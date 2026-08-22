import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  EMPTY_INBOUND_MMS_D1_PENDING_CONTEXT,
  INBOUND_MEDIA_D1_PENDING_FETCH_CAP,
  INBOUND_MEDIA_D1_PENDING_LOOKBACK_MS,
  INBOUND_MEDIA_D1_RECENT_WINS_CAP,
  buildInboundMmsD1CandidateFact,
  isInboundMediaJobD1PendingShape,
  listInboundMmsD1EligiblePendingJobs,
  loadInboundMmsD1PendingContext,
  type InboundMmsD1JobLite,
  type InboundMmsD1WinLite,
} from "@/lib/victory-media/inbound-mms-d1-pending-context";

const NOW = new Date("2026-08-21T12:00:00.000Z");
const JOB_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const JOB_2 = "bbbbbbbb-2222-4222-8222-222222222222";
const FRESH_PROD_JOB = "2cf694ea-ba64-4323-a56f-bdb9a4075136";
const OLD_PROD_JOB = "dba40005-52c2-43bd-a4c1-edadc3ebff7e";
const WIN_A = "cccccccc-3333-4333-8333-333333333333";
const USER = "user_d1";
const PHOTO_SID = "SMdddddddddddddddddddddddddddddddd";
const PHOTO_SID_B = "SMffffffffffffffffffffffffffffffff";
const BODY_SID = "SMeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const MIN_MS = 60 * 1000;

