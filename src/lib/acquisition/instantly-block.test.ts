import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { decideConversationEffect, nextClaimDecision } from "@/lib/acquisition/conversation";
import {
  INSTANTLY_BLOCK_LIST_URL,
  advanceInstantlyBlock,
  blockBackoffMs,
  blockClaimHeld,
  instantlyBlockReasonForLifecycle,
  instantlyBlockReasonForSuppression,
  instantlyBlockSourceId,
  instantlyBlocklistEnabled,
  mergeBlockIntent,
  planInstantlyBlockCoverage,
  type InstantlyBlockReason,
} from "@/lib/acquisition/instantly-block";
import {
  RECONCILE_MAX_PAGES,
  RECONCILE_PAGE_SIZE,
  RECONCILE_RECENT,
  RECONCILE_WRITE_CAP,
  deliverPendingInstantlyBlocks,
  ensureInstantlyBlock,
  reconcileMissingInstantlyBlocks,
} from "@/lib/acquisition/instantly-block.server";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: (...args: unknown[]) => from(...args) },
}));

const EMAIL = "person@example.com";
const ENTRY_ID = "01a16e56-3045-7cc4-b98b-540b85edb1fd";

function entry(email = EMAIL) {
  return {
    id: ENTRY_ID,
    timestamp_created: "2026-10-24T14:35:04.645Z",
    organization_id: "01a16e56-3045-7cc4-b98b-540c6e8d2986",
    bl_value: email,
    is_domain: false,
  };
}

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function query(result: { data: unknown; error: { code?: string } | null }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const builder: object = new Proxy({}, {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject);
      }
      if (typeof prop !== "string") return undefined;
      return (...args: unknown[]) => {
        calls.push({ method: prop, args });
        return builder;
      };
    },
  });
  return { calls, builder };
}

const NOW = new Date("2026-10-24T12:00:00.000Z");

function blockRow(attemptCount: number) {
  return {
    id: "block-1",
    person_id: "person-1",
    email_normalized: EMAIL,
    reason: "paid_member",
    status: "failed",
    source_event_id: "stripe:paid:evt_paid",
    provider_entry_id: null,
    provider_confirmed_at: null,
    evidence: [],
    attempt_count: attemptCount,
    claim_until: "2026-10-24T11:00:00.000Z",
    next_attempt_at: null,
  };
}

