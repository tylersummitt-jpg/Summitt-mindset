import { describe, expect, it, vi, beforeEach } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

vi.mock("@/lib/onboarding-persist-identity", () => ({
  parseImportantPeopleFromBody: () => [],
}));

const generateMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/onboarding-generation", () => ({
  generateIdentityOptions: (...args: unknown[]) => generateMock(...args),
}));

describe("POST /api/onboarding/generate-identity-options", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ userId: "user_1" });
    generateMock.mockResolvedValue(["I am becoming a disciplined version of myself."]);
  });

  it("passes user_written_words into generation context", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/generate-identity-options", {
        method: "POST",
        body: JSON.stringify({
          preferred_name: "Alex",
          ingredient_ids: ["dad"],
          user_written_words: "I am trying to be more present at home",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredName: "Alex",
        ingredientIds: ["dad"],
        userWrittenWords: "I am trying to be more present at home",
      })
    );
  });

  it("accepts draft_identity_text alias", async () => {
    const { POST } = await import("./route");
    await POST(
      new Request("http://localhost/api/onboarding/generate-identity-options", {
        method: "POST",
        body: JSON.stringify({
          preferred_name: "Alex",
          ingredient_ids: ["parent"],
          draft_identity_text: "becoming a steadier dad",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userWrittenWords: "becoming a steadier dad",
      })
    );
  });

  it("returns deterministic options when generation succeeds", async () => {
    generateMock.mockResolvedValue([
      "I am becoming a disciplined dad.",
      "I am a dad who keeps his word and follows through.",
    ]);
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/generate-identity-options", {
        method: "POST",
        body: JSON.stringify({
          preferred_name: "Alex",
          ingredient_ids: ["dad"],
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.options).toHaveLength(2);
  });

  it("returns safe 503 when generation yields no valid options", async () => {
    generateMock.mockResolvedValue([]);
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/generate-identity-options", {
        method: "POST",
        body: JSON.stringify({
          preferred_name: "Alex",
          ingredient_ids: ["dad"],
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toContain("Could not generate identity options");
  });

  it("returns safe 503 when generation throws", async () => {
    generateMock.mockRejectedValue(new Error("unexpected"));
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/generate-identity-options", {
        method: "POST",
        body: JSON.stringify({
          preferred_name: "Alex",
          ingredient_ids: ["dad"],
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toContain("Could not generate identity options");
  });
});
