import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  approvedEmailDecision,
  runApprovedEmailAnswer,
  type ApprovedEmailSnapshot,
} from "@/lib/acquisition/email-manual-answer";
import {
  applyBlockPage,
  automaticSendsAllowed,
  blockImportPlan,
  claimImportLease,
  commitImportLease,
  invalidEntryError,
  parseBlockListPage,
  runBlockImport,
  type BlockImportCommit,
  type BlockImportEntry,
  type BlockImportPerson,
  type BlockImportReason,
  type BlockImportStore,
  type ImportLease,
} from "@/lib/acquisition/instantly-block-import";

const NOW = new Date("2026-11-17T15:00:00.000Z");

function entry(id: string, value: string, isDomain = false): BlockImportEntry {
  return { id, value, isDomain };
}

function page(entries: readonly BlockImportEntry[], next: string | null) {
  return {
    items: entries.map((item) => ({
      id: item.id,
      timestamp_created: NOW.toISOString(),
      organization_id: "org-1",
      bl_value: item.value,
      is_domain: item.isDomain,
    })),
    next_starting_after: next,
  };
}

function person(id: string, email: string, lifecycle: BlockImportPerson["lifecycle"]): BlockImportPerson {
  return { id, email, lifecycle };
}

function memory(initial?: {
  reasons?: Record<string, BlockImportReason>;
  people?: BlockImportPerson[];
  domainPeople?: BlockImportPerson[];
}) {
  const reasons = new Map(Object.entries(initial?.reasons ?? {}));
  const people = new Map((initial?.people ?? []).map((row) => [row.email, row]));
  const calls = {
    inserts: [] as string[],
    cancels: [] as string[],
    expired: [] as string[],
    advances: [] as string[],
    events: [] as Array<{ personId: string | null; providerEventId: string }>,
    domains: [] as string[],
    domainUpdates: [] as string[],
    domainCancels: [] as string[],
  };
  let failInsert = false;
  let domainCancelFails = false;
  const store: BlockImportStore = {
    suppressionReason: async (email) => reasons.get(email) ?? null,
    insertSuppression: async (email) => {
      calls.inserts.push(email);
      if (failInsert) return "failed";
      if (reasons.has(email)) return "duplicate";
      reasons.set(email, "provider");
      return "inserted";
    },
    personByEmail: async (email) => people.get(email) ?? null,
    advanceLifecycle: async (id, from, to) => {
      calls.advances.push(`${id}:${from}:${to}`);
      const row = [...people.values()].find((item) => item.id === id);
      if (row) row.lifecycle = to;
      return "advanced";
    },
    cancelScheduled: async (id) => {
      calls.cancels.push(id);
      return true;
    },
    cancelExpiredClaims: async (id) => {
      calls.expired.push(id);
      return true;
    },
    clearNextAction: async () => true,
    insertEvent: async (args) => {
      if (calls.events.some((event) => event.providerEventId === args.providerEventId)) return "duplicate";
      calls.events.push(args);
      return "stored";
    },
    upsertDomain: async (args) => {
      if (calls.domains.includes(args.domain)) calls.domainUpdates.push(args.domain);
      else calls.domains.push(args.domain);
      return true;
    },
    cancelDomainOutbound: async (domain) => {
      calls.domainCancels.push(domain);
      return !domainCancelFails;
    },
  };
  return {
    store,
    calls,
    reasons,
    people,
    fail: () => { failInsert = true; },
    failDomain: () => { domainCancelFails = true; },
    repairDomain: () => { domainCancelFails = false; },
  };
}

function claimed(cursor: string | null = null, generation = 1) {
  return { ok: true as const, generation, cursor, cycle: 0, pages: 0 };
}

