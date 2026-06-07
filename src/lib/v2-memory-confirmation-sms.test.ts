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

import { applyWave11ConfirmedProfileUpdates, insertWave11MemoryResolutionEvent } from "@/lib/v2-memory-confirmation-sms";

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
