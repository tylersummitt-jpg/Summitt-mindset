import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

vi.mock("next/server", () => ({
  after: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}));

vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  hasUnresolvedAccountDeletionRequest: vi.fn(async () => false),
}));

import { supabaseServer } from "@/lib/supabase-server";
import {
  evaluateAndAttachInboundMmsC2Job,
  isInboundMediaJobC2DueListCandidate,
  isInboundMediaJobSemanticTargetOwned,
  listInboundMediaJobsForC2,
  type AttachInboundMmsC2Deps,
} from "@/lib/victory-media/attach-inbound-mms-c2";
import type { InboundMediaJobRow } from "@/lib/victory-media/claim-inbound-media-job";
import {
  INBOUND_MEDIA_C2_OWNED_LAST_ERROR_CODES,
  type InboundMmsC1Decision,
  type InboundMmsC1MediaLite,
  type InboundMmsC1SiblingLite,
  type InboundMmsC1WinLite,
} from "@/lib/victory-media/correlate-inbound-mms-c1";
import type { FinalizeVictoryWinMediaInput } from "@/lib/victory-media/finalize-victory-win-media";
import {
  victoryMediaCardPath,
  victoryMediaMasterPath,
  victoryMediaMmsNormCardPath,
  victoryMediaMmsNormMasterPath,
} from "@/lib/victory-media/storage-paths";

const NOW = new Date("2026-08-20T12:00:00.000Z");
const JOB_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const JOB_2 = "bbbbbbbb-2222-4222-8222-222222222222";
const WIN_A = "cccccccc-3333-4333-8333-333333333333";
const WIN_B = "dddddddd-4444-4444-8444-444444444444";
const USER = "user_c2";
const SID = "SMcccccccccccccccccccccccccccccccc";
const PHOTO_SID = "SMeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const NORM = victoryMediaMmsNormMasterPath(USER, JOB_ID);

function job(partial: Partial<InboundMediaJobRow> = {}): InboundMediaJobRow {
  return {
    id: JOB_ID,
    message_sid: SID,
    media_ordinal: 0,
    clerk_user_id: USER,
    twilio_media_sid: "MEcccccccccccccccccccccccccccccccc",
    declared_content_type: "image/jpeg",
    status: "awaiting_attach",
    attempt_count: 2,
    next_retry_at: "2026-08-20T11:00:00.000Z",
    last_error_code: "attach_eligible",
    temp_storage_path: null,
    normalized_storage_path: NORM,
    attached_win_id: null,
    semantic_target_win_id: null,
    resolution: null,
    classifier_target: null,
    followup_idempotency_key: null,
    expires_at: "2026-08-23T12:00:00.000Z",
    tombstoned_at: null,
    created_at: "2026-08-19T00:00:00.000Z",
    updated_at: "2026-08-20T11:00:00.000Z",
    ...partial,
  };
}

function winLite(partial: Partial<InboundMmsC1WinLite> = {}): InboundMmsC1WinLite {
  return {
    id: WIN_A,
    clerk_user_id: USER,
    source_message_sid: SID,
    source_type: "sms_inbound",
    status: "active",
    hidden_at: null,
    ...partial,
  };
}

function sibling(partial: Partial<InboundMmsC1SiblingLite> = {}): InboundMmsC1SiblingLite {
  return {
    id: JOB_ID,
    status: "awaiting_attach",
    temp_storage_path: null,
    normalized_storage_path: NORM,
    resolution: null,
    attached_win_id: null,
    tombstoned_at: null,
    expires_at: "2026-08-23T12:00:00.000Z",
    ...partial,
  };
}

function mmsMedia(partial: Partial<InboundMmsC1MediaLite> = {}): InboundMmsC1MediaLite {
  return {
    id: JOB_ID,
    win_id: WIN_A,
    clerk_user_id: USER,
    source_type: "inbound_mms",
    source_message_sid: SID,
    source_media_ordinal: 0,
    ...partial,
  };
}

async function jpegBytes(width = 32, height = 24): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 180, g: 40, b: 40 },
    },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}

function facts(args?: {
  wins?: InboundMmsC1WinLite[];
  siblings?: InboundMmsC1SiblingLite[];
  provenanceMedia?: InboundMmsC1MediaLite | null;
  media?: InboundMmsC1MediaLite | null;
}) {
  const wins = args?.wins ?? [winLite()];
  const mediaByWinId = new Map<string, InboundMmsC1MediaLite | null>();
  if (wins.length === 1) {
    mediaByWinId.set(wins[0]!.id, args?.media ?? null);
  }
  return {
    wins,
    siblings: args?.siblings ?? [sibling()],
    provenanceMedia: args?.provenanceMedia ?? null,
    mediaByWinId,
  };
}

function applied(decision: InboundMmsC1Decision): InboundMmsC1Decision {
  return decision;
}

