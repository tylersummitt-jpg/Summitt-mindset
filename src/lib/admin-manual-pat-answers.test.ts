import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendSMSChunked = vi.hoisted(() => vi.fn());
const isTwilioReady = vi.hoisted(() => vi.fn(() => true));
const eligibilityMock = vi.hoisted(() => vi.fn());
const threadMemMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const getActiveCommitmentMock = vi.hoisted(() =>
  vi.fn(async () => ({ id: "cmt_1" }))
);
const exactThreadMock = vi.hoisted(() => vi.fn());
const clerkMetaMock = vi.hoisted(() => vi.fn(async () => ({ timezone: "America/New_York" })));

type Job = {
  message_sid: string;
  clerk_user_id: string;
  from_phone: string;
  raw_body: string;
  status: string;
  reply_body: string | null;
  sent_at: string | null;
  outbound_message_sid: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  next_retry_at?: string;
};

const { db, makeBuilder } = vi.hoisted(() => {
  const db = {
    jobs: [] as Job[],
    profiles: [] as Array<{ clerk_user_id: string; preferred_name: string | null }>,
  };

  function makeBuilder(table: string) {
    const filters: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    let inIds: string[] | null = null;
    let wantSingle = false;

    const runSelect = () => {
      if (table === "user_profiles") {
        const rows = db.profiles.filter(
          (p) => !inIds || inIds.includes(p.clerk_user_id)
        );
        return { data: rows, error: null };
      }
      let rows = [...db.jobs];
      if (typeof filters.message_sid === "string") {
        rows = rows.filter((j) => j.message_sid === filters.message_sid);
      }
      if (typeof filters.status === "string") {
        rows = rows.filter((j) => j.status === filters.status);
      }
      rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
      if (wantSingle) {
        return { data: rows[0] ?? null, error: null };
      }
      return { data: rows, error: null };
    };

    const runUpdate = () => {
      const idx = db.jobs.findIndex((j) => {
        if (
          typeof filters.message_sid === "string" &&
          j.message_sid !== filters.message_sid
        ) {
          return false;
        }
        if (typeof filters.status === "string" && j.status !== filters.status) {
          return false;
        }
        return true;
      });
      if (idx < 0 || !patch) {
        return { data: wantSingle ? null : [], error: null };
      }
      db.jobs[idx] = { ...db.jobs[idx]!, ...patch } as Job;
      const row = db.jobs[idx]!;
      return { data: wantSingle ? row : [row], error: null };
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      update: (p: Record<string, unknown>) => {
        patch = p;
        return builder;
      },
      eq: (k: string, v: unknown) => {
        filters[k] = v;
        return builder;
      },
      in: (_k: string, ids: string[]) => {
        inIds = ids;
        return builder;
      },
      order: () => builder,
      maybeSingle: async () => {
        wantSingle = true;
        return patch ? runUpdate() : runSelect();
      },
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(patch ? runUpdate() : runSelect()).then(resolve, reject),
    };
    return builder;
  }

  return { db, makeBuilder };
});

vi.mock("server-only", () => ({}));

vi.mock("@/lib/twilio", () => ({
  sendSMSChunked: (...args: unknown[]) => sendSMSChunked(...args),
  isTwilioReady: () => isTwilioReady(),
}));

vi.mock("@/lib/account-deletion/inbound-coach-send-eligibility", () => ({
  checkInboundCoachSmsEligibility: (...args: unknown[]) => eligibilityMock(...args),
}));

vi.mock("@/lib/v2-commitment-sms-thread-memory", () => ({
  upsertCommitmentSmsThreadMemoryFromOutbound: (...args: unknown[]) =>
    threadMemMock(...args),
}));

vi.mock("@/lib/v2-commitment", () => ({
  getActiveCommitment: (...args: unknown[]) => getActiveCommitmentMock(...args),
}));

vi.mock("@/lib/sms-recent-exact-thread-72h", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sms-recent-exact-thread-72h")>(
    "@/lib/sms-recent-exact-thread-72h"
  );
  return {
    ...actual,
    buildRecentExactThread72h: (...args: unknown[]) => exactThreadMock(...args),
  };
});

vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: (...args: unknown[]) => clerkMetaMock(...args),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => makeBuilder(table),
  },
}));

function seedJob(over: Partial<Job> = {}): Job {
  const job: Job = {
    message_sid: "SMpark1",
    clerk_user_id: "user_brooke",
    from_phone: "+15551112222",
    raw_body: "Did you set alarms at night?",
    status: "awaiting_manual_pat_answer",
    reply_body: null,
    sent_at: null,
    outbound_message_sid: null,
    last_error: JSON.stringify({ tag: "inbound_sol_awaiting_manual_pat_answer" }),
    created_at: "2026-08-30T11:00:00.000Z",
    updated_at: "2026-08-30T11:00:00.000Z",
    ...over,
  };
  db.jobs.push(job);
  return job;
}

