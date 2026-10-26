import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { reviewConversationDraft } from "@/lib/acquisition/conversation";
import {
  approvedEmailDecision,
  blockedInboundIds,
  emailAnswerAdminUrl,
  manualAnswerNeeded,
  manualAnswersMissingFrom,
  missingInformationReason,
  notificationPlan,
  reviewOwnerEmailAnswer,
  runApprovedEmailAnswer,
  stuckManualSendRepair,
  type ApprovedEmailSnapshot,
} from "@/lib/acquisition/email-manual-answer";
import { INSTANTLY_REPLY_URL } from "@/lib/acquisition/instantly-reply";

const NOW = new Date("2026-10-25T22:00:00.000Z");
const REPLY_TO = "01234567-89ab-cdef-0123-456789abcdef";

function snapshot(patch: Partial<ApprovedEmailSnapshot> = {}): ApprovedEmailSnapshot {
  return {
    readable: true,
    request: {
      id: "request-1",
      status: "open",
      approvedBody: "We do not promise a refund. After the trial, membership is $29/month or $249/year.",
      inboundMessageId: "inbound-1",
      personId: "person-1",
      journeyId: "journey-1",
      claimUntil: null,
    },
    inbound: {
      replyToProviderMessageId: REPLY_TO,
      senderAccount: "outreach@summittmindset.com",
      subject: "Summitt Mindset",
      leadEmail: "coach@school.edu",
      campaignId: "camp-1",
    },
    person: {
      found: true,
      lifecycle: "reply_needs_review",
      suppressed: false,
      clerkSubscribed: false,
    },
    outbound: null,
    ...patch,
  };
}

