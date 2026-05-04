import { describe, expect, it, vi, beforeEach } from "vitest";

const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

const getClerkPublicMetadataMock = vi.fn();
vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: (...args: unknown[]) => getClerkPublicMetadataMock(...args),
}));

vi.mock("@/lib/v2-identity-anchor", () => ({
  computeIdentityRefreshDueAtIsoFromNow: () => "2099-01-01T00:00:00.000Z",
}));

const maybeSingleMock = vi.fn();
const upsertMock = vi.fn();
const fromMock = vi.fn(() => ({
  select: () => ({
    eq: () => ({
      maybeSingle: maybeSingleMock,
    }),
  }),
  upsert: upsertMock,
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: fromMock,
  },
}));

describe("POST /api/onboarding/identity", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ userId: "user_2abc" });
    getClerkPublicMetadataMock.mockResolvedValue({ onboardingCompleted: false });
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    upsertMock.mockResolvedValue({ error: null });
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
    const j = (await res.json()) as { error?: string };
    expect(j.error).toContain("session");
  });

  it("returns safe user-facing error on Supabase upsert failure", async () => {
    upsertMock.mockResolvedValue({
      error: { message: "fake", code: "23505", details: "", hint: "" },
    });
    const { POST } = await import("./route");
    const body = {
      preferred_name: "Alex",
      people_summary: "My family needs me present.",
      responsibility: "Two kids under ten; evenings are when I want to show up.",
      identity_anchor_text:
        "A steadier parent who follows through on small promises every day.",
    };
    const res = await POST(
      new Request("http://localhost/api/onboarding/identity", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(500);
    const j = (await res.json()) as { error?: string };
    expect(j.error).toContain("save this step");
    expect(j.error).not.toContain("23505");
    expect(j.error).not.toContain("fake");
  });

  it("preserves validation error for missing preferred name", async () => {
    const { POST } = await import("./route");
    const body = {
      preferred_name: "",
      people_summary: "My family",
      responsibility: "Context here",
      identity_anchor_text: "Someone who shows up with consistency and calm.",
    };
    const res = await POST(
      new Request("http://localhost/api/onboarding/identity", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    const j = (await res.json()) as { error?: string };
    expect(j.error).toContain("Coach Pat");
  });
});
