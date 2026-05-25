import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import GoalBuilderClient from "@/components/GoalBuilderClient";

const IDENTITY =
  "I am a disciplined dad, steady husband, and consistent business leader.";

const LIVE_BAR =
  "I will put my phone away for the first 30 minutes after I get home.";

const RECOMMENDED_TITLE = "Be present after work";
const RECOMMENDED_BEHAVIOR =
  "I will read one chapter of a leadership book before bed each night.";

const CUSTOM_TITLE = "Follow through today";
const CUSTOM_BEHAVIOR =
  "I will do the one commitment I already told myself I would do today.";

function renderBuilder(props: React.ComponentProps<typeof GoalBuilderClient>) {
  return renderToStaticMarkup(React.createElement(GoalBuilderClient, props));
}

describe("GoalBuilderClient app_edit", () => {
  it("shows live behavior_statement and starts with no focus area selected", () => {
    const html = renderBuilder({
      mode: "app_edit",
      identityAnchor: IDENTITY,
      initialLiveBehaviorStatement: LIVE_BAR,
      backHref: "/dashboard/victory-room",
      onGoalReady: vi.fn(),
    });
    expect(html).toContain(LIVE_BAR);
    expect(html).toContain("Current live goal");
    expect(html).toContain("What area should Coach Pat help you practice now?");
    expect(html).not.toContain('border-2 border-[var(--brand)]');
  });

  it("does not preload intake metadata in app_edit mode", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/GoalBuilderClient.tsx"),
      "utf8"
    );
    expect(src).not.toContain("v2_commitment_intake");
    expect(src).toContain('isAppEdit ? ""');
  });

  it("uses v2 generate endpoint by default in app_edit", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/GoalBuilderClient.tsx"),
      "utf8"
    );
    expect(src).toContain("/api/v2/commitment/generate-goal-options");
  });

  it("does not use browser Supabase", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/GoalBuilderClient.tsx"),
      "utf8"
    );
    expect(src).not.toContain("supabase");
    expect(src).not.toContain("createClient");
  });

  it("restores appEditDraft when remounting after chapter Back", () => {
    const html = renderBuilder({
      mode: "app_edit",
      identityAnchor: IDENTITY,
      initialLiveBehaviorStatement: LIVE_BAR,
      backHref: "/dashboard/victory-room",
      onGoalReady: vi.fn(),
      appEditDraft: {
        selectedAreaId: "parenting",
        title: CUSTOM_TITLE,
        behaviorStatement: CUSTOM_BEHAVIOR,
        showAllFocusAreas: false,
        generatedGoals: [],
        weakAccept: false,
        warnMessage: null,
      },
    });
    expect(html).toContain(CUSTOM_TITLE);
    expect(html).toContain(CUSTOM_BEHAVIOR);
    expect(html).toContain('value="' + CUSTOM_TITLE + '"');
    expect(html).toContain("border-[var(--brand)] bg-[var(--brand)]");
    expect(html).toContain("Parenting");
  });

  it("syncs draft to parent before onGoalReady", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/GoalBuilderClient.tsx"),
      "utf8"
    );
    expect(src).toContain("onAppEditDraftChange?.(buildAppEditDraftSnapshot())");
    expect(src).not.toContain("v2_commitment_intake");
  });
});

describe("GoalBuilderClient onboarding", () => {
  const CONTINUE_DISABLED = /disabled=""[^>]*>Continue to Review/;

  it("posts to onboarding commitment route", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/GoalBuilderClient.tsx"),
      "utf8"
    );
    expect(src).toContain("/api/onboarding/commitment");
    expect(src).toContain("selected_template_id");
    expect(src).toContain("selectedTemplateId");
  });

  it("disables Continue initially", () => {
    const html = renderBuilder({
      mode: "onboarding",
      identityAnchor: IDENTITY,
      backHref: "/onboarding/identity",
    });
    expect(html).toMatch(CONTINUE_DISABLED);
  });

  it("enables Continue after selecting a recommended goal", () => {
    const html = renderBuilder({
      mode: "onboarding",
      identityAnchor: IDENTITY,
      initialSelectedAreaId: "parenting",
      initialTitle: RECOMMENDED_TITLE,
      initialBehaviorStatement: RECOMMENDED_BEHAVIOR,
      backHref: "/onboarding/identity",
    });
    expect(html).toContain("Continue to Review →");
    expect(html).not.toMatch(CONTINUE_DISABLED);
  });
});
