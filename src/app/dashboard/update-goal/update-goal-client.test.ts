import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import UpdateGoalClient from "@/app/dashboard/update-goal/update-goal-client";

const IDENTITY = "I am a steady leader and present dad.";
const LIVE_BAR = "I will walk ten minutes before starting work each weekday.";

function renderUpdateGoal(
  props: Partial<React.ComponentProps<typeof UpdateGoalClient>> = {}
) {
  return renderToStaticMarkup(
    React.createElement(UpdateGoalClient, {
      identityAnchor: IDENTITY,
      personalizationContext: { ingredientIds: ["dad"], identityAnchor: IDENTITY },
      currentBehaviorStatement: LIVE_BAR,
      effectiveCoachingAsk: null,
      defaultRecommendedSeasonMode: "same_season_sync",
      ...props,
    })
  );
}

describe("UpdateGoalClient", () => {
  it("shows current identity and live behavior_statement", () => {
    const html = renderUpdateGoal();
    expect(html).toContain("My Identity");
    expect(html).toContain(IDENTITY);
    expect(html).toContain(LIVE_BAR);
    expect(html).toContain("My Current Goal");
  });

  it("does not load v2_commitment_intake on page", () => {
    const pageSrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/dashboard/update-goal/page.tsx"),
      "utf8"
    );
    expect(pageSrc).not.toContain("v2_commitment_intake");
    expect(pageSrc).toContain("loadIdentityEditDraft");
    expect(pageSrc).toContain("behavior_statement");
  });

  it("saves through goal-change API with season_mode and client_request_id", () => {
    const clientSrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/dashboard/update-goal/update-goal-client.tsx"),
      "utf8"
    );
    expect(clientSrc).toContain("/api/v2/commitment/goal-change");
    expect(clientSrc).toContain("behavior_statement");
    expect(clientSrc).toContain("season_mode");
    expect(clientSrc).toContain("client_request_id");
    expect(clientSrc).not.toContain("/api/onboarding/commitment");
    expect(clientSrc).not.toContain("supabase");
  });

  it("shows behavior_statement as canonical goal label not stale title", () => {
    const html = renderUpdateGoal();
    expect(html).toContain(LIVE_BAR);
    expect(html).not.toContain("Morning focus");
  });

  it("includes chapter choice step copy", () => {
    const clientSrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/dashboard/update-goal/update-goal-client.tsx"),
      "utf8"
    );
    expect(clientSrc).toContain("same_season_sync");
    expect(clientSrc).toContain("new_chapter");
    expect(clientSrc).toContain("deriveSeasonModeForSmsGoalChange");
  });

  it("preserves builderDraft in parent for chapter Back remount", () => {
    const clientSrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/dashboard/update-goal/update-goal-client.tsx"),
      "utf8"
    );
    expect(clientSrc).toContain("builderDraft");
    expect(clientSrc).toContain("appEditDraft={builderDraft}");
    expect(clientSrc).toContain("onAppEditDraftChange={handleBuilderDraftChange}");
    expect(clientSrc).not.toContain("v2_commitment_intake");
  });
});
