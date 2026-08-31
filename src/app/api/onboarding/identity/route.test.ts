import { describe, expect, it, vi, beforeEach } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

const getClerkPublicMetadataMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: (...args: unknown[]) => getClerkPublicMetadataMock(...args),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

const persistMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/onboarding-persist-identity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/onboarding-persist-identity")>(
    "@/lib/onboarding-persist-identity"
  );
  return {
    ...actual,
    persistOnboardingIdentity: (...args: unknown[]) => persistMock(...args),
  };
});

const clearReviewAckMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/onboarding-reset-review-ack", () => ({
  clearProposedCommitmentReviewAcknowledgment: (...args: unknown[]) =>
    clearReviewAckMock(...args),
}));

const validBody = {
  preferred_name: "Alex",
  identity_anchor_text:
    "A steadier parent who follows through on small promises every day.",
};

describe("POST /api/onboarding/identity", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ userId: "user_2abc" });
    getClerkPublicMetadataMock.mockResolvedValue({ onboardingCompleted: false });
    persistMock.mockResolvedValue({ ok: true, versionId: "ver_1" });
    clearReviewAckMock.mockResolvedValue(undefined);
  });

  it("returns session-safe error when unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/identity", {
        method: "POST",
        body: "{}",
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Your session expired. Please sign in again.",
    });
    expect(persistMock).not.toHaveBeenCalled();
    expect(clearReviewAckMock).not.toHaveBeenCalled();
  });

  it("persists ingredient_ids and important_people on save", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/identity", {
        method: "POST",
        body: JSON.stringify({
          ...validBody,
          ingredient_ids: ["parent", "discipline", "other"],
          other_text: "builder",
          important_people: [{ display_name: "Sam", relationship_type: "child" }],
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      versionId: "ver_1",
      identity_anchor_text: validBody.identity_anchor_text,
    });
    expect(persistMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ingredientIds: ["parent", "discipline", "other"],
        otherText: "builder",
        importantPeople: [{ display_name: "Sam", relationship_type: "child" }],
        identityAnchorText: validBody.identity_anchor_text,
      })
    );
    expect(clearReviewAckMock).toHaveBeenCalledWith("user_2abc");
  });

  it("does not require people_summary", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/identity", {
        method: "POST",
        body: JSON.stringify(validBody),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      versionId: "ver_1",
      identity_anchor_text: validBody.identity_anchor_text,
    });
    expect(persistMock).toHaveBeenCalled();
    expect(clearReviewAckMock).toHaveBeenCalledWith("user_2abc");
  });

  it("preserves validation error for missing preferred name", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/identity", {
        method: "POST",
        body: JSON.stringify({
          preferred_name: "",
          identity_anchor_text: "Someone who shows up with consistency and calm.",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Add what Coach Pat should call you.");
    expect(persistMock).not.toHaveBeenCalled();
    expect(clearReviewAckMock).not.toHaveBeenCalled();
  });

  it("returns 403 for completed users with edit-identity redirect message", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({ onboardingCompleted: true });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/identity", {
        method: "POST",
        body: JSON.stringify(validBody),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Use Edit identity in Victory Room to update your identity.");
    expect(persistMock).not.toHaveBeenCalled();
    expect(clearReviewAckMock).not.toHaveBeenCalled();
  });

  it("still succeeds when clear review ack is a no-op (no proposed commitment)", async () => {
    clearReviewAckMock.mockResolvedValue(undefined);
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/identity", {
        method: "POST",
        body: JSON.stringify(validBody),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      versionId: "ver_1",
      identity_anchor_text: validBody.identity_anchor_text,
    });
    expect(clearReviewAckMock).toHaveBeenCalledTimes(1);
  });

  it("blocks unsafe other_text when Other is selected", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/identity", {
        method: "POST",
        body: JSON.stringify({
          ...validBody,
          ingredient_ids: ["other"],
          other_text: "I want to kill myself",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    expect(persistMock).not.toHaveBeenCalled();
    expect(clearReviewAckMock).not.toHaveBeenCalled();
  });

  it("accepts safe vague other_text when Other is selected", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/identity", {
        method: "POST",
        body: JSON.stringify({
          ...validBody,
          ingredient_ids: ["other"],
          other_text: "artist",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      versionId: "ver_1",
      identity_anchor_text: validBody.identity_anchor_text,
    });
    expect(persistMock).toHaveBeenCalledWith(
      expect.objectContaining({
        otherText: "artist",
      })
    );
  });

  it("blocks unsafe identity anchor text on save", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/identity", {
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
    expect(clearReviewAckMock).not.toHaveBeenCalled();
  });

  it("allows weak identity anchor when use_mine_anyway is set", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/identity", {
        method: "POST",
        body: JSON.stringify({
          preferred_name: "Alex",
          identity_anchor_text: "I am becoming the best me I can be.",
          intake_weak_accept: true,
          use_mine_anyway: true,
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      versionId: "ver_1",
      identity_anchor_text: "I am becoming the best me I can be.",
    });
    expect(persistMock).toHaveBeenCalled();
  });

  it("returns the normalized persisted identity_anchor_text on success", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/identity", {
        method: "POST",
        body: JSON.stringify({
          preferred_name: "  Alex  ",
          identity_anchor_text:
            "  A steadier parent who follows through on small promises every day.  ",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    expect(persistMock).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredName: "Alex",
        identityAnchorText: validBody.identity_anchor_text,
      })
    );
    expect(await res.json()).toEqual({
      ok: true,
      versionId: "ver_1",
      identity_anchor_text: validBody.identity_anchor_text,
    });
  });

  it("returns 500 persist error without treating save as success", async () => {
    persistMock.mockResolvedValue({
      ok: false,
      error: "We couldn’t save this step. Please try again.",
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/identity", {
        method: "POST",
        body: JSON.stringify(validBody),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "We couldn’t save this step. Please try again.",
    });
    expect(clearReviewAckMock).not.toHaveBeenCalled();
  });
});