function baseDeps(overrides: Partial<AttachInboundMmsC2Deps> = {}): AttachInboundMmsC2Deps {
  return {
    now: NOW,
    hasUnresolvedDeletion: async () => false,
    loadFacts: async () => facts(),
    applyDecision: async ({ decision }) => applied(decision),
    confirmTerminal: async (_job, decision) => decision,
    casJob: async () => true,
    downloadObject: async () => Buffer.from("not-jpeg"),
    removeObjects: async () => {},
    readJpegMetadata: async () => ({ width: 32, height: 24 }),
    finalize: async () => ({
      ok: true,
      status: "attached",
      media: {
        id: JOB_ID,
        winId: WIN_A,
        clerkUserId: USER,
        sourceType: "inbound_mms",
        storageMasterPath: victoryMediaMasterPath(USER, JOB_ID),
        storageCardPath: victoryMediaCardPath(USER, JOB_ID),
        mimeType: "image/jpeg",
        byteSize: 10,
        width: 32,
        height: 24,
        cardByteSize: 8,
        cardWidth: 16,
        cardHeight: 12,
        userSelectedAt: null,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
    }),
    ...overrides,
  };
}

describe("isInboundMediaJobC2DueListCandidate", () => {
  it("picks due attach_eligible awaiting_attach", () => {
    expect(isInboundMediaJobC2DueListCandidate(job(), NOW)).toBe(true);
  });

  it("does not pick not-yet-due attach_eligible", () => {
    expect(
      isInboundMediaJobC2DueListCandidate(
        job({ next_retry_at: "2026-08-20T12:01:00.000Z" }),
        NOW
      )
    ).toBe(false);
  });

  it("ignores pending_semantics", () => {
    expect(
      isInboundMediaJobC2DueListCandidate(
        job({ status: "pending_semantics", last_error_code: "attach_eligible" }),
        NOW
      )
    ).toBe(false);
  });

  it("ignores waiting_for_win last_error_code", () => {
    expect(
      isInboundMediaJobC2DueListCandidate(job({ last_error_code: "waiting_for_win" }), NOW)
    ).toBe(false);
  });

  it("picks C2 retry codes", () => {
    expect(
      isInboundMediaJobC2DueListCandidate(
        job({ last_error_code: "c2_finalize_failed" }),
        NOW
      )
    ).toBe(true);
  });

  it("picks semantic_target awaiting_attach", () => {
    expect(
      isInboundMediaJobC2DueListCandidate(
        job({
          last_error_code: "semantic_target",
          semantic_target_win_id: WIN_A,
        }),
        NOW
      )
    ).toBe(true);
  });

  it("picks semantic-specific retry codes including target missing", () => {
    expect(
      isInboundMediaJobC2DueListCandidate(
        job({
          last_error_code: "c2_semantic_target_missing",
          semantic_target_win_id: null,
        }),
        NOW
      )
    ).toBe(true);
    expect(
      isInboundMediaJobC2DueListCandidate(
        job({
          last_error_code: "c2_semantic_stale_ownership",
          semantic_target_win_id: WIN_A,
        }),
        NOW
      )
    ).toBe(true);
  });

  it("does not pick pending_semantics even with semantic_target code", () => {
    expect(
      isInboundMediaJobC2DueListCandidate(
        job({
          status: "pending_semantics",
          last_error_code: "semantic_target",
          semantic_target_win_id: WIN_A,
        }),
        NOW
      )
    ).toBe(false);
  });
});

describe("listInboundMediaJobsForC2", () => {
  function mockC2List(rows: Array<Record<string, unknown>>) {
    const captured: { inCol?: string; inVals?: unknown; limit?: number } = {};
    const api = {
      select: () => api,
      eq: () => api,
      is: () => api,
      not: () => api,
      lte: () => api,
      order: () => api,
      in: (col: string, vals: unknown) => {
        captured.inCol = col;
        captured.inVals = vals;
        return api;
      },
      limit: (n: number) => {
        captured.limit = n;
        return api;
      },
      then(resolve: (v: { data: unknown; error: unknown }) => void) {
        const codes = Array.isArray(captured.inVals) ? captured.inVals : [];
        let match = rows.filter((r) => codes.includes(r.last_error_code));
        if (captured.limit != null) match = match.slice(0, captured.limit);
        resolve({ data: match, error: null });
      },
    };
    vi.mocked(supabaseServer.from).mockReturnValue(
      api as unknown as ReturnType<typeof supabaseServer.from>
    );
    return captured;
  }

  it("SQL-filters to attach_eligible/c2_* and limits to 1 without over-fetch", async () => {
    const waiting = {
      ...job({ id: JOB_2, last_error_code: "waiting_for_win" }),
    };
    const eligible = { ...job() };
    const captured = mockC2List([waiting, eligible]);
    const ids = await listInboundMediaJobsForC2(1, { now: NOW });
    expect(captured.inCol).toBe("last_error_code");
    expect(captured.inVals).toEqual([...INBOUND_MEDIA_C2_OWNED_LAST_ERROR_CODES]);
    expect(captured.limit).toBe(1);
    expect(ids).toEqual([JOB_ID]);
    expect(ids).not.toContain(JOB_2);
  });

  it("C1-owned waiting_for_win rows cannot hide a later attach_eligible row at limit 1", async () => {
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 10; i++) {
      rows.push({
        ...job({
          id: `bbbbbbbb-2222-4222-8222-${String(i).padStart(12, "0")}`,
          last_error_code: "waiting_for_win",
        }),
      });
    }
    rows.push({ ...job() });
    mockC2List(rows);
    const ids = await listInboundMediaJobsForC2(1, { now: NOW });
    expect(ids).toEqual([JOB_ID]);
  });

  it("SQL-includes semantic_target jobs", async () => {
    const captured = mockC2List([
      { ...job({ last_error_code: "waiting_for_win" }) },
      {
        ...job({
          last_error_code: "semantic_target",
          semantic_target_win_id: WIN_A,
        }),
      },
    ]);
    const ids = await listInboundMediaJobsForC2(1, { now: NOW });
    expect(captured.inVals).toEqual(
      expect.arrayContaining(["semantic_target", "attach_eligible"])
    );
    expect(ids).toEqual([JOB_ID]);
  });
});

