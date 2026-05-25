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
  supabaseServer: {
    from: vi.fn(),
  },
}));

describe("POST /api/onboarding/commitment", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_1" });
    getClerkPublicMetadataMock.mockResolvedValue({ onboardingCompleted: false });
  });

  it("returns 403 for completed users before writing proposed commitment", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({ onboardingCompleted: true });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/commitment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commitment_title: "Walk",
          behavior_statement: "I will walk ten minutes each morning before coffee.",
          selected_area_id: "walking_health",
        }),
      })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("already completed");
  });
});
