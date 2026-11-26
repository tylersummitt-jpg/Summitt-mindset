import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Daily Texts account section", () => {
  const account = readFileSync("src/app/user/[[...user]]/user-account-client.tsx", "utf8");
  const section = readFileSync("src/components/daily-texts-section.tsx", "utf8");

  it("is the first section in the existing account card", () => {
    expect(account.indexOf("DailyTextsSection")).toBeGreaterThan(-1);
    expect(account.indexOf("DailyTextsSection")).toBeLessThan(account.indexOf("Need help?"));
    expect(account).toContain("Text STOP to stop text messages");
    expect(account).toContain("Text START to resume text messages");
    expect(account).toContain("Text HELP for info");
    expect(account).not.toContain("AccountSmsBlock");
    expect(account).not.toContain("text-check-ins-section");
    expect(account).toContain('summittPlan === "paused"');
  });

  it("uses the existing account controls and does not claim the schedule is live early", () => {
    expect(section).toContain("Daily Texts");
    expect(section).toContain("Choose when Coach Pat texts you.");
    expect(section).toContain("Pause Daily Texts");
    expect(section).toContain("Resume Daily Texts");
    expect(section).not.toContain("Pause All Texts");
    expect(section).toContain("You can still text Coach Pat anytime while your daily texts are paused.");
    expect(section).toContain('view.relationshipStatus !== "not_configured"');
    expect(section).toContain("Status: Daily texts are paused.");
    expect(section).toContain("Text START to resume text messages");
    expect(section).toContain("Eastern Time (not confirmed)");
    expect(section).toContain("formatTimedPauseWhen");
    const pauseFn = section.slice(
      section.indexOf("async function onPause"),
      section.indexOf("async function onSave")
    );
    expect(pauseFn).toContain("setView(result.view)");
    expect(pauseFn).not.toContain("applyLoaded");
    expect(pauseFn).not.toContain("setSchedule");
    expect(section).toContain("canTextCoach");
    expect(section).toContain("load({ preserveDirty: true })");
    const tryAgain = section.slice(section.indexOf("Try again") - 180, section.indexOf("Try again"));
    expect(tryAgain).toContain("preserveDirty: true");
    expect(section).toContain("Which days would you like to receive texts?");
    expect(section).toContain("What time?");
    expect(section).toContain("Same time on selected days");
    expect(section).toContain("Different times each day");
    expect(section).toContain("No text");
    expect(section).toContain(
      "You are choosing to receive texts during nighttime or early morning hours. You can change your preferences or opt out at any time."
    );
    expect(section).toContain("utPrimaryBtn");
    expect(section).toContain("SAVE");
    expect(section).toContain("Text START to resume text messages");
    expect(section).not.toContain("AccountSmsBlock");
    expect(section).not.toContain("not yet");
    expect(section).not.toContain("coming soon");
  });
});
