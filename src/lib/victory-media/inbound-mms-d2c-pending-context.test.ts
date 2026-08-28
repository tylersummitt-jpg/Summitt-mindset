import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  EMPTY_INBOUND_MMS_D2C_PENDING_CONTEXT,
  INBOUND_MEDIA_D2C_PENDING_FETCH_CAP,
  buildInboundMmsD2cCandidateFact,
  inboundPendingMediaSourceFromD2c,
  isInboundMediaJobD2cPendingShape,
  isInboundMmsPendingClarificationContext,
  listInboundMmsD2cEligiblePendingJobs,
  loadInboundMmsD2cPendingContext,
  type InboundMmsD2cJobLite,
} from "@/lib/victory-media/inbound-mms-d2c-pending-context";
import type { InboundMmsD1WinLite } from "@/lib/victory-media/inbound-mms-d1-pending-context";

const NOW = new Date("2026-08-22T16:00:00.000Z");
const JOB_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const JOB_2 = "bbbbbbbb-2222-4222-8222-222222222222";
const WIN_A = "cccccccc-3333-4333-8333-333333333333";
const USER = "user_d2c";
const PHOTO_SID = "SMdddddddddddddddddddddddddddddddd";
const PHOTO_SID_B = "SMffffffffffffffffffffffffffffffff";
const BODY_SID = "SMeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const QUESTION = "What made this one a win for you?";
const KEY = `mms-d2-clarify:${JOB_ID}`;