describe("unsupported email questions", () => {
  it("creates a request only for an unsupported question or a withheld draft", () => {
    expect(manualAnswerNeeded({ outcome: "needs_human", draftRejected: false, processingError: null })).toBe(true);
    expect(manualAnswerNeeded({ outcome: "ask_question", draftRejected: true, processingError: null })).toBe(true);
    expect(manualAnswerNeeded({ outcome: "ask_question", draftRejected: false, processingError: "draft_rejected" })).toBe(true);
    expect(manualAnswerNeeded({ outcome: "ask_question", draftRejected: false, processingError: null })).toBe(false);
    expect(manualAnswerNeeded({ outcome: "ambiguous", draftRejected: false, processingError: null })).toBe(false);
    expect(manualAnswerNeeded({ outcome: "referral", draftRejected: false, processingError: null })).toBe(false);
    expect(manualAnswerNeeded({ outcome: "offer_decline", draftRejected: false, processingError: null })).toBe(false);
    expect(manualAnswerNeeded({ outcome: "unsubscribe", draftRejected: false, processingError: null })).toBe(false);
    expect(manualAnswerNeeded({ outcome: "complaint", draftRejected: false, processingError: null })).toBe(false);
    expect(manualAnswerNeeded({ outcome: "accept_offer", draftRejected: false, processingError: null })).toBe(false);
    expect(manualAnswerNeeded({ outcome: null, draftRejected: false, processingError: "model_failed" })).toBe(false);
    expect(manualAnswerNeeded({ outcome: null, draftRejected: false, processingError: "openai_unavailable" })).toBe(false);
    expect(reviewConversationDraft("We can refund the first month.")).toBeNull();
    expect(missingInformationReason({
      outcome: "ask_question",
      reason: "The draft added a refund.",
      draftRejected: true,
    })).toContain("Draft withheld");
    expect(missingInformationReason({
      outcome: "needs_human",
      reason: "The refund policy is not verified.",
      draftRejected: false,
    })).toBe("The refund policy is not verified.");
  });

  it("retries a failed notice and leaves a successful notice alone", () => {
    expect(notificationPlan({ status: "open", notificationStatus: "pending", attempts: 0, updatedAt: NOW.toISOString() }, NOW)).toBe("send");
    expect(notificationPlan({ status: "open", notificationStatus: "failed", attempts: 2, updatedAt: NOW.toISOString() }, NOW)).toBe("send");
    expect(notificationPlan({ status: "open", notificationStatus: "sent", attempts: 1, updatedAt: NOW.toISOString() }, NOW)).toBe("leave");
    expect(notificationPlan({ status: "open", notificationStatus: "failed", attempts: 3, updatedAt: NOW.toISOString() }, NOW)).toBe("leave");
    expect(notificationPlan({ status: "open", notificationStatus: "notifying", attempts: 1, updatedAt: NOW.toISOString() }, NOW)).toBe("leave");
    expect(notificationPlan({
      status: "open",
      notificationStatus: "notifying",
      attempts: 1,
      updatedAt: new Date(NOW.getTime() - 11 * 60 * 1000).toISOString(),
    }, NOW)).toBe("send");
    expect(notificationPlan({ status: "sent", notificationStatus: "pending", attempts: 0, updatedAt: NOW.toISOString() }, NOW)).toBe("leave");
    expect(emailAnswerAdminUrl("request-1")).toBe("https://summittmindset.com/admin/distribution/email-answers?request=request-1");
    const notice = readFileSync("src/lib/acquisition/notify-email-answer.ts", "utf8");
    expect(notice).not.toContain("lead_email");
    expect(notice).not.toContain("leadEmail");
    expect(notice).toContain("emailAnswerAdminUrl");
  });

  it("keeps two questions on one journey separate and holds the journey until the open request is finished", () => {
    const blocked = blockedInboundIds({
      messages: [
        { id: "inbound-1", journeyId: "journey-1" },
        { id: "inbound-2", journeyId: "journey-1" },
        { id: "inbound-3", journeyId: "journey-2" },
      ],
      answers: [
        { inboundMessageId: "inbound-1", journeyId: "journey-1", status: "open" },
      ],
    });
    expect([...blocked].sort()).toEqual(["inbound-1", "inbound-2"]);
    const finished = blockedInboundIds({
      messages: [{ id: "inbound-2", journeyId: "journey-1" }],
      answers: [{ inboundMessageId: "inbound-1", journeyId: "journey-1", status: "sent" }],
    });
    expect(finished.size).toBe(0);
  });

  it("repairs a missing request that sits behind requests already stored", () => {
    const covered = ["covered-0", "covered-1", "covered-2", "covered-3", "covered-4"];
    expect(manualAnswersMissingFrom({
      messages: [
        ...covered.map((id) => ({ id, outcome: "needs_human", processingError: null })),
        { id: "missing-draft", outcome: "ask_question", processingError: "draft_rejected" },
        { id: "supported", outcome: "ask_question", processingError: null },
        { id: "failed-model", outcome: null, processingError: "model_failed" },
      ],
      coveredInboundIds: new Set(covered),
    })).toEqual(["missing-draft"]);
  });
});

