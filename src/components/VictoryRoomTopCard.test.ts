import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import { VictoryRoomTopCard } from "@/components/VictoryRoomTopCard";

const baseProps = {
  profile: { identity_anchor_text: "I keep my word." },
  commitment: { title: "Morning focus", behavior_statement: "Ten minutes of planning before email." },
  activeSeason: null,
  timeZone: "America/New_York",
};

const foundationButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-300";

describe("VictoryRoomTopCard", () => {
  it("renders My Identity and My Current Goal", () => {
    const html = renderToStaticMarkup(React.createElement(VictoryRoomTopCard, baseProps));
    expect(html).toContain("Your foundation");
    expect(html).toContain("My Identity");
    expect(html).toContain("My Current Goal");
    expect(html).toContain("I keep my word.");
    expect(html).toContain("Ten minutes of planning before email.");
    expect(html).not.toContain("Daily OS");
    expect(html).not.toContain("Open dashboard");
  });

  it("shows Update goal as a button-style link when showUpdateGoalLink is true", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRoomTopCard, { ...baseProps, showUpdateGoalLink: true })
    );
    expect(html).toContain("Update goal");
    expect(html).not.toContain("Update my goal");
    expect(html).toContain('href="/dashboard/update-goal"');
    expect(html).toContain(foundationButtonClass);
    expect(html).toContain("Adjust what Pat holds you to next.");
  });

  it("hides Update goal when showUpdateGoalLink is false", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRoomTopCard, { ...baseProps, showUpdateGoalLink: false })
    );
    expect(html).not.toContain("Update goal");
    expect(html).not.toContain("/dashboard/update-goal");
  });

  it("shows Edit identity as a button-style link when showEditIdentityLink is true", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRoomTopCard, { ...baseProps, showEditIdentityLink: true })
    );
    expect(html).toContain("Edit identity");
    expect(html).toContain('href="/dashboard/edit-identity"');
    expect(html).toContain(foundationButtonClass);
    expect(html).toContain("Update who you&#x27;re becoming");
  });

  it("hides Edit identity when showEditIdentityLink is false", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRoomTopCard, { ...baseProps, showEditIdentityLink: false })
    );
    expect(html).not.toContain("Edit identity");
    expect(html).not.toContain("/dashboard/edit-identity");
  });
});
