import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authMock,
  getActiveCommitmentMock,
  clearExpiredMock,
  clearPendingMock,
  getPendingMock,
  persistGuidedMock,
  recomputeMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  getActiveCommitmentMock: vi.fn(),
  clearExpiredMock: vi.fn(),
  clearPendingMock: vi.fn(),
  getPendingMock: vi.fn(),
  persistGuidedMock: vi.fn(),
  recomputeMock: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/v2-commitment", () => ({
  getActiveCommitment: (...args: unknown[]) => getActiveCommitmentMock(...args),
}));

vi.mock("@/lib/v2-guided-resolution", () => ({
  clearPendingResolutionIfExpired: (...args: unknown[]) => clearExpiredMock(...args),
  clearPendingResolution: (...args: unknown[]) => clearPendingMock(...args),
  getPendingResolutionOrNull: (...args: unknown[]) => getPendingMock(...args),
}));

vi.mock("@/lib/v2-coaching-memory", () => ({
  recomputeV2CoachingMemory: (...args: unknown[]) => recomputeMock(...args),
}));

vi.mock("@/lib/v2-persist-identity-edit", () => ({
  persistGuidedIdentityAnchorEdit: (...args: unknown[]) => persistGuidedMock(...args),
}));

function baseCommitment() {
  return {
    id: "cmt_1",
    accountability_phase: "active_accountability",
    pending_resolution_kind: "identity_anchor_update",
  };
}

const validAnchor =
  "A steadier parent who follows through on small promises every day.";

describe("POST /api/v2/guided-resolution/identity", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_1" });
    getActiveCommitmentMock.mockResolvedValue(baseCommitment());
    clearExpiredMock.mockResolvedValue(undefined);
    getPendingMock.mockReturnValue({
      kind: "identity_anchor_update",
      createdAt: "2026-05-10T12:00:00.000Z",
      expiresAt: "2027-05-10T12:00:00.000Z",
      payload: { source: "coaching_refresh_resolved" },
    });
    persistGuidedMock.mockResolvedValue({
      ok: true,
      versionId: "ver_new",
      identityAnchorText: validAnchor,
    });
    clearPendingMock.mockResolvedValue(undefined);
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/guided-resolution/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity_anchor_text: validAnchor }),
      })
    );
    expect(res.status).toBe(401);
    expect(persistGuidedMock).not.toHaveBeenCalled();
  });

  it("returns 409 when no pending identity update", async () => {
    getPendingMock.mockReturnValue(null);
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/guided-resolution/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity_anchor_text: validAnchor }),
      })
    );
    expect(res.status).toBe(409);
    expect(persistGuidedMock).not.toHaveBeenCalled();
  });

  it("blocks unsafe identity anchor before persist", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/guided-resolution/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity_anchor_text: "I want to kill myself" }),
      })
    );
    expect(res.status).toBe(400);
    expect(persistGuidedMock).not.toHaveBeenCalled();
  });

  it("uses versioned persist helper and clears pending on success", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/guided-resolution/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity_anchor_text: validAnchor }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.versionId).toBe("ver_new");
    expect(persistGuidedMock).toHaveBeenCalledWith({
      clerkUserId: "user_1",
      identityAnchorText: validAnchor,
    });
    expect(clearPendingMock).toHaveBeenCalledWith("cmt_1");
  });

  it("returns 409 identity_setup_incomplete when no active version exists", async () => {
    persistGuidedMock.mockResolvedValue({
      ok: false,
      error:
        "Your identity setup is incomplete. Use Edit identity in Victory Room to update your identity.",
      code: "identity_setup_incomplete",
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/guided-resolution/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity_anchor_text: validAnchor }),
      })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("identity_setup_incomplete");
    expect(clearPendingMock).not.toHaveBeenCalled();
  });

  it("clears pending and recomputes coaching memory when low-pressure blocked", async () => {
    getActiveCommitmentMock.mockResolvedValue({
      ...baseCommitment(),
      accountability_phase: "low_pressure_reactivation",
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/guided-resolution/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity_anchor_text: validAnchor }),
      })
    );
    expect(res.status).toBe(409);
    expect(persistGuidedMock).not.toHaveBeenCalled();
    expect(clearPendingMock).toHaveBeenCalledWith("cmt_1");
    expect(recomputeMock).toHaveBeenCalledWith("cmt_1", {
      reasonCode: "guided_resolution_identity_paused_blocked",
    });
  });
});