describe("owner approval sends once on the original thread", () => {
  it("refuses an opted-out prospect before any outbound insert", async () => {
    const inserts: string[] = [];
    const posts = vi.fn();
    const result = await runApprovedEmailAnswer({
      now: NOW,
      apiKey: "test-key",
      read: async () => snapshot({ person: { found: true, lifecycle: "unsubscribed", suppressed: true, clerkSubscribed: false } }),
      mark: async () => true,
      claim: async () => "claimed",
      insertOutbound: async () => {
        inserts.push("inserted");
        return "inserted";
      },
      recordOutbound: async () => true,
      fetchImpl: posts,
    });
    expect(result).toMatchObject({ state: "blocked", reason: "ineligible" });
    expect(inserts).toEqual([]);
    expect(posts).not.toHaveBeenCalled();
  });

  it("posts the stored thread once and does not post again after an uncertain result", async () => {
    let requestStatus = "open";
    let outbound: ApprovedEmailSnapshot["outbound"] = null;
    const posted: string[] = [];
    const read = async () => snapshot({
      request: {
        id: "request-1",
        status: requestStatus,
        approvedBody: "We do not promise a refund.",
        inboundMessageId: "inbound-1",
        personId: "person-1",
        journeyId: "journey-1",
        claimUntil: null,
      },
      outbound,
    });
    const deps = {
      now: NOW,
      apiKey: "test-key",
      read,
      mark: async (status: string) => {
        requestStatus = status;
        return true;
      },
      claim: async () => {
        if (requestStatus !== "open") return "lost" as const;
        requestStatus = "sending";
        return "claimed" as const;
      },
      insertOutbound: async (guard: { replyTo: string }) => {
        if (outbound) return "duplicate" as const;
        expect(guard.replyTo).toBe(REPLY_TO);
        outbound = { status: "processing", providerMessageId: null, claimUntil: null, error: null };
        return "inserted" as const;
      },
      recordOutbound: async (patch: { processing_status: string; provider_response_id: string | null }) => {
        outbound = {
          status: patch.processing_status,
          providerMessageId: patch.provider_response_id,
          claimUntil: null,
          error: patch.processing_status === "uncertain" ? "timeout_or_network" : null,
        };
        return true;
      },
      fetchImpl: vi.fn(async (url: string | URL | Request) => {
        posted.push(String(url));
        throw new Error("timeout");
      }),
    };
    expect(reviewOwnerEmailAnswer("We do not promise a refund.")).toContain("refund");
    const first = await runApprovedEmailAnswer(deps);
    expect(first.state).toBe("uncertain");
    const second = await runApprovedEmailAnswer(deps);
    expect(second.state).toBe("uncertain");
    expect(posted.filter((url) => url === INSTANTLY_REPLY_URL)).toEqual([INSTANTLY_REPLY_URL]);
    expect(approvedEmailDecision(await read(), NOW).action).toBe("reconcile");
  });

  it("lets only one worker post when two approvals race", async () => {
    let requestStatus = "open";
    let outbound: ApprovedEmailSnapshot["outbound"] = null;
    let posts = 0;
    const read = async () => snapshot({
      request: {
        id: "request-1",
        status: requestStatus,
        approvedBody: "The annual plan is $249/year after the trial.",
        inboundMessageId: "inbound-1",
        personId: "person-1",
        journeyId: "journey-1",
        claimUntil: null,
      },
      outbound,
    });
    const deps = {
      now: NOW,
      apiKey: "test-key",
      read,
      mark: async (status: string) => {
        requestStatus = status;
        return true;
      },
      claim: async () => {
        if (requestStatus !== "open") return "lost" as const;
        requestStatus = "sending";
        return "claimed" as const;
      },
      insertOutbound: async (guard: { replyTo: string; body: string }) => {
        if (outbound) return "duplicate" as const;
        expect(guard.replyTo).toBe(REPLY_TO);
        expect(guard.body).toBe("The annual plan is $249/year after the trial.");
        outbound = { status: "processing", providerMessageId: null, claimUntil: null, error: null };
        return "inserted" as const;
      },
      recordOutbound: async (patch: { processing_status: string; provider_response_id: string | null }) => {
        outbound = { status: patch.processing_status, providerMessageId: patch.provider_response_id, claimUntil: null, error: null };
        return true;
      },
      fetchImpl: vi.fn(async () => {
        posts += 1;
        return new Response(JSON.stringify({ id: "provider-1" }), { status: 200 });
      }),
    };
    const [left, right] = await Promise.all([runApprovedEmailAnswer(deps), runApprovedEmailAnswer(deps)]);
    expect(posts).toBe(1);
    expect([left.state, right.state].sort()).toEqual(["accepted", "processing"]);
    expect(outbound?.providerMessageId).toBe("provider-1");
  });

  it("reclaims an expired send claim and still posts the original thread once", () => {
    const current = snapshot();
    current.request = { ...current.request!, status: "sending", claimUntil: new Date(NOW.getTime() - 1000).toISOString() };
    expect(approvedEmailDecision(current, NOW).action).toBe("send");
    current.request = { ...current.request, claimUntil: new Date(NOW.getTime() + 60_000).toISOString() };
    expect(approvedEmailDecision(current, NOW)).toMatchObject({ action: "leave", result: { state: "processing" } });
  });
});

