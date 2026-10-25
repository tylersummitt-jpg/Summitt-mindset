import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { reviewConversationDraft } from "@/lib/acquisition/conversation";
import { INSTANTLY_REPLY_URL } from "@/lib/acquisition/instantly-reply";
import {
  ONE_THREAD_REPLY_BODY,
  ONE_THREAD_REPLY_CAMPAIGN_ID,
  ONE_THREAD_REPLY_INBOUND_ID,
  ONE_THREAD_REPLY_OUTBOUND_ID,
  ONE_THREAD_REPLY_SUBJECT,
  oneThreadReplyDecision,
  runOneThreadReply,
  type OneThreadOutbound,
  type OneThreadReplyDeps,
  type OneThreadSnapshot,
} from "@/lib/acquisition/one-thread-reply";

const ownerMock = vi.hoisted(() => vi.fn());
const sendMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-tyler-admin", () => ({
  isTylerOwnerSession: () => ownerMock(),
}));
vi.mock("@/lib/acquisition/one-thread-reply.server", () => ({
  sendAuthorizedOneThreadReply: () => sendMock(),
}));

import { POST } from "@/app/api/admin/acquisition/one-thread-reply/route";

const NOW = new Date("2026-10-25T21:00:00.000Z");
const REPLY_TO = "01234567-89ab-cdef-0123-456789abcdef";
const SENDER = "coach@example.com";
const LEAD = "owner@example.com";
const PROVIDER_ID = "prov-exact-1";

function snapshot(overrides: {
  settings?: Partial<OneThreadSnapshot["settings"]>;
  inbound?: Partial<NonNullable<OneThreadSnapshot["inbound"]>> | null;
  person?: Partial<OneThreadSnapshot["person"]>;
  outbound?: OneThreadOutbound | null;
  readable?: boolean;
} = {}): OneThreadSnapshot {
  const inbound = overrides.inbound === null ? null : {
    id: ONE_THREAD_REPLY_INBOUND_ID,
    campaignId: ONE_THREAD_REPLY_CAMPAIGN_ID,
    direction: "inbound",
    status: "interpreted",
    outcome: "ask_question",
    error: null,
    effectApplied: true,
    replyBlock: null,
    replyToProviderMessageId: REPLY_TO,
    senderAccount: SENDER,
    personId: "person-1",
    journeyId: "journey-1",
    leadEmail: LEAD,
    ...overrides.inbound,
  };
  return {
    readable: overrides.readable ?? true,
    settings: {
      automation: "off",
      interpretation: "pilot",
      sending: "off",
      blocklist: "on",
      pilotCampaigns: [ONE_THREAD_REPLY_CAMPAIGN_ID],
      ...overrides.settings,
    },
    inbound,
    person: {
      found: true,
      lifecycle: "reply_needs_review",
      suppressed: false,
      clerkSubscribed: false,
      ...overrides.person,
    },
    outbound: overrides.outbound ?? null,
  };
}

