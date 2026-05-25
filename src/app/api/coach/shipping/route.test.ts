import { describe, expect, it, vi, beforeEach } from "vitest";

const authMock = vi.fn();
const currentUserMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  currentUser: () => currentUserMock(),
}));

const getClerkPublicMetadataMock = vi.fn();
const updateClerkPublicMetadataMock = vi.fn();

vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: (...args: unknown[]) =>
    getClerkPublicMetadataMock(...args),
}));

vi.mock("@/lib/clerk-public-metadata", () => ({
  updateClerkPublicMetadata: (...args: unknown[]) =>
    updateClerkPublicMetadataMock(...args),
}));

const upsertMock = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      upsert: (...args: unknown[]) => upsertMock(...args),
    }),
  },
}));

vi.mock("@/lib/notify-coach-kit", () => ({
  notifyCoachKitSubmitted: vi.fn().mockResolvedValue(undefined),
}));

const validBody = {
  full_name: "Pat Coach",
  address_line_1: "123 Main St",
  city: "Knoxville",
  state: "TN",
  postal_code: "37901",
  country: "USA",
};

describe("POST /api/coach/shipping", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_coach" });
    currentUserMock.mockResolvedValue({
      emailAddresses: [{ emailAddress: "coach@example.com" }],
    });
    getClerkPublicMetadataMock.mockResolvedValue({
      acquisitionSource: "coach",
      summittSubscribed: true,
      onboardingCompleted: true,
      coachAddressCollected: false,
    });
    upsertMock.mockResolvedValue({ error: null });
    updateClerkPublicMetadataMock.mockResolvedValue(undefined);
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/coach/shipping", {
        method: "POST",
        body: JSON.stringify(validBody),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when onboarding is not complete", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      acquisitionSource: "coach",
      summittSubscribed: true,
      onboardingCompleted: false,
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/coach/shipping", {
        method: "POST",
        body: JSON.stringify(validBody),
      })
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      ok: false,
      error: "Finish onboarding before submitting Kit shipping.",
    });
  });

  it("returns 403 when user is not coach-attributed", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      acquisitionSource: "organic",
      summittSubscribed: true,
      onboardingCompleted: true,
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/coach/shipping", {
        method: "POST",
        body: JSON.stringify(validBody),
      })
    );
    expect(res.status).toBe(403);
  });

  it("accepts valid completed coach shipping submission", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/coach/shipping", {
        method: "POST",
        body: JSON.stringify(validBody),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(upsertMock).toHaveBeenCalled();
    expect(updateClerkPublicMetadataMock).toHaveBeenCalledWith("user_coach", {
      coachAddressCollected: true,
    });
  });
});
