import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMock = vi.fn();
const persistWave11Mock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      update: (...args: unknown[]) => updateMock(...args),
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

import { applyWave11ConfirmedProfileUpdates } from "@/lib/v2-memory-confirmation-sms";

const USER = "user_wave11";
const VALID_ANCHOR =
  "A steadier parent who follows through on small promises every day.";

describe("applyWave11ConfirmedProfileUpdates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMock.mockReturnValue({
      eq: () => Promise.resolve({ error: null }),
    });
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
