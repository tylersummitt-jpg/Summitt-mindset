import fs from "fs";
import path from "path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import { VictoryRoomTopCard } from "@/components/VictoryRoomTopCard";
import { vrAccentLink, vrFoundationBtn } from "@/components/victory-room-visual";

const TOP_CARD_SRC = fs.readFileSync(
  path.join(process.cwd(), "src/components/VictoryRoomTopCard.tsx"),
  "utf8"
);

const baseProps = {
  profile: { identity_anchor_text: "I keep my word." },
  commitment: { title: "Morning focus", behavior_statement: "Ten minutes of planning before email." },
};

const LONG_IDENTITY =
  "I am becoming a steady, present leader who keeps her word at home and at work even when the day gets loud and crowded.";
const LONG_GOAL =
  "Lift weights for fifteen minutes every weekday before opening email, then write one sentence about what mattered, and protect that bar even when travel, meetings, or tired evenings make it tempting to skip, postpone, or quietly lower the standard I asked Pat to hold me to.";

describe("VictoryRoomTopCard", () => {
  it("is a server component with no page H1 or subtitle", () => {
    expect(TOP_CARD_SRC).not.toContain('"use client"');
    expect(TOP_CARD_SRC).not.toContain("<h1");
    expect(TOP_CARD_SRC).not.toContain(">Victory Room<");
    expect(TOP_CARD_SRC).not.toContain("A place to remember who you&apos;re becoming");
    expect(TOP_CARD_SRC).not.toContain("saved from your");
  });

  it("renders My Identity and My Current Goal without page chrome or helpers", () => {
    const html = renderToStaticMarkup(React.createElement(VictoryRoomTopCard, baseProps));
    expect(html).not.toContain("<h1");
    expect(html).not.toContain("Victory Room");
    expect(html).not.toContain("A place to remember who you&#x27;re becoming");
    expect(html).not.toContain("saved from your");
    expect(html).not.toContain("real choices.");
    expect(html).not.toContain("calm home for proof");
    expect(html).not.toContain("proof of who you are becoming");
    expect(html).not.toContain("Summitt Mindset");
    expect(html).not.toContain("Update who you&#x27;re becoming");
    expect(html).not.toContain("your current goal stays the same");
    expect(html).not.toContain("Adjust what Pat holds you to next.");
    expect(html).toContain("My identity");
    expect(html).toContain("My current goal");
    expect(html).toContain("I keep my word.");
    expect(html).toContain("Ten minutes of planning before email.");
    expect(html).not.toContain("Morning focus");
    expect(html).not.toContain("Your Foundation");
    expect(html).not.toContain("Current season");
    expect(html).not.toContain("Daily OS");
    expect(html).not.toContain("Open dashboard");
  });

  it("does not render distinct commitment.title under Current Goal when behavior_statement exists", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRoomTopCard, {
        profile: { identity_anchor_text: "I keep my word." },
        commitment: {
          title: "SaaS App",
          behavior_statement: "Lift weights for 15 minutes a day",
        },
      })
    );
    expect(html).toContain("Lift weights for 15 minutes a day");
    expect(html).not.toContain("SaaS App");
  });

  it("shows identity fallback when identity is missing", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRoomTopCard, {
        profile: { identity_anchor_text: null },
        commitment: { title: "Morning focus", behavior_statement: "Walk ten minutes." },
      })
    );
    expect(html).toContain("Still being shaped — your identity line will show here.");
    expect(html).toContain("Walk ten minutes.");
  });

  it("shows neutral empty state and never title when behavior_statement is empty", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRoomTopCard, {
        profile: { identity_anchor_text: "I keep my word." },
        commitment: { title: "Morning focus", behavior_statement: null },
      })
    );
    expect(html).toContain("No current goal set yet.");
    expect(html).not.toContain("Morning focus");
  });

  it("shows Update goal as an accent text link when showUpdateGoalLink is true", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRoomTopCard, { ...baseProps, showUpdateGoalLink: true })
    );
    expect(html).toContain("Update goal");
    expect(html).not.toContain("Update my goal");
    expect(html).toContain('href="/dashboard/update-goal"');
    expect(html).toContain(vrAccentLink);
    expect(html).toContain("min-h-11");
    expect(html).not.toContain(vrFoundationBtn);
    expect(html).not.toContain("Adjust what Pat holds you to next.");
  });

  it("hides Update goal when showUpdateGoalLink is false", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRoomTopCard, { ...baseProps, showUpdateGoalLink: false })
    );
    expect(html).not.toContain("Update goal");
    expect(html).not.toContain("/dashboard/update-goal");
  });

  it("shows Edit identity as an accent text link when showEditIdentityLink is true", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRoomTopCard, { ...baseProps, showEditIdentityLink: true })
    );
    expect(html).toContain("Edit identity");
    expect(html).toContain('href="/dashboard/edit-identity"');
    expect(html).toContain(vrAccentLink);
    expect(html).toContain("min-h-11");
    expect(html).not.toContain(vrFoundationBtn);
    expect(html).not.toContain("Update who you&#x27;re becoming");
  });

  it("hides Edit identity when showEditIdentityLink is false", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRoomTopCard, { ...baseProps, showEditIdentityLink: false })
    );
    expect(html).not.toContain("Edit identity");
    expect(html).not.toContain("/dashboard/edit-identity");
  });

  it("keeps stacked mobile layout, two-column sm+ layout, and a mobile-only divider", () => {
    expect(TOP_CARD_SRC).toContain("grid-cols-1");
    expect(TOP_CARD_SRC).toContain("sm:grid-cols-2");
    expect(TOP_CARD_SRC).toContain("sm:gap-8");
    expect(TOP_CARD_SRC).toContain("min-w-0");
    expect(TOP_CARD_SRC).toContain("vrDivider");
    expect(TOP_CARD_SRC).toContain("my-4");
    expect(TOP_CARD_SRC).toContain("sm:hidden");
    expect(TOP_CARD_SRC).not.toContain("my-8");
    expect(TOP_CARD_SRC).toContain("!h-8");
    expect(TOP_CARD_SRC).toContain("!w-8");
    expect(TOP_CARD_SRC).toContain("!p-5");
    expect(TOP_CARD_SRC).toContain("sm:!p-8");
    expect(TOP_CARD_SRC).toContain("!mb-8");
    expect(TOP_CARD_SRC).toContain("sm:!mb-12");
  });

  it("wraps long identity and goal text without clamping or truncating", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRoomTopCard, {
        profile: { identity_anchor_text: LONG_IDENTITY },
        commitment: { title: "Ignored title", behavior_statement: LONG_GOAL },
      })
    );
    expect(html).toContain(LONG_IDENTITY);
    expect(html).toContain(LONG_GOAL);
    expect(html).not.toMatch(/line-clamp/);
    expect(html).not.toMatch(/truncate/);
    expect(html).not.toMatch(/ellipsis/);
    expect(html).not.toContain("…");
    expect(TOP_CARD_SRC).toContain("break-words");
    expect(TOP_CARD_SRC).not.toContain("line-clamp");
    expect(TOP_CARD_SRC).not.toContain("truncate");
    expect(TOP_CARD_SRC).not.toContain("text-ellipsis");
  });
});