describe("instantly block import", () => {
  it("imports one new block, preserves stronger reasons, and does not invent a reason", async () => {
    const fresh = memory({
      people: [person("person-1", "coach@school.edu", "cold_active")],
    });
    expect(await applyBlockPage(fresh.store, [entry("entry-1", "coach@school.edu")])).toBe(true);
    expect(fresh.calls.inserts).toEqual(["coach@school.edu"]);
    expect(fresh.reasons.get("coach@school.edu")).toBe("provider");
    expect(fresh.calls.advances).toEqual(["person-1:cold_active:suppressed"]);
    expect(fresh.calls.cancels).toEqual(["person-1"]);
    expect(fresh.calls.events).toEqual([{ personId: "person-1", providerEventId: "instantly-block:entry-1" }]);

    const kept = memory({
      reasons: { "coach@school.edu": "unsubscribe", "other@school.edu": "complaint" },
      people: [
        person("person-1", "coach@school.edu", "unsubscribed"),
        person("person-2", "other@school.edu", "not_interested"),
        person("person-3", "member@school.edu", "paid_member"),
      ],
    });
    expect(await applyBlockPage(kept.store, [
      entry("entry-1", "coach@school.edu"),
      entry("entry-2", "other@school.edu"),
      entry("entry-3", "member@school.edu"),
    ])).toBe(true);
    expect(kept.calls.inserts).toEqual(["member@school.edu"]);
    expect(kept.reasons.get("coach@school.edu")).toBe("unsubscribe");
    expect(kept.reasons.get("other@school.edu")).toBe("complaint");
    expect(kept.calls.advances).toEqual([]);
    expect(kept.people.get("coach@school.edu")?.lifecycle).toBe("unsubscribed");
    expect(kept.people.get("other@school.edu")?.lifecycle).toBe("not_interested");
    expect(kept.people.get("member@school.edu")?.lifecycle).toBe("paid_member");
    expect(blockImportPlan({
      entryId: "entry-1",
      person: { id: "person-1", lifecycle: "unsubscribed" },
      existingReason: "unsubscribe",
      eventPersonId: null,
    }).insertSuppression).toBe(false);
  });

  it("records a previously unknown address without a person or a cancel", async () => {
    const unknown = memory();
    expect(await applyBlockPage(unknown.store, [entry("entry-9", "new@school.edu")])).toBe(true);
    expect(unknown.calls.inserts).toEqual(["new@school.edu"]);
    expect(unknown.calls.cancels).toEqual([]);
    expect(unknown.calls.events).toEqual([{ personId: null, providerEventId: "instantly-block:entry-9" }]);
  });

  it("records a domain block once and cancels matching outbound work without loading people", async () => {
    const domain = memory({
      people: Array.from({ length: 10001 }, (_, index) => person(
        `person-${index}`,
        `coach${index}@school.edu`,
        "cold_active",
      )),
    });
    expect(await applyBlockPage(domain.store, [entry("domain-1", "school.edu", true)])).toBe(true);
    expect(domain.calls.domains).toEqual(["school.edu"]);
    expect(domain.calls.domainCancels).toEqual(["school.edu"]);
    expect(domain.calls.inserts).toEqual([]);
    expect(domain.calls.cancels).toEqual([]);
    expect(domain.calls.advances).toEqual([]);
    expect(domain.calls.events).toEqual([{ personId: null, providerEventId: "instantly-block:domain-1" }]);
    expect(domain.people.get("coach0@school.edu")?.lifecycle).toBe("cold_active");
    expect(await applyBlockPage(domain.store, [entry("domain-1", "school.edu", true)])).toBe(true);
    expect(domain.calls.domainUpdates).toEqual(["school.edu"]);
    expect(domain.calls.domainCancels).toEqual(["school.edu", "school.edu"]);
  });

  it("does not advance the blocklist cursor when domain protection fails, then resumes", async () => {
    const domain = memory();
    domain.failDomain();
    const commits: BlockImportCommit[] = [];
    let cursor: string | null = null;
    const failed = await runBlockImport({
      now: NOW,
      budget: 5,
      claim: async () => claimed(cursor),
      readPage: async () => ({ ok: true, body: page([entry("domain-1", "school.edu", true)], "cursor-2") }),
      applyPage: (entries) => applyBlockPage(domain.store, entries),
      commit: async (patch) => {
        commits.push(patch);
        if (patch.kind === "progress") cursor = patch.cursor;
        return true;
      },
    });
    expect(failed).toMatchObject({ cycleCompletedThisRun: false, error: "database" });
    expect(cursor).toBeNull();
    expect(domain.calls.domains).toEqual(["school.edu"]);
    expect(commits.some((patch) => patch.kind === "progress")).toBe(false);
    domain.repairDomain();
    const retried = await runBlockImport({
      now: NOW,
      budget: 5,
      claim: async () => claimed(cursor, 2),
      readPage: async () => ({ ok: true, body: page([entry("domain-1", "school.edu", true)], null) }),
      applyPage: (entries) => applyBlockPage(domain.store, entries),
      commit: async () => true,
    });
    expect(retried.cycleCompletedThisRun).toBe(true);
    expect(domain.calls.domainUpdates).toEqual(["school.edu"]);
    expect(domain.calls.domainCancels.filter((item) => item === "school.edu").length).toBeGreaterThan(1);
  });

  it("treats a duplicate entry as the same suppression and event", async () => {
    const rows = memory({ people: [person("person-1", "coach@school.edu", "cold_active")] });
    const parsed = parseBlockListPage(page([
      entry("entry-1", "coach@school.edu"),
      entry("entry-1", "Coach@School.edu"),
    ], null));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries.map((item) => item.value)).toEqual(["coach@school.edu", "coach@school.edu"]);
    expect(await applyBlockPage(rows.store, parsed.entries)).toBe(true);
    expect(rows.calls.inserts).toEqual(["coach@school.edu"]);
    expect(rows.calls.events).toHaveLength(1);
    expect(rows.reasons.get("coach@school.edu")).toBe("provider");
  });

  it("stops a page when a database write fails and does not continue", async () => {
    const rows = memory({
      people: [
        person("person-1", "one@school.edu", "cold_active"),
        person("person-2", "two@school.edu", "cold_active"),
      ],
    });
    rows.fail();
    expect(await applyBlockPage(rows.store, [
      entry("entry-1", "one@school.edu"),
      entry("entry-2", "two@school.edu"),
    ])).toBe(false);
    expect(rows.calls.events).toEqual([]);
    expect(rows.calls.cancels).toEqual([]);
  });

  it("walks thousands of entries across pages, then resumes after an interruption", async () => {
    const total = 2500;
    const bodies = new Map<string, unknown>();
    let previous = "";
    for (let start = 0; start < total; start += 100) {
      const entries = Array.from({ length: Math.min(100, total - start) }, (_, offset) => {
        const index = start + offset;
        return entry(`id-${index}`, `coach${index}@school.edu`);
      });
      const next = start + 100 < total ? `cursor-${start + 100}` : null;
      bodies.set(previous, page(entries, next));
      previous = next ?? previous;
    }
    const seen: string[] = [];
    const commits: BlockImportCommit[] = [];
    let cursor: string | null = null;
    const readPage = async (request: string | null) => ({ ok: true as const, body: bodies.get(request ?? "") });
    const first = await runBlockImport({
      now: NOW,
      budget: 20,
      claim: async () => claimed(cursor),
      readPage,
      applyPage: async (entries) => {
        seen.push(...entries.map((item) => item.value));
        return true;
      },
      commit: async (patch) => {
        commits.push(patch);
        if (patch.kind === "progress") cursor = patch.cursor;
        return true;
      },
    });
    expect(first.cycleCompletedThisRun).toBe(false);
    expect(first.pagesRead).toBe(20);
    expect(seen).toHaveLength(2000);
    expect(cursor).toBe("cursor-2000");
    const second = await runBlockImport({
      now: NOW,
      budget: 20,
      claim: async () => claimed(cursor, 2),
      readPage,
      applyPage: async (entries) => {
        seen.push(...entries.map((item) => item.value));
        return true;
      },
      commit: async (patch) => {
        commits.push(patch);
        if (patch.kind === "complete") cursor = null;
        return true;
      },
    });
    expect(second.cycleCompletedThisRun).toBe(true);
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect(commits.some((patch) => patch.kind === "complete")).toBe(true);
    expect(cursor).toBeNull();
  });

  it("does not advance after a provider timeout, a 429, a truncated page, or a repeated cursor", async () => {
    for (const error of ["timeout_or_network", "rate_limited"]) {
      const applied: string[] = [];
      const commits: BlockImportCommit[] = [];
      const result = await runBlockImport({
        now: NOW,
        budget: 5,
        claim: async () => claimed("cursor-1"),
        readPage: async () => ({ ok: false, error }),
        applyPage: async (entries) => {
          applied.push(...entries.map((item) => item.value));
          return true;
        },
        commit: async (patch) => {
          commits.push(patch);
          return true;
        },
      });
      expect(result).toMatchObject({ cycleCompletedThisRun: false, error, pagesRead: 0 });
      expect(applied).toEqual([]);
      expect(commits).toEqual([{ kind: "error", generation: 1, error }]);
    }

    const truncated = await runBlockImport({
      now: NOW,
      budget: 5,
      claim: async () => claimed(),
      readPage: async () => ({ ok: true, body: { items: [], next_starting_after: "cursor-2" } }),
      applyPage: async () => true,
      commit: async () => true,
    });
    expect(truncated).toMatchObject({ cycleCompletedThisRun: false, error: "empty_page_with_cursor" });

    const repeatedCommits: BlockImportCommit[] = [];
    const repeated = await runBlockImport({
      now: NOW,
      budget: 5,
      claim: async () => claimed("cursor-1"),
      readPage: async () => ({ ok: true, body: page([entry("id-1", "coach@school.edu")], "cursor-1") }),
      applyPage: async () => true,
      commit: async (patch) => {
        repeatedCommits.push(patch);
        return true;
      },
    });
    expect(repeated.cycleCompletedThisRun).toBe(false);
    expect(repeated.error).toBe("cursor_repeated");
    expect(repeatedCommits.some((patch) => patch.kind === "progress")).toBe(false);

    const malformed = await runBlockImport({
      now: NOW,
      budget: 5,
      claim: async () => claimed(),
      readPage: async () => ({
        ok: true,
        body: { items: [{ id: "id-1", bl_value: "coach@school.edu" }], next_starting_after: null },
      }),
      applyPage: async () => {
        throw new Error("malformed page was applied");
      },
      commit: async () => true,
    });
    expect(malformed).toMatchObject({ cycleCompletedThisRun: false, error: "invalid_entry:id-1" });
  });

  it("keeps an unreadable page temporary and holds a malformed entry without discarding it", async () => {
    const wrapper = await runBlockImport({
      now: NOW,
      budget: 5,
      claim: async () => claimed(),
      readPage: async () => ({ ok: true, body: { nope: true } }),
      applyPage: async () => true,
      commit: async () => true,
    });
    expect(wrapper).toMatchObject({ cycleCompletedThisRun: false, error: "unreadable" });

    const commits: BlockImportCommit[] = [];
    let cursor: string | null = "cursor-1";
    const held = await runBlockImport({
      now: NOW,
      budget: 5,
      claim: async () => claimed(cursor),
      readPage: async () => ({
        ok: true,
        body: page(
          [entry("good-1", "coach@school.edu"), entry("bad-1", "not an email")],
          "cursor-2",
        ),
      }),
      applyPage: async () => {
        throw new Error("page with an invalid entry was applied");
      },
      commit: async (patch) => {
        commits.push(patch);
        if (patch.kind === "progress") cursor = patch.cursor;
        return true;
      },
    });
    expect(held).toMatchObject({ cycleCompletedThisRun: false, error: invalidEntryError("bad-1") });
    expect(cursor).toBe("cursor-1");
    expect(commits).toEqual([{ kind: "error", generation: 1, error: "invalid_entry:bad-1" }]);
    expect(automaticSendsAllowed({ readable: true, cycleCompletedThisRun: held.cycleCompletedThisRun })).toBe(false);

    const recovered = await runBlockImport({
      now: NOW,
      budget: 5,
      claim: async () => claimed(cursor, 2),
      readPage: async () => ({ ok: true, body: page([entry("good-1", "coach@school.edu")], null) }),
      applyPage: async () => true,
      commit: async () => true,
    });
    expect(recovered.cycleCompletedThisRun).toBe(true);
  });

  it("keeps the cursor when a database write fails and lets a second run resume", async () => {
    const commits: BlockImportCommit[] = [];
    const failed = await runBlockImport({
      now: NOW,
      budget: 5,
      claim: async () => claimed("cursor-1"),
      readPage: async () => ({ ok: true, body: page([entry("id-1", "coach@school.edu")], "cursor-2") }),
      applyPage: async () => false,
      commit: async (patch) => {
        commits.push(patch);
        return true;
      },
    });
    expect(failed).toMatchObject({ cycleCompletedThisRun: false, error: "database" });
    expect(commits).toEqual([{ kind: "error", generation: 1, error: "database" }]);
  });

  it("lets only one of two overlapping runs own the lease", async () => {
    let lease = freshLease();
    let reads = 0;
    const claim = async () => {
      const snapshot = lease;
      const decision = claimImportLease(snapshot, NOW);
      await Promise.resolve();
      if (!decision.ok) return decision;
      if (lease.generation !== snapshot.generation || leaseIsCurrent(lease, NOW)) {
        return { ok: false as const, reason: "contended" as const };
      }
      lease = decision.lease;
      return decision.claim;
    };
    const run = () => runBlockImport({
      now: NOW,
      budget: 1,
      claim,
      readPage: async () => {
        reads += 1;
        return { ok: true, body: page([], null) };
      },
      applyPage: async () => true,
      commit: async (patch) => {
        const decision = commitImportLease(lease, patch, NOW);
        if (!decision.ok) return false;
        lease = decision.lease;
        return true;
      },
    });
    const [left, right] = await Promise.all([run(), run()]);
    const readsByRun = [left.pagesRead, right.pagesRead].sort();
    expect(readsByRun).toEqual([0, 1]);
    expect(reads).toBe(1);
    expect([left, right].filter((item) => item.cycleCompletedThisRun)).toHaveLength(1);
    expect(lease.generation).toBe(1);
    expect(lease.claimUntil).toBeNull();
  });

  it("renews the lease, rejects an expired owner, and refuses an older generation", () => {
    let lease = freshLease();
    const claimedLease = claimImportLease(lease, NOW);
    expect(claimedLease.ok).toBe(true);
    if (!claimedLease.ok) return;
    lease = claimedLease.lease;
    const owner = claimedLease.claim;
    const later = new Date(NOW.getTime() + 60_000);
    const progress = commitImportLease(lease, {
      kind: "progress",
      generation: owner.generation,
      cursor: "cursor-2",
      pages: 1,
    }, later);
    expect(progress.ok).toBe(true);
    if (!progress.ok) return;
    lease = progress.lease;
    expect(lease.cursor).toBe("cursor-2");
    expect(lease.claimUntil).toBe(new Date(later.getTime() + 4 * 60 * 1000).toISOString());
    expect(claimImportLease(lease, later).ok).toBe(false);

    const expiredAt = new Date(later.getTime() + 4 * 60 * 1000);
    expect(commitImportLease(lease, {
      kind: "progress",
      generation: owner.generation,
      cursor: "cursor-3",
      pages: 2,
    }, expiredAt).ok).toBe(false);
    expect(lease.cursor).toBe("cursor-2");

    const takeover = claimImportLease(lease, expiredAt);
    expect(takeover.ok).toBe(true);
    if (!takeover.ok) return;
    expect(takeover.claim.cursor).toBe("cursor-2");
    expect(takeover.claim.generation).toBe(owner.generation + 1);
    const stolen = takeover.lease;
    expect(commitImportLease(stolen, {
      kind: "progress",
      generation: owner.generation,
      cursor: "cursor-old",
      pages: 9,
    }, expiredAt).ok).toBe(false);
    const renewed = commitImportLease(stolen, {
      kind: "progress",
      generation: takeover.claim.generation,
      cursor: "cursor-2",
      pages: 1,
    }, expiredAt);
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    expect(renewed.lease.cursor).toBe("cursor-2");
    expect(renewed.lease.generation).toBe(takeover.claim.generation);
  });

  it("does not unsuppress an address that disappears from a later snapshot", async () => {
    const seen: string[][] = [];
    const bodies = [
      page([entry("id-1", "keep@school.edu"), entry("id-2", "gone@school.edu")], null),
      page([entry("id-1", "keep@school.edu")], null),
    ];
    let index = 0;
    const run = () => runBlockImport({
      now: NOW,
      budget: 5,
      claim: async () => claimed(null, index + 1),
      readPage: async () => ({ ok: true, body: bodies[index++] }),
      applyPage: async (entries) => {
        seen.push(entries.map((item) => item.value));
        return true;
      },
      commit: async () => true,
    });
    expect((await run()).cycleCompletedThisRun).toBe(true);
    expect((await run()).cycleCompletedThisRun).toBe(true);
    expect(seen).toEqual([["keep@school.edu", "gone@school.edu"], ["keep@school.edu"]]);
  });
});