function isoAgo(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

function job(partial: Partial<InboundMmsD1JobLite> = {}): InboundMmsD1JobLite {
  return {
    id: JOB_ID,
    message_sid: PHOTO_SID,
    created_at: isoAgo(10 * MIN_MS),
    status: "pending_semantics",
    resolution: null,
    tombstoned_at: null,
    attached_win_id: null,
    semantic_target_win_id: null,
    temp_storage_path: null,
    normalized_storage_path: `mms-norm/${USER}/${JOB_ID}/master.jpg`,
    expires_at: "2026-08-24T12:00:00.000Z",
    ...partial,
  };
}

const shapeArgs = {
  now: NOW,
  currentMessageSid: BODY_SID,
  createdAfterMs: NOW.getTime() - INBOUND_MEDIA_D1_PENDING_LOOKBACK_MS,
};

describe("isInboundMediaJobD1PendingShape", () => {
  it("accepts a pending image-only shape with different SID", () => {
    expect(isInboundMediaJobD1PendingShape(job(), shapeArgs)).toBe(true);
  });

  it("rejects same-message SID as current Body", () => {
    expect(
      isInboundMediaJobD1PendingShape(job({ message_sid: BODY_SID }), shapeArgs)
    ).toBe(false);
  });

  it("rejects expired, tombstoned, attached, semantic-targeted, and Body leftovers by shape", () => {
    expect(
      isInboundMediaJobD1PendingShape(
        job({ expires_at: "2026-08-21T11:00:00.000Z" }),
        shapeArgs
      )
    ).toBe(false);
    expect(
      isInboundMediaJobD1PendingShape(
        job({ tombstoned_at: NOW.toISOString() }),
        shapeArgs
      )
    ).toBe(false);
    expect(
      isInboundMediaJobD1PendingShape(job({ attached_win_id: WIN_A }), shapeArgs)
    ).toBe(false);
    expect(
      isInboundMediaJobD1PendingShape(
        job({ semantic_target_win_id: WIN_A }),
        shapeArgs
      )
    ).toBe(false);
    expect(
      isInboundMediaJobD1PendingShape(job({ resolution: "attached" }), shapeArgs)
    ).toBe(false);
    expect(
      isInboundMediaJobD1PendingShape(
        job({ created_at: "2026-08-19T11:00:00.000Z" }),
        shapeArgs
      )
    ).toBe(false);
    expect(
      isInboundMediaJobD1PendingShape(
        job({ normalized_storage_path: null }),
        shapeArgs
      )
    ).toBe(false);
    expect(
      isInboundMediaJobD1PendingShape(job({ status: "awaiting_attach" }), shapeArgs)
    ).toBe(false);
  });

  it("29-minute photo is inside the D1 conversational window", () => {
    expect(
      isInboundMediaJobD1PendingShape(
        job({ created_at: isoAgo(29 * MIN_MS) }),
        shapeArgs
      )
    ).toBe(true);
  });

  it("31-minute photo is outside the D1 conversational window", () => {
    expect(
      isInboundMediaJobD1PendingShape(
        job({ created_at: isoAgo(31 * MIN_MS) }),
        shapeArgs
      )
    ).toBe(false);
  });
});

describe("loadInboundMmsD1PendingContext", () => {
  const win: InboundMmsD1WinLite = {
    id: WIN_A,
    occurred_at: "2026-08-20T12:00:00.000Z",
    display_title: "Kids hiking",
    display_body: "Took the kids hiking",
    relationship_type: "whole_life",
    commitment_id: null,
  };

  it("returns one candidate plus recent wins when exactly one image-only job", async () => {
    const listedJobs: InboundMmsD1JobLite[] = [];
    const ctx = await loadInboundMmsD1PendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => false,
        listPendingJobs: async (args) => {
          listedJobs.push(job());
          expect(args.currentMessageSid).toBe(BODY_SID);
          expect(args.clerkUserId).toBe(USER);
          expect(args.createdAfterIso).toBe(isoAgo(INBOUND_MEDIA_D1_PENDING_LOOKBACK_MS));
          return [job()];
        },
        listBodySids: async () => new Set(),
        listRecentWins: async () => [win],
        listWinIdsWithMedia: async () => new Set(),
      }
    );
    expect(ctx.candidate_count).toBe(1);
    expect(ctx.candidate).toEqual({
      job_id: JOB_ID,
      age_seconds: 600,
      message_sid: PHOTO_SID,
      normalized_ready: true,
    });
    expect(ctx.recent_wins).toEqual([
      {
        id: WIN_A,
        text: "Kids hiking",
        occurred_at: "2026-08-20T12:00:00.000Z",
        relationship_type: "whole_life",
        commitment_id: null,
        has_media: false,
      },
    ]);
    expect(JSON.stringify(ctx)).not.toMatch(/storage|signed|http|thumbnail|data:image/i);
    expect(listedJobs).toHaveLength(1);
  });

  it("sets has_media true when a Win already has media", async () => {
    const ctx = await loadInboundMmsD1PendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => false,
        listPendingJobs: async () => [job()],
        listBodySids: async () => new Set(),
        listRecentWins: async () => [win],
        listWinIdsWithMedia: async () => new Set([WIN_A]),
      }
    );
    expect(ctx.recent_wins[0]?.has_media).toBe(true);
  });

  it("candidate_count 0 when no jobs", async () => {
    const ctx = await loadInboundMmsD1PendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => false,
        listPendingJobs: async () => [],
        listBodySids: async () => new Set(),
        listRecentWins: async () => [win],
      }
    );
    expect(ctx).toEqual(EMPTY_INBOUND_MMS_D1_PENDING_CONTEXT);
  });

  it("candidate_count 2 with null candidate and no silent pick", async () => {
    const ctx = await loadInboundMmsD1PendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => false,
        listPendingJobs: async () => [
          job(),
          job({ id: JOB_2, message_sid: "SMffffffffffffffffffffffffffffffff" }),
        ],
        listBodySids: async () => new Set(),
        listRecentWins: async () => [win],
      }
    );
    expect(ctx.candidate_count).toBe(2);
    expect(ctx.candidate).toBeNull();
    expect(ctx.recent_wins).toEqual([]);
  });

  it("ignores a pending job that has a Body row", async () => {
    const ctx = await loadInboundMmsD1PendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => false,
        listPendingJobs: async () => [job()],
        listBodySids: async () => new Set([PHOTO_SID]),
        listRecentWins: async () => [win],
      }
    );
    expect(ctx).toEqual(EMPTY_INBOUND_MMS_D1_PENDING_CONTEXT);
  });

  it("ignores same-message SID even if listed", async () => {
    const ctx = await loadInboundMmsD1PendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => false,
        listPendingJobs: async () => [job({ message_sid: BODY_SID })],
        listBodySids: async () => new Set(),
      }
    );
    expect(ctx.candidate_count).toBe(0);
  });

  it("fails closed on unresolved deletion", async () => {
    const listPendingJobs = vi.fn(async () => [job()]);
    const ctx = await loadInboundMmsD1PendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => true,
        listPendingJobs,
      }
    );
    expect(ctx).toEqual(EMPTY_INBOUND_MMS_D1_PENDING_CONTEXT);
    expect(listPendingJobs).not.toHaveBeenCalled();
  });

  it("fails closed on deletion lookup throw", async () => {
    const ctx = await loadInboundMmsD1PendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => {
          throw new Error("db");
        },
        listPendingJobs: async () => [job()],
      }
    );
    expect(ctx).toEqual(EMPTY_INBOUND_MMS_D1_PENDING_CONTEXT);
  });

  it("fetch cap is 2 and recent wins cap is 7", () => {
    expect(INBOUND_MEDIA_D1_PENDING_FETCH_CAP).toBe(2);
    expect(INBOUND_MEDIA_D1_RECENT_WINS_CAP).toBe(7);
    expect(INBOUND_MEDIA_D1_PENDING_LOOKBACK_MS).toBe(30 * 60 * 1000);
  });

  it("candidate fact never includes storage paths", () => {
    const fact = buildInboundMmsD1CandidateFact(job(), NOW);
    expect(fact).not.toHaveProperty("normalized_storage_path");
    expect(JSON.stringify(fact)).not.toContain("mms-norm");
  });

  it("fails closed on pending-job lookup error", async () => {
    const ctx = await loadInboundMmsD1PendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => false,
        listPendingJobs: async () => "error",
      }
    );
    expect(ctx).toEqual(EMPTY_INBOUND_MMS_D1_PENDING_CONTEXT);
  });
});

