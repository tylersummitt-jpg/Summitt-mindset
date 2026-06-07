import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMock = vi.fn();
const persistWave11Mock = vi.fn();
const insertMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      update: (...args: unknown[]) => updateMock(...args),
      insert: (...args: unknown[]) => insertMock(...args),
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/v2-persist-identity-edit", () => ({
  persistWave11ConfirmedIdentityAnchorEdit: (...args: unknown[]) => persistWave11Mock(...args),
}));

const recomputeMock = vi.fn();

vi.mock("@/lib/v2-coaching-memory", () => ({
  recomputeV2CoachingMemory: (...args: unknown[]) => recomputeMock(...args),
}));

import {
  applyWave11ConfirmedProfileUpdates,
  insertWave11MemoryResolutionEvent,
  persistMemoryConfirmationTruthOnNoSend,
} from "@/lib/v2-memory-confirmation-sms";

const USER = "user_wave11";
const VALID_ANCHOR =
  "A steadier parent who follows through on small promises every day.";

describe("applyWave11ConfirmedProfileUpdates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMock.mockReturnValue({
      eq: () => Promise.resolve({ error: null }),
    });
    insertMock.mockResolvedValue({ error: null });
    persistWave11Mock.mockResolvedValue({
      ok: true,
      versionId: "ver_wave11",
      identityAnchorText: VALID_ANCHOR,
    });
  });

  it("routes confirmed identity updates through versioned helper, not profile-only write", async () => {
    const result = await applyWave11ConfirmedProfileUpdates({
      clerkUserId: USER,
      pending: {
        eventId: "evt_1",
        occurredAt: "2026-05-10T12:00:00.000Z",
        sourceMessageSid: "SM123",
        pendingKind: "identity_anchor_update",
        candidateIdentityAnchorText: VALID_ANCHOR,
        candidatePeopleSummary: null,
        candidateResponsibility: null,
        confirmationQuestion: "Want me to remember that?",
        expiresAtMs: Date.now() + 60_000,
      },
    });

    expect(result.appliedIdentity).toBe(true);
    expect(persistWave11Mock).toHaveBeenCalledWith({
      clerkUserId: USER,
      identityAnchorText: VALID_ANCHOR,
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("does not mark identity applied when versioned helper fails", async () => {
    persistWave11Mock.mockResolvedValue({
      ok: false,
      error: "Identity setup incomplete.",
      code: "identity_setup_incomplete",
    });

    const result = await applyWave11ConfirmedProfileUpdates({
      clerkUserId: USER,
      pending: {
        eventId: "evt_1",
        occurredAt: "2026-05-10T12:00:00.000Z",
        sourceMessageSid: "SM123",
        pendingKind: "identity_anchor_update",
        candidateIdentityAnchorText: VALID_ANCHOR,
        candidatePeopleSummary: null,
        candidateResponsibility: null,
        confirmationQuestion: "Want me to remember that?",
        expiresAtMs: Date.now() + 60_000,
      },
    });

    expect(result.appliedIdentity).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("still applies relationship context profile updates directly", async () => {
    const result = await applyWave11ConfirmedProfileUpdates({
      clerkUserId: USER,
      pending: {
        eventId: "evt_2",
        occurredAt: "2026-05-10T12:00:00.000Z",
        sourceMessageSid: "SM456",
        pendingKind: "relationship_context_update",
        candidateIdentityAnchorText: null,
        candidatePeopleSummary: "Two children at home and a spouse who travels weekly.",
        candidateResponsibility: "Primary caregiver for school pickup and evening routines.",
        confirmationQuestion: "Want me to remember that?",
        expiresAtMs: Date.now() + 60_000,
      },
    });

    expect(result.appliedIdentity).toBe(false);
    expect(result.appliedPeopleSummary).toBe(true);
    expect(result.appliedResponsibility).toBe(true);
    expect(persistWave11Mock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        people_summary: "Two children at home and a spouse who travels weekly.",
        responsibility: "Primary caregiver for school pickup and evening routines.",
      })
    );
  });

  it("rejects invalid identity candidate without calling versioned helper", async () => {
    const result = await applyWave11ConfirmedProfileUpdates({
      clerkUserId: USER,
      pending: {
        eventId: "evt_3",
        occurredAt: "2026-05-10T12:00:00.000Z",
        sourceMessageSid: "SM789",
        pendingKind: "identity_anchor_update",
        candidateIdentityAnchorText: "bad",
        candidatePeopleSummary: null,
        candidateResponsibility: null,
        confirmationQuestion: "Want me to remember that?",
        expiresAtMs: Date.now() + 60_000,
      },
    });

    expect(result.appliedIdentity).toBe(false);
    expect(persistWave11Mock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("insertWave11MemoryResolutionEvent idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockResolvedValue({ error: null });
  });

  it("returns inserted true on first insert", async () => {
    const result = await insertWave11MemoryResolutionEvent({
      commitmentId: "cmt_1",
      clerkUserId: USER,
      inboundMessageSid: "SM_retry_1",
      resolvedPendingSourceMessageSid: "SM_pending",
      outcome: "declined",
      priorEventId: "evt_1",
      appliedIdentity: false,
      appliedPeopleSummary: false,
      appliedResponsibility: false,
      resolutionTelemetry: { memory_resolution_visible_sent: false },
    });

    expect(result).toEqual({ inserted: true, duplicate: false });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotency_key: "v2_wave11_memory_resolution:SM_retry_1",
      })
    );
  });

  it("returns duplicate true on 23505 without throwing", async () => {
    insertMock.mockResolvedValueOnce({ error: { code: "23505", message: "duplicate" } });

    const result = await insertWave11MemoryResolutionEvent({
      commitmentId: "cmt_1",
      clerkUserId: USER,
      inboundMessageSid: "SM_retry_2",
      resolvedPendingSourceMessageSid: "SM_pending",
      outcome: "confirmed",
      priorEventId: "evt_1",
      appliedIdentity: true,
      appliedPeopleSummary: false,
      appliedResponsibility: false,
      resolutionTelemetry: { memory_resolution_visible_sent: false },
    });

    expect(result).toEqual({ inserted: false, duplicate: true });
  });

  it("merges resolutionTelemetry into payload_json", async () => {
    await insertWave11MemoryResolutionEvent({
      commitmentId: "cmt_1",
      clerkUserId: USER,
      inboundMessageSid: "SM_telemetry",
      resolvedPendingSourceMessageSid: "SM_pending",
      outcome: "declined",
      priorEventId: null,
      appliedIdentity: false,
      appliedPeopleSummary: false,
      appliedResponsibility: false,
      resolutionTelemetry: {
        memory_confirmation_branch: "decline",
        memory_resolution_visible_sent: false,
        unified_final_guard_no_send_reason: "unsupported_accountability_claim",
      },
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload_json: expect.objectContaining({
          memory_confirmation_branch: "decline",
          memory_resolution_visible_sent: false,
          unified_final_guard_no_send_reason: "unsupported_accountability_claim",
        }),
      })
    );
  });
});

