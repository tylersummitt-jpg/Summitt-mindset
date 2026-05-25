import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const chatCreateMock = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({
  default: class OpenAI {
    chat = { completions: { create: chatCreateMock } };
  },
}));

vi.mock("@/lib/ai-safety", () => ({
  PAT_BRAND_SAFETY_RULES: "rules",
  assertTextSafeForBrand: vi.fn().mockResolvedValue({ ok: true }),
  sanitizeModelOutput: vi.fn(async (_client: unknown, text: string) => text),
}));

describe("generateGoalOptions fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    chatCreateMock.mockRejectedValue(new Error("OpenAI unavailable"));
    process.env.OPENAI_API_KEY = "sk-test";
  });

  it("returns valid SMS-checkable deterministic goals when OpenAI fails", async () => {
    const { generateGoalOptions } = await import("@/lib/onboarding-generation");
    const options = await generateGoalOptions("parenting", {
      identityAnchor: "I am a disciplined dad and steady husband.",
      ingredientIds: ["dad", "husband"],
    });
    expect(options.length).toBe(5);
    for (const goal of options) {
      expect(goal.behaviorStatement).toMatch(/^I will/i);
      expect(goal.behaviorStatement.toLowerCase()).not.toContain(
        "matches who i am becoming"
      );
    }
  });
});

describe("generateGoalOptions prompt personalization", () => {
  beforeEach(() => {
    vi.resetModules();
    chatCreateMock.mockResolvedValue({
      choices: [{ message: { content: '{"goals":[]}' } }],
    });
    process.env.OPENAI_API_KEY = "sk-test";
  });

  it("includes resolved relationship terms and excludes private names", async () => {
    const { generateGoalOptions } = await import("@/lib/onboarding-generation");
    await generateGoalOptions("relationship", {
      identityAnchor: "I am a steady husband.",
      ingredientIds: ["husband"],
      importantPeople: [
        { relationship_type: "spouse_partner" },
        { relationship_type: "child" },
      ],
    });

    const prompt = chatCreateMock.mock.calls[0]?.[0]?.messages?.[0]?.content as string;
    expect(prompt).toContain("my wife");
    expect(prompt).toContain("Do not include private names");
    expect(prompt).not.toContain("display_name");
  });
});