describe("evaluateAndAttachInboundMmsC2Job", () => {
  it("happy path: media id = job.id, provenance, user_selected false, no inboundJobId", async () => {
    const master = await jpegBytes(40, 30);
    const card = await jpegBytes(20, 15);
    const finalize = vi.fn(async (input: FinalizeVictoryWinMediaInput) => {
      expect(input.mediaId).toBe(JOB_ID);
      expect(input.winId).toBe(WIN_A);
      expect(input.sourceType).toBe("inbound_mms");
      expect(input.sourceMessageSid).toBe(SID);
      expect(input.sourceMediaOrdinal).toBe(0);
      expect(input.twilioMediaSid).toBe("MEcccccccccccccccccccccccccccccccc");
      expect(input.userSelected).toBe(false);
      expect(input.inboundJobId).toBeUndefined();
      expect(input.master.byteSize).toBe(master.length);
      expect(input.card.byteSize).toBe(card.length);
      return {
        ok: true as const,
        status: "attached" as const,
        media: {
          id: JOB_ID,
          winId: WIN_A,
          clerkUserId: USER,
          sourceType: "inbound_mms" as const,
          storageMasterPath: victoryMediaMasterPath(USER, JOB_ID),
          storageCardPath: victoryMediaCardPath(USER, JOB_ID),
          mimeType: "image/jpeg" as const,
          byteSize: master.length,
          width: 40,
          height: 30,
          cardByteSize: card.length,
          cardWidth: 20,
          cardHeight: 15,
          userSelectedAt: null,
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        },
      };
    });
    const casJob = vi.fn(async () => true);
    const removeObjects = vi.fn(async () => {});
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        downloadObject: async ({ path }) => {
          if (path === victoryMediaMmsNormMasterPath(USER, JOB_ID)) return master;
          if (path === victoryMediaMmsNormCardPath(USER, JOB_ID)) return card;
          throw new Error("unexpected path");
        },
        readJpegMetadata: async (bytes) => {
          const meta = await sharp(bytes).metadata();
          return { width: meta.width ?? 0, height: meta.height ?? 0 };
        },
        finalize,
        casJob,
        removeObjects,
      })
    );
    expect(r).toEqual({
      ok: true,
      status: "attached",
      jobId: JOB_ID,
      winId: WIN_A,
    });
    expect(casJob).toHaveBeenCalledOnce();
    expect(removeObjects).toHaveBeenCalledWith({
      bucket: "victory-media",
      paths: [
        victoryMediaMmsNormMasterPath(USER, JOB_ID),
        victoryMediaMmsNormCardPath(USER, JOB_ID),
      ],
    });
  });

  it("zero Wins → wait, no finalize", async () => {
    const finalize = vi.fn();
    const applyDecision = vi.fn(async ({ decision }: { decision: InboundMmsC1Decision }) =>
      applied(decision)
    );
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        loadFacts: async () => facts({ wins: [] }),
        finalize,
        applyDecision,
      })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("waiting_for_win");
    expect(finalize).not.toHaveBeenCalled();
    expect(applyDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({ kind: "waiting_for_win" }),
      })
    );
  });

  it("two Wins → ambiguous_wins terminal + norm cleanup", async () => {
    const removeObjects = vi.fn(async () => {});
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        loadFacts: async () =>
          facts({
            wins: [winLite(), winLite({ id: WIN_B })],
          }),
        removeObjects,
      })
    );
    expect(r).toMatchObject({ ok: false, reason: "ambiguous_wins", terminal: true });
    expect(removeObjects).toHaveBeenCalled();
  });

  it("hidden Win before start → wait", async () => {
    const finalize = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        loadFacts: async () =>
          facts({
            wins: [
              winLite({ status: "hidden", hidden_at: NOW.toISOString() }),
            ],
          }),
        finalize,
      })
    );
    expect(r).toMatchObject({ ok: false, reason: "waiting_for_win" });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("hidden Win before insert → wait, no job attached", async () => {
    const casJob = vi.fn(async () => true);
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        downloadObject: async () => jpegBytes(8, 8),
        finalize: async () => ({ ok: false, code: "win_not_attachable" }),
        casJob,
      })
    );
    expect(r).toMatchObject({ ok: false, reason: "waiting_for_win", terminal: false });
    expect(casJob).not.toHaveBeenCalled();
  });

  it("multi-image history blocks with no ordinal winner", async () => {
    const finalize = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        loadFacts: async () =>
          facts({
            siblings: [
              sibling(),
              sibling({
                id: JOB_2,
                status: "expired",
                resolution: "expired",
              }),
            ],
          }),
        finalize,
      })
    );
    expect(r).toMatchObject({ ok: false, reason: "ambiguous_media", terminal: true });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("web priority before start → user_priority_blocked", async () => {
    const finalize = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        loadFacts: async () =>
          facts({
            media: {
              id: "eeeeeeee-5555-4555-8555-555555555555",
              win_id: WIN_A,
              clerk_user_id: USER,
              source_type: "web_upload",
              source_message_sid: null,
              source_media_ordinal: null,
            },
          }),
        finalize,
      })
    );
    expect(r).toMatchObject({
      ok: false,
      reason: "web_priority_blocked",
      terminal: true,
    });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("web race before insert classifies user_priority_blocked", async () => {
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        downloadObject: async () => jpegBytes(8, 8),
        finalize: async () => ({ ok: false, code: "media_exists" }),
        loadFacts: vi
          .fn()
          .mockResolvedValueOnce(facts())
          .mockResolvedValueOnce(
            facts({
              media: {
                id: "eeeeeeee-5555-4555-8555-555555555555",
                win_id: WIN_A,
                clerk_user_id: USER,
                source_type: "web_upload",
                source_message_sid: null,
                source_media_ordinal: null,
              },
            })
          ),
      })
    );
    expect(r).toMatchObject({
      ok: false,
      reason: "web_priority_blocked",
      terminal: true,
    });
  });

  it("other MMS before start", async () => {
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        loadFacts: async () =>
          facts({
            media: mmsMedia({
              id: "eeeeeeee-5555-4555-8555-555555555555",
              source_message_sid: "SMother",
            }),
          }),
      })
    );
    expect(r).toMatchObject({
      ok: false,
      reason: "other_mms_occupied",
      terminal: true,
    });
  });

  it("other MMS race after insert conflict", async () => {
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        downloadObject: async () => jpegBytes(8, 8),
        finalize: async () => ({ ok: false, code: "media_exists" }),
        loadFacts: vi
          .fn()
          .mockResolvedValueOnce(facts())
          .mockResolvedValueOnce(
            facts({
              media: mmsMedia({
                id: "eeeeeeee-5555-4555-8555-555555555555",
                source_message_sid: "SMother",
              }),
            })
          ),
      })
    );
    expect(r).toMatchObject({ ok: false, reason: "other_mms_occupied", terminal: true });
  });

  it("same-MMS replay skips Storage and CASes job", async () => {
    const downloadObject = vi.fn();
    const finalize = vi.fn();
    const casJob = vi.fn(async () => true);
    const removeObjects = vi.fn(async () => {});
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        loadFacts: async () => facts({ provenanceMedia: mmsMedia() }),
        downloadObject,
        finalize,
        casJob,
        removeObjects,
      })
    );
    expect(r).toEqual({
      ok: true,
      status: "existing",
      jobId: JOB_ID,
      winId: WIN_A,
    });
    expect(downloadObject).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(casJob).toHaveBeenCalledOnce();
    expect(removeObjects).toHaveBeenCalled();
  });

  it("same-MMS replay still CASes when Win is now hidden", async () => {
    const casJob = vi.fn(async () => true);
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        loadFacts: async () =>
          facts({
            wins: [winLite({ status: "hidden", hidden_at: NOW.toISOString() })],
            provenanceMedia: mmsMedia(),
          }),
        casJob,
      })
    );
    expect(r.ok).toBe(true);
    expect(casJob).toHaveBeenCalledOnce();
  });

  it("same provenance wrong media id never attaches", async () => {
    const finalize = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        loadFacts: async () =>
          facts({
            provenanceMedia: mmsMedia({
              id: "eeeeeeee-5555-4555-8555-555555555555",
            }),
          }),
        finalize,
      })
    );
    expect(r.ok).toBe(false);
    expect(finalize).not.toHaveBeenCalled();
  });

  it("expired before start expires without finalize", async () => {
    const finalize = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      job({ expires_at: "2026-08-20T11:00:00.000Z" }),
      baseDeps({ finalize })
    );
    expect(r).toMatchObject({ ok: false, reason: "expired", terminal: true });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("expired due attach_eligible expires without Storage work", async () => {
    const finalize = vi.fn();
    const downloadObject = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      job({ expires_at: "2026-08-20T11:59:00.000Z" }),
      baseDeps({
        now: new Date("2026-08-20T12:00:00.000Z"),
        finalize,
        downloadObject,
      })
    );
    expect(r).toMatchObject({ ok: false, reason: "expired", terminal: true });
    expect(finalize).not.toHaveBeenCalled();
    expect(downloadObject).not.toHaveBeenCalled();
  });

  it("expiry immediately before persist uses current now", async () => {
    const finalize = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      job({ expires_at: "2026-08-20T12:00:00.000Z" }),
      baseDeps({
        now: new Date("2026-08-20T12:00:01.000Z"),
        finalize,
      })
    );
    expect(r).toMatchObject({ ok: false, reason: "expired" });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("deletion before start expires", async () => {
    const finalize = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({ hasUnresolvedDeletion: async () => true, finalize })
    );
    expect(r).toMatchObject({ ok: false, reason: "deletion_blocked", terminal: true });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("deletion before persist expires", async () => {
    let calls = 0;
    const finalize = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        hasUnresolvedDeletion: async () => {
          calls += 1;
          return calls >= 3;
        },
        downloadObject: async () => jpegBytes(8, 8),
        finalize,
      })
    );
    expect(r).toMatchObject({ ok: false, reason: "deletion_blocked" });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("deletion after insert re-arms; does not CAS attached", async () => {
    let calls = 0;
    const casJob = vi.fn(async () => true);
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        hasUnresolvedDeletion: async () => {
          calls += 1;
          return calls >= 4;
        },
        downloadObject: async () => jpegBytes(8, 8),
        casJob,
      })
    );
    expect(r).toMatchObject({ ok: false, reason: "c2_stale_ownership", terminal: false });
    expect(casJob).not.toHaveBeenCalled();
  });

  it("norm master missing → c2_storage_read_failed", async () => {
    const applyDecision = vi.fn(async ({ decision }: { decision: InboundMmsC1Decision }) =>
      applied(decision)
    );
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        downloadObject: async ({ path }) => {
          if (path.includes("master.jpg")) throw new Error("missing");
          return jpegBytes(8, 8);
        },
        applyDecision,
      })
    );
    expect(r).toMatchObject({ ok: false, reason: "c2_storage_read_failed", terminal: false });
    expect(applyDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({ errorCode: "c2_storage_read_failed" }),
      })
    );
  });

  it("norm card missing → c2_storage_read_failed", async () => {
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        downloadObject: async ({ path }) => {
          if (path.includes("card.jpg")) throw new Error("missing");
          return jpegBytes(8, 8);
        },
      })
    );
    expect(r).toMatchObject({ ok: false, reason: "c2_storage_read_failed" });
  });

  it("metadata failure", async () => {
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        downloadObject: async () => Buffer.from("nope"),
        readJpegMetadata: async () => null,
      })
    );
    expect(r).toMatchObject({ ok: false, reason: "c2_metadata_failed", terminal: false });
  });

  it("canonical finalize storage failure retries awaiting_attach", async () => {
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        downloadObject: async () => jpegBytes(8, 8),
        finalize: async () => ({ ok: false, code: "storage_upload_failed" }),
      })
    );
    expect(r).toMatchObject({ ok: false, reason: "c2_finalize_failed", terminal: false });
  });

  it("DB insert failure retries without attaching job", async () => {
    const casJob = vi.fn(async () => true);
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        downloadObject: async () => jpegBytes(8, 8),
        finalize: async () => ({ ok: false, code: "db_insert_failed" }),
        casJob,
      })
    );
    expect(r).toMatchObject({ ok: false, reason: "c2_finalize_failed" });
    expect(casJob).not.toHaveBeenCalled();
  });

  it("media insert success + job CAS loss leaves media and re-arms", async () => {
    const removeObjects = vi.fn(async () => {});
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        downloadObject: async () => jpegBytes(8, 8),
        casJob: async () => false,
        removeObjects,
      })
    );
    expect(r).toMatchObject({ ok: false, reason: "c2_stale_ownership", terminal: false });
    expect(removeObjects).not.toHaveBeenCalledWith(
      expect.objectContaining({
        paths: expect.arrayContaining([victoryMediaMasterPath(USER, JOB_ID)]),
      })
    );
  });

  it("replay after prior DB insert skips download", async () => {
    const downloadObject = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        loadFacts: async () => facts({ provenanceMedia: mmsMedia(), media: mmsMedia() }),
        downloadObject,
      })
    );
    expect(r.ok).toBe(true);
    expect(downloadObject).not.toHaveBeenCalled();
  });

  it("norm cleanup failure after attached is non-fatal", async () => {
    const r = await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        downloadObject: async () => jpegBytes(8, 8),
        removeObjects: async () => {
          throw new Error("cleanup");
        },
      })
    );
    expect(r.ok).toBe(true);
  });

  it("does not increment attempt_count in attached CAS patch", async () => {
    const casJob = vi.fn(async ({ patch }) => {
      expect(patch).not.toHaveProperty("attempt_count");
      expect(patch.status).toBe("attached");
      expect(patch.resolution).toBe("attached");
      expect(patch.attached_win_id).toBe(WIN_A);
      expect(patch.next_retry_at).toBeNull();
      expect(patch.last_error_code).toBeNull();
      return true;
    });
    await evaluateAndAttachInboundMmsC2Job(
      job(),
      baseDeps({
        downloadObject: async () => jpegBytes(8, 8),
        casJob,
      })
    );
    expect(casJob).toHaveBeenCalledOnce();
  });

  function semanticJob(partial: Partial<InboundMediaJobRow> = {}) {
    return job({
      last_error_code: "semantic_target",
      semantic_target_win_id: WIN_A,
      message_sid: PHOTO_SID,
      ...partial,
    });
  }

  function semanticDeps(overrides: Partial<AttachInboundMmsC2Deps> = {}): AttachInboundMmsC2Deps {
    return baseDeps({
      loadFacts: async () =>
        facts({
          wins: [winLite({ source_message_sid: SID })],
          siblings: [sibling()],
        }),
      loadTargetWin: async () => ({
        id: WIN_A,
        clerk_user_id: USER,
        status: "active",
        hidden_at: null,
      }),
      loadMediaForWin: async () => null,
      ...overrides,
    });
  }

  it("Mode A same-MessageSid happy path still ignores unset semantic_target_win_id", async () => {
    const r = await evaluateAndAttachInboundMmsC2Job(
      job({ semantic_target_win_id: null }),
      baseDeps({ downloadObject: async () => jpegBytes(8, 8) })
    );
    expect(r).toMatchObject({ ok: true, status: "attached", winId: WIN_A });
  });

  it("semantic target attaches across a different MessageSid", async () => {
    const finalize = vi.fn(async (input: FinalizeVictoryWinMediaInput) => {
      expect(input.winId).toBe(WIN_A);
      expect(input.sourceMessageSid).toBe(PHOTO_SID);
      expect(input.mediaId).toBe(JOB_ID);
      return {
        ok: true as const,
        status: "attached" as const,
        media: {
          id: JOB_ID,
          winId: WIN_A,
          clerkUserId: USER,
          sourceType: "inbound_mms" as const,
          storageMasterPath: victoryMediaMasterPath(USER, JOB_ID),
          storageCardPath: victoryMediaCardPath(USER, JOB_ID),
          mimeType: "image/jpeg" as const,
          byteSize: 10,
          width: 32,
          height: 24,
          cardByteSize: 8,
          cardWidth: 16,
          cardHeight: 12,
          userSelectedAt: null,
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        },
      };
    });
    const casJob = vi.fn(async ({ patch }) => {
      expect(patch.attached_win_id).toBe(WIN_A);
      expect(patch.status).toBe("attached");
      expect(patch).not.toHaveProperty("semantic_target_win_id");
      return true;
    });
    const r = await evaluateAndAttachInboundMmsC2Job(
      semanticJob(),
      semanticDeps({
        downloadObject: async () => jpegBytes(8, 8),
        finalize,
        casJob,
      })
    );
    expect(r).toEqual({
      ok: true,
      status: "attached",
      jobId: JOB_ID,
      winId: WIN_A,
    });
    expect(finalize).toHaveBeenCalledOnce();
  });

  it("semantic target wrong clerk is rejected", async () => {
    const finalize = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      semanticJob(),
      semanticDeps({
        loadTargetWin: async () => ({
          id: WIN_A,
          clerk_user_id: "user_other",
          status: "active",
          hidden_at: null,
        }),
        finalize,
      })
    );
    expect(r.ok).toBe(false);
    expect(finalize).not.toHaveBeenCalled();
  });

  it("semantic target missing Win is rejected", async () => {
    const finalize = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      semanticJob(),
      semanticDeps({ loadTargetWin: async () => null, finalize })
    );
    expect(r.ok).toBe(false);
    expect(finalize).not.toHaveBeenCalled();
  });

  it("semantic target hidden Win is rejected without drifting", async () => {
    const finalize = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      semanticJob(),
      semanticDeps({
        loadTargetWin: async () => ({
          id: WIN_A,
          clerk_user_id: USER,
          status: "hidden",
          hidden_at: NOW.toISOString(),
        }),
        finalize,
      })
    );
    expect(r).toMatchObject({
      ok: false,
      reason: "c2_semantic_stale_ownership",
      terminal: false,
    });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("semantic target inactive Win is rejected", async () => {
    const finalize = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      semanticJob(),
      semanticDeps({
        loadTargetWin: async () => ({
          id: WIN_A,
          clerk_user_id: USER,
          status: "completed",
          hidden_at: null,
        }),
        finalize,
      })
    );
    expect(r.ok).toBe(false);
    expect(finalize).not.toHaveBeenCalled();
  });

  it("semantic target with existing web media is user_priority_blocked", async () => {
    const finalize = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      semanticJob(),
      semanticDeps({
        loadMediaForWin: async () => ({
          id: "eeeeeeee-5555-4555-8555-555555555555",
          win_id: WIN_A,
          clerk_user_id: USER,
          source_type: "web_upload",
          source_message_sid: null,
          source_media_ordinal: null,
        }),
        finalize,
      })
    );
    expect(r).toMatchObject({
      ok: false,
      reason: "web_priority_blocked",
      terminal: true,
    });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("semantic target with existing MMS media is other_mms_occupied", async () => {
    const finalize = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      semanticJob(),
      semanticDeps({
        loadMediaForWin: async () =>
          mmsMedia({
            id: "eeeeeeee-5555-4555-8555-555555555555",
            source_message_sid: SID,
          }),
        finalize,
      })
    );
    expect(r).toMatchObject({
      ok: false,
      reason: "other_mms_occupied",
      terminal: true,
    });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("semantic target same-SID multi-image history is rejected", async () => {
    const finalize = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      semanticJob(),
      semanticDeps({
        loadFacts: async () =>
          facts({
            siblings: [
              sibling(),
              sibling({ id: JOB_2, status: "expired", resolution: "expired" }),
            ],
          }),
        finalize,
      })
    );
    expect(r).toMatchObject({ ok: false, reason: "ambiguous_media", terminal: true });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("semantic target expired job is rejected", async () => {
    const finalize = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      semanticJob({ expires_at: "2026-08-20T11:00:00.000Z" }),
      semanticDeps({ finalize })
    );
    expect(r).toMatchObject({ ok: false, reason: "expired", terminal: true });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("semantic target deletion is blocked", async () => {
    const finalize = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      semanticJob(),
      semanticDeps({ hasUnresolvedDeletion: async () => true, finalize })
    );
    expect(r).toMatchObject({ ok: false, reason: "deletion_blocked", terminal: true });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("semantic target tombstoned job is rejected", async () => {
    const finalize = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      semanticJob({
        status: "tombstoned",
        resolution: "removed",
        tombstoned_at: NOW.toISOString(),
      }),
      semanticDeps({ finalize })
    );
    expect(r).toMatchObject({ ok: false, reason: "tombstoned", terminal: true });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("C2 retry preserves semantic_target_win_id on the job snapshot", async () => {
    const applyDecision = vi.fn(async ({ job: j, decision }) => {
      expect(j.semantic_target_win_id).toBe(WIN_A);
      return decision;
    });
    const r = await evaluateAndAttachInboundMmsC2Job(
      semanticJob(),
      semanticDeps({
        downloadObject: async () => {
          throw new Error("read");
        },
        applyDecision,
      })
    );
    expect(r).toMatchObject({ ok: false, reason: "c2_semantic_storage_read_failed" });
    expect(applyDecision).toHaveBeenCalled();
    const codes = applyDecision.mock.calls.map((c) => c[0].decision);
    expect(
      codes.some(
        (d) => d.kind === "error_retry" && d.errorCode === "c2_semantic_storage_read_failed"
      )
    ).toBe(true);
  });

  it("semantic replay requires target agreement", async () => {
    const downloadObject = vi.fn();
    const r = await evaluateAndAttachInboundMmsC2Job(
      semanticJob(),
      semanticDeps({
        loadFacts: async () =>
          facts({
            provenanceMedia: mmsMedia({
              win_id: WIN_A,
              source_message_sid: PHOTO_SID,
            }),
          }),
        downloadObject,
      })
    );
    expect(r).toEqual({
      ok: true,
      status: "existing",
      jobId: JOB_ID,
      winId: WIN_A,
    });
    expect(downloadObject).not.toHaveBeenCalled();
  });

  it("semantic replay mismatches target vs canonical row fail closed", async () => {
    const finalize = vi.fn();
    const casJob = vi.fn(async () => true);
    const r = await evaluateAndAttachInboundMmsC2Job(
      semanticJob(),
      semanticDeps({
        loadFacts: async () =>
          facts({
            provenanceMedia: mmsMedia({
              win_id: WIN_B,
              source_message_sid: PHOTO_SID,
            }),
          }),
        finalize,
        casJob,
      })
    );
    expect(r).toMatchObject({
      ok: false,
      reason: "c2_semantic_stale_ownership",
      terminal: false,
    });
    expect(finalize).not.toHaveBeenCalled();
    expect(casJob).not.toHaveBeenCalled();
  });

  it("semantic web race still wins", async () => {
    const r = await evaluateAndAttachInboundMmsC2Job(
      semanticJob(),
      semanticDeps({
        downloadObject: async () => jpegBytes(8, 8),
        finalize: async () => ({ ok: false, code: "media_exists" }),
        loadMediaForWin: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: "eeeeeeee-5555-4555-8555-555555555555",
            win_id: WIN_A,
            clerk_user_id: USER,
            source_type: "web_upload",
            source_message_sid: null,
            source_media_ordinal: null,
          }),
      })
    );
    expect(r).toMatchObject({
      ok: false,
      reason: "web_priority_blocked",
      terminal: true,
    });
  });

  it("semantic metadata failure writes c2_semantic_metadata_failed", async () => {
    const applyDecision = vi.fn(async ({ decision }) => decision);
    const r = await evaluateAndAttachInboundMmsC2Job(
      semanticJob(),
      semanticDeps({
        downloadObject: async () => jpegBytes(8, 8),
        readJpegMetadata: async () => null,
        applyDecision,
      })
    );
    expect(r).toMatchObject({
      ok: false,
      reason: "c2_semantic_metadata_failed",
      terminal: false,
    });
    const codes = applyDecision.mock.calls.map((c) => c[0].decision);
    expect(
      codes.some(
        (d) => d.kind === "error_retry" && d.errorCode === "c2_semantic_metadata_failed"
      )
    ).toBe(true);
  });

  it("semantic finalize failure writes c2_semantic_finalize_failed", async () => {
    const applyDecision = vi.fn(async ({ decision }) => decision);
    const r = await evaluateAndAttachInboundMmsC2Job(
      semanticJob(),
      semanticDeps({
        downloadObject: async () => jpegBytes(8, 8),
        finalize: async () => {
          throw new Error("finalize");
        },
        applyDecision,
      })
    );
    expect(r).toMatchObject({
      ok: false,
      reason: "c2_semantic_finalize_failed",
      terminal: false,
    });
    const codes = applyDecision.mock.calls.map((c) => c[0].decision);
    expect(
      codes.some(
        (d) => d.kind === "error_retry" && d.errorCode === "c2_semantic_finalize_failed"
      )
    ).toBe(true);
  });

  it("FK SET NULL leftover stays Mode B across two C2 passes and ignores a same-SID decoy Win", async () => {
    const loadFacts = vi.fn(async () =>
      facts({
        wins: [winLite({ id: WIN_A, source_message_sid: PHOTO_SID })],
        siblings: [sibling()],
      })
    );
    const finalize = vi.fn(async () => {
      throw new Error("must not finalize");
    });
    const loadTargetWin = vi.fn(async () => ({
      id: WIN_A,
      clerk_user_id: USER,
      status: "active",
      hidden_at: null,
    }));
    const applyDecision = vi.fn(async ({ decision }) => decision);

    const leftover = semanticJob({
      semantic_target_win_id: null,
      last_error_code: "semantic_target",
    });
    const first = await evaluateAndAttachInboundMmsC2Job(
      leftover,
      semanticDeps({
        loadFacts,
        finalize,
        loadTargetWin,
        applyDecision,
        downloadObject: async () => jpegBytes(8, 8),
      })
    );
    expect(first).toMatchObject({
      ok: false,
      reason: "c2_semantic_target_missing",
      terminal: false,
    });
    expect(loadFacts).not.toHaveBeenCalled();
    expect(loadTargetWin).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(isInboundMediaJobSemanticTargetOwned(leftover)).toBe(true);

    const retried = semanticJob({
      semantic_target_win_id: null,
      last_error_code: "c2_semantic_target_missing",
    });
    expect(isInboundMediaJobSemanticTargetOwned(retried)).toBe(true);
    const second = await evaluateAndAttachInboundMmsC2Job(
      retried,
      semanticDeps({
        loadFacts,
        finalize,
        loadTargetWin,
        applyDecision,
        downloadObject: async () => jpegBytes(8, 8),
      })
    );
    expect(second).toMatchObject({
      ok: false,
      reason: "c2_semantic_target_missing",
      terminal: false,
    });
    expect(loadFacts).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(isInboundMediaJobSemanticTargetOwned(retried)).toBe(true);
  });

  it("ordinary Mode A attach_eligible is not classified as semantic lineage", async () => {
    expect(
      isInboundMediaJobSemanticTargetOwned(
        job({ semantic_target_win_id: null, last_error_code: "attach_eligible" })
      )
    ).toBe(false);
    expect(
      isInboundMediaJobSemanticTargetOwned(
        job({ semantic_target_win_id: null, last_error_code: "c2_stale_ownership" })
      )
    ).toBe(false);
    const r = await evaluateAndAttachInboundMmsC2Job(
      job({ semantic_target_win_id: null }),
      baseDeps({ downloadObject: async () => jpegBytes(8, 8) })
    );
    expect(r).toMatchObject({ ok: true, status: "attached", winId: WIN_A });
  });
});

describe("isInboundMediaJobSemanticTargetOwned", () => {
  it("treats UUID or any semantic lineage code as owned", () => {
    expect(
      isInboundMediaJobSemanticTargetOwned(
        job({ semantic_target_win_id: WIN_A, last_error_code: "c2_storage_read_failed" })
      )
    ).toBe(true);
    expect(
      isInboundMediaJobSemanticTargetOwned(
        job({ semantic_target_win_id: null, last_error_code: "semantic_target" })
      )
    ).toBe(true);
    expect(
      isInboundMediaJobSemanticTargetOwned(
        job({ semantic_target_win_id: null, last_error_code: "c2_semantic_stale_ownership" })
      )
    ).toBe(true);
  });
});