describe("automatic send clearance", () => {
  it("allows automatic sends only after the current invocation finishes the walk", () => {
    expect(automaticSendsAllowed({ readable: true, cycleCompletedThisRun: false })).toBe(false);
    expect(automaticSendsAllowed({ readable: false, cycleCompletedThisRun: false })).toBe(false);
    expect(automaticSendsAllowed({ readable: false, cycleCompletedThisRun: true })).toBe(false);
    expect(automaticSendsAllowed({ readable: true, cycleCompletedThisRun: true })).toBe(true);
    const source = readFileSync("src/lib/acquisition/instantly-block-import.ts", "utf8");
    expect(source).not.toContain("automaticSendClearance");
    expect(source).not.toContain("verifyRecipientSet");
    expect(source).not.toContain("classifyBlockSearch");
    expect(source).not.toContain('verdict: "absent"');
  });
});

describe("outbound protection wiring", () => {
  it("checks a manual answer against the local suppression and does not post after a later stop", async () => {
    const now = new Date("2026-10-25T22:00:00.000Z");
    const sendable = manualSnapshot(false);
    expect(approvedEmailDecision(manualSnapshot(true), now).action).toBe("block_opt_out");
    expect(approvedEmailDecision({
      ...sendable,
      person: { ...sendable.person, suppressed: null },
    }, now)).toMatchObject({ action: "refuse", reason: "suppression_unknown" });
    let reads = 0;
    const posts = vi.fn();
    const marked: string[] = [];
    const result = await runApprovedEmailAnswer({
      now,
      apiKey: "test-key",
      read: async () => {
        reads += 1;
        return reads < 3 ? sendable : manualSnapshot(true);
      },
      mark: async (status) => {
        marked.push(status);
        return true;
      },
      claim: async () => "claimed",
      insertOutbound: async () => "inserted",
      recordOutbound: async () => true,
      fetchImpl: posts,
    });
    expect(result).toMatchObject({ state: "blocked", reason: "ineligible" });
    expect(posts).not.toHaveBeenCalled();
    expect(marked).toContain("blocked");
  });

  it("keeps import, cancellation, and send gates inside the existing acquisition path", () => {
    const server = readFileSync("src/lib/acquisition/instantly-block-import.server.ts", "utf8");
    const pure = readFileSync("src/lib/acquisition/instantly-block-import.ts", "utf8");
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    const manual = readFileSync("src/lib/acquisition/email-manual-answer.ts", "utf8");
    const manualServer = readFileSync("src/lib/acquisition/email-manual-answer.server.ts", "utf8");
    const pass = readFileSync("src/lib/acquisition/pass.ts", "utf8");
    const cron = store.slice(store.indexOf("export async function runAcquisitionCron"));
    const scheduled = server.slice(server.indexOf("async function cancelScheduled"), server.indexOf("async function cancelExpiredClaims"));
    const expired = server.slice(server.indexOf("async function cancelExpiredClaims"), server.indexOf("async function clearNextAction"));
    const errorAt = server.indexOf("instantly_block_import_error: decision.lease.error");
    const errorPatch = server.slice(errorAt, server.indexOf("const { data, error }", errorAt));
    const progressAt = server.indexOf("patch.kind === \"progress\"");
    const progressPatch = server.slice(progressAt, server.indexOf("patch.kind === \"complete\""));
    const domainWrite = server.slice(server.indexOf("async function upsertDomain"), server.indexOf("async function readImportState"));
    const domainUpdate = domainWrite.slice(domainWrite.indexOf(".update("));

    expect(server).toContain("runBlockImport");
    expect(server).toContain("applyBlockPage");
    const claimFn = server.slice(server.indexOf("async function claimImport"), server.indexOf("async function commitImport"));
    const commitFn = server.slice(server.indexOf("async function commitImport"), server.indexOf("async function readBlockPage"));
    expect(server).toContain("claim: () => claimImport(clock())");
    expect(server).toContain("commit: (patch) => commitImport(patch, clock())");
    expect(claimFn).not.toContain("new Date()");
    expect(commitFn).not.toContain("new Date()");
    expect(server).toContain("claimImportLease");
    expect(server).toContain("commitImportLease");
    expect(server).toContain("acquisition_cancel_domain_outbound");
    expect(server).toContain('.gt("instantly_block_import_claim_until", now.toISOString())');
    expect(server).toContain('method: "GET"');
    expect(server).not.toContain("verifyRecipientSet");
    expect(server).not.toContain("peopleOnDomain");
    expect(server).not.toContain('searchParams.set("search"');
    expect(server).toContain('reason: "provider"');
    expect(server).toContain('.eq("instantly_block_import_generation", state.lease.generation)');
    expect(server).toContain('.eq("instantly_block_import_generation", patch.generation)');
    expect(server).not.toContain('method: "POST"');
    expect(server).not.toContain('method: "DELETE"');
    expect(server).not.toContain(".delete(");
    expect(server).not.toContain("emails.send");
    expect(server).not.toContain("postInstantlyThreadReply");
    expect(server).not.toContain("ensureInstantlyBlock");
    expect(server).not.toContain('reason: "unsubscribe"');
    expect(server).not.toContain('reason: "complaint"');
    expect(server).not.toContain('reason: "bounce"');
    expect(pure + server).not.toContain("playbook");
    expect(pure + server).not.toContain("campaign-activation");
    expect(scheduled).toContain('.eq("status", "scheduled")');
    expect(scheduled).not.toContain("accepted");
    expect(scheduled).not.toContain("delivered");
    expect(expired).toContain('.eq("status", "claimed")');
    expect(expired).toContain("claim_until.lte");
    expect(expired).not.toContain("accepted");
    expect(errorPatch).not.toContain("cursor");
    expect(progressPatch).toContain("instantly_block_import_claim_until: decision.lease.claimUntil");
    expect(progressPatch).not.toContain("instantly_block_import_claim_until: null");
    expect(domainWrite.slice(0, domainWrite.indexOf(".update("))).toContain("first_seen_at");
    expect(domainUpdate).not.toContain("first_seen_at");
    expect(parseBlockListPage({ items: [], next_starting_after: null })).toMatchObject({ ok: true, entries: [] });

    expect(cron).toContain("clock: () => Date = () => new Date()");
    expect(cron.indexOf("importInstantlyBlockList")).toBeLessThan(cron.indexOf("reconcileMissingInstantlyBlocks"));
    expect(cron.indexOf("reconcileMissingInstantlyBlocks")).toBeLessThan(cron.indexOf("deliverPendingInstantlyBlocks"));
    expect(cron.indexOf("importInstantlyBlockList")).toBeLessThan(cron.indexOf('skipped: "automation_off"'));
    expect(cron.indexOf('skipped: "automation_off"')).toBeLessThan(cron.indexOf('skipped: "block_import_held"'));
    expect(cron.indexOf('skipped: "automation_off"')).toBeLessThan(cron.indexOf("runAcquisitionPass"));
    expect(cron).toContain("cycleCompletedThisRun");
    expect(cron).toContain("automaticSendsAllowed");
    expect(cron).not.toContain("automaticSendClearance");
    expect(cron).not.toContain("verifyAutomaticRecipients");
    expect(cron).not.toContain("emailsQueuedForAutomaticSend");
    expect(cron).not.toContain("postInstantlyThreadReply");
    expect(cron).not.toContain("instantly_block_import_completed_at");
    const migration = readFileSync("supabase/migrations/20261117160000_instantly_block_import.sql", "utf8");
    expect(migration).toContain("acquisition_cancel_domain_outbound");
    expect(migration).toContain("acquisition_people_email_domain_idx");
    expect(migration).toContain("status = 'scheduled'");
    expect(migration).toContain("status = 'claimed'");
    expect(migration).not.toContain("status = 'accepted'");
    expect(migration).not.toContain("status = 'delivered'");
    expect(migration).not.toContain("DELETE FROM");
    for (const historical of ["00b17f01", "0b629c19", "24903120", "3c7c2aeb", "4306e289", "7e6e0c3c"]) {
      expect(pure + server + cron + migration).not.toContain(historical);
    }

    expect(manual).toContain("weaker freshness guarantee");
    expect(manual.lastIndexOf("const latest = await deps.read()")).toBeGreaterThan(manual.indexOf("insertOutbound"));
    expect(manual.lastIndexOf("const latest = await deps.read()")).toBeLessThan(manual.lastIndexOf("postInstantlyThreadReply"));
    expect(manualServer).toContain("durableAcquisitionStop");
    expect(manualServer).not.toContain("INSTANTLY_BLOCK_LIST_URL");
    expect(manualServer).not.toContain("block-lists-entries");
    const sendAt = pass.indexOf("const result = await args.send");
    expect(pass.lastIndexOf("args.suppression", sendAt)).toBeGreaterThan(pass.indexOf("evaluateWarmSend"));
    expect(pass.lastIndexOf("args.suppression", sendAt)).toBeLessThan(sendAt);
  });
});

function freshLease(): ImportLease {
  return {
    cursor: null,
    cycle: 0,
    pages: 0,
    generation: 0,
    claimUntil: null,
    completedCycle: null,
    completedAt: null,
    error: null,
  };
}

function leaseIsCurrent(lease: ImportLease, now: Date): boolean {
  return lease.claimUntil != null && Date.parse(lease.claimUntil) > now.getTime();
}

function manualSnapshot(suppressed: boolean): ApprovedEmailSnapshot {
  return {
    readable: true,
    request: {
      id: "request-1",
      status: "open",
      approvedBody: "The annual plan is $249/year after the trial.",
      inboundMessageId: "inbound-1",
      personId: "person-1",
      journeyId: "journey-1",
      claimUntil: null,
    },
    inbound: {
      replyToProviderMessageId: "01234567-89ab-cdef-0123-456789abcdef",
      senderAccount: "outreach@summittmindset.com",
      subject: "Summitt Mindset",
      leadEmail: "coach@school.edu",
      campaignId: "camp-1",
    },
    person: {
      found: true,
      lifecycle: "reply_needs_review",
      suppressed,
      clerkSubscribed: false,
    },
    outbound: null,
  };
}