import {
  listManualPatAnswers,
  saveManualPatDraft,
  sendManualPatCoachReply,
  SMS_NO_LONGER_ELIGIBLE_ERROR,
} from "@/lib/admin-manual-pat-answers";
import { coachJobReplyStrongDeliveryEvidence } from "@/lib/sms-recent-exact-thread-72h";

describe("admin manual Pat answers", () => {
  beforeEach(() => {
    db.jobs = [];
    db.profiles = [{ clerk_user_id: "user_brooke", preferred_name: "Brooke" }];
    sendSMSChunked.mockReset();
    sendSMSChunked.mockResolvedValue({
      firstSid: "SMout1",
      chunkCount: 1,
      chunkLengths: [10],
      messageSids: ["SMout1"],
      firstStatus: "queued",
    });
    isTwilioReady.mockReturnValue(true);
    eligibilityMock.mockReset();
    eligibilityMock.mockResolvedValue({ ok: true, reason: "eligible" });
    threadMemMock.mockClear();
    getActiveCommitmentMock.mockClear();
    exactThreadMock.mockReset();
    exactThreadMock.mockResolvedValue({
      messages: [
        {
          role: "user",
          body: "Did you set alarms at night?",
          at: "2026-08-30T11:00:00.000Z",
          at_local: "Aug 30, 7:00 AM",
        },
      ],
    });
    clerkMetaMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("2/3/4/5/23: lists only awaiting rows, oldest first, preferred_name, exact raw_body, thread, separate cards", async () => {
    seedJob({
      message_sid: "SMnew",
      created_at: "2026-08-30T12:00:00.000Z",
      raw_body: "What about the second question?",
    });
    seedJob({
      message_sid: "SMold",
      created_at: "2026-08-30T10:00:00.000Z",
      raw_body: "Did you set alarms at night?",
    });
    seedJob({
      message_sid: "SMsent",
      status: "sent",
      created_at: "2026-08-30T09:00:00.000Z",
    });
    const rows = await listManualPatAnswers();
    expect(rows.map((r) => r.messageSid)).toEqual(["SMold", "SMnew"]);
    expect(rows[0]?.preferredName).toBe("Brooke");
    expect(rows[0]?.question).toBe("Did you set alarms at night?");
    expect(rows[1]?.question).toBe("What about the second question?");
    expect(rows[0]?.thread).toEqual([
      {
        role: "user",
        body: "Did you set alarms at night?",
        at: "2026-08-30T11:00:00.000Z",
        atLocal: "Aug 30, 7:00 AM",
      },
    ]);
    expect(exactThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkUserId: "user_brooke",
        path: "inbound",
        preserveUserBodyFormatting: true,
      })
    );
    expect(exactThreadMock.mock.calls[0]?.[0]).not.toEqual(
      expect.objectContaining({ windowDays: 21 })
    );
  });

  it("6/7/9: save persists exact body, no Twilio, reload restores draft", async () => {
    seedJob();
    const saved = await saveManualPatDraft({
      messageSid: "SMpark1",
      replyBody: "Yes. We set the gym alarms every night.\n",
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.replyBody).toBe("Yes. We set the gym alarms every night.\n");
    }
    expect(db.jobs[0]?.status).toBe("awaiting_manual_pat_answer");
    expect(db.jobs[0]?.reply_body).toBe("Yes. We set the gym alarms every night.\n");
    expect(db.jobs[0]?.sent_at).toBeNull();
    expect(db.jobs[0]?.outbound_message_sid).toBeNull();
    expect(db.jobs[0]?.last_error).toContain("inbound_sol_awaiting_manual_pat_answer");
    expect(sendSMSChunked).not.toHaveBeenCalled();

    const rows = await listManualPatAnswers();
    expect(rows[0]?.replyBody).toBe("Yes. We set the gym alarms every night.\n");
  });

  it("17: save after send starts is rejected", async () => {
    seedJob({ status: "sending", reply_body: "draft" });
    const saved = await saveManualPatDraft({
      messageSid: "SMpark1",
      replyBody: "newer",
    });
    expect(saved.ok).toBe(false);
    if (!saved.ok) expect(saved.status).toBe(409);
    expect(db.jobs[0]?.reply_body).toBe("draft");
  });

  it("8: unsent awaiting reply_body is not strong Coach delivery evidence", () => {
    const evidence = coachJobReplyStrongDeliveryEvidence(
      {
        status: "awaiting_manual_pat_answer",
        reply_body: "Unsent Tyler draft",
        sent_at: null,
        outbound_message_sid: null,
      },
      "Unsent Tyler draft"
    );
    expect(evidence).toBeNull();
  });

  it("10: blank Send is blocked", async () => {
    seedJob({ reply_body: "   " });
    const result = await sendManualPatCoachReply("SMpark1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe("Answer is empty.");
    }
    expect(sendSMSChunked).not.toHaveBeenCalled();
    expect(db.jobs[0]?.status).toBe("awaiting_manual_pat_answer");
  });

  it("11/12/13/14/18: Send CAS awaiting→sending and sends exact Tyler body with no rewrite", async () => {
    seedJob({ reply_body: "  Yes. Early, every night.  " });
    const result = await sendManualPatCoachReply("SMpark1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bodySent).toBe("Yes. Early, every night.");
      expect(result.outboundMessageSid).toBe("SMout1");
    }
    expect(eligibilityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageSid: "SMpark1",
        expectedJobStatuses: ["sending"],
      })
    );
    expect(sendSMSChunked).toHaveBeenCalledTimes(1);
    expect(sendSMSChunked.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        to: "+15551112222",
        body: "Yes. Early, every night.",
        lastOutbound: { clerkUserId: "user_brooke", messageKind: "coach" },
      })
    );
    expect(db.jobs[0]?.status).toBe("sent");
    expect(db.jobs[0]?.outbound_message_sid).toBe("SMout1");
    expect(db.jobs[0]?.sent_at).toBeTruthy();
    expect(db.jobs[0]?.last_error).toBeNull();
    expect(threadMemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sentBody: "Yes. Early, every night.",
        source: "inbound_coach_reply",
      })
    );
  });

  it("16: sequential double Send is one Twilio", async () => {
    seedJob({ reply_body: "Yes." });
    const first = await sendManualPatCoachReply("SMpark1");
    const second = await sendManualPatCoachReply("SMpark1");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);
    expect(sendSMSChunked).toHaveBeenCalledTimes(1);
  });

  it("16: overlapping Send CAS is one Twilio", async () => {
    seedJob({ reply_body: "Yes." });
    const [a, b] = await Promise.all([
      sendManualPatCoachReply("SMpark1"),
      sendManualPatCoachReply("SMpark1"),
    ]);
    const oks = [a, b].filter((r) => r.ok);
    const fails = [a, b].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(fails).toHaveLength(1);
    if (!fails[0]?.ok) expect(fails[0].status).toBe(409);
    expect(sendSMSChunked).toHaveBeenCalledTimes(1);
  });

  it("16: Send while already sending is 409 and no Twilio", async () => {
    seedJob({ status: "sending", reply_body: "Yes." });
    const result = await sendManualPatCoachReply("SMpark1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(sendSMSChunked).not.toHaveBeenCalled();
  });

  it("19: sent row disappears from pending queue", async () => {
    seedJob({ reply_body: "Yes." });
    await sendManualPatCoachReply("SMpark1");
    const rows = await listManualPatAnswers();
    expect(rows).toEqual([]);
  });

  it("21: STOP / ineligible cancels and does not Twilio", async () => {
    seedJob({ reply_body: "Yes." });
    eligibilityMock.mockResolvedValue({
      ok: false,
      reason: "sms_stopped",
      lastErrorCode: "sms_not_eligible",
    });
    const result = await sendManualPatCoachReply("SMpark1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toBe(SMS_NO_LONGER_ELIGIBLE_ERROR);
    }
    expect(sendSMSChunked).not.toHaveBeenCalled();
    expect(db.jobs[0]?.status).toBe("cancelled");
    expect(db.jobs[0]?.reply_body).toBe("Yes.");
  });

  it("22: send failure returns job to awaiting with draft preserved", async () => {
    seedJob({ reply_body: "Keep this draft." });
    sendSMSChunked.mockRejectedValueOnce(new Error("twilio_timeout"));
    const result = await sendManualPatCoachReply("SMpark1");
    expect(result.ok).toBe(false);
    expect(db.jobs[0]?.status).toBe("awaiting_manual_pat_answer");
    expect(db.jobs[0]?.reply_body).toBe("Keep this draft.");
    expect(db.jobs[0]?.sent_at).toBeNull();
    expect(sendSMSChunked).toHaveBeenCalledTimes(1);
  });

  it("20: sent job has strong Coach delivery evidence; awaiting draft does not", () => {
    expect(
      coachJobReplyStrongDeliveryEvidence(
        {
          status: "sent",
          sent_at: "2026-08-30T12:00:00.000Z",
          outbound_message_sid: "SMout1",
        },
        "Yes. Early, every night."
      )
    ).toBe("outbound_message_sid_present");
  });
});