describe("manual send crash boundaries do not post twice", () => {
  const past = new Date(NOW.getTime() - 60_000).toISOString();
  const future = new Date(NOW.getTime() + 60_000).toISOString();
  const outbound = (
    status: string,
    providerMessageId: string | null,
    claimUntil: string | null,
  ) => ({ status, providerMessageId, claimUntil, error: status === "failed" ? "provider_error" : null });

  it("maps each crash to one safe recovery and never a blind second post", () => {
    expect(stuckManualSendRepair({
      requestStatus: "open", claimUntil: null, outbound: null, now: NOW,
    })).toEqual({ action: "leave" });
    expect(stuckManualSendRepair({
      requestStatus: "sending", claimUntil: past, outbound: null, now: NOW,
    })).toEqual({ action: "reopen" });
    expect(stuckManualSendRepair({
      requestStatus: "sending", claimUntil: future, outbound: null, now: NOW,
    })).toEqual({ action: "leave" });
    expect(stuckManualSendRepair({
      requestStatus: "sending", claimUntil: past, outbound: outbound("processing", null, past), now: NOW,
    })).toEqual({ action: "hold_uncertain", reason: "no_provider_id" });
    expect(stuckManualSendRepair({
      requestStatus: "sending", claimUntil: past, outbound: outbound("processing", null, future), now: NOW,
    })).toEqual({ action: "leave" });
    expect(stuckManualSendRepair({
      requestStatus: "sending", claimUntil: past, outbound: outbound("processing", "provider-1", past), now: NOW,
    })).toMatchObject({ action: "read_provider", providerMessageId: "provider-1" });
    expect(stuckManualSendRepair({
      requestStatus: "sending", claimUntil: past, outbound: outbound("sent", "provider-1", null), now: NOW,
    })).toEqual({ action: "mark_sent", providerMessageId: "provider-1" });
    expect(stuckManualSendRepair({
      requestStatus: "sending", claimUntil: past, outbound: outbound("uncertain", null, null), now: NOW,
    })).toEqual({ action: "hold_uncertain", reason: "no_provider_id" });
    expect(stuckManualSendRepair({
      requestStatus: "uncertain", claimUntil: null, outbound: outbound("uncertain", null, null), now: NOW,
    })).toEqual({ action: "leave" });
    expect(stuckManualSendRepair({
      requestStatus: "sending", claimUntil: past, outbound: outbound("failed", null, null), now: NOW,
    })).toMatchObject({ action: "mark_terminal", status: "failed" });
  });

  it("posts once after a crash before the claim, and not again after acceptance is recorded", async () => {
    let requestStatus = "open";
    let claimUntil: string | null = null;
    let outbound: ApprovedEmailSnapshot["outbound"] = null;
    let crashBeforeClaim = true;
    const posts: string[] = [];
    const marked: string[] = [];
    const read = async () => snapshot({
      request: {
        id: "request-1",
        status: requestStatus,
        approvedBody: "The annual plan is $249/year after the trial.",
        inboundMessageId: "inbound-1",
        personId: "person-1",
        journeyId: "journey-1",
        claimUntil,
      },
      outbound,
    });
    const deps = {
      now: NOW,
      apiKey: "test-key",
      read,
      mark: async (status: string) => {
        marked.push(status);
        requestStatus = status;
        claimUntil = null;
        return true;
      },
      claim: async () => {
        if (crashBeforeClaim) {
          crashBeforeClaim = false;
          throw new Error("crash before claim");
        }
        if (requestStatus !== "open" && !(requestStatus === "sending" && claimUntil != null && Date.parse(claimUntil) <= NOW.getTime())) {
          return "lost" as const;
        }
        requestStatus = "sending";
        claimUntil = future;
        return "claimed" as const;
      },
      insertOutbound: async () => {
        if (outbound) return "duplicate" as const;
        outbound = { status: "processing", providerMessageId: null, claimUntil: future, error: null };
        return "inserted" as const;
      },
      recordOutbound: async (patch: { processing_status: string; provider_response_id: string | null; processing_error: string | null }) => {
        outbound = {
          status: patch.processing_status,
          providerMessageId: patch.provider_response_id,
          claimUntil: null,
          error: patch.processing_error,
        };
        return true;
      },
      fetchImpl: vi.fn(async (url: string | URL | Request) => {
        posts.push(String(url));
        return new Response(JSON.stringify({ id: "provider-1" }), { status: 200 });
      }),
    };
    await expect(runApprovedEmailAnswer(deps)).rejects.toThrow("crash before claim");
    expect(posts).toEqual([]);
    expect(requestStatus).toBe("open");
    const sent = await runApprovedEmailAnswer(deps);
    expect(sent).toMatchObject({ state: "accepted", providerMessageId: "provider-1" });
    expect(posts).toEqual([INSTANTLY_REPLY_URL]);
    const again = await runApprovedEmailAnswer(deps);
    expect(again.state).toBe("accepted");
    expect(posts).toEqual([INSTANTLY_REPLY_URL]);
    expect(marked).toContain("sent");
  });

  it("does not post when the claim or the provider result was not recorded", async () => {
    const posts: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      posts.push(String(url));
      return new Response(JSON.stringify({ id: "provider-1" }), { status: 200 });
    });
    const base = snapshot().request!;
    const expired = await runApprovedEmailAnswer({
      now: NOW,
      apiKey: "test-key",
      read: async () => snapshot({
        request: { ...base, status: "sending", claimUntil: past },
        outbound: { status: "processing", providerMessageId: null, claimUntil: past, error: null },
      }),
      mark: async () => true,
      claim: async () => "claimed",
      insertOutbound: async () => "inserted",
      recordOutbound: async () => true,
      fetchImpl,
    });
    expect(expired).toMatchObject({ state: "uncertain", reason: "no_provider_id" });
    const live = await runApprovedEmailAnswer({
      now: NOW,
      apiKey: "test-key",
      read: async () => snapshot({
        request: { ...base, status: "sending", claimUntil: future },
        outbound: { status: "processing", providerMessageId: null, claimUntil: future, error: null },
      }),
      mark: async () => true,
      claim: async () => "claimed",
      insertOutbound: async () => "inserted",
      recordOutbound: async () => true,
      fetchImpl,
    });
    expect(live).toMatchObject({ state: "processing", reason: "claim_held" });
    const recorded = await runApprovedEmailAnswer({
      now: NOW,
      apiKey: "test-key",
      read: async () => snapshot({
        request: { ...base, status: "sending", claimUntil: past },
        outbound: { status: "sent", providerMessageId: "provider-1", claimUntil: null, error: null },
      }),
      mark: async () => true,
      claim: async () => "claimed",
      insertOutbound: async () => "inserted",
      recordOutbound: async () => true,
      fetchImpl,
    });
    expect(recorded).toMatchObject({ state: "accepted", providerMessageId: "provider-1" });
    expect(posts).toEqual([]);
  });

  it("blocks an opt-out that arrives while the approved answer is still unsent", async () => {
    const posts = vi.fn();
    const result = await runApprovedEmailAnswer({
      now: NOW,
      apiKey: "test-key",
      read: async () => snapshot({
        request: { ...snapshot().request!, status: "open", approvedBody: "The annual plan is $249/year after the trial." },
        person: { found: true, lifecycle: "reply_needs_review", suppressed: true, clerkSubscribed: false },
      }),
      mark: async () => true,
      claim: async () => "claimed",
      insertOutbound: async () => "inserted",
      recordOutbound: async () => true,
      fetchImpl: posts,
    });
    expect(result).toMatchObject({ state: "blocked", reason: "ineligible" });
    expect(posts).not.toHaveBeenCalled();
  });
});

