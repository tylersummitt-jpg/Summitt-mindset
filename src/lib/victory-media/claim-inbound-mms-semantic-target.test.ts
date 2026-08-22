import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/server", () => ({
  after: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(),
  },
}));

vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  hasUnresolvedAccountDeletionRequest: vi.fn(async () => false),
}));

import {
  claimInboundMediaJobSemanticTarget,
  INBOUND_MEDIA_SEMANTIC_TARGET_ERROR_CODE,
  isInboundMediaJobSemanticTargetClaimable,
  isSemanticTargetWinTechnicallyEligible,
} from "@/lib/victory-media/claim-inbound-mms-semantic-target";
import type { InboundMediaJobRow } from "@/lib/victory-media/claim-inbound-media-job";
import { INBOUND_MEDIA_C1_WAIT_RETRY_MS } from "@/lib/victory-media/correlate-inbound-mms-c1";
import { victoryMediaMmsNormMasterPath } from "@/lib/victory-media/storage-paths";

const NOW = new Date("2026-08-21T12:00:00.000Z");
const JOB_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const JOB_2 = "bbbbbbbb-2222-4222-8222-222222222222";
const WIN_A = "cccccccc-3333-4333-8333-333333333333";
const USER = "user_d0";
const OTHER = "user_other";
const PHOTO_SID = "SMdddddddddddddddddddddddddddddddd";
const NORM = victoryMediaMmsNormMasterPath(USER, JOB_ID);

function pendingJob(partial: Partial<InboundMediaJobRow> = {}): InboundMediaJobRow {
  return {
    id: JOB_ID,
    message_sid: PHOTO_SID,
    media_ordinal: 0,
    clerk_user_id: USER,
    twilio_media_sid: "MEcccccccccccccccccccccccccccccccc",
    declared_content_type: "image/jpeg",
    status: "pending_semantics",
    attempt_count: 2,
    next_retry_at: null,
    last_error_code: null,
    temp_storage_path: null,
    normalized_storage_path: NORM,
    attached_win_id: null,
    semantic_target_win_id: null,
    resolution: null,
    classifier_target: null,
    followup_idempotency_key: null,
    expires_at: "2026-08-24T12:00:00.000Z",
    tombstoned_at: null,
    created_at: "2026-08-19T00:00:00.000Z",
    updated_at: "2026-08-21T11:00:00.000Z",
    ...partial,
  };
}

function eligibleWin() {
  return {
    id: WIN_A,
    clerk_user_id: USER,
    status: "active",
    hidden_at: null,
  };
}

function okDeps(overrides: Parameters<typeof claimInboundMediaJobSemanticTarget>[1] = {}) {
  return {
    hasUnresolvedDeletion: async () => false,
    loadJob: async () => pendingJob(),
    loadTargetWin: async () => eligibleWin(),
    loadMediaForWin: async () => null,
    loadSameSidJobs: async () => [{ id: JOB_ID }],
    casClaim: async () => true,
    ...overrides,
  };
}

describe("isInboundMediaJobSemanticTargetClaimable", () => {
  it("accepts pending_semantics with D2a last_error_code (D1 rescue of grace)", () => {
    expect(
      isInboundMediaJobSemanticTargetClaimable(
        pendingJob({
          last_error_code: "semantic_grace",
          next_retry_at: NOW.toISOString(),
        }),
        { clerkUserId: USER, now: NOW }
      )
    ).toBe(true);
    expect(
      isInboundMediaJobSemanticTargetClaimable(
        pendingJob({ last_error_code: "semantic_due" }),
        { clerkUserId: USER, now: NOW }
      )
    ).toBe(true);
  });

  it("rejects awaiting_attach / attached / pending_user by default", () => {
    expect(
      isInboundMediaJobSemanticTargetClaimable(
        pendingJob({ status: "awaiting_attach" }),
        { clerkUserId: USER, now: NOW }
      )
    ).toBe(false);
    expect(
      isInboundMediaJobSemanticTargetClaimable(
        pendingJob({ resolution: "pending_user" }),
        { clerkUserId: USER, now: NOW }
      )
    ).toBe(false);
  });

  it("accepts pending_user only when expectedResolution is explicit", () => {
    expect(
      isInboundMediaJobSemanticTargetClaimable(
        pendingJob({ resolution: "pending_user" }),
        { clerkUserId: USER, now: NOW, expectedResolution: "pending_user" }
      )
    ).toBe(true);
  });
});

