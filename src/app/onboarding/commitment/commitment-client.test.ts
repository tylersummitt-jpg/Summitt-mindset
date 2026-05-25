import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import CommitmentClient from "@/app/onboarding/commitment/commitment-client";

const IDENTITY =
  "I am a disciplined dad, steady husband, and consistent business leader.";

const RECOMMENDED_TITLE = "Be present after work";
const RECOMMENDED_BEHAVIOR =
  "I will put my phone away for the first 30 minutes after I get home.";

const CONTINUE_DISABLED = /disabled=""[^>]*>Continue to Review/;

function renderCommitment(
  props: React.ComponentProps<typeof CommitmentClient> = {}
) {
  return renderToStaticMarkup(React.createElement(CommitmentClient, props));
}

function expectContinueDisabled(html: string) {
  expect(html).toMatch(CONTINUE_DISABLED);
}

function expectContinueEnabled(html: string) {
  expect(html).toContain("Continue to Review →");
  expect(html).not.toMatch(CONTINUE_DISABLED);
}

describe("CommitmentClient", () => {
  it("shows focus areas with Something else and Show more", () => {
    const html = renderCommitment({ identityAnchor: IDENTITY });
    expect(html).toContain("Choose one focus area");
    expect(html).toContain("Something else");
    expect(html).toContain("Show more");
    expect(html).toContain("Parenting");
    expect(html).not.toContain("My Identity");
  });

  it("uses strong write-your-own placeholders", () => {
    const html = renderCommitment({ identityAnchor: IDENTITY });
    expect(html).toContain("Be present after work");
    expect(html).toContain(
      "I will put my phone away for the first 30 minutes after I get home."
    );
  });

  it("shows Make it your own section with helper copy", () => {
    const html = renderCommitment({ identityAnchor: IDENTITY });
    expect(html).toContain("Make it your own");
    expect(html).toContain(
      "Coach Pat will text you about this goal. You can use the recommendation as-is or tweak it so it sounds exactly right."
    );
    expect(html).not.toContain("Or write your own");
  });

  it("uses Make it your own language in generate-more failure copy", () => {
    const clientSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/GoalBuilderClient.tsx"),
      "utf8"
    );
    expect(clientSrc).toContain(
      "Could not generate more options right now. Pick a recommendation or make it your own."
    );
    expect(clientSrc).not.toContain(
      "Pick a recommendation or write your own."
    );
  });

  it("does not render internal template metadata", () => {
    const html = renderCommitment({
      identityAnchor: IDENTITY,
      initialSelectedAreaId: "parenting",
      initialTitle: RECOMMENDED_TITLE,
      initialBehaviorStatement: RECOMMENDED_BEHAVIOR,
    });
    const clientSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/GoalBuilderClient.tsx"),
      "utf8"
    );
    expect(html).not.toContain("Based on template");
    expect(html).not.toContain("parenting_evening_checkin");
    expect(clientSrc).toContain("selectedTemplateId");
    expect(clientSrc).toContain("selected_template_id");
  });

  it("personalizes recommended goals from identity context", () => {
    const html = renderCommitment({
      identityAnchor: IDENTITY,
      initialSelectedAreaId: "relationship",
      personalizationContext: {
        ingredientIds: ["husband"],
      },
    });
    expect(html).toContain("my wife");
    expect(html).not.toContain("my spouse or partner");
  });

  it("page renders My Identity above My Current Goal header", () => {
    const pageSrc = fs.readFileSync(
      path.join(__dirname, "page.tsx"),
      "utf8"
    );
    const identityIdx = pageSrc.indexOf("My Identity");
    const goalIdx = pageSrc.indexOf("My Current Goal");
    expect(identityIdx).toBeGreaterThanOrEqual(0);
    expect(goalIdx).toBeGreaterThan(identityIdx);
    expect(pageSrc).toContain("Pick a goal Coach Pat can check regularly");
  });

  it("does not add My Why or life_desires artifacts", () => {
    const clientSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/GoalBuilderClient.tsx"),
      "utf8"
    );
    expect(clientSrc).not.toContain("life_desires");
    expect(clientSrc).not.toContain("needs_why");
    expect(clientSrc).not.toContain("/api/onboarding/why");
    expect(clientSrc).not.toContain("Twilio");
  });

  it("disables Continue initially", () => {
    const html = renderCommitment({ identityAnchor: IDENTITY });
    expectContinueDisabled(html);
  });

  it("keeps Continue disabled after selecting focus area only", () => {
    const html = renderCommitment({
      identityAnchor: IDENTITY,
      initialSelectedAreaId: "parenting",
    });
    expectContinueDisabled(html);
  });

  it("enables Continue after selecting a recommended goal", () => {
    const html = renderCommitment({
      identityAnchor: IDENTITY,
      initialSelectedAreaId: "parenting",
      initialTitle: RECOMMENDED_TITLE,
      initialBehaviorStatement: RECOMMENDED_BEHAVIOR,
    });
    expectContinueEnabled(html);
    expect(html).toContain('border-2 border-[var(--brand)]');
  });

  it("enables Continue after writing title and behavior", () => {
    const html = renderCommitment({
      identityAnchor: IDENTITY,
      initialSelectedAreaId: "discipline",
      initialTitle: "Follow through today",
      initialBehaviorStatement:
        "I will do the one commitment I already told myself I would do today.",
    });
    expectContinueEnabled(html);
  });

  it("disables Continue when title is cleared", () => {
    const html = renderCommitment({
      identityAnchor: IDENTITY,
      initialSelectedAreaId: "parenting",
      initialTitle: "",
      initialBehaviorStatement: RECOMMENDED_BEHAVIOR,
    });
    expectContinueDisabled(html);
  });

  it("disables Continue when behavior is cleared", () => {
    const html = renderCommitment({
      identityAnchor: IDENTITY,
      initialSelectedAreaId: "parenting",
      initialTitle: RECOMMENDED_TITLE,
      initialBehaviorStatement: "",
    });
    expectContinueDisabled(html);
  });

  it("keeps weak/warn Use mine anyway path with Continue gated on acceptance", () => {
    const warn =
      "Make this more specific. Write the actual behavior Coach Pat should check on.";

    const blocked = renderCommitment({
      identityAnchor: IDENTITY,
      initialSelectedAreaId: "something_else",
      initialTitle: "Stay consistent",
      initialBehaviorStatement: "be disciplined",
      initialWarnMessage: warn,
      initialWeakAccept: false,
    });
    expectContinueDisabled(blocked);
    expect(blocked).toContain("Use mine anyway");

    const accepted = renderCommitment({
      identityAnchor: IDENTITY,
      initialSelectedAreaId: "something_else",
      initialTitle: "Stay consistent",
      initialBehaviorStatement: "be disciplined",
      initialWarnMessage: warn,
      initialWeakAccept: true,
    });
    expectContinueEnabled(accepted);
    expect(accepted).toContain("Use mine anyway");
  });

  it("gates Continue on trimmed title and behavior text", () => {
    const whitespaceOnly = renderCommitment({
      identityAnchor: IDENTITY,
      initialSelectedAreaId: "parenting",
      initialTitle: "   ",
      initialBehaviorStatement: RECOMMENDED_BEHAVIOR,
    });
    expectContinueDisabled(whitespaceOnly);
  });
});