function isoAgo(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

function job(partial: Partial<InboundMmsD2cJobLite> = {}): InboundMmsD2cJobLite {
  return {
    id: JOB_ID,
    message_sid: PHOTO_SID,
    created_at: isoAgo(40 * 60 * 1000),
    status: "pending_semantics",
    resolution: "pending_user",
    tombstoned_at: null,
    attached_win_id: null,
    semantic_target_win_id: null,
    temp_storage_path: null,
    normalized_storage_path: `mms-norm/${USER}/${JOB_ID}/master.jpg`,
    expires_at: "2026-08-25T12:00:00.000Z",
    clarification_body: QUESTION,
    followup_idempotency_key: KEY,
    ...partial,
  };
}

const shapeArgs = { now: NOW, currentMessageSid: BODY_SID };

describe("isInboundMediaJobD2cPendingShape", () => {
  it("accepts a sent pending_user clarification with a different SID", () => {
    expect(isInboundMediaJobD2cPendingShape(job(), shapeArgs)).toBe(true);
  });

  it("rejects D1 unresolved photos (resolution null)", () => {
    expect(
      isInboundMediaJobD2cPendingShape(job({ resolution: null }), shapeArgs)
    ).toBe(false);
  });

  it("rejects reserved-unsent key+body while resolution is still null", () => {
    expect(
      isInboundMediaJobD2cPendingShape(
        job({
          resolution: null,
          clarification_body: QUESTION,
          followup_idempotency_key: KEY,
        }),
        shapeArgs
      )
    ).toBe(false);
  });

  it("rejects missing sent body or idempotency key", () => {
    expect(
      isInboundMediaJobD2cPendingShape(job({ clarification_body: null }), shapeArgs)
    ).toBe(false);
    expect(
      isInboundMediaJobD2cPendingShape(job({ clarification_body: "  " }), shapeArgs)
    ).toBe(false);
    expect(
      isInboundMediaJobD2cPendingShape(
        job({ followup_idempotency_key: null }),
        shapeArgs
      )
    ).toBe(false);
  });

  it("rejects expired, attached, same SID, and 40m age is still eligible (no D1 window)", () => {
    expect(
      isInboundMediaJobD2cPendingShape(
        job({ expires_at: "2026-08-22T15:00:00.000Z" }),
        shapeArgs
      )
    ).toBe(false);
    expect(
      isInboundMediaJobD2cPendingShape(job({ attached_win_id: WIN_A }), shapeArgs)
    ).toBe(false);
    expect(
      isInboundMediaJobD2cPendingShape(job({ message_sid: BODY_SID }), shapeArgs)
    ).toBe(false);
    expect(
      isInboundMediaJobD2cPendingShape(
        job({ created_at: isoAgo(40 * 60 * 1000) }),
        shapeArgs
      )
    ).toBe(true);
  });
});

describe("isInboundMmsPendingClarificationContext", () => {
  it("requires awaiting_user plus the exact sent body", () => {
    expect(
      isInboundMmsPendingClarificationContext({
        candidate_count: 1,
        candidate: {
          job_id: JOB_ID,
          age_seconds: 2400,
          message_sid: PHOTO_SID,
          normalized_ready: true,
          awaiting_user: true,
          clarification_body: QUESTION,
        },
        recent_wins: [],
      })
    ).toBe(true);
    expect(
      isInboundMmsPendingClarificationContext({
        candidate_count: 1,
        candidate: {
          job_id: JOB_ID,
          age_seconds: 120,
          message_sid: PHOTO_SID,
          normalized_ready: true,
        },
        recent_wins: [],
      })
    ).toBe(false);
  });
});

describe("loadInboundMmsD2cPendingContext", () => {
  const win: InboundMmsD1WinLite = {
    id: WIN_A,
    occurred_at: "2026-08-22T11:56:00.000Z",
    display_title: "Lakelyn dance",
    display_body: "First dance class",
    relationship_type: "whole_life",
    commitment_id: null,
  };

  it("returns one awaiting_user candidate with the exact sent question", async () => {
    const ctx = await loadInboundMmsD2cPendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => false,
        listPendingJobs: async (args) => {
          expect(args.currentMessageSid).toBe(BODY_SID);
          expect(args.clerkUserId).toBe(USER);
          expect(args).not.toHaveProperty("createdAfterIso");
          return [job()];
        },
        listBodySids: async () => new Set(),
        listRecentWins: async () => [win],
        listWinIdsWithMedia: async () => new Set(),
      }
    );
    expect(ctx).not.toBe("error");
    if (ctx === "error") return;
    expect(ctx.candidate_count).toBe(1);
    expect(ctx.candidate).toEqual({
      job_id: JOB_ID,
      age_seconds: 2400,
      message_sid: PHOTO_SID,
      normalized_ready: true,
      awaiting_user: true,
      clarification_body: QUESTION,
    });
    expect(ctx.recent_wins[0]?.id).toBe(WIN_A);
    expect(JSON.stringify(ctx)).not.toMatch(/storage|signed|http|thumbnail|data:image/i);
    expect(JSON.stringify(ctx)).toContain(QUESTION);
  });

  it("uses stored display_title as concise recent-win label", async () => {
    const trophyWin: InboundMmsD1WinLite = {
      ...win,
      display_title: "Swam With the Kids",
      display_body:
        "Put his phone away while swimming and gave his kids his full attention.",
    };
    const ctx = await loadInboundMmsD2cPendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => false,
        listPendingJobs: async () => [job()],
        listBodySids: async () => new Set(),
        listRecentWins: async () => [trophyWin],
        listWinIdsWithMedia: async () => new Set(),
      }
    );
    expect(ctx).not.toBe("error");
    if (ctx === "error") return;
    expect(ctx.candidate_count).toBe(1);
    expect(ctx.recent_wins).toHaveLength(1);
    expect(ctx.recent_wins[0]?.id).toBe(WIN_A);
    expect(ctx.recent_wins[0]?.text).toBe("Swam With the Kids");
    expect(ctx.recent_wins[0]?.text).not.toContain("Put his phone away");
  });

  it("candidate_count 0 when no pending_user jobs", async () => {
    const ctx = await loadInboundMmsD2cPendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => false,
        listPendingJobs: async () => [],
        listBodySids: async () => new Set(),
      }
    );
    expect(ctx).toEqual(EMPTY_INBOUND_MMS_D2C_PENDING_CONTEXT);
  });

  it("candidate_count 2 with null candidate and no silent pick", async () => {
    const ctx = await loadInboundMmsD2cPendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => false,
        listPendingJobs: async () => [
          job(),
          job({
            id: JOB_2,
            message_sid: PHOTO_SID_B,
            followup_idempotency_key: `mms-d2-clarify:${JOB_2}`,
          }),
        ],
        listBodySids: async () => new Set(),
      }
    );
    expect(ctx).not.toBe("error");
    if (ctx === "error") return;
    expect(ctx.candidate_count).toBe(2);
    expect(ctx.candidate).toBeNull();
    expect(ctx.recent_wins).toEqual([]);
  });

  it("returns error on list failure so callers do not fall through to D1", async () => {
    const ctx = await loadInboundMmsD2cPendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => false,
        listPendingJobs: async () => "error",
      }
    );
    expect(ctx).toBe("error");
  });

  it("inboundPendingMediaSourceFromD2c prefers clarification, then D1, fail-closes on error", () => {
    expect(inboundPendingMediaSourceFromD2c("error")).toBe("error");
    expect(
      inboundPendingMediaSourceFromD2c({
        candidate_count: 1,
        candidate: {
          job_id: JOB_ID,
          age_seconds: 1,
          message_sid: PHOTO_SID,
          normalized_ready: true,
          awaiting_user: true,
          clarification_body: QUESTION,
        },
        recent_wins: [],
      })
    ).toBe("clarification");
    expect(
      inboundPendingMediaSourceFromD2c({
        candidate_count: 2,
        candidate: null,
        recent_wins: [],
      })
    ).toBe("clarification");
    expect(
      inboundPendingMediaSourceFromD2c({
        candidate_count: 0,
        candidate: null,
        recent_wins: [],
      })
    ).toBe("d1");
  });

  it("empty on unresolved deletion", async () => {
    const ctx = await loadInboundMmsD2cPendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      { hasUnresolvedDeletion: async () => true }
    );
    expect(ctx).toEqual(EMPTY_INBOUND_MMS_D2C_PENDING_CONTEXT);
  });

  it("deletion-guard throw is lookup failure, not zero candidates", async () => {
    const ctx = await loadInboundMmsD2cPendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => {
          throw new Error("deletion_lookup_failed");
        },
        listPendingJobs: async () => [job()],
      }
    );
    expect(ctx).toBe("error");
    expect(inboundPendingMediaSourceFromD2c(ctx)).toBe("error");
    expect(inboundPendingMediaSourceFromD2c(ctx)).not.toBe("d1");
  });

  it("listPendingJobs throw is lookup failure, not zero candidates", async () => {
    const ctx = await loadInboundMmsD2cPendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => false,
        listPendingJobs: async () => {
          throw new Error("db");
        },
      }
    );
    expect(ctx).toBe("error");
  });
});

