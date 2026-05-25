import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { toggleIdentityIngredient } from "@/lib/onboarding-identity-templates";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import IdentityClient, {
  EDIT_GENERATED_OPTION_LABEL,
} from "@/app/onboarding/identity/identity-client";

const BUILDER_SRC = path.join(__dirname, "..", "..", "..", "components", "IdentityBuilderClient.tsx");

function readBuilderSrc(): string {
  return fs.readFileSync(BUILDER_SRC, "utf8");
}

const WRITE_OWN_PLACEHOLDER =
  "I am committed to being a steady presence for my family and a consistent leader for my organization.";
const OLD_PLACEHOLDER = "I am becoming someone who follows through when it matters.";

function renderIdentity(props: React.ComponentProps<typeof IdentityClient> = {}) {
  return renderToStaticMarkup(React.createElement(IdentityClient, props));
}

describe("IdentityClient", () => {
  it("renders name section before My Identity with helper copy", () => {
    const html = renderIdentity();
    const nameHeader = html.indexOf("What should Coach Pat call you?");
    const identityHeader = html.indexOf("My Identity");
    expect(nameHeader).toBeGreaterThanOrEqual(0);
    expect(identityHeader).toBeGreaterThan(nameHeader);
    expect(html).toContain(
      "Use your first name or a nickname. This is how Coach Pat will address you in texts."
    );
    expect(html).toContain(
      "Let&#x27;s build the identity statement Coach Pat will hold you to."
    );
    expect(html).toContain(
      "Choose what matters most right now. Coach Pat will help turn it into one clear line."
    );
    expect(html).toContain("Your first name or nickname");
  });

  it("renders human-facing ingredient chips", () => {
    const html = renderIdentity();
    expect(html).toContain("Select all that apply. Pick a few that fit.");
    expect(html).toContain("Pick up to 6");
    expect(html).toContain("Dad");
    expect(html).toContain("Mom");
    expect(html).toContain("Husband");
    expect(html).toContain("Wife");
    expect(html).toContain("Grandfather");
    expect(html).toContain("Discipline");
    expect(html).not.toContain("Father / Mother / Parent");
    expect(html).not.toContain("Spouse / Partner");
    expect(html).not.toContain("More present");
  });

  it("shows Other field only when Other is selected", () => {
    const withoutOther = renderIdentity({ initialIngredientIds: ["dad"] });
    expect(withoutOther).not.toContain("What would you add?");

    const withOther = renderIdentity({ initialIngredientIds: ["other"] });
    expect(withOther).toContain("What would you add?");
    expect(withOther).toContain("artist, musician, volunteer");
  });

  it("shows conditional important people fields for human-facing chips", () => {
    const dad = renderIdentity({ initialIngredientIds: ["dad"] });
    expect(dad).toContain("Kids&#x27; first names");
    expect(dad).toContain("Child name(s)");

    const husband = renderIdentity({ initialIngredientIds: ["husband"] });
    expect(husband).toContain("Spouse or partner&#x27;s first name");

    const grandfather = renderIdentity({ initialIngredientIds: ["grandfather"] });
    expect(grandfather).toContain("Grandkids&#x27; first names");

    const coach = renderIdentity({ initialIngredientIds: ["coach"] });
    expect(coach).toContain("Who do you lead or serve?");
  });

  it("resumes legacy spouse_partner as spouse category field", () => {
    const html = renderIdentity({ initialIngredientIds: ["spouse_partner"] });
    expect(html).toContain("Spouse or partner&#x27;s first name");
  });

  it("does not show identity textarea or old placeholder on initial render", () => {
    const html = renderIdentity();
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain(OLD_PLACEHOLDER);
    expect(html).not.toContain("After you pick ingredients, generate options or write your own");
    expect(html).not.toContain("Write my own");
    expect(html).not.toContain("Edit my statement");
  });

  it("shows Generate identity statements button disabled until an ingredient is selected", () => {
    const withoutIngredient = renderIdentity();
    expect(withoutIngredient).toContain("Generate identity statements");
    expect(withoutIngredient).toContain("Choose at least one identity ingredient first.");
    expect(withoutIngredient).toMatch(/disabled=""[^>]*>Generate identity statements/);

    const withIngredient = renderIdentity({ initialIngredientIds: ["discipline"] });
    expect(withIngredient).toContain("Generate identity statements");
    expect(withIngredient).not.toMatch(/disabled=""[^>]*>Generate identity statements/);
  });

  it("disables Continue until a final identity is selected", () => {
    const fresh = renderIdentity({
      initialPreferredName: "Alex",
      initialIngredientIds: ["discipline"],
    });
    expect(fresh).toMatch(/disabled=""[^>]*>Continue to My Current Goal/);

    const selected = renderIdentity({
      initialPreferredName: "Alex",
      initialIngredientIds: ["discipline"],
      initialIdentityAnchor: "I am a disciplined dad who follows through.",
    });
    expect(selected).not.toMatch(/disabled=""[^>]*>Continue to My Current Goal/);
  });

  it("shows generated statements with Use this and Edit this below after generation", () => {
    const html = renderIdentity({
      initialPreferredName: "Alex",
      initialIngredientIds: ["discipline"],
      initialGeneratedOptions: [
        "I am becoming a disciplined dad.",
        "I am a dad who keeps his word.",
      ],
    });
    expect(html).toContain("Choose a statement");
    expect(html).toContain("I am becoming a disciplined dad.");
    expect(html).toContain("Use this");
    expect(html).toContain(EDIT_GENERATED_OPTION_LABEL);
    expect(html).toContain('aria-label="Edit this below: I am becoming a disciplined dad."');
    expect(html).not.toContain(">Edit this</button>");
    expect(html).toContain("Generate more");
    expect(html).toContain("Write my own");
    expect(html).not.toContain("<textarea");
  });

  it("highlights selected generated statement and enables Continue", () => {
    const option = "I am becoming a disciplined dad.";
    const html = renderIdentity({
      initialPreferredName: "Alex",
      initialIngredientIds: ["discipline"],
      initialGeneratedOptions: [option],
      initialIdentityAnchor: option,
    });
    expect(html).toContain('border-2 border-[var(--brand)]');
    expect(html).not.toMatch(/disabled=""[^>]*>Continue to My Current Goal/);
  });

  it("opens edit textarea below when Edit this below is used", () => {
    const option = "I am becoming a disciplined dad.";
    const html = renderIdentity({
      initialPreferredName: "Alex",
      initialIngredientIds: ["discipline"],
      initialGeneratedOptions: [option],
      initialIdentityAnchor: option,
      initialEditorMode: "edit",
    });
    expect(html).toContain("<textarea");
    expect(html).toContain("Edit your statement");
    expect(html).toContain('aria-label="Edit your identity statement below"');
    expect(html).toContain(option);
  });

  it("scrolls and focuses edit textarea after Edit this below", () => {
    const src = readBuilderSrc();
    expect(src).toContain("pendingGeneratedEditorFocus");
    expect(src).toContain("scrollIntoView");
    expect(src).toContain("identityEditorRef");
    expect(src).not.toContain("life_desires");
    expect(src).not.toContain("needs_why");
  });

  it("shows Write my own textarea with stronger placeholder only in write-own mode", () => {
    const html = renderIdentity({
      initialPreferredName: "Alex",
      initialIngredientIds: ["discipline"],
      initialGeneratedOptions: ["I am becoming a disciplined dad."],
      initialEditorMode: "write-own",
    });
    expect(html).toContain("Write your identity statement");
    expect(html).toContain(WRITE_OWN_PLACEHOLDER);
    expect(html).not.toContain(OLD_PLACEHOLDER);
  });

  it("resumes saved identity without forcing regeneration", () => {
    const saved = "I am a steady husband and disciplined dad.";
    const html = renderIdentity({
      initialPreferredName: "Alex",
      initialIdentityAnchor: saved,
      initialIngredientIds: ["dad", "husband"],
    });
    expect(html).toContain(saved);
    expect(html).toContain("Generate more");
    expect(html).toContain("Edit this");
    expect(html).not.toContain("Generate identity statements");
    expect(html).not.toMatch(/disabled=""[^>]*>Continue to My Current Goal/);
  });

  it("includes user_written_words on resume only in generate request payload", () => {
    const src = readBuilderSrc();
    expect(src).toContain("user_written_words");
    expect(src).toContain("resumeIdentity");
    expect(src).not.toContain("life_desires");
    expect(src).not.toContain("needs_why");
  });

  it("keeps parent-group mutual exclusion in toggle logic", () => {
    let selected = toggleIdentityIngredient([], "dad").next;
    selected = toggleIdentityIngredient(selected, "mom").next;
    expect(selected).toEqual(["mom"]);
  });

  it("reveals generation-failure escape copy and Write my own when generation fails", () => {
    const html = renderIdentity({
      initialPreferredName: "Alex",
      initialIngredientIds: ["discipline"],
      initialGenerationFailed: true,
    });
    expect(html).toContain("Coach Pat couldn&#x27;t generate options right now");
    expect(html).toContain("Write my own");
    expect(html).toContain("Generate identity statements");
    expect(html).not.toContain("text-red-600");
    expect(html).not.toContain("OpenAI");
  });

  it("opens write-own textarea with stronger placeholder after generation failure", () => {
    const html = renderIdentity({
      initialPreferredName: "Alex",
      initialIngredientIds: ["discipline"],
      initialGenerationFailed: true,
      initialEditorMode: "write-own",
    });
    expect(html).toContain("Write your identity statement");
    expect(html).toContain(WRITE_OWN_PLACEHOLDER);
  });

  it("enables Continue after valid write-own text following generation failure", () => {
    const html = renderIdentity({
      initialPreferredName: "Alex",
      initialIngredientIds: ["discipline"],
      initialGenerationFailed: true,
      initialEditorMode: "write-own",
      initialIdentityAnchor: "I am a disciplined dad who follows through every day.",
    });
    expect(html).not.toMatch(/disabled=""[^>]*>Continue to My Current Goal/);
  });

  it("handles generation failure without technical error copy in source", () => {
    const src = readBuilderSrc();
    expect(src).toContain("markGenerationFailed");
    expect(src).toContain("GENERATION_FAILURE_ESCAPE_MESSAGE");
    expect(src).not.toMatch(/setError\([^)]*Could not generate options/);
    expect(src).not.toContain("OpenAI");
  });

  it("preserves weak identity Use mine anyway path after write-own", () => {
    const src = readBuilderSrc();
    expect(src).toContain("isGenericWeakIdentityAnchor");
    expect(src).toContain("Use mine anyway");
    expect(src).toContain("setShowWeakPanel(true)");
  });
});
