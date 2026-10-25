import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { INSTANTLY_BLOCK_LIST_URL } from "@/lib/acquisition/instantly-block";
import {
  BLOCKLIST_CREATE_TEST_CONFIRM,
  runInstantlyBlocklistCreateTest,
  type BlocklistCreateTestOutcome,
} from "@/lib/acquisition/instantly-blocklist-create-test";

const { ownerSession, runOwned } = vi.hoisted(() => ({
  ownerSession: vi.fn(),
  runOwned: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-tyler-admin", () => ({
  isTylerOwnerSession: ownerSession,
}));
vi.mock("@/lib/acquisition/instantly-blocklist-create-test.server", () => ({
  runOwnedBlocklistCreateTest: (...args: unknown[]) => runOwned(...args),
}));

import { POST } from "@/app/api/admin/acquisition/instantly-blocklist-create-test/route";

const ALLOWED = "owner-test@example.com";
const SECRET_ID = "entry-9f3c";
const SECRET_TOKEN = "super-secret-token";

type Claim = "claimed" | "used" | "unavailable";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function entry(email = ALLOWED, domain = false) {
  return {
    id: SECRET_ID,
    bl_value: email,
    is_domain: domain,
    organization_id: "org-secret",
    message: `Bearer ${SECRET_TOKEN}`,
  };
}

function expectRedacted(report: unknown) {
  const text = JSON.stringify(report);
  expect(text).not.toContain(ALLOWED);
  expect(text).not.toContain(SECRET_ID);
  expect(text).not.toContain(SECRET_TOKEN);
  expect(text).not.toContain("Bearer");
  expect(text).not.toContain("org-secret");
  expect(text).not.toContain("@");
  expect(text).not.toContain("bl_value");
}

function harness(overrides: {
  body?: unknown;
  apiKey?: string | null;
  allowlist?: string | null;
  fetchImpl?: typeof fetch;
  local?: "present" | "absent" | "unreadable";
  claimState?: "present" | "absent" | "unreadable";
  claimOnce?: () => Promise<Claim>;
  recordOutcome?: (outcome: BlocklistCreateTestOutcome) => Promise<void>;
} = {}) {
  const recorded: BlocklistCreateTestOutcome[] = [];
  const local = vi.fn(async () => overrides.local ?? "absent");
  const readClaim = vi.fn(async () => overrides.claimState ?? "absent");
  const claimOnce = vi.fn(overrides.claimOnce ?? (async () => "claimed" as const));
  const recordOutcome = vi.fn(overrides.recordOutcome ?? (async (outcome: BlocklistCreateTestOutcome) => {
    recorded.push(outcome);
  }));
  const fetchImpl = overrides.fetchImpl ?? (async () => jsonResponse(200, { items: [] }));
  const run = () => runInstantlyBlocklistCreateTest({
    body: overrides.body ?? { email: ALLOWED, confirm: BLOCKLIST_CREATE_TEST_CONFIRM },
    apiKey: overrides.apiKey === undefined ? "test-key" : overrides.apiKey,
    allowlist: overrides.allowlist === undefined ? ALLOWED : overrides.allowlist,
    fetchImpl: fetchImpl as typeof fetch,
    findLocalIntent: local,
    readClaim,
    claimOnce,
    recordOutcome,
  });
  return { run, local, readClaim, claimOnce, recordOutcome, recorded };
}

afterEach(() => {
  ownerSession.mockReset();
  runOwned.mockReset();
});