describe("listInboundMmsD2cEligiblePendingJobs", () => {
  it("does not include a D1 resolution-null sibling", async () => {
    const listed = await listInboundMmsD2cEligiblePendingJobs(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => false,
        listPendingJobs: async () => [job({ resolution: null, clarification_body: null })],
        listBodySids: async () => new Set(),
      }
    );
    expect(listed).toEqual([]);
  });

  it("deletion-guard throw returns error, not an empty list", async () => {
    const listed = await listInboundMmsD2cEligiblePendingJobs(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => {
          throw new Error("deletion_lookup_failed");
        },
        listPendingJobs: async () => [job()],
      }
    );
    expect(listed).toBe("error");
  });
});

describe("buildInboundMmsD2cCandidateFact", () => {
  it("marks awaiting_user and copies the sent body", () => {
    expect(buildInboundMmsD2cCandidateFact(job(), NOW).clarification_body).toBe(
      QUESTION
    );
    expect(buildInboundMmsD2cCandidateFact(job(), NOW).awaiting_user).toBe(true);
  });
});

describe("D2c SQL wire (source)", () => {
  it("filters pending_user and does not apply a 30-minute lookback", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/victory-media/inbound-mms-d2c-pending-context.ts"),
      "utf8"
    );
    expect(src).toContain('.eq("resolution", "pending_user")');
    expect(src).toContain(".not(\"clarification_body\", \"is\", null)");
    expect(src).not.toContain("INBOUND_MEDIA_D1_PENDING_LOOKBACK_MS");
    expect(src).not.toContain("createdAfterIso");
    expect(INBOUND_MEDIA_D2C_PENDING_FETCH_CAP).toBe(2);
  });
});