function harness(options: {
  initial?: OneThreadSnapshot;
  reads?: OneThreadSnapshot[];
  stored?: number;
  claimResult?: "claimed" | "duplicate" | "error";
  fetchImpl?: typeof fetch;
} = {}) {
  const drafts: OneThreadSnapshot["inbound"][] = [];
  const claims: string[] = [];
  const records: Array<{ status: string; providerMessageId: string | null; error: string | null; expected: string }> = [];
  let outbound = options.initial?.outbound ?? null;
  let reads = 0;
  const fetchImpl = options.fetchImpl ?? vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: PROVIDER_ID }), { status: 200 }));
  const deps: OneThreadReplyDeps = {
    now: NOW,
    apiKey: "test-key",
    fetchImpl,
    read: async () => {
      const queued = options.reads?.[reads];
      reads += 1;
      if (queued) return queued;
      return snapshot({ ...(options.initial ?? {}), outbound });
    },
    storeDraft: async () => {
      drafts.push(options.initial?.inbound ?? snapshot().inbound);
      return options.stored ?? 1;
    },
    claim: async () => {
      claims.push(ONE_THREAD_REPLY_OUTBOUND_ID);
      if (options.claimResult) return options.claimResult;
      if (outbound) return "duplicate";
      outbound = { status: "processing", providerMessageId: null, claimUntil: new Date(NOW.getTime() + 60_000).toISOString(), error: null };
      return "claimed";
    },
    record: async (patch, expected) => {
      if (!outbound || outbound.status !== expected) return false;
      outbound = {
        status: patch.processing_status,
        providerMessageId: patch.provider_response_id,
        claimUntil: null,
        error: patch.processing_error,
      };
      records.push({
        status: patch.processing_status,
        providerMessageId: patch.provider_response_id,
        error: patch.processing_error,
        expected,
      });
      return true;
    },
  };
  return {
    deps,
    fetchImpl: fetchImpl as ReturnType<typeof vi.fn>,
    drafts,
    claims,
    records,
    outbound: () => outbound,
  };
}

describe("approved one-thread reply", () => {
  it("keeps the approved wording and the public offer", () => {
    expect(ONE_THREAD_REPLY_SUBJECT).toBe("Re: Summitt Mindset AI Conversation Test");
    expect(ONE_THREAD_REPLY_BODY).toBe([
      "Hi,",
      "",
      "Yes\u2014it\u2019s free for the first 7 days, with $0 due today. After the trial, membership is $29/month or $249/year, depending on the plan you choose. You can cancel anytime.",
      "",
      "Tyler Summitt",
    ].join("\n"));
    expect(reviewConversationDraft(ONE_THREAD_REPLY_BODY)).toBe(ONE_THREAD_REPLY_BODY);
    expect(ONE_THREAD_REPLY_BODY.toLowerCase()).toContain("cancel anytime");
    expect(ONE_THREAD_REPLY_BODY.toLowerCase()).not.toContain("refund");
    expect(ONE_THREAD_REPLY_OUTBOUND_ID).toBe(`outbound:${ONE_THREAD_REPLY_INBOUND_ID}`);
  });

  it("authorizes only the owner test message while the four controls stay in place", () => {
    expect(oneThreadReplyDecision(snapshot(), NOW)).toMatchObject({ action: "send" });
    const wrong = [
      ["settings_automation", snapshot({ settings: { automation: "pilot" } })],
      ["settings_sending", snapshot({ settings: { sending: "on" } })],
      ["settings_interpretation", snapshot({ settings: { interpretation: "off" } })],
      ["settings_pilot", snapshot({ settings: { pilotCampaigns: [ONE_THREAD_REPLY_CAMPAIGN_ID, "other-campaign"] } })],
      ["settings_blocklist", snapshot({ settings: { blocklist: "off" } })],
      ["message_missing", snapshot({ inbound: null })],
      ["message_missing", snapshot({ inbound: { id: "other-message" } })],
      ["wrong_campaign", snapshot({ inbound: { campaignId: "other-campaign" } })],
      ["missing_reply_target", snapshot({ inbound: { replyToProviderMessageId: null } })],
      ["missing_account", snapshot({ inbound: { senderAccount: null } })],
      ["ineligible", snapshot({ inbound: { status: "pending" } })],
      ["ineligible", snapshot({ inbound: { effectApplied: false } })],
      ["ineligible", snapshot({ person: { lifecycle: "paid_member" } })],
      ["ineligible", snapshot({ person: { suppressed: true } })],
      ["ineligible", snapshot({ person: { clerkSubscribed: true } })],
      ["suppression_unknown", snapshot({ person: { suppressed: null } })],
    ] as const;
    for (const [reason, row] of wrong) {
      expect(oneThreadReplyDecision(row, NOW), reason).toEqual({ action: "refuse", reason });
    }
  });

  it("leaves an existing sent, blocked, failed, or live claim without another provider call", () => {
    expect(oneThreadReplyDecision(snapshot({
      outbound: { status: "sent", providerMessageId: PROVIDER_ID, claimUntil: null, error: null },
    }), NOW)).toMatchObject({ action: "leave", state: "accepted", providerMessageId: PROVIDER_ID });
    expect(oneThreadReplyDecision(snapshot({
      outbound: { status: "blocked", providerMessageId: null, claimUntil: null, error: "unauthorized" },
    }), NOW)).toMatchObject({ action: "leave", state: "blocked", reason: "unauthorized" });
    expect(oneThreadReplyDecision(snapshot({
      outbound: { status: "failed", providerMessageId: null, claimUntil: null, error: "provider_error" },
    }), NOW)).toMatchObject({ action: "leave", state: "failed" });
    expect(oneThreadReplyDecision(snapshot({
      outbound: { status: "processing", providerMessageId: null, claimUntil: new Date(NOW.getTime() + 60_000).toISOString(), error: null },
    }), NOW)).toMatchObject({ action: "leave", state: "processing", reason: "claim_held" });
    expect(oneThreadReplyDecision(snapshot({
      outbound: { status: "uncertain", providerMessageId: PROVIDER_ID, claimUntil: null, error: "timeout_or_network" },
    }), NOW)).toMatchObject({ action: "reconcile", providerMessageId: PROVIDER_ID, expectedStatus: "uncertain" });
  });
});

