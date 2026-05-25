import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const getClerkPublicMetadataMock = vi.fn();
const getActiveCommitmentMock = vi.fn();
const persistMock = vi.fn();
const loadDraftMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: (...args: unknown[]) => getClerkPublicMetadataMock(...args),
}));

vi.mock("@/lib/v2-commitment", () => ({
  getActiveCommitment: (...args: unknown[]) => getActiveCommitmentMock(...args),
}));

vi.mock("@/lib/v2-guided-resolution", () => ({
  getPendingResolutionOrNull: vi.fn(() => null),
  isSmsInboundPendingResolutionActionable: vi.fn(() => false),
}));

vi.mock("@/lib/load-identity-edit-draft", () => ({
  loadIdentityEditDraft: (...args: unknown[]) => loadDraftMock(...args),
}));

vi.mock("@/lib/v2-persist-identity-edit", () => ({
  persistAppIdentityEdit: (...args: unknown[]) => persistMock(...args),
}));

vi.mock("@/lib/onboarding-persist-identity", () => ({
  parseImportantPeopleFromBody: vi.fn(() => []),
}));

const validBody = {
  preferred_name: "Alex",
  identity_anchor_text: "A steadier parent who follows through on small promises every day.",
};

function baseCommitment() {
  return {
    id: "cmt_1",
    accountability_phase: "active_accountability",
  };
}

describe("POST /api/v2/identity/edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_1" });
    getClerkPublicMetadataMock.mockResolvedValue({ onboardingCompleted: true });
    getActiveCommitmentMock.mockResolvedValue(baseCommitment());
    loadDraftMock.mockResolvedValue({
      activeIdentityVersionId: null,
      preferredName: "Alex",
      identityAnchorText: null,
      ingredientIds: [],
      otherText: null,
      intakeOrigin: null,
      useMineAnyway: false,
      clarityScore: null,
      importantPeople: [],
    });
    persistMock.mockResolvedValue({
      ok: true,
      versionId: "ver_new",
      identityAnchorText: validBody.identity_anchor_text,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/identity/edit", {
        method: "POST",
        body: JSON.stringify(validBody),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(401);
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("returns 403 when onboarding incomplete", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({ onboardingCompleted: false });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/identity/edit", {
        method: "POST",
        body: JSON.stringify(validBody),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(403);
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("returns 400 for unsafe identity anchor", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/identity/edit", {
        method: "POST",
        body: JSON.stringify({
          preferred_name: "Alex",
          identity_anchor_text: "I want to kill myself",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("returns 409 on version conflict from persist helper", async () => {
    persistMock.mockResolvedValue({
      ok: false,
      error: "Your identity was updated elsewhere. Refresh and try again.",
      code: "version_conflict",
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/identity/edit", {
        method: "POST",
        body: JSON.stringify({
          ...validBody,
          expected_active_version_id: "ver_old",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(409);
  });

  it("returns 409 when active version exists but expected_active_version_id is missing", async () => {
    loadDraftMock.mockResolvedValue({
      activeIdentityVersionId: "ver_old",
      preferredName: "Alex",
      identityAnchorText: "Old anchor",
      ingredientIds: ["dad"],
      otherText: null,
      intakeOrigin: "generated",
      useMineAnyway: false,
      clarityScore: 80,
      importantPeople: [],
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/identity/edit", {
        method: "POST",
        body: JSON.stringify(validBody),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("missing_expected_version");
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("persists and returns ok payload on success", async () => {
    loadDraftMock.mockResolvedValue({
      activeIdentityVersionId: "ver_old",
      preferredName: "Alex",
      identityAnchorText: "Old anchor",
      ingredientIds: ["dad"],
      otherText: null,
      intakeOrigin: "generated",
      useMineAnyway: false,
      clarityScore: 80,
      importantPeople: [],
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/identity/edit", {
        method: "POST",
        body: JSON.stringify({
          ...validBody,
          expected_active_version_id: "ver_old",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.versionId).toBe("ver_new");
    expect(persistMock).toHaveBeenCalled();
  });

  it("returns 409 during low_pressure_reactivation", async () => {
    getActiveCommitmentMock.mockResolvedValue({
      id: "cmt_1",
      accountability_phase: "low_pressure_reactivation",
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/identity/edit", {
        method: "POST",
        body: JSON.stringify(validBody),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(409);
    expect(persistMock).not.toHaveBeenCalled();
  });
});