describe("persistMemoryConfirmationTruthOnNoSend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockResolvedValue({ error: null });
    recomputeMock.mockResolvedValue(undefined);
  });

  const baseArgs = {
    commitmentId: "cmt_1",
    clerkUserId: USER,
    inboundMessageSid: "SM_no_send",
    pendingSourceMessageSid: "SM_pending",
    pendingEventId: "evt_pending",
    noSendReason: "model_no_send",
  };

  it("ambiguous lane no-send: no resolution insert, pending not cleared", async () => {
    const telemetry = await persistMemoryConfirmationTruthOnNoSend({
      ...baseArgs,
      branch: "ambiguous",
      noSendStage: "lane",
    });

    expect(insertMock).not.toHaveBeenCalled();
    expect(recomputeMock).not.toHaveBeenCalled();
    expect(telemetry).toMatchObject({
      memory_confirmation_branch: "ambiguous",
      memory_no_send_stage: "lane",
      memory_resolution_persisted: false,
      memory_resolution_visible_sent: false,
      pending_memory_cleared: false,
      lane_no_send_reason: "model_no_send",
    });
  });

  it("ambiguous FVG no-send: no resolution insert", async () => {
    const telemetry = await persistMemoryConfirmationTruthOnNoSend({
      ...baseArgs,
      branch: "ambiguous",
      noSendStage: "final_voice_gate",
      noSendReason: "v3_repair_failed",
    });

    expect(insertMock).not.toHaveBeenCalled();
    expect(telemetry.final_voice_gate_skip_reason).toBe("v3_repair_failed");
    expect(telemetry.pending_memory_cleared).toBe(false);
  });

  it("decline lane no-send: declined resolution with visible_sent=false", async () => {
    const telemetry = await persistMemoryConfirmationTruthOnNoSend({
      ...baseArgs,
      branch: "decline",
      noSendStage: "lane",
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload_json: expect.objectContaining({
          resolution_outcome: "declined",
          memory_confirmation_branch: "decline",
          memory_no_send_stage: "lane",
          memory_resolution_visible_sent: false,
          memory_update_applied_before_sms: false,
        }),
      })
    );
    expect(telemetry).toMatchObject({
      memory_resolution_persisted: true,
      pending_memory_cleared: true,
      memory_update_applied_before_sms: false,
      memory_resolution_duplicate: false,
    });
  });

  it("decline FVG no-send: same as lane", async () => {
    await persistMemoryConfirmationTruthOnNoSend({
      ...baseArgs,
      branch: "decline",
      noSendStage: "final_voice_gate",
      noSendReason: "no_safe_v3_voice",
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload_json: expect.objectContaining({
          resolution_outcome: "declined",
          final_voice_gate_skip_reason: "no_safe_v3_voice",
        }),
      })
    );
  });

  it("yes lane no-send: confirmed resolution, recompute when anyApplied", async () => {
    const telemetry = await persistMemoryConfirmationTruthOnNoSend({
      ...baseArgs,
      branch: "yes",
      noSendStage: "lane",
      anyApplied: true,
      applied: { appliedIdentity: true, appliedPeopleSummary: false, appliedResponsibility: false },
    });

    expect(recomputeMock).toHaveBeenCalledWith("cmt_1", {
      reasonCode: "wave11_sms_memory_confirmation",
    });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload_json: expect.objectContaining({
          resolution_outcome: "confirmed",
          memory_update_applied_before_sms: true,
          memory_applied_any: true,
          applied_identity_anchor: true,
        }),
      })
    );
    expect(telemetry.memory_update_applied_before_sms).toBe(true);
  });

  it("yes FVG no-send: memory_update_applied_before_sms follows anyApplied not hardcoded true", async () => {
    const telemetry = await persistMemoryConfirmationTruthOnNoSend({
      ...baseArgs,
      branch: "yes",
      noSendStage: "final_voice_gate",
      anyApplied: false,
      applied: { appliedIdentity: false, appliedPeopleSummary: false, appliedResponsibility: false },
    });

    expect(recomputeMock).not.toHaveBeenCalled();
    expect(telemetry.memory_update_applied_before_sms).toBe(false);
    expect(telemetry.memory_applied_any).toBe(false);
  });

  it("yes unified guard no-send: includes unified reason field via stageMetadata", async () => {
    await persistMemoryConfirmationTruthOnNoSend({
      ...baseArgs,
      branch: "yes",
      noSendStage: "unified_final_guard",
      noSendReason: "unsupported_accountability_claim",
      anyApplied: true,
      applied: { appliedIdentity: false, appliedPeopleSummary: true, appliedResponsibility: false },
      stageMetadata: { unified_final_guard_mode: "transactional_coaching_limited" },
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload_json: expect.objectContaining({
          unified_final_guard_no_send_reason: "unsupported_accountability_claim",
          unified_final_guard_mode: "transactional_coaching_limited",
        }),
      })
    );
  });

  it("duplicate resolution on retry is safe no-op", async () => {
    insertMock.mockResolvedValueOnce({ error: { code: "23505", message: "duplicate" } });

    const telemetry = await persistMemoryConfirmationTruthOnNoSend({
      ...baseArgs,
      branch: "decline",
      noSendStage: "lane",
    });

    expect(telemetry.memory_resolution_duplicate).toBe(true);
  });
});
