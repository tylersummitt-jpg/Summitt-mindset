import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

const getClerkPublicMetadataMock = vi.fn();
vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: (...args: unknown[]) => getClerkPublicMetadataMock(...args),
}));

const fromMock = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: (...args: unknown[]) => fromMock(...args) },
}));

describe("POST /api/onboarding/review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_1" });
    getClerkPublicMetadataMock.mockResolvedValue({ onboardingCompleted: false });
  });

  it("sets review_acknowledged_at on intake", async () => {
    const updateMock = vi.fn().mockReturnValue({
      eq: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    });

    fromMock.mockImplementation((table: string) => {
      if (table === "v2_commitment") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () => Promise.resolve({ data: { id: "c1" } }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "v2_commitment_intake") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { commitment_id: "c1", review_acknowledged_at: null },
                  }),
              }),
            }),
          }),
          update: updateMock,
        };
      }
      return {};
    });

    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalled();
    const payload = updateMock.mock.calls[0][0];
    expect(payload.review_acknowledged_at).toBeTruthy();
  });

  it("no-ops for completed users", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({ onboardingCompleted: true });
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(200);
    expect(fromMock).not.toHaveBeenCalled();
  });
});