describe("instantly subscriber stop", () => {
  it("blocks trial, paid, unsubscribe, complaint, and bounce, and leaves decline and cancellation alone", () => {
    expect(instantlyBlockReasonForLifecycle("trial_started")).toBe("trial_started");
    expect(instantlyBlockReasonForLifecycle("paid_member")).toBe("paid_member");
    expect(instantlyBlockReasonForLifecycle("trial_expired")).toBeNull();
    expect(instantlyBlockReasonForLifecycle("not_interested")).toBeNull();
    expect(instantlyBlockReasonForLifecycle("offer_decline")).toBeNull();
    expect(instantlyBlockReasonForSuppression("unsubscribe")).toBe("unsubscribe");
    expect(instantlyBlockReasonForSuppression("complaint")).toBe("complaint");
    expect(instantlyBlockReasonForSuppression("bounce")).toBe("bounce");
    expect(instantlyBlockReasonForSuppression("provider")).toBeNull();
    expect(instantlyBlocklistEnabled("on")).toBe(true);
    expect(instantlyBlocklistEnabled("off")).toBe(false);
    expect(instantlyBlocklistEnabled(undefined)).toBe(false);
  });

  it("keeps a confirmed block when a duplicate or older event arrives", () => {
    const existing = {
      personId: "person-1",
      reason: "paid_member" as InstantlyBlockReason,
      status: "confirmed" as const,
      providerEntryId: ENTRY_ID,
      evidence: [{ reason: "paid_member" as InstantlyBlockReason, sourceEventId: "stripe:paid:evt_paid" }],
    };
    const merged = mergeBlockIntent(existing, {
      personId: null,
      reason: "trial_started",
      sourceEventId: "stripe:trial:evt_late",
    });
    expect(merged.status).toBe("confirmed");
    expect(merged.providerEntryId).toBe(ENTRY_ID);
    expect(merged.reason).toBe("paid_member");
    expect(merged.evidence.map((item) => item.reason)).toEqual(["paid_member", "trial_started"]);
    const again = mergeBlockIntent(merged, {
      personId: "person-1",
      reason: "trial_started",
      sourceEventId: "stripe:trial:evt_late",
    });
    expect(again.evidence).toHaveLength(2);
  });

  it("does not call Instantly while the integration is inactive", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await advanceInstantlyBlock({
      enabled: false,
      apiKey: "test-key",
      email: EMAIL,
      status: "pending",
      fetchImpl,
    });
    expect(result.requested).toBe(false);
    expect(result.status).toBe("pending");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("confirms a create response and does not treat permission or rate limit as success", async () => {
    const created = vi.fn<typeof fetch>(async () => response(200, entry()));
    const ok = await advanceInstantlyBlock({
      enabled: true,
      apiKey: "test-key",
      email: EMAIL,
      status: "pending",
      fetchImpl: created,
    });
    expect(ok).toMatchObject({ status: "confirmed", providerEntryId: ENTRY_ID, requested: true });
    const post = created.mock.calls[0];
    expect(String(post?.[0])).toBe(INSTANTLY_BLOCK_LIST_URL);
    expect(post?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ bl_value: EMAIL });

    for (const status of [401, 403]) {
      const denied = vi.fn<typeof fetch>(async () => response(status, { message: "no" }));
      const result = await advanceInstantlyBlock({
        enabled: true,
        apiKey: "test-key",
        email: EMAIL,
        status: "pending",
        fetchImpl: denied,
      });
      expect(result.status).toBe("failed");
      expect(result.lastError).toBe("permission_denied");
      expect(result.providerEntryId).toBeNull();
    }

    const limited = vi.fn<typeof fetch>(async () => response(429, { message: "slow" }));
    const retry = await advanceInstantlyBlock({
      enabled: true,
      apiKey: "test-key",
      email: EMAIL,
      status: "pending",
      fetchImpl: limited,
    });
    expect(retry.status).toBe("pending");
    expect(retry.lastError).toBe("rate_limited");
    expect(retry.providerEntryId).toBeNull();
  });

  it("keeps a timeout uncertain, then confirms from a later read-back without posting twice in that read", async () => {
    const timeout = vi.fn<typeof fetch>(async () => {
      throw new Error("network down");
    });
    const first = await advanceInstantlyBlock({
      enabled: true,
      apiKey: "test-key",
      email: EMAIL,
      status: "pending",
      fetchImpl: timeout,
    });
    expect(first).toMatchObject({ status: "uncertain", lastError: "timeout_or_network" });

    const read = vi.fn<typeof fetch>(async () => response(200, { items: [entry()] }));
    const second = await advanceInstantlyBlock({
      enabled: true,
      apiKey: "test-key",
      email: EMAIL,
      status: "uncertain",
      fetchImpl: read,
    });
    expect(second).toMatchObject({ status: "confirmed", providerEntryId: ENTRY_ID });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
    expect(String(read.mock.calls[0]?.[0])).toContain("search=");
    expect(String(read.mock.calls[0]?.[0])).not.toContain("/campaigns");
  });

  it("posts again only after a read-back shows the earlier write is absent", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { items: [] }))
      .mockResolvedValueOnce(response(200, entry()));
    const result = await advanceInstantlyBlock({
      enabled: true,
      apiKey: "test-key",
      email: EMAIL,
      status: "uncertain",
      fetchImpl,
    });
    expect(result.status).toBe("confirmed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
  });

  it("confirms an already-present entry when create returns 400", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(400, { message: "exists" }))
      .mockResolvedValueOnce(response(200, { items: [entry()] }));
    const result = await advanceInstantlyBlock({
      enabled: true,
      apiKey: "test-key",
      email: EMAIL,
      status: "pending",
      fetchImpl,
    });
    expect(result).toMatchObject({ status: "confirmed", providerEntryId: ENTRY_ID });
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({ method: "GET" });
  });

  it("wires stops without an unblock, and the drain stays inactive until the switch is on", () => {
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    const trial = store.slice(
      store.indexOf("export async function noteAcquisitionTrial"),
      store.indexOf("export async function noteAcquisitionClerk"),
    );
    const paid = store.slice(
      store.indexOf("export async function noteAcquisitionPaid"),
      store.indexOf("export async function noteAcquisitionClosed"),
    );
    const closed = store.slice(
      store.indexOf("export async function noteAcquisitionClosed"),
      store.indexOf("export async function loadAcquisitionDashboard"),
    );
    const suppression = store.slice(
      store.indexOf("async function rememberSuppression"),
      store.indexOf("async function applySignal"),
    );
    const server = readFileSync("src/lib/acquisition/instantly-block.server.ts", "utf8");
    const transport = readFileSync("src/lib/acquisition/instantly-block.ts", "utf8");
    const migration = readFileSync("supabase/migrations/20261024120000_acquisition_instantly_blocklist.sql", "utf8");
    const conversation = readFileSync("src/lib/acquisition/conversation.ts", "utf8");
    expect(trial).toContain('reason: "trial_started"');
    expect(paid).toContain('reason: "paid_member"');
    expect(closed).not.toContain("ensureInstantlyBlock");
    expect(closed).toContain("trial_expired");
    expect(suppression).toContain("ensureInstantlyBlock");
    expect(suppression.indexOf("recovery_suppressions")).toBeLessThan(suppression.indexOf("ensureInstantlyBlock"));
    const drain = server.slice(server.indexOf("export async function deliverPendingInstantlyBlocks"));
    expect(drain.indexOf("if (!args.enabled)")).toBeGreaterThan(-1);
    expect(drain.indexOf("if (!args.enabled)")).toBeLessThan(drain.indexOf("advanceInstantlyBlock"));
    expect(drain.indexOf("if (!args.apiKey)")).toBeLessThan(drain.indexOf("advanceInstantlyBlock"));
    expect(transport).not.toContain('method: "DELETE"');
    expect(transport).not.toContain("/campaigns");
    expect(transport).not.toContain("warmup");
    expect(conversation).not.toContain("block-lists-entries");
    expect(migration).toContain("DEFAULT 'off'");
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE ON TABLE public.acquisition_instantly_blocks TO service_role");
    expect(store).toContain('enabled: settings.instantlyBlocklist === "on"');
    expect(migration).toContain("attempt_count >= 0");
    expect(migration).not.toContain("BETWEEN 0 AND 8");
    expect(server).not.toContain('.lt("attempt_count"');
  });

  it("reports a failed intent insert and does not treat it as stored", async () => {
    const failed = query({ data: null, error: { code: "XX000" } });
    from.mockReset();
    from.mockImplementation(() => failed.builder);
    const result = await ensureInstantlyBlock({
      email: EMAIL,
      personId: "person-1",
      reason: "trial_started",
      sourceEventId: "stripe:trial:evt_1",
    });
    expect(result).toEqual({ ok: false, outcome: "not_stored" });
    expect(from).toHaveBeenCalledTimes(1);

    from.mockClear();
    const invalid = await ensureInstantlyBlock({
      email: "not-an-email",
      personId: null,
      reason: "unsubscribe",
      sourceEventId: "suppression:unsubscribe:not-an-email",
    });
    expect(invalid).toEqual({ ok: false, outcome: "invalid_email" });
    expect(from).not.toHaveBeenCalled();
  });

  it("keeps retrying after eight failures, and an expired claim can be taken again", async () => {
    expect(blockBackoffMs(1, "permission")).toBe(6 * 60 * 60 * 1000);
    expect(blockBackoffMs(8, "permission")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(blockBackoffMs(20, "permission")).toBe(blockBackoffMs(8, "permission"));
    expect(blockBackoffMs(1, "transient")).toBe(15 * 60 * 1000);
    expect(blockBackoffMs(8, "transient")).toBe(24 * 60 * 60 * 1000);
    expect(blockClaimHeld(null, NOW)).toBe(false);
    expect(blockClaimHeld("2026-10-24T11:59:00.000Z", NOW)).toBe(false);
    expect(blockClaimHeld("2026-10-24T12:02:00.000Z", NOW)).toBe(true);

    const denied = vi.fn<typeof fetch>(async () => response(401, { message: "no" }));
    const eighth = await advanceInstantlyBlock({
      enabled: true,
      apiKey: "test-key",
      email: EMAIL,
      status: "failed",
      attemptCount: 8,
      fetchImpl: denied,
      now: NOW,
    });
    expect(eighth.status).toBe("failed");
    expect(eighth.lastError).toBe("permission_denied");
    expect(eighth.providerEntryId).toBeNull();
    expect(Date.parse(eighth.nextAttemptAt ?? "") - NOW.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(denied).toHaveBeenCalledTimes(1);

    const missing = await advanceInstantlyBlock({
      enabled: true,
      apiKey: null,
      email: EMAIL,
      status: "pending",
      attemptCount: 3,
      fetchImpl: denied,
      now: NOW,
    });
    expect(missing.requested).toBe(false);
    expect(missing.status).toBe("pending");
    expect(missing.lastError).toBe("missing_credentials");
    expect(missing.providerEntryId).toBeNull();
    expect(denied).toHaveBeenCalledTimes(1);

    const listed = query({ data: [blockRow(8)], error: null });
    const held = query({ data: [], error: null });
    from.mockReset();
    from.mockImplementationOnce(() => listed.builder).mockImplementationOnce(() => held.builder);
    const fetchImpl = vi.fn<typeof fetch>();
    const skipped = await deliverPendingInstantlyBlocks({
      enabled: true,
      apiKey: "test-key",
      now: NOW,
      fetchImpl,
    });
    expect(skipped).toEqual({ attempted: 0, skipped: null });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(String(held.calls.find((call) => call.method === "or")?.args[0])).toContain("claim_until.lte");

    const again = query({ data: [blockRow(8)], error: null });
    const claimed = query({ data: [{ id: "block-1" }], error: null });
    const saved = query({ data: null, error: null });
    from.mockReset();
    from
      .mockImplementationOnce(() => again.builder)
      .mockImplementationOnce(() => claimed.builder)
      .mockImplementationOnce(() => saved.builder);
    const retryFetch = vi.fn<typeof fetch>(async () => response(403, { message: "no" }));
    const recovered = await deliverPendingInstantlyBlocks({
      enabled: true,
      apiKey: "test-key",
      now: NOW,
      fetchImpl: retryFetch,
    });
    expect(recovered.attempted).toBe(1);
    expect(retryFetch).toHaveBeenCalledTimes(1);
    const savedUpdate = saved.calls.find((call) => call.method === "update");
    expect(savedUpdate?.args[0]).toMatchObject({
      status: "failed",
      last_error: "permission_denied",
      provider_entry_id: null,
    });
    expect(savedUpdate?.args[0]).not.toMatchObject({ status: "confirmed" });

    const idle = query({ data: [blockRow(1)], error: null });
    const idleClaim = query({ data: [{ id: "block-1" }], error: null });
    const idleSave = query({ data: null, error: null });
    from.mockReset();
    from
      .mockImplementationOnce(() => idle.builder)
      .mockImplementationOnce(() => idleClaim.builder)
      .mockImplementationOnce(() => idleSave.builder);
    const noFetch = vi.fn<typeof fetch>();
    const unkeyed = await deliverPendingInstantlyBlocks({
      enabled: true,
      apiKey: null,
      now: NOW,
      fetchImpl: noFetch,
    });
    expect(unkeyed.skipped).toBe("missing_credentials");
    expect(noFetch).not.toHaveBeenCalled();
    expect(idleSave.calls.find((call) => call.method === "update")?.args[0]).toMatchObject({
      status: "failed",
      last_error: "missing_credentials",
    });

    from.mockReset();
    const offFetch = vi.fn<typeof fetch>();
    const off = await deliverPendingInstantlyBlocks({
      enabled: false,
      apiKey: "test-key",
      now: NOW,
      fetchImpl: offFetch,
    });
    expect(off).toEqual({ attempted: 0, skipped: "inactive" });
    expect(from).not.toHaveBeenCalled();
    expect(offFetch).not.toHaveBeenCalled();
  });

  it("repairs a missing intent from a duplicate without replaying unrelated effects", () => {
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    const personPath = store.slice(
      store.indexOf("async function applyPersonEvent"),
      store.indexOf("export async function recordAcquisitionVideoEvent"),
    );
    const duplicate = personPath.slice(
      personPath.indexOf('plan === "already_recorded"'),
      personPath.indexOf("const labelMayApply"),
    );
    expect(duplicate).toContain("rememberSuppression");
    expect(duplicate).toContain("if (!block.ok) return { ok: false as const }");
    expect(duplicate).not.toContain("applySignal");
    expect(duplicate).not.toContain("scheduleAction");

    const trial = store.slice(
      store.indexOf("export async function noteAcquisitionTrial"),
      store.indexOf("export async function noteAcquisitionClerk"),
    );
    expect(trial.indexOf("ensureInstantlyBlock")).toBeLessThan(trial.indexOf('stored === "duplicate"'));
    expect(trial).toContain("block.outcome === \"not_stored\"");
    expect(trial).toContain("instantly block intent remains unconfirmed");
    const paid = store.slice(
      store.indexOf("export async function noteAcquisitionPaid"),
      store.indexOf("export async function noteAcquisitionClosed"),
    );
    expect(paid.indexOf("ensureInstantlyBlock")).toBeLessThan(paid.indexOf('stored === "duplicate"'));
    expect(paid.indexOf("if (blockUnconfirmed)")).toBeLessThan(paid.indexOf('stored === "duplicate"'));

    const resend = store.slice(
      store.indexOf("export async function applyAcquisitionResendEvent"),
      store.indexOf("export async function noteAcquisitionTrial"),
    );
    expect(resend.indexOf("rememberSuppression")).toBeLessThan(resend.indexOf('stored === "duplicate"'));
    expect(resend).toContain("if (stored === \"duplicate\") return block.ok");
    expect(resend.indexOf('stored === "duplicate"')).toBeLessThan(resend.indexOf("applySignal"));
    const resendRoute = readFileSync("src/app/api/acquisition/resend/route.ts", "utf8");
    expect(resendRoute).toContain("stored === false");
    expect(resendRoute).toContain("status: 500");

    const processor = store.slice(
      store.indexOf("export async function processAcquisitionConversations"),
      store.indexOf("export async function deliverAcquisitionThreadReply"),
    );
    const stop = processor.slice(processor.indexOf('effect.type === "global_unsubscribe"'));
    expect(stop.indexOf("rememberSuppression")).toBeLessThan(stop.indexOf("applySignal"));
    expect(stop).toContain('processing_error: "effect_unconfirmed"');
    expect(stop.slice(0, stop.indexOf("effect_unconfirmed") + 40)).not.toContain("effect_applied_at");
    expect(nextClaimDecision({
      status: "failed",
      claimUntil: null,
      attemptCount: 8,
      outcome: "unsubscribe",
      effectApplied: false,
      now: NOW,
    })).toBe("effect_only");
    expect(decideConversationEffect({
      outcome: "unsubscribe",
      journeyId: "journey-1",
      hasPromise: true,
      stopped: false,
      suppressed: false,
    }).type).toBe("global_unsubscribe");
    expect(decideConversationEffect({
      outcome: "offer_decline",
      journeyId: "journey-1",
      hasPromise: true,
      stopped: false,
      suppressed: false,
    }).type).toBe("record");
  });

  it("covers existing trials and paid members, and does not turn a trial or a decline into an unsubscribe", () => {
    const trial = planInstantlyBlockCoverage({
      people: [
        { id: "person-trial", email: "Trial@Example.com", lifecycle: "trial_started" },
        { id: "person-paid", email: "paid@example.com", lifecycle: "paid_member" },
        { id: "person-expired", email: "expired@example.com", lifecycle: "trial_expired" },
        { id: "person-declined", email: "decline@example.com", lifecycle: "not_interested" },
        { id: "person-stopped", email: "stopped@example.com", lifecycle: "unsubscribed" },
        { id: "person-unknown-stop", email: "unknown-stop@example.com", lifecycle: "suppressed" },
      ],
      suppressions: [
        { email: "paid@example.com", reason: "unsubscribe" },
        { email: "complaint@example.com", reason: "complaint" },
        { email: "bounce@example.com", reason: "bounce" },
        { email: "provider@example.com", reason: "provider" },
      ],
      blockedEmails: ["stopped@example.com"],
    });
    const byEmail = new Map(trial.proposals.map((proposal) => [proposal.email, proposal]));
    expect(byEmail.get("trial@example.com")).toMatchObject({
      reason: "trial_started",
      personId: "person-trial",
      sourceEventId: instantlyBlockSourceId("person:trial_started", "person-trial"),
    });
    expect(byEmail.get("trial@example.com")?.evidence.map((item) => item.reason)).toEqual(["trial_started"]);
    expect(byEmail.get("paid@example.com")?.reason).toBe("unsubscribe");
    expect(byEmail.get("paid@example.com")?.evidence.map((item) => item.reason).sort()).toEqual(["paid_member", "unsubscribe"]);
    expect(byEmail.get("complaint@example.com")?.reason).toBe("complaint");
    expect(byEmail.get("bounce@example.com")?.reason).toBe("bounce");
    expect(byEmail.get("expired@example.com")).toMatchObject({
      reason: "trial_started",
      personId: "person-expired",
      sourceEventId: instantlyBlockSourceId("person:trial_expired", "person-expired"),
    });
    expect(byEmail.get("expired@example.com")?.evidence.map((item) => item.reason)).toEqual(["trial_started"]);
    expect(byEmail.has("decline@example.com")).toBe(false);
    expect(byEmail.has("stopped@example.com")).toBe(false);
    expect(byEmail.has("unknown-stop@example.com")).toBe(false);
    expect(byEmail.has("provider@example.com")).toBe(false);
    expect(trial.alreadyCovered).toBe(1);
    expect(trial.excluded).toMatchObject({
      declined: 1,
      provider: 1,
      unspecifiedSuppressed: 1,
    });

    const server = readFileSync("src/lib/acquisition/instantly-block.server.ts", "utf8");
    const preview = server.slice(
      server.indexOf("export async function previewInstantlyBlockCoverage"),
      server.indexOf("export async function applyInstantlyBlockCoverage"),
    );
    const apply = server.slice(
      server.indexOf("export async function applyInstantlyBlockCoverage"),
      server.indexOf("export async function deliverPendingInstantlyBlocks"),
    );
    expect(preview).not.toContain(".insert(");
    expect(preview).not.toContain(".update(");
    expect(preview).not.toContain("advanceInstantlyBlock");
    expect(apply).toContain("ensureInstantlyBlock");
    expect(apply).not.toContain("advanceInstantlyBlock");
    expect(apply).not.toContain("fetch(");
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    const cron = store.slice(store.indexOf("export async function runAcquisitionCron"));
    expect(cron.indexOf("reconcileMissingInstantlyBlocks")).toBeLessThan(cron.indexOf("deliverPendingInstantlyBlocks"));
    expect(cron).not.toContain("applyInstantlyBlockCoverage");
    expect(cron).not.toContain("previewInstantlyBlockCoverage");
    expect(store).not.toContain("applyInstantlyBlockCoverage");
    const route = readFileSync("src/app/api/admin/acquisition/instantly-block-coverage/route.ts", "utf8");
    expect(route).toContain("isTylerOwnerSession");
    expect(route).toContain("dryRun: true");
    expect(route.indexOf("if (!apply || !report.readable || !report.complete)")).toBeLessThan(route.indexOf("applyInstantlyBlockCoverage(report.proposals)"));
    expect(route).not.toContain("block-lists-entries");
    expect(route).not.toContain("instantly_blocklist");
  });

  it("repairs missing intents from the cron without calling Instantly or reopening a confirmed block", async () => {
    const origin = new Date(0);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const inserts: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    const blocked = new Set<string>();
    const progress = {
      peopleEmail: null as string | null,
      peopleGen: 0,
      suppressionEmail: null as string | null,
      suppressionGen: 0,
    };
    let peopleMode: "one" | "many" | "full" | "error" = "one";
    let peopleRows: Record<string, unknown>[] = [];
    let suppressionRows: Record<string, unknown>[] = [];
    let failInsert = false;
    let fullPage = 0;
    const cursorMatches = (kind: "people" | "suppression", calls: Array<{ method: string; args: unknown[] }>) => {
      const emailColumn = kind === "people" ? "instantly_reconcile_people_email" : "instantly_reconcile_suppression_email";
      const genColumn = kind === "people" ? "instantly_reconcile_people_gen" : "instantly_reconcile_suppression_gen";
      const currentEmail = kind === "people" ? progress.peopleEmail : progress.suppressionEmail;
      const currentGen = kind === "people" ? progress.peopleGen : progress.suppressionGen;
      const generation = calls.find((call) => call.method === "eq" && call.args[0] === genColumn);
      if (generation?.args[1] !== currentGen) return false;
      if (currentEmail === null) {
        const isNull = calls.find((call) => call.method === "is" && call.args[0] === emailColumn);
        return isNull?.args[1] === null;
      }
      const email = calls.find((call) => call.method === "eq" && call.args[0] === emailColumn);
      return email?.args[1] === currentEmail;
    };

    const callsOf = (calls: Array<{ method: string; args: unknown[] }>) => calls;
    const orderDescending = (calls: Array<{ method: string; args: unknown[] }>) => {
      const order = callsOf(calls).find((call) => call.method === "order");
      const options = order?.args[1] as { ascending?: boolean } | undefined;
      return options?.ascending === false;
    };
    const afterEmail = (calls: Array<{ method: string; args: unknown[] }>) => {
      const gt = calls.find((call) => call.method === "gt" && call.args[0] === "email_normalized");
      return typeof gt?.args[1] === "string" ? gt.args[1] : null;
    };
    const limitOf = (calls: Array<{ method: string; args: unknown[] }>) => {
      const limit = calls.find((call) => call.method === "limit");
      return typeof limit?.args[0] === "number" ? limit.args[0] : RECONCILE_PAGE_SIZE;
    };
    const install = () => {
      from.mockReset();
      from.mockImplementation((table: string) => {
        const calls: Array<{ method: string; args: unknown[] }> = [];
        let result: { data: unknown; error: { code?: string } | null } | null = null;
        const builder: object = new Proxy({}, {
          get(_target, prop) {
            if (prop === "then") {
              return (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
                if (!result) result = answer(table, calls);
                return Promise.resolve(result).then(resolve, reject);
              };
            }
            if (typeof prop !== "string") return undefined;
            return (...args: unknown[]) => {
              calls.push({ method: prop, args });
              if (prop === "update" || prop === "insert" || prop === "delete") {
                if (table === "acquisition_people" || table === "acquisition_events" || table === "acquisition_journeys") {
                  throw new Error(`unexpected ${prop} on ${table}`);
                }
              }
              return builder;
            };
          },
        });
        return builder;
      });
    };
    const answer = (table: string, calls: Array<{ method: string; args: unknown[] }>) => {
      if (table === "acquisition_settings") {
        const update = calls.find((call) => call.method === "update");
        if (update) {
          const patch = update.args[0] as Record<string, unknown>;
          const kind = "instantly_reconcile_people_email" in patch ? "people" : "suppression";
          if (!cursorMatches(kind, calls)) return { data: [], error: null };
          if (kind === "people") {
            progress.peopleEmail = typeof patch.instantly_reconcile_people_email === "string"
              ? patch.instantly_reconcile_people_email
              : null;
            progress.peopleGen = Number(patch.instantly_reconcile_people_gen);
          } else {
            progress.suppressionEmail = typeof patch.instantly_reconcile_suppression_email === "string"
              ? patch.instantly_reconcile_suppression_email
              : null;
            progress.suppressionGen = Number(patch.instantly_reconcile_suppression_gen);
          }
          return { data: [{ id: "default" }], error: null };
        }
        return {
          data: {
            instantly_reconcile_people_email: progress.peopleEmail,
            instantly_reconcile_people_gen: progress.peopleGen,
            instantly_reconcile_suppression_email: progress.suppressionEmail,
            instantly_reconcile_suppression_gen: progress.suppressionGen,
          },
          error: null,
        };
      }
      if (table === "acquisition_people") {
        if (peopleMode === "error") return { data: null, error: { code: "XX000" } };
        if (orderDescending(calls)) return { data: peopleRows.slice(0, RECONCILE_RECENT), error: null };
        const after = afterEmail(calls);
        const limit = limitOf(calls);
        if (peopleMode === "full") {
          const page = fullPage;
          fullPage += 1;
          return {
            data: Array.from({ length: limit }, (_, index) => ({
              id: `full-${page}-${index}`,
              email_normalized: `full-${page}-${String(index).padStart(3, "0")}@example.com`,
              lifecycle_state: "trial_started",
            })),
            error: null,
          };
        }
        return {
          data: [...peopleRows]
            .filter((row) => after === null || String(row.email_normalized) > after)
            .sort((left, right) => String(left.email_normalized) < String(right.email_normalized) ? -1 : 1)
            .slice(0, limit),
          error: null,
        };
      }
      if (table === "recovery_suppressions") {
        if (orderDescending(calls)) return { data: suppressionRows.slice(0, RECONCILE_RECENT), error: null };
        const after = afterEmail(calls);
        return {
          data: [...suppressionRows]
            .filter((row) => after === null || String(row.email_normalized) > after)
            .sort((left, right) => String(left.email_normalized) < String(right.email_normalized) ? -1 : 1)
            .slice(0, limitOf(calls)),
          error: null,
        };
      }
      const insert = calls.find((call) => call.method === "insert");
      if (insert) {
        const row = insert.args[0] as Record<string, unknown>;
        if (failInsert) return { data: null, error: { code: "XX000" } };
        if (blocked.has(String(row.email_normalized))) return { data: null, error: { code: "23505" } };
        inserts.push(row);
        blocked.add(String(row.email_normalized));
        return { data: null, error: null };
      }
      const update = calls.find((call) => call.method === "update");
      if (update) {
        updates.push(update.args[0] as Record<string, unknown>);
        return { data: null, error: null };
      }
      const eq = calls.find((call) => call.method === "eq" && call.args[0] === "email_normalized");
      if (eq) {
        return {
          data: {
            id: "block-confirmed",
            person_id: "person-paid",
            email_normalized: eq.args[1],
            reason: "paid_member",
            status: "confirmed",
            source_event_id: "person:paid_member:person-paid",
            provider_entry_id: ENTRY_ID,
            evidence: [{ reason: "paid_member", sourceEventId: "person:paid_member:person-paid" }],
            attempt_count: 2,
          },
          error: null,
        };
      }
      const listed = calls.find((call) => call.method === "in");
      const emails = Array.isArray(listed?.args[1]) ? listed.args[1] as string[] : [];
      return {
        data: emails.filter((email) => blocked.has(email)).map((email_normalized) => ({ email_normalized })),
        error: null,
      };
    };

    install();
    peopleRows = [{ id: "person-trial", email_normalized: "trial@example.com", lifecycle_state: "trial_started" }];
    const trial = await reconcileMissingInstantlyBlocks({ now: origin });
    expect(trial).toMatchObject({ readable: true, complete: true, stored: 1, failed: 0 });
    expect(inserts.at(-1)).toMatchObject({
      email_normalized: "trial@example.com",
      reason: "trial_started",
      status: "pending",
      source_event_id: instantlyBlockSourceId("person:trial_started", "person-trial"),
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    inserts.length = 0;
    peopleRows = [{ id: "person-paid", email_normalized: "paid@example.com", lifecycle_state: "paid_member" }];
    const paid = await reconcileMissingInstantlyBlocks({ now: origin });
    expect(paid.stored).toBe(1);
    expect(inserts.at(-1)).toMatchObject({
      reason: "paid_member",
      source_event_id: instantlyBlockSourceId("person:paid_member", "person-paid"),
    });

    inserts.length = 0;
    peopleRows = [];
    suppressionRows = [
      { email_normalized: "gone@example.com", reason: "unsubscribe" },
      { email_normalized: "complain@example.com", reason: "complaint" },
      { email_normalized: "bounce@example.com", reason: "bounce" },
    ];
    const stops = await reconcileMissingInstantlyBlocks({ now: origin });
    expect(stops.stored).toBe(3);
    expect(inserts.map((row) => row.reason).sort()).toEqual(["bounce", "complaint", "unsubscribe"]);
    expect(inserts.some((row) => row.reason === "trial_started")).toBe(false);

    inserts.length = 0;
    suppressionRows = [];
    peopleRows = [{ id: "person-paid", email_normalized: "paid@example.com", lifecycle_state: "paid_member" }];
    const duplicate = await reconcileMissingInstantlyBlocks({ now: origin });
    expect(duplicate.stored).toBe(0);
    expect(inserts).toHaveLength(0);

    const concurrentPeople = [{ id: "person-race", email_normalized: "race@example.com", lifecycle_state: "trial_started" }];
    peopleRows = concurrentPeople;
    const [firstRace, secondRace] = await Promise.all([
      reconcileMissingInstantlyBlocks({ now: origin }),
      reconcileMissingInstantlyBlocks({ now: origin }),
    ]);
    expect(firstRace.failed + secondRace.failed).toBe(0);
    expect(inserts.filter((row) => row.email_normalized === "race@example.com")).toHaveLength(1);
    expect(updates.every((patch) => !("status" in patch) && !("provider_entry_id" in patch))).toBe(true);

    inserts.length = 0;
    updates.length = 0;
    peopleRows = [{ id: "person-expired", email_normalized: "expired@example.com", lifecycle_state: "trial_expired" }];
    blocked.add("expired@example.com");
    const expired = await reconcileMissingInstantlyBlocks({ now: origin });
    expect(expired.stored).toBe(0);
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
    blocked.delete("expired@example.com");
    const expiredMissing = await reconcileMissingInstantlyBlocks({ now: origin });
    expect(expiredMissing.stored).toBe(1);
    expect(inserts.at(-1)).toMatchObject({
      reason: "trial_started",
      source_event_id: instantlyBlockSourceId("person:trial_expired", "person-expired"),
    });

    inserts.length = 0;
    peopleRows = [
      { id: "person-no", email_normalized: "decline@example.com", lifecycle_state: "not_interested" },
      { id: "person-ambiguous", email_normalized: "ambiguous@example.com", lifecycle_state: "suppressed" },
    ];
    const leftOut = await reconcileMissingInstantlyBlocks({ now: origin });
    expect(leftOut.stored).toBe(0);
    expect(inserts).toHaveLength(0);

    peopleMode = "error";
    const emailBeforeError = progress.peopleEmail;
    const generationBeforeError = progress.peopleGen;
    const hidden = await reconcileMissingInstantlyBlocks({ now: origin });
    expect(hidden).toMatchObject({ readable: false, complete: false, stored: 0, failed: 0 });
    expect(inserts).toHaveLength(0);
    expect(progress.peopleEmail).toBe(emailBeforeError);
    expect(progress.peopleGen).toBe(generationBeforeError);

    peopleMode = "many";
    peopleRows = Array.from({ length: 30 }, (_, index) => ({
      id: `many-${index}`,
      email_normalized: `many-${index}@example.com`,
      lifecycle_state: "trial_started",
    }));
    const bounded = await reconcileMissingInstantlyBlocks({ now: origin });
    expect(bounded.complete).toBe(true);
    expect(bounded.stored).toBe(RECONCILE_WRITE_CAP);
    expect(bounded.deferred).toBe(30 - RECONCILE_WRITE_CAP);
    expect(inserts).toHaveLength(RECONCILE_WRITE_CAP);
    const next = await reconcileMissingInstantlyBlocks({ now: origin });
    expect(next.stored).toBe(RECONCILE_WRITE_CAP);
    expect(inserts).toHaveLength(RECONCILE_WRITE_CAP * 2);

    inserts.length = 0;
    peopleMode = "full";
    peopleRows = [];
    const incomplete = await reconcileMissingInstantlyBlocks({ now: origin });
    expect(incomplete.complete).toBe(false);
    expect(incomplete.readable).toBe(true);
    expect(incomplete.stored).toBe(RECONCILE_WRITE_CAP);
    expect(inserts.length).toBeLessThanOrEqual(RECONCILE_WRITE_CAP);

    failInsert = true;
    peopleMode = "one";
    peopleRows = [{ id: "person-later", email_normalized: "later@example.com", lifecycle_state: "paid_member" }];
    const broken = await reconcileMissingInstantlyBlocks({ now: origin });
    expect(broken.failed).toBe(1);
    expect(broken.stored).toBe(0);
    failInsert = false;
    const healed = await reconcileMissingInstantlyBlocks({ now: origin });
    expect(healed.stored).toBe(1);
    expect(healed.failed).toBe(0);

    updates.length = 0;
    blocked.add("held@example.com");
    const held = await ensureInstantlyBlock({
      email: "held@example.com",
      personId: "person-paid",
      reason: "trial_started",
      sourceEventId: "person:trial_expired:person-held",
    });
    expect(held).toEqual({ ok: true, outcome: "present" });
    expect(updates).toHaveLength(1);
    expect(updates[0]).not.toHaveProperty("status");
    expect(updates[0]).not.toHaveProperty("provider_entry_id");

    const off = await deliverPendingInstantlyBlocks({
      enabled: false,
      apiKey: "test-key",
      now: origin,
      fetchImpl: fetchSpy,
    });
    expect(off).toEqual({ attempted: 0, skipped: "inactive" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    const server = readFileSync("src/lib/acquisition/instantly-block.server.ts", "utf8");
    const reconcile = server.slice(
      server.indexOf("export async function reconcileMissingInstantlyBlocks"),
      server.indexOf("export async function applyInstantlyBlockCoverage"),
    );
    expect(reconcile).not.toContain("advanceInstantlyBlock");
    expect(reconcile).not.toContain("fetch(");
    expect(reconcile).not.toContain(".delete(");
    expect(server).not.toContain('method: "DELETE"');
    expect(server).not.toContain("RECONCILE_WINDOWS");
  });

  it("walks the whole qualifying population, then wraps, without moving past a failed read", async () => {
    const population = 10_200;
    const oldCeiling = 5_100;
    const personEmail = (index: number) => `p${String(index).padStart(5, "0")}@example.com`;
    const personIndex = (email: string) => {
      const match = /^p(\d{5})@example\.com$/.exec(email);
      return match ? Number(match[1]) : -1;
    };
    const missing = new Set([6_000, population - 1]);
    const inserted: string[] = [];
    const blockUpdates: Record<string, unknown>[] = [];
    const progress = {
      peopleEmail: null as string | null,
      peopleGen: 0,
      suppressionEmail: null as string | null,
      suppressionGen: 0,
    };
    let failPeople = false;
    let singleEmail: string | null = null;
    let recentPeople: Record<string, unknown>[] = [];
    let recentSuppressions: Record<string, unknown>[] = [];
    const counts = { peopleWalks: 0, peopleRecent: 0, suppressionReads: 0, settingsReads: 0, settingsWrites: 0, inserts: 0 };
    const resetCounts = () => {
      counts.peopleWalks = 0;
      counts.peopleRecent = 0;
      counts.suppressionReads = 0;
      counts.settingsReads = 0;
      counts.settingsWrites = 0;
      counts.inserts = 0;
    };
    const cursorMatches = (kind: "people" | "suppression", calls: Array<{ method: string; args: unknown[] }>) => {
      const emailColumn = kind === "people" ? "instantly_reconcile_people_email" : "instantly_reconcile_suppression_email";
      const genColumn = kind === "people" ? "instantly_reconcile_people_gen" : "instantly_reconcile_suppression_gen";
      const currentEmail = kind === "people" ? progress.peopleEmail : progress.suppressionEmail;
      const currentGen = kind === "people" ? progress.peopleGen : progress.suppressionGen;
      const generation = calls.find((call) => call.method === "eq" && call.args[0] === genColumn);
      if (generation?.args[1] !== currentGen) return false;
      if (currentEmail === null) {
        return calls.some((call) => call.method === "is" && call.args[0] === emailColumn && call.args[1] === null);
      }
      return calls.some((call) => call.method === "eq" && call.args[0] === emailColumn && call.args[1] === currentEmail);
    };
    from.mockReset();
    from.mockImplementation((table: string) => {
      const calls: Array<{ method: string; args: unknown[] }> = [];
      let result: { data: unknown; error: { code?: string } | null } | null = null;
      const builder: object = new Proxy({}, {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
              if (!result) result = answer(table, calls);
              return Promise.resolve(result).then(resolve, reject);
            };
          }
          if (typeof prop !== "string") return undefined;
          return (...args: unknown[]) => {
            calls.push({ method: prop, args });
            return builder;
          };
        },
      });
      return builder;
    });
    const answer = (table: string, calls: Array<{ method: string; args: unknown[] }>) => {
      const descending = calls.some((call) => call.method === "order" && (call.args[1] as { ascending?: boolean } | undefined)?.ascending === false);
      const after = calls.find((call) => call.method === "gt" && call.args[0] === "email_normalized");
      const afterValue = typeof after?.args[1] === "string" ? after.args[1] : null;
      const limitCall = calls.find((call) => call.method === "limit");
      const limit = typeof limitCall?.args[0] === "number" ? limitCall.args[0] : RECONCILE_PAGE_SIZE;
      if (table === "acquisition_settings") {
        const update = calls.find((call) => call.method === "update");
        if (update) {
          counts.settingsWrites += 1;
          const patch = update.args[0] as Record<string, unknown>;
          const kind = "instantly_reconcile_people_email" in patch ? "people" : "suppression";
          if (!cursorMatches(kind, calls)) return { data: [], error: null };
          if (kind === "people") {
            progress.peopleEmail = typeof patch.instantly_reconcile_people_email === "string" ? patch.instantly_reconcile_people_email : null;
            progress.peopleGen = Number(patch.instantly_reconcile_people_gen);
          } else {
            progress.suppressionEmail = typeof patch.instantly_reconcile_suppression_email === "string" ? patch.instantly_reconcile_suppression_email : null;
            progress.suppressionGen = Number(patch.instantly_reconcile_suppression_gen);
          }
          return { data: [{ id: "default" }], error: null };
        }
        counts.settingsReads += 1;
        return {
          data: {
            instantly_reconcile_people_email: progress.peopleEmail,
            instantly_reconcile_people_gen: progress.peopleGen,
            instantly_reconcile_suppression_email: progress.suppressionEmail,
            instantly_reconcile_suppression_gen: progress.suppressionGen,
          },
          error: null,
        };
      }
      if (table === "acquisition_people") {
        if (descending) {
          counts.peopleRecent += 1;
          if (failPeople) return { data: null, error: { code: "XX000" } };
          if (recentPeople.length > 0) return { data: recentPeople, error: null };
          return {
            data: Array.from({ length: Math.min(RECONCILE_RECENT, population) }, (_, index) => ({
              id: `recent-${index}`,
              email_normalized: personEmail(index),
              lifecycle_state: "trial_started",
            })),
            error: null,
          };
        }
        counts.peopleWalks += 1;
        if (failPeople) return { data: null, error: { code: "XX000" } };
        if (singleEmail) {
          const rows = afterValue === null || singleEmail > afterValue
            ? [{ id: "person-single", email_normalized: singleEmail, lifecycle_state: "trial_started" }]
            : [];
          return { data: rows.slice(0, limit), error: null };
        }
        const start = afterValue === null ? 0 : personIndex(afterValue) + 1;
        const rows = [];
        for (let index = Math.max(start, 0); index < population && rows.length < limit; index += 1) {
          rows.push({
            id: `person-${index}`,
            email_normalized: personEmail(index),
            lifecycle_state: index === population - 1 ? "paid_member" : "trial_started",
          });
        }
        return { data: rows, error: null };
      }
      if (table === "recovery_suppressions") {
        counts.suppressionReads += 1;
        if (descending) return { data: recentSuppressions, error: null };
        const rows = recentSuppressions.filter((row) => afterValue === null || String(row.email_normalized) > afterValue);
        return { data: rows.slice(0, limit), error: null };
      }
      const insert = calls.find((call) => call.method === "insert");
      if (insert) {
        const row = insert.args[0] as Record<string, unknown>;
        const email = String(row.email_normalized);
        if (missing.has(personIndex(email)) || email === singleEmail || recentPeople.some((person) => person.email_normalized === email) || recentSuppressions.some((person) => person.email_normalized === email)) {
          if (inserted.includes(email)) return { data: null, error: { code: "23505" } };
          inserted.push(email);
          counts.inserts += 1;
          missing.delete(personIndex(email));
          return { data: null, error: null };
        }
        return { data: null, error: { code: "23505" } };
      }
      const update = calls.find((call) => call.method === "update");
      if (update) {
        blockUpdates.push(update.args[0] as Record<string, unknown>);
        return { data: null, error: null };
      }
      const eq = calls.find((call) => call.method === "eq" && call.args[0] === "email_normalized");
      if (eq) {
        return {
          data: {
            id: "block-confirmed",
            person_id: null,
            email_normalized: eq.args[1],
            reason: "paid_member",
            status: "confirmed",
            source_event_id: "person:paid_member:held",
            provider_entry_id: ENTRY_ID,
            evidence: [{ reason: "paid_member", sourceEventId: "person:paid_member:held" }],
            attempt_count: 1,
          },
          error: null,
        };
      }
      const listed = calls.find((call) => call.method === "in");
      const emails = Array.isArray(listed?.args[1]) ? listed.args[1] as string[] : [];
      return {
        data: emails.filter((email) => !missing.has(personIndex(email)) && email !== singleEmail && !recentPeople.some((person) => person.email_normalized === email) && !recentSuppressions.some((person) => person.email_normalized === email)).map((email_normalized) => ({ email_normalized })),
        error: null,
      };
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let runs = 0;
    let sawPastCeiling = false;
    while (runs < 80 && (missing.size > 0 || progress.peopleGen < 1 || progress.peopleEmail !== null)) {
      resetCounts();
      const before = progress.peopleEmail;
      await reconcileMissingInstantlyBlocks({ now: new Date(0) });
      if (before && personIndex(before) > oldCeiling) sawPastCeiling = true;
      expect(counts.peopleWalks).toBeLessThanOrEqual(RECONCILE_MAX_PAGES);
      expect(counts.peopleRecent).toBeLessThanOrEqual(1);
      expect(counts.suppressionReads).toBeLessThanOrEqual(1 + RECONCILE_MAX_PAGES);
      expect(counts.settingsReads).toBe(1);
      expect(counts.settingsWrites).toBeLessThanOrEqual(2);
      expect(counts.inserts).toBeLessThanOrEqual(RECONCILE_WRITE_CAP);
      runs += 1;
    }
    expect(missing.size).toBe(0);
    expect(inserted).toContain(personEmail(6_000));
    expect(inserted).toContain(personEmail(population - 1));
    expect(sawPastCeiling).toBe(true);
    expect(progress).toMatchObject({ peopleEmail: null, peopleGen: 1 });
    expect(runs).toBeLessThan(80);
    const insertedBeforeWrap = inserted.length;
    resetCounts();
    await reconcileMissingInstantlyBlocks({ now: new Date(0) });
    expect(inserted).toHaveLength(insertedBeforeWrap);
    expect(fetchSpy).not.toHaveBeenCalled();

    progress.peopleEmail = personEmail(5_000);
    recentPeople = [{ id: "person-new-trial", email_normalized: "a-new-trial@example.com", lifecycle_state: "trial_started" }];
    recentSuppressions = [{ email_normalized: "a-unsub@example.com", reason: "unsubscribe" }];
    const prioritized = await reconcileMissingInstantlyBlocks({ now: new Date(0) });
    expect(prioritized.stored).toBe(2);
    expect(inserted).toContain("a-new-trial@example.com");
    expect(inserted).toContain("a-unsub@example.com");
    expect(progress.peopleEmail && progress.peopleEmail > personEmail(oldCeiling)).toBe(true);

    const stalledEmail = progress.peopleEmail;
    const stalledGen = progress.peopleGen;
    failPeople = true;
    recentPeople = [];
    recentSuppressions = [];
    const stalled = await reconcileMissingInstantlyBlocks({ now: new Date(0) });
    expect(stalled).toMatchObject({ readable: false, stored: 0, failed: 0 });
    expect(progress.peopleEmail).toBe(stalledEmail);
    expect(progress.peopleGen).toBe(stalledGen);
    failPeople = false;
    singleEmail = null;
    const resumed = await reconcileMissingInstantlyBlocks({ now: new Date(0) });
    expect(resumed.readable).toBe(true);
    expect(progress.peopleEmail === stalledEmail || (progress.peopleEmail !== null && stalledEmail !== null && progress.peopleEmail > stalledEmail)).toBe(true);

    progress.peopleEmail = null;
    progress.peopleGen = 0;
    progress.suppressionEmail = null;
    progress.suppressionGen = 0;
    singleEmail = "race2@example.com";
    recentPeople = [];
    recentSuppressions = [];
    inserted.length = 0;
    const [firstRace, secondRace] = await Promise.all([
      reconcileMissingInstantlyBlocks({ now: new Date(0) }),
      reconcileMissingInstantlyBlocks({ now: new Date(0) }),
    ]);
    expect(firstRace.failed + secondRace.failed).toBe(0);
    expect(inserted.filter((email) => email === "race2@example.com")).toHaveLength(1);
    expect(progress.peopleGen).toBe(1);
    expect(progress.peopleEmail).toBeNull();
    expect(blockUpdates.every((patch) => !("status" in patch) && !("provider_entry_id" in patch))).toBe(true);

    blockUpdates.length = 0;
    const held = await ensureInstantlyBlock({
      email: "held@example.com",
      personId: null,
      reason: "trial_started",
      sourceEventId: "person:trial_expired:held",
    });
    expect(held).toEqual({ ok: true, outcome: "present" });
    expect(blockUpdates).toHaveLength(1);
    expect(blockUpdates[0]).not.toHaveProperty("status");
    expect(blockUpdates[0]).not.toHaveProperty("provider_entry_id");

    const off = await deliverPendingInstantlyBlocks({
      enabled: false,
      apiKey: "test-key",
      now: new Date(0),
      fetchImpl: fetchSpy,
    });
    expect(off).toEqual({ attempted: 0, skipped: "inactive" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    const migration = readFileSync("supabase/migrations/20261024120000_acquisition_instantly_blocklist.sql", "utf8");
    expect(migration).toContain("instantly_reconcile_people_email");
    expect(migration).toContain("instantly_reconcile_people_gen");
    expect(migration).toContain("instantly_reconcile_suppression_email");
    expect(migration).toContain("instantly_reconcile_suppression_gen");
    expect(migration).toContain("DEFAULT 'off'");
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/);
  });
});