describe("email escalation stays inside the existing acquisition path", () => {
  it("does not open sending, schedule an asset, or touch SMS and Stripe", () => {
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    const processor = store.slice(
      store.indexOf("export async function processAcquisitionConversations"),
      store.indexOf("export async function deliverAcquisitionThreadReply"),
    );
    const cron = store.slice(store.indexOf("export async function runAcquisitionCron"));
    const server = readFileSync("src/lib/acquisition/email-manual-answer.server.ts", "utf8");
    const migration = readFileSync("supabase/migrations/20261025190000_acquisition_email_manual_answers.sql", "utf8");
    const page = readFileSync("src/app/admin/distribution/email-answers/page.tsx", "utf8");
    const listRoute = readFileSync("src/app/api/admin/acquisition/email-answers/route.ts", "utf8");
    const saveRoute = readFileSync("src/app/api/admin/acquisition/email-answers/[id]/route.ts", "utf8");
    const sendRoute = readFileSync("src/app/api/admin/acquisition/email-answers/[id]/send/route.ts", "utf8");
    const middleware = readFileSync("src/middleware.ts", "utf8");
    const distribution = readFileSync("src/app/admin/operating-screen.tsx", "utf8");
    expect(processor).toContain("reconcileAcquisitionEmailAnswers");
    expect(processor).toContain("inboundIdsBlockedByEmailAnswers");
    expect(processor).toContain("holdFailed");
    expect(processor).toContain('conversationSending === "on"');
    expect(processor).not.toContain("postInstantlyThreadReply");
    expect(cron).toContain('skipped: "automation_off"');
    expect(cron).not.toContain("reconcileAcquisitionEmailAnswers");
    expect(server).not.toContain("scheduleAction");
    expect(server).not.toContain("acquisition_actions");
    expect(server).toContain('from("acquisition_settings")');
    expect(server).not.toContain('from("acquisition_settings").update');
    expect(server).not.toContain("knowledge_entry_id");
    expect(server).not.toContain("sms_inbound");
    expect(server).not.toContain("stripe");
    expect(server).toContain("23505");
    expect(server).toContain("`outbound:${request.inboundMessageId}`");
    expect(server).toContain('from("acquisition_email_answer_gaps")');
    expect(server).toContain("reconcileInstantlyReply");
    expect(server).not.toContain("postInstantlyThreadReply");
    expect(server).not.toContain(INSTANTLY_REPLY_URL);
    expect(migration).toContain("UNIQUE (inbound_message_id)");
    expect(migration).toContain("'needs_human'");
    expect(migration).toContain("knowledge_entry_id UUID NULL");
    expect(migration).toContain("CREATE VIEW public.acquisition_email_answer_gaps");
    expect(migration).toContain("NOT EXISTS");
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(migration).not.toMatch(/\bUPDATE\s+public\./);
    expect(page.indexOf("isTylerOwnerSession")).toBeLessThan(page.indexOf("EmailAnswersDashboard"));
    for (const route of [listRoute, saveRoute, sendRoute]) {
      const handler = route.slice(route.indexOf("export async function"));
      expect(handler.indexOf("isTylerOwnerSession")).toBeLessThan(handler.search(/listEmailAnswers|saveEmailAnswer|sendApprovedEmailAnswer/));
    }
    expect(middleware).not.toContain("email-answers");
    expect(distribution).toContain('href="/admin/distribution/email-answers"');
    expect(readFileSync("src/app/api/admin/acquisition/one-thread-reply/route.ts", "utf8")).toContain("sendAuthorizedOneThreadReply");
    expect(readFileSync("src/lib/acquisition/one-thread-reply.ts", "utf8")).toContain("856a5ef5-88c6-44c6-b001-a5b020d641f7");
  });
});
