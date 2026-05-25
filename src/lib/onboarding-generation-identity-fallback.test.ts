import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildDeterministicIdentityOptions } from "@/lib/onboarding-identity-templates";

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
  sanitizeModelOutput: vi.fn(),
}));

describe("generateIdentityOptions server fallback", () => {
  const originalApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.resetModules();
    chatCreateMock.mockReset();
    process.env.OPENAI_API_KEY = "sk-test";
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  it("returns deterministic options when OpenAI throws", async () => {
    chatCreateMock.mockRejectedValue(new Error("OpenAI unavailable"));

    const { generateIdentityOptions } = await import("@/lib/onboarding-generation");
    const ctx = {
      preferredName: "Alex",
      ingredientIds: ["dad", "discipline"],
    };
    const result = await generateIdentityOptions(ctx);
    const expected = buildDeterministicIdentityOptions(ctx);

    expect(result.length).toBeGreaterThan(0);
    expect(result).toEqual(expected);
  });

  it("returns deterministic options when OpenAI API key is missing", async () => {
    delete process.env.OPENAI_API_KEY;

    const { generateIdentityOptions } = await import("@/lib/onboarding-generation");
    const ctx = {
      preferredName: "Alex",
      ingredientIds: ["dad", "husband", "discipline"],
    };
    const result = await generateIdentityOptions(ctx);
    const expected = buildDeterministicIdentityOptions(ctx);

    expect(result.length).toBeGreaterThan(0);
    expect(result).toEqual(expected);
    expect(chatCreateMock).not.toHaveBeenCalled();
  });
});