describe("one-thread execution", () => {
  it("posts the approved text once and stores the exact provider id", async () => {
    const seen: Array<{ url: string; body: { eaccount: string; reply_to_uuid: string; subject: string; body: { text: string } } }> = [];
    const box = harness({
      fetchImpl: vi.fn<typeof fetch>(async (url, init) => {
        seen.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ id: PROVIDER_ID }), { status: 200 });
      }),
    });
    const first = await runOneThreadReply(box.deps);
    const second = await runOneThreadReply(box.deps);
    expect(first).toEqual({ state: "accepted", reason: null, providerMessageId: PROVIDER_ID });
    expect(second).toEqual({ state: "accepted", reason: null, providerMessageId: PROVIDER_ID });
    expect(seen).toEqual([{
      url: INSTANTLY_REPLY_URL,
      body: {
        eaccount: SENDER,
        reply_to_uuid: REPLY_TO,
        subject: ONE_THREAD_REPLY_SUBJECT,
        body: { text: ONE_THREAD_REPLY_BODY },
      },
    }]);
    expect(box.records).toEqual([{
      status: "sent",
      providerMessageId: PROVIDER_ID,
      error: null,
      expected: "processing",
    }]);
    expect(box.drafts).toHaveLength(1);
    expect(box.claims).toEqual([ONE_THREAD_REPLY_OUTBOUND_ID]);
    expect(box.outbound()).toMatchObject({ status: "sent", providerMessageId: PROVIDER_ID });
  });

  it("does not call the provider when a precondition fails", async () => {
    const cases = [
      snapshot({ settings: { sending: "on" } }),
      snapshot({ settings: { automation: "active" } }),
      snapshot({ settings: { pilotCampaigns: [] } }),
      snapshot({ settings: { blocklist: "off" } }),
      snapshot({ inbound: { id: "other-message" } }),
      snapshot({ inbound: { campaignId: "other-campaign" } }),
      snapshot({ inbound: { replyToProviderMessageId: " " } }),
      snapshot({ inbound: { senderAccount: "not-an-email" } }),
      snapshot({ inbound: { status: "pending" } }),
      snapshot({ person: { lifecycle: "trial_started" } }),
      snapshot({ person: { suppressed: null } }),
      snapshot({ outbound: { status: "sent", providerMessageId: PROVIDER_ID, claimUntil: null, error: null } }),
      snapshot({ outbound: { status: "blocked", providerMessageId: null, claimUntil: null, error: "ineligible" } }),
      snapshot({ outbound: { status: "failed", providerMessageId: null, claimUntil: null, error: "provider_error" } }),
      snapshot({ outbound: { status: "processing", providerMessageId: null, claimUntil: new Date(NOW.getTime() + 60_000).toISOString(), error: null } }),
    ];
    for (const initial of cases) {
      const box = harness({
        initial,
        stored: 1,
        fetchImpl: vi.fn<typeof fetch>(async () => {
          throw new Error("provider");
        }),
      });
      box.deps.storeDraft = async () => {
        throw new Error("draft");
      };
      box.deps.claim = async () => {
        throw new Error("claim");
      };
      await runOneThreadReply(box.deps);
      expect(box.fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("stops before the draft write when the second read loses eligibility", async () => {
    const box = harness({
      reads: [snapshot(), snapshot({ settings: { sending: "on" } })],
    });
    const result = await runOneThreadReply(box.deps);
    expect(result).toEqual({ state: "refused", reason: "settings_sending", providerMessageId: null });
    expect(box.drafts).toHaveLength(0);
    expect(box.claims).toHaveLength(0);
    expect(box.fetchImpl).not.toHaveBeenCalled();
  });

  it("stores the draft and still does not claim when eligibility changes before the claim", async () => {
    const box = harness({
      reads: [snapshot(), snapshot(), snapshot({ settings: { blocklist: "off" } })],
    });
    const result = await runOneThreadReply(box.deps);
    expect(result).toEqual({ state: "refused", reason: "settings_blocklist", providerMessageId: null });
    expect(box.drafts).toHaveLength(1);
    expect(box.claims).toHaveLength(0);
    expect(box.fetchImpl).not.toHaveBeenCalled();
  });

  it("does not claim or post when the guarded draft update matches nothing", async () => {
    const box = harness({ stored: 0 });
    const result = await runOneThreadReply(box.deps);
    expect(result).toEqual({ state: "refused", reason: "not_eligible", providerMessageId: null });
    expect(box.claims).toHaveLength(0);
    expect(box.fetchImpl).not.toHaveBeenCalled();
  });

  it("does not post when the claim loses or the provider key is missing", async () => {
    const missing = harness();
    missing.deps.apiKey = null;
    expect(await runOneThreadReply(missing.deps)).toEqual({ state: "refused", reason: "missing_credentials", providerMessageId: null });
    expect(missing.drafts).toHaveLength(0);
    expect(missing.fetchImpl).not.toHaveBeenCalled();

    const lost = harness({ claimResult: "duplicate" });
    expect(await runOneThreadReply(lost.deps)).toEqual({ state: "refused", reason: "duplicate_send", providerMessageId: null });
    expect(lost.fetchImpl).not.toHaveBeenCalled();

    const broken = harness({ claimResult: "error" });
    expect(await runOneThreadReply(broken.deps)).toEqual({ state: "refused", reason: "claim_failed", providerMessageId: null });
    expect(broken.fetchImpl).not.toHaveBeenCalled();
  });

  it("lets one of two concurrent executions post", async () => {
    let outbound: OneThreadOutbound | null = null;
    let posts = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      posts += 1;
      return new Response(JSON.stringify({ id: PROVIDER_ID }), { status: 200 });
    });
    const deps: OneThreadReplyDeps = {
      now: NOW,
      apiKey: "test-key",
      fetchImpl,
      read: async () => snapshot({ outbound }),
      storeDraft: async () => 1,
      claim: () => {
        if (outbound) return Promise.resolve("duplicate");
        outbound = { status: "processing", providerMessageId: null, claimUntil: new Date(NOW.getTime() + 60_000).toISOString(), error: null };
        return Promise.resolve("claimed");
      },
      record: async (patch, expected) => {
        if (!outbound || outbound.status !== expected) return false;
        outbound = {
          status: patch.processing_status,
          providerMessageId: patch.provider_response_id,
          claimUntil: null,
          error: patch.processing_error,
        };
        return true;
      },
    };
    const [first, second] = await Promise.all([runOneThreadReply(deps), runOneThreadReply(deps)]);
    expect(posts).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect([first, second].some((result) => result.state === "accepted" && result.providerMessageId === PROVIDER_ID)).toBe(true);
    expect([first, second].every((result) => (
      (result.state === "accepted" && result.providerMessageId === PROVIDER_ID)
      || result.state === "processing"
    ))).toBe(true);
    expect(outbound).toMatchObject({ status: "sent", providerMessageId: PROVIDER_ID });
  });

  it("keeps a timeout or an unreadable provider response from being posted again", async () => {
    const timeout = harness({
      fetchImpl: vi.fn<typeof fetch>(async () => {
        throw new Error("socket hang up");
      }),
    });
    expect(await runOneThreadReply(timeout.deps)).toMatchObject({ state: "uncertain", reason: "timeout_or_network", providerMessageId: null });
    expect(await runOneThreadReply(timeout.deps)).toMatchObject({ state: "uncertain", reason: "no_provider_id", providerMessageId: null });
    expect(timeout.fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(timeout.fetchImpl.mock.calls[0]?.[0])).toBe(INSTANTLY_REPLY_URL);

    const ambiguous = harness({
      fetchImpl: vi.fn<typeof fetch>(async () => new Response(JSON.stringify({}), { status: 200 })),
    });
    expect(await runOneThreadReply(ambiguous.deps)).toMatchObject({ state: "uncertain", reason: "unreadable_response", providerMessageId: null });
    expect(await runOneThreadReply(ambiguous.deps)).toMatchObject({ state: "uncertain", reason: "no_provider_id" });
    expect(ambiguous.fetchImpl).toHaveBeenCalledTimes(1);

    const rejected = harness({
      fetchImpl: vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ message: "no" }), { status: 401 })),
    });
    expect(await runOneThreadReply(rejected.deps)).toMatchObject({ state: "blocked", reason: "unauthorized" });
    expect(await runOneThreadReply(rejected.deps)).toMatchObject({ state: "blocked", reason: "unauthorized" });
    expect(rejected.fetchImpl).toHaveBeenCalledTimes(1);
    expect(rejected.records[0]).toMatchObject({ status: "blocked", providerMessageId: null, expected: "processing" });
  });

  it("reconciles an uncertain provider id with a read and does not post", async () => {
    const box = harness({
      initial: snapshot({
        outbound: { status: "uncertain", providerMessageId: PROVIDER_ID, claimUntil: null, error: "timeout_or_network" },
      }),
      fetchImpl: vi.fn<typeof fetch>(async (url) => {
        expect(String(url)).toBe(`https://api.instantly.ai/api/v2/emails/${PROVIDER_ID}`);
        expect(String(url)).not.toContain("/emails/reply");
        return new Response(JSON.stringify({ id: PROVIDER_ID }), { status: 200 });
      }),
    });
    box.deps.storeDraft = async () => {
      throw new Error("draft");
    };
    box.deps.claim = async () => {
      throw new Error("claim");
    };
    const result = await runOneThreadReply(box.deps);
    expect(result).toEqual({ state: "accepted", reason: null, providerMessageId: PROVIDER_ID });
    expect(box.records[0]).toMatchObject({ status: "sent", providerMessageId: PROVIDER_ID, expected: "uncertain" });
    expect(box.fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("one-thread route and wiring", () => {
  beforeEach(() => {
    ownerMock.mockReset();
    sendMock.mockReset();
  });

  it("rejects a non-owner before the sender and ignores any caller-selected message", async () => {
    ownerMock.mockResolvedValue(false);
    const denied = await POST();
    expect(denied.status).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
    ownerMock.mockResolvedValue(true);
    sendMock.mockResolvedValue({ state: "refused", reason: "message_missing", providerMessageId: null });
    const allowed = await POST();
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ state: "refused", reason: "message_missing", providerMessageId: null });
    expect(sendMock.mock.calls).toEqual([[]]);
    const route = readFileSync("src/app/api/admin/acquisition/one-thread-reply/route.ts", "utf8");
    const handler = route.slice(route.indexOf("export async function POST"));
    expect(handler.indexOf("isTylerOwnerSession")).toBeLessThan(handler.indexOf("sendAuthorizedOneThreadReply"));
    expect(route).not.toContain("request.json");
    expect(route).not.toContain("inboundMessageId");
    expect(POST.length).toBe(0);
  });

  it("does not enter the cron, the general reply queue, or scheduled acquisition sends", () => {
    const server = readFileSync("src/lib/acquisition/one-thread-reply.server.ts", "utf8");
    const pure = readFileSync("src/lib/acquisition/one-thread-reply.ts", "utf8");
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    const cron = store.slice(store.indexOf("export async function runAcquisitionCron"));
    const processor = store.slice(
      store.indexOf("export async function processAcquisitionConversations"),
      store.indexOf("export async function deliverAcquisitionThreadReply"),
    );
    const route = readFileSync("src/app/api/cron/acquisition/route.ts", "utf8");
    const middleware = readFileSync("src/middleware.ts", "utf8");
    const draft = server.slice(server.indexOf("async function storeApprovedDraft"), server.indexOf("async function claimOneThreadOutbound"));
    const claim = server.slice(server.indexOf("async function claimOneThreadOutbound"), server.indexOf("const recordOneThreadAttempt"));
    const run = pure.slice(pure.indexOf("export async function runOneThreadReply"));
    expect(draft).toContain('draft_subject: ONE_THREAD_REPLY_SUBJECT');
    expect(draft).toContain('draft_body: ONE_THREAD_REPLY_BODY');
    expect(draft).toContain('.eq("id", ONE_THREAD_REPLY_INBOUND_ID)');
    expect(draft).toContain('.eq("campaign_id", ONE_THREAD_REPLY_CAMPAIGN_ID)');
    expect(draft).toContain('.eq("processing_status", "interpreted")');
    expect(draft).toContain('.eq("ai_outcome", "ask_question")');
    expect(draft).toContain('.not("effect_applied_at", "is", null)');
    expect(draft).not.toContain("processing_status:");
    expect(draft).not.toContain("ai_outcome:");
    expect(draft).not.toContain("body_text");
    expect(claim).toContain("provider_message_id: ONE_THREAD_REPLY_OUTBOUND_ID");
    expect(claim).toContain("body_text: ONE_THREAD_REPLY_BODY");
    expect(claim).toContain('23505');
    expect(run.indexOf("storeDraft")).toBeLessThan(run.indexOf("deps.claim"));
    expect(run.indexOf("deps.claim")).toBeLessThan(run.indexOf("postInstantlyThreadReply"));
    for (const source of [server, pure, readFileSync("src/app/api/admin/acquisition/one-thread-reply/route.ts", "utf8")]) {
      expect(source).not.toContain("runAcquisitionCron");
      expect(source).not.toContain("processAcquisitionConversations");
      expect(source).not.toContain("deliverAcquisitionThreadReply");
      expect(source).not.toContain("scheduleAction");
      expect(source).not.toContain("acquisition_actions");
      expect(source).not.toContain("decideConversationEffect");
      expect(source).not.toContain("applySignal");
    }
    expect(server).not.toContain('from("acquisition_settings")');
    expect(cron).not.toContain("one-thread-reply");
    expect(cron).not.toContain("sendAuthorizedOneThreadReply");
    expect(processor).not.toContain("sendAuthorizedOneThreadReply");
    expect(route).not.toContain("one-thread-reply");
    expect(middleware).not.toContain("one-thread-reply");
  });
});