describe("listInboundMmsD1EligiblePendingJobs", () => {
  it("returns the same image-only eligibility set the loader uses", async () => {
    const listed = await listInboundMmsD1EligiblePendingJobs(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => false,
        listPendingJobs: async () => [
          job(),
          job({ id: JOB_2, message_sid: BODY_SID }),
        ],
        listBodySids: async () => new Set(),
      }
    );
    expect(listed).not.toBe("error");
    if (listed === "error") return;
    expect(listed.map((j) => j.id)).toEqual([JOB_ID]);
  });

  it("excludes a Body+photo leftover via sms_inbound_messages proof", async () => {
    const listed = await listInboundMmsD1EligiblePendingJobs(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      {
        hasUnresolvedDeletion: async () => false,
        listPendingJobs: async () => [job()],
        listBodySids: async () => new Set([PHOTO_SID]),
      }
    );
    expect(listed).toEqual([]);
  });

  it("returns error on lookup failure", async () => {
    await expect(
      listInboundMmsD1EligiblePendingJobs(
        { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
        {
          hasUnresolvedDeletion: async () => false,
          listPendingJobs: async () => "error",
        }
      )
    ).resolves.toBe("error");
    await     expect(
      listInboundMmsD1EligiblePendingJobs(
        { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
        {
          hasUnresolvedDeletion: async () => false,
          listPendingJobs: async () => [job()],
          listBodySids: async () => "error",
        }
      )
    ).resolves.toBe("error");
  });
});

const windowDeps = (jobs: InboundMmsD1JobLite[]) => ({
  hasUnresolvedDeletion: async () => false,
  listPendingJobs: async () => jobs,
  listBodySids: async () => new Set<string>(),
  listRecentWins: async () => [] as InboundMmsD1WinLite[],
});

describe("D1 30-minute conversational candidate window", () => {
  it("production repro: 17m fresh + 10h old yields only the fresh photo", async () => {
    const fresh = job({
      id: FRESH_PROD_JOB,
      message_sid: "MM2cf694eaba644323a56fbdb9a4075136",
      created_at: isoAgo(17 * MIN_MS),
    });
    const old = job({
      id: OLD_PROD_JOB,
      message_sid: "MMdba4000552c243bda4c1edadc3ebff7e",
      created_at: isoAgo(10 * 60 * MIN_MS),
    });
    const listed = await listInboundMmsD1EligiblePendingJobs(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      windowDeps([old, fresh])
    );
    expect(listed).not.toBe("error");
    if (listed === "error") return;
    expect(listed.map((j) => j.id)).toEqual([FRESH_PROD_JOB]);

    const ctx = await loadInboundMmsD1PendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      windowDeps([old, fresh])
    );
    expect(ctx.candidate_count).toBe(1);
    expect(ctx.candidate?.job_id).toBe(FRESH_PROD_JOB);
    expect(ctx.candidate?.age_seconds).toBe(17 * 60);
  });

  it("29-minute photo remains a D1 candidate", async () => {
    const ctx = await loadInboundMmsD1PendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      windowDeps([job({ created_at: isoAgo(29 * MIN_MS) })])
    );
    expect(ctx.candidate_count).toBe(1);
    expect(ctx.candidate?.job_id).toBe(JOB_ID);
    expect(ctx.candidate?.age_seconds).toBe(29 * 60);
  });

  it("31-minute photo is not a D1 candidate and is not mutated", async () => {
    const aged = job({ created_at: isoAgo(31 * MIN_MS) });
    const snapshot = structuredClone(aged);
    const listed = await listInboundMmsD1EligiblePendingJobs(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      windowDeps([aged])
    );
    expect(listed).toEqual([]);
    const ctx = await loadInboundMmsD1PendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      windowDeps([aged])
    );
    expect(ctx).toEqual(EMPTY_INBOUND_MMS_D1_PENDING_CONTEXT);
    expect(aged).toEqual(snapshot);
    expect(aged.status).toBe("pending_semantics");
    expect(aged.tombstoned_at).toBeNull();
    expect(aged.expires_at).toBe(snapshot.expires_at);
    expect(aged.resolution).toBeNull();
  });

  it("two fresh photos inside 30 minutes fail closed", async () => {
    const ctx = await loadInboundMmsD1PendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      windowDeps([
        job({ created_at: isoAgo(10 * MIN_MS) }),
        job({
          id: JOB_2,
          message_sid: PHOTO_SID_B,
          created_at: isoAgo(17 * MIN_MS),
        }),
      ])
    );
    expect(ctx.candidate_count).toBe(2);
    expect(ctx.candidate).toBeNull();
    expect(ctx.recent_wins).toEqual([]);
  });

  it("fresh 10m + old 2h yields only the fresh photo", async () => {
    const ctx = await loadInboundMmsD1PendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      windowDeps([
        job({
          id: JOB_2,
          message_sid: PHOTO_SID_B,
          created_at: isoAgo(2 * 60 * MIN_MS),
        }),
        job({ created_at: isoAgo(10 * MIN_MS) }),
      ])
    );
    expect(ctx.candidate_count).toBe(1);
    expect(ctx.candidate?.job_id).toBe(JOB_ID);
    expect(ctx.candidate?.age_seconds).toBe(10 * 60);
  });

  it("old-only 2h photo is not a D1 candidate and is not mutated", async () => {
    const old = job({ created_at: isoAgo(2 * 60 * MIN_MS) });
    const snapshot = structuredClone(old);
    const ctx = await loadInboundMmsD1PendingContext(
      { clerkUserId: USER, currentMessageSid: BODY_SID, now: NOW },
      windowDeps([old])
    );
    expect(ctx.candidate_count).toBe(0);
    expect(ctx).toEqual(EMPTY_INBOUND_MMS_D1_PENDING_CONTEXT);
    expect(old).toEqual(snapshot);
    expect(old.status).toBe("pending_semantics");
    expect(old.tombstoned_at).toBeNull();
  });
});

describe("D1 vs D2a last_error_code compatibility", () => {
  it("D1 SQL and shape ignore last_error_code so semantic_grace remains eligible", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/victory-media/inbound-mms-d1-pending-context.ts"),
      "utf8"
    );
    const list = src.slice(src.indexOf("async function defaultListPendingJobs"));
    expect(list).not.toContain('.eq("last_error_code"');
    expect(list).not.toContain('.in("last_error_code"');
    expect(list).not.toContain('.neq("last_error_code"');
    expect(isInboundMediaJobD1PendingShape(job(), shapeArgs)).toBe(true);
  });
});

