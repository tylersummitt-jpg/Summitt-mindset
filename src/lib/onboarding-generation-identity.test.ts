import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { buildIdentityGenerationPromptBlock } from "@/lib/onboarding-identity-templates";

describe("onboarding-generation identity prompt", () => {
  it("includes userWrittenWords in OpenAI prompt assembly", () => {
    const src = fs.readFileSync(path.join(__dirname, "onboarding-generation.ts"), "utf8");
    expect(src).toContain("ctx.userWrittenWords");
    expect(src).toContain("User draft identity words");
    expect(src).toContain("buildIdentityGenerationPromptBlock");
  });

  it("prompt block requires high fidelity to selected chips", () => {
    const block = buildIdentityGenerationPromptBlock({
      preferredName: "Alex",
      ingredientIds: ["dad", "husband", "entrepreneur", "leader", "discipline", "consistency"],
    });
    expect(block).toContain("Do not ignore selected ingredients");
    expect(block).toContain("raw material");
    expect(block).toContain("Include all selected role chips");
    expect(block).toContain("Required role chips: dad, husband, entrepreneur, leader");
    expect(block).toContain("Required trait language: disciplined, consistent");
    expect(block).toContain("Never list private names");
  });

  it("prompt preserves selected chips when user draft words present", () => {
    const block = buildIdentityGenerationPromptBlock({
      preferredName: "Alex",
      ingredientIds: ["dad", "husband", "discipline"],
      userWrittenWords: "trying to be better",
    });
    expect(block).toContain("must not replace or drop selected chips");
  });

  it("does not add My Why or life_desires artifacts", () => {
    const src = fs.readFileSync(path.join(__dirname, "onboarding-generation.ts"), "utf8");
    expect(src).not.toContain("life_desires");
    expect(src).not.toContain("needs_why");
    expect(src).not.toMatch(/\/api\/onboarding\/why/);
  });
});