describe("temporary one-address blocklist create test", () => {
  it("allows only the owner and does not read the key or call Instantly otherwise", async () => {
    ownerSession.mockResolvedValue(false);
    const denied = await POST(new Request("https://summittmindset.com/api/admin/acquisition/instantly-blocklist-create-test", {
      method: "POST",
      body: JSON.stringify({ email: ALLOWED, confirm: BLOCKLIST_CREATE_TEST_CONFIRM }),
    }));
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "Unauthorized" });
    expect(runOwned).not.toHaveBeenCalled();

    ownerSession.mockResolvedValue(true);
    runOwned.mockResolvedValue({ verdict: "created", httpStatus: 200, posted: true });
    const allowed = await POST(new Request("https://summittmindset.com/api/admin/acquisition/instantly-blocklist-create-test", {
      method: "POST",
      body: JSON.stringify({ email: ALLOWED, confirm: BLOCKLIST_CREATE_TEST_CONFIRM, extra: true }),
    }));
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ verdict: "created", httpStatus: 200, posted: true });
    expect(runOwned).toHaveBeenCalledTimes(1);

    const route = readFileSync("src/app/api/admin/acquisition/instantly-blocklist-create-test/route.ts", "utf8");
    const handler = route.slice(route.indexOf("export async function POST"));
    expect(route).toContain("isTylerOwnerSession");
    expect(route).not.toContain("requireTylerAdmin");
    expect(route).not.toMatch(/export async function (GET|PUT|PATCH|DELETE)/);
    expect(handler.indexOf("isTylerOwnerSession")).toBeLessThan(handler.indexOf("runOwnedBlocklistCreateTest"));
  });

  it("rejects a missing allowlist, the wrong address, and unexpected fields without a provider call", async () => {
    const fetchImpl = vi.fn();
    const missing = harness({ allowlist: null, fetchImpl: fetchImpl as typeof fetch });
    expect(await missing.run()).toMatchObject({ verdict: "not_allowlisted", posted: false });
    const wrong = harness({ allowlist: "other@example.com", fetchImpl: fetchImpl as typeof fetch });
    expect(await wrong.run()).toMatchObject({ verdict: "not_allowlisted", posted: false });
    expectRedacted(await wrong.run());
    const extra = harness({
      body: { email: ALLOWED, confirm: BLOCKLIST_CREATE_TEST_CONFIRM, search: ALLOWED },
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(await extra.run()).toMatchObject({ verdict: "invalid_request", posted: false });
    const badConfirm = harness({
      body: { email: ALLOWED, confirm: "yes" },
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(await badConfirm.run()).toMatchObject({ verdict: "invalid_request", posted: false });
    const notEmail = harness({
      body: { email: "not-an-email", confirm: BLOCKLIST_CREATE_TEST_CONFIRM },
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(await notEmail.run()).toMatchObject({ verdict: "invalid_request", posted: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(missing.local).not.toHaveBeenCalled();
    expect(extra.local).not.toHaveBeenCalled();
  });

  it("refuses an address that already has a local stop intent and does not call Instantly", async () => {
    const fetchImpl = vi.fn();
    const { run, claimOnce } = harness({ local: "present", fetchImpl: fetchImpl as typeof fetch });
    const report = await run();
    expect(report).toEqual({ verdict: "local_intent_exists", httpStatus: null, posted: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(claimOnce).not.toHaveBeenCalled();
    expectRedacted(report);
  });

  it("returns already_present from an exact email match and does not POST", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { items: [entry()] }));
    const { run, claimOnce } = harness({ fetchImpl: fetchImpl as typeof fetch });
    const report = await run();
    expect(report).toEqual({ verdict: "already_present", httpStatus: 200, posted: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
    expect(claimOnce).not.toHaveBeenCalled();
    expectRedacted(report);
  });

  it("fails closed when the preflight search is truncated, denied, or unreadable", async () => {
    const full = Array.from({ length: 100 }, () => ({ id: SECRET_ID, bl_value: "other@example.com", is_domain: false }));
    const cases = [
      jsonResponse(200, { items: full }),
      jsonResponse(401, { message: ALLOWED }),
      jsonResponse(500, { items: [] }),
      jsonResponse(200, { bl_value: ALLOWED }),
    ];
    for (const response of cases) {
      const fetchImpl = vi.fn(async () => response);
      const { run, claimOnce } = harness({ fetchImpl: fetchImpl as typeof fetch });
      const report = await run();
      expect(report.verdict).toBe("preflight_blocked");
      expect(report.posted).toBe(false);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(claimOnce).not.toHaveBeenCalled();
      expectRedacted(report);
    }
    const thrown = vi.fn(async () => {
      throw new Error(`network ${ALLOWED}`);
    });
    const offline = await harness({ fetchImpl: thrown as typeof fetch }).run();
    expect(offline).toMatchObject({ verdict: "preflight_blocked", posted: false, httpStatus: null });
    expectRedacted(offline);
  });

  it("confirms create only from one exact-email POST and does not retry an uncertain result", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "GET") return jsonResponse(200, { items: [entry(ALLOWED, true)] });
      return jsonResponse(200, entry());
    });
    const { run, recorded } = harness({ fetchImpl: fetchImpl as typeof fetch });
    const report = await run();
    expect(report).toEqual({ verdict: "created", httpStatus: 200, posted: true });
    expect(recorded).toEqual(["created"]);
    expectRedacted(report);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const get = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const post = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    const search = new URL(get[0]);
    expect(`${search.origin}${search.pathname}`).toBe(INSTANTLY_BLOCK_LIST_URL);
    expect(search.searchParams.get("limit")).toBe("100");
    expect(search.searchParams.get("search")).toBe(ALLOWED);
    expect([...search.searchParams.keys()].sort()).toEqual(["limit", "search"]);
    expect(get[1].method).toBe("GET");
    expect(post[0]).toBe(INSTANTLY_BLOCK_LIST_URL);
    expect(post[1].method).toBe("POST");
    expect(JSON.parse(String(post[1].body))).toEqual({ bl_value: ALLOWED });

    const deniedFetch = vi.fn(async (_url: string, init?: RequestInit) => (
      init?.method === "POST" ? jsonResponse(403, entry()) : jsonResponse(200, { items: [] })
    ));
    const denied = harness({ fetchImpl: deniedFetch as typeof fetch });
    expect(await denied.run()).toEqual({ verdict: "denied", httpStatus: 403, posted: true });
    expect(denied.recorded).toEqual(["denied"]);
    expect(deniedFetch.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);

    const ambiguous = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error(`timeout ${SECRET_ID}`);
      return jsonResponse(200, { items: [] });
    });
    const uncertain = harness({ fetchImpl: ambiguous as typeof fetch });
    expect(await uncertain.run()).toEqual({ verdict: "uncertain", httpStatus: null, posted: true });
    expect(uncertain.recorded).toEqual(["uncertain"]);
    expect(ambiguous).toHaveBeenCalledTimes(2);

    const mismatched = vi.fn(async (_url: string, init?: RequestInit) => (
      init?.method === "POST"
        ? jsonResponse(200, entry(ALLOWED, true))
        : jsonResponse(200, { items: [] })
    ));
    const notCreated = harness({ fetchImpl: mismatched as typeof fetch });
    expect(await notCreated.run()).toMatchObject({ verdict: "uncertain", httpStatus: 200, posted: true });
    expect(mismatched.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
  });

  it("lets the first claim POST once and blocks a repeat or concurrent claim", async () => {
    let claimed = false;
    let chain = Promise.resolve();
    const claimOnce = () => {
      const current = chain.then(() => {
        if (claimed) return "used" as const;
        claimed = true;
        return "claimed" as const;
      });
      chain = current.then(() => undefined, () => undefined);
      return current;
    };
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return jsonResponse(200, entry());
      }
      return jsonResponse(200, { items: [] });
    });
    const shared = harness({
      fetchImpl: fetchImpl as typeof fetch,
      claimOnce,
      claimState: "absent",
    });
    const [first, second] = await Promise.all([shared.run(), shared.run()]);
    const verdicts = [first.verdict, second.verdict].sort();
    expect(verdicts).toEqual(["already_used", "created"]);
    expect(fetchImpl.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
    expect(first.posted || second.posted).toBe(true);
    expect(first.posted && second.posted).toBe(false);

    const again = harness({
      fetchImpl: vi.fn() as typeof fetch,
      claimState: "present",
    });
    expect(await again.run()).toEqual({ verdict: "already_used", httpStatus: null, posted: false });
    expect(again.claimOnce).not.toHaveBeenCalled();
  });

  it("does not select, update, or send the pending stop queue", () => {
    const server = readFileSync("src/lib/acquisition/instantly-blocklist-create-test.server.ts", "utf8");
    const decision = readFileSync("src/lib/acquisition/instantly-blocklist-create-test.ts", "utf8");
    const migration = readFileSync("supabase/migrations/20261024200000_acquisition_blocklist_create_test.sql", "utf8");
    const lookup = server.slice(server.indexOf("findLocalIntent"), server.indexOf("readClaim"));
    expect(lookup).toContain('.from("acquisition_instantly_blocks")');
    expect(lookup).toContain('.eq("email_normalized", email)');
    expect(lookup).not.toContain(".update(");
    expect(lookup).not.toContain(".insert(");
    expect(server).toContain('.from("acquisition_blocklist_create_test")');
    expect(server).toContain(".insert({ id: CLAIM_ID, outcome: \"claimed\" })");
    expect(server).toContain(".update({ outcome })");
    expect(server).not.toContain("deliverPendingInstantlyBlocks");
    expect(server).not.toContain("acquisition_settings");
    expect(server).not.toContain("acquisition_people");
    expect(server).not.toContain("recovery_suppressions");
    expect(decision).not.toContain("deliverPendingInstantlyBlocks");
    expect(decision).toContain('method: "POST"');
    expect(decision).not.toMatch(/method:\s*"(PUT|PATCH|DELETE)"/);
    const posts = decision.split('method: "POST"').length - 1;
    expect(posts).toBe(1);
    expect(migration).toContain("CHECK (id = 'once')");
    expect(migration).not.toContain("email_normalized");
    expect(migration).not.toContain("bl_value");
    expect(migration).not.toContain("provider_entry_id");
    expect(migration).toContain("Do not execute until reviewed");
    expect(migration).not.toContain("acquisition_instantly_blocks");
  });
});