describe("isSemanticTargetWinTechnicallyEligible", () => {
  it("requires same clerk, active, unhidden", () => {
    expect(isSemanticTargetWinTechnicallyEligible(eligibleWin(), USER)).toBe(true);
    expect(
      isSemanticTargetWinTechnicallyEligible(
        { ...eligibleWin(), clerk_user_id: OTHER },
        USER
      )
    ).toBe(false);
    expect(
      isSemanticTargetWinTechnicallyEligible({ ...eligibleWin(), status: "hidden" }, USER)
    ).toBe(false);
    expect(
      isSemanticTargetWinTechnicallyEligible(
        { ...eligibleWin(), hidden_at: NOW.toISOString() },
        USER
      )
    ).toBe(false);
    expect(isSemanticTargetWinTechnicallyEligible(null, USER)).toBe(false);
  });
});

describe("claimInboundMediaJobSemanticTarget", () => {
  it("CAS pending_semantics → awaiting_attach with semantic_target", async () => {
    const casClaim = vi.fn(async () => true);
    const r = await claimInboundMediaJobSemanticTarget(
      { jobId: JOB_ID, clerkUserId: USER, targetWinId: WIN_A, now: NOW },
      okDeps({ casClaim })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, targetWinId: WIN_A });
    expect(casClaim).toHaveBeenCalledOnce();
    const args = casClaim.mock.calls[0]![0];
    expect(args.targetWinId).toBe(WIN_A);
    expect(args.expectedResolution).toBeNull();
    expect(INBOUND_MEDIA_SEMANTIC_TARGET_ERROR_CODE).toBe("semantic_target");
    expect(INBOUND_MEDIA_C1_WAIT_RETRY_MS).toBe(60_000);
  });

  it("rejects wrong clerk target", async () => {
    const r = await claimInboundMediaJobSemanticTarget(
      { jobId: JOB_ID, clerkUserId: USER, targetWinId: WIN_A, now: NOW },
      okDeps({
        loadTargetWin: async () => ({ ...eligibleWin(), clerk_user_id: OTHER }),
      })
    );
    expect(r).toEqual({ ok: false, reason: "target_ineligible" });
  });

  it("rejects missing target", async () => {
    const r = await claimInboundMediaJobSemanticTarget(
      { jobId: JOB_ID, clerkUserId: USER, targetWinId: WIN_A, now: NOW },
      okDeps({ loadTargetWin: async () => null })
    );
    expect(r).toEqual({ ok: false, reason: "target_ineligible" });
  });

  it("rejects hidden target", async () => {
    const r = await claimInboundMediaJobSemanticTarget(
      { jobId: JOB_ID, clerkUserId: USER, targetWinId: WIN_A, now: NOW },
      okDeps({
        loadTargetWin: async () => ({
          ...eligibleWin(),
          status: "hidden",
          hidden_at: NOW.toISOString(),
        }),
      })
    );
    expect(r).toEqual({ ok: false, reason: "target_ineligible" });
  });

  it("rejects inactive target", async () => {
    const r = await claimInboundMediaJobSemanticTarget(
      { jobId: JOB_ID, clerkUserId: USER, targetWinId: WIN_A, now: NOW },
      okDeps({ loadTargetWin: async () => ({ ...eligibleWin(), status: "completed" }) })
    );
    expect(r).toEqual({ ok: false, reason: "target_ineligible" });
  });

  it("rejects target with web media", async () => {
    const r = await claimInboundMediaJobSemanticTarget(
      { jobId: JOB_ID, clerkUserId: USER, targetWinId: WIN_A, now: NOW },
      okDeps({
        loadMediaForWin: async () => ({
          id: "eeeeeeee-5555-4555-8555-555555555555",
          win_id: WIN_A,
          source_type: "web_upload",
        }),
      })
    );
    expect(r).toEqual({ ok: false, reason: "media_exists" });
  });

  it("rejects target with inbound_mms media", async () => {
    const r = await claimInboundMediaJobSemanticTarget(
      { jobId: JOB_ID, clerkUserId: USER, targetWinId: WIN_A, now: NOW },
      okDeps({
        loadMediaForWin: async () => ({
          id: JOB_ID,
          win_id: WIN_A,
          source_type: "inbound_mms",
        }),
      })
    );
    expect(r).toEqual({ ok: false, reason: "media_exists" });
  });

  it("rejects same-SID multi-image history", async () => {
    const r = await claimInboundMediaJobSemanticTarget(
      { jobId: JOB_ID, clerkUserId: USER, targetWinId: WIN_A, now: NOW },
      okDeps({
        loadSameSidJobs: async () => [{ id: JOB_ID }, { id: JOB_2 }],
      })
    );
    expect(r).toEqual({ ok: false, reason: "ambiguous_media" });
  });

  it("rejects expired jobs", async () => {
    const r = await claimInboundMediaJobSemanticTarget(
      { jobId: JOB_ID, clerkUserId: USER, targetWinId: WIN_A, now: NOW },
      okDeps({
        loadJob: async () => pendingJob({ expires_at: "2026-08-21T11:00:00.000Z" }),
      })
    );
    expect(r).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects unresolved deletion", async () => {
    const r = await claimInboundMediaJobSemanticTarget(
      { jobId: JOB_ID, clerkUserId: USER, targetWinId: WIN_A, now: NOW },
      okDeps({ hasUnresolvedDeletion: async () => true })
    );
    expect(r).toEqual({ ok: false, reason: "deletion_blocked" });
  });

  it("rejects tombstoned jobs", async () => {
    const r = await claimInboundMediaJobSemanticTarget(
      { jobId: JOB_ID, clerkUserId: USER, targetWinId: WIN_A, now: NOW },
      okDeps({
        loadJob: async () =>
          pendingJob({
            status: "tombstoned",
            resolution: "removed",
            tombstoned_at: NOW.toISOString(),
          }),
      })
    );
    expect(r).toEqual({ ok: false, reason: "tombstoned" });
  });

  it("does not claim production pending_user without explicit expectedResolution", async () => {
    const casClaim = vi.fn(async () => true);
    const r = await claimInboundMediaJobSemanticTarget(
      { jobId: JOB_ID, clerkUserId: USER, targetWinId: WIN_A, now: NOW },
      okDeps({
        loadJob: async () => pendingJob({ resolution: "pending_user" }),
        casClaim,
      })
    );
    expect(r).toEqual({ ok: false, reason: "not_claimable" });
    expect(casClaim).not.toHaveBeenCalled();
  });

  it("can claim pending_user when expectedResolution is explicit", async () => {
    const casClaim = vi.fn(async () => true);
    const r = await claimInboundMediaJobSemanticTarget(
      {
        jobId: JOB_ID,
        clerkUserId: USER,
        targetWinId: WIN_A,
        now: NOW,
        expectedResolution: "pending_user",
      },
      okDeps({
        loadJob: async () => pendingJob({ resolution: "pending_user" }),
        casClaim,
      })
    );
    expect(r.ok).toBe(true);
    expect(casClaim.mock.calls[0]![0].expectedResolution).toBe("pending_user");
  });

  it("does not insert or update v2_win", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/victory-media/claim-inbound-mms-semantic-target.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/\.from\("v2_win"\)\s*\.(insert|update|delete)/);
    expect(src).not.toContain("sendSMS");
    expect(src).not.toContain("responses.create");
    expect(src).not.toContain("chat.completions");
    expect(src).not.toContain("persistRecognizedWins");
  });
});
