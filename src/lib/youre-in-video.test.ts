import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ENGAGEMENT_EVENT_TYPES } from "@/lib/mobile-measurement";
import {
  buildRetentionIntelligence,
  formatCompleteRetentionFacts,
  formatRetentionIntelligence,
  RETENTION_DAY_MS,
  type RetentionIntelligenceInput,
} from "@/lib/retention-intelligence";
import { interpretRetentionReportRead } from "@/lib/retention-report";
import {
  aggregateYoureInVideoMembers,
  crossedYoureInWatchMilestones,
  formatYoureInVideoEngagement,
  youreInVideoIdempotencyKey,
  youreInVideoUnavailable,
  YOURE_IN_VIMEO_ID,
} from "@/lib/youre-in-video";

const root = process.cwd();
const NOW = Date.parse("2026-11-07T15:00:00.000Z");

function input(youreInVideo?: RetentionIntelligenceInput["youreInVideo"]): RetentionIntelligenceInput {
  return {
    nowMs: NOW,
    partial: false,
    partialReason: null,
    withheld: null,
    spells: [
      {
        id: "s1",
        clerkUserId: "user_paid",
        paidStartMs: NOW - 100 * RETENTION_DAY_MS,
        endedAtMs: null,
        endKnown: true,
        open: true,
        interval: "month",
        cancellationReason: null,
        trialStartMs: null,
      },
    ],
    activeWithoutPayment: 0,
    appleRows: 0,
    customerFeedbackCount: 0,
    engagementReadable: true,
    hits: [],
    measuredSignals: [],
    acquisitionReadable: true,
    landingReadable: true,
    experimentReadable: true,
    acquisition: [],
    youreInVideo,
  };
}

const FACTS = {
  asOfLabel: "Nov 7, 2026",
  rangeLabel: "All time",
  cohortCalculatedAt: "Nov 7, 2026",
  generationNote: null,
  payingMembers: "1",
  trialsConverted: "0",
  cancelledDuringTrial: "0",
  finishedTrialWithoutPaid: "0",
  paidMembershipsEnded: "0",
  churn: "0",
  pastDueNow: "0",
  paymentFailedInRange: "0",
  freeWeekNow: "0",
  stripeRevenue: "$0",
};

describe("You're In video milestones", () => {
  it("keeps the welcome video id and a once-per-member key with no day", () => {
    expect(YOURE_IN_VIMEO_ID).toBe("1244458037");
    const key = youreInVideoIdempotencyKey("youre_in_video_started", "user_real");
    expect(key).toBe(
      youreInVideoIdempotencyKey("youre_in_video_started", "user_real")
    );
    expect(key).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(youreInVideoIdempotencyKey("youre_in_video_completed", "user_real")).not.toBe(key);
  });

  it("counts played-range milestones and does not treat a short range as 25%", () => {
    expect(
      crossedYoureInWatchMilestones({ playedFraction: 0.24, ended: false, already: new Set() })
    ).toEqual([]);
    expect(
      crossedYoureInWatchMilestones({ playedFraction: 0.25, ended: false, already: new Set() })
    ).toEqual(["youre_in_video_watched_25"]);
    expect(
      crossedYoureInWatchMilestones({ playedFraction: 0.5, ended: false, already: new Set() })
    ).toEqual(["youre_in_video_watched_25", "youre_in_video_watched_50"]);
  });

  it("records completion from ended without inventing a watch milestone", () => {
    expect(
      crossedYoureInWatchMilestones({ playedFraction: null, ended: true, already: new Set() })
    ).toEqual(["youre_in_video_completed"]);
    expect(
      crossedYoureInWatchMilestones({
        playedFraction: 0.5,
        ended: true,
        already: new Set(["youre_in_video_watched_25", "youre_in_video_watched_50"]),
      })
    ).toEqual(["youre_in_video_completed"]);
  });

  it("counts each member once and rolls later thresholds backward", () => {
    const facts = aggregateYoureInVideoMembers([
      { clerkUserId: "user_skip", eventType: "youre_in_page_reached" },
      { clerkUserId: "user_start", eventType: "youre_in_page_reached" },
      { clerkUserId: "user_start", eventType: "youre_in_video_started" },
      { clerkUserId: "user_start", eventType: "youre_in_video_started" },
      { clerkUserId: "user_done", eventType: "youre_in_video_completed" },
      { clerkUserId: "user_done", eventType: "youre_in_video_completed" },
      { clerkUserId: "user_half", eventType: "youre_in_video_watched_50" },
      { clerkUserId: "", eventType: "youre_in_video_started" },
      { clerkUserId: "user_other", eventType: "film_room_played" },
    ]);
    expect(facts).toMatchObject({
      status: "ready",
      reached: 4,
      started: 3,
      watched25: 2,
      watched50: 2,
      completed: 1,
    });
  });

  it("prints a true zero without a percentage and keeps an unread result off zero", () => {
    const none = formatYoureInVideoEngagement(aggregateYoureInVideoMembers([]));
    expect(none.join("\n")).toContain("Reached final onboarding page: 0 unique members.");
    expect(none.join("\n")).toContain("Percent of members who reached the page: Not available.");
    expect(none.join("\n")).toContain("Percent of members who started the video: Not available.");

    const unread = formatYoureInVideoEngagement(
      youreInVideoUnavailable("You're In! video events could not be read. They are not shown as zero.")
    );
    expect(unread.join("\n")).toContain("could not be read");
    expect(unread.join("\n")).not.toContain("0 unique");
  });

  it("leaves monthly retention unchanged and adds the section to the copied facts", () => {
    const plain = buildRetentionIntelligence(input());
    const measured = buildRetentionIntelligence(
      input(
        aggregateYoureInVideoMembers([
          { clerkUserId: "user_done", eventType: "youre_in_page_reached" },
          { clerkUserId: "user_done", eventType: "youre_in_video_completed" },
        ])
      )
    );
    expect(measured.milestones).toEqual(plain.milestones);
    expect(measured.engagement).toEqual(plain.engagement);
    expect(measured.annual).toEqual(plain.annual);
    expect(measured.monthlyBehavior).toEqual(plain.monthlyBehavior);
    const copied = formatCompleteRetentionFacts(measured, FACTS);
    expect(copied).toContain("YOU'RE IN! VIDEO ENGAGEMENT");
    expect(copied).toContain("Completed video: 1 unique member.");
    expect(copied).toContain("100% of members who reached the page.");
    expect(copied).toContain("Watched 25%: 1 unique member.");
    expect(copied).toContain("EARLIER DAY-30 COMPARISONS");
    expect(ENGAGEMENT_EVENT_TYPES).not.toContain("youre_in_page_reached");
    expect(ENGAGEMENT_EVENT_TYPES).not.toContain("youre_in_video_completed");
  });

  it("keeps an older saved report readable and does not show a zero", () => {
    const built = buildRetentionIntelligence(input());
    const stored = { ...built };
    delete stored.youreInVideo;
    const read = interpretRetentionReportRead({
      error: null,
      nowMs: NOW,
      row: {
        report: stored,
        calculated_at: "2026-11-01T15:00:00.000Z",
        schema_version: 1,
        state: "idle",
        started_at: null,
        error: null,
      },
    });
    const text = formatRetentionIntelligence(read.intelligence).join("\n");
    expect(text).toContain("You're In! video engagement is not in this saved report.");
    expect(text).not.toContain("0 unique members");
    expect(read.intelligence.milestones).toEqual(built.milestones);
  });

  it("does not attach analytics to onboarding completion or Film Room home", () => {
    const completeRoute = readFileSync(join(root, "src/app/api/onboarding/complete/route.ts"), "utf8");
    const button = readFileSync(join(root, "src/components/CompleteOnboardingButton.tsx"), "utf8");
    const page = readFileSync(join(root, "src/app/onboarding/complete/page.tsx"), "utf8");
    const home = readFileSync(join(root, "src/lib/member-app-home-path.ts"), "utf8");
    const mobile = readFileSync(join(root, "src/lib/mobile-measurement.ts"), "utf8");
    expect(completeRoute).not.toContain("youre_in_");
    expect(button).toContain('fetch("/api/onboarding/complete"');
    expect(button).toContain('router.replace("/film-room")');
    expect(button).not.toContain("youre-in-video");
    expect(page).toContain("data-youre-in-player");
    expect(page).toContain('allow="fullscreen; picture-in-picture"');
    expect(page).not.toContain("autoplay");
    expect(page).not.toContain("@vimeo/player");
    expect(home).toContain('"/dashboard/victory-room"');
    expect(mobile).not.toContain("youre_in_");
    const privacy = readFileSync(join(root, "src/app/privacy/page.tsx"), "utf8");
    expect(privacy).toContain("final onboarding");
    expect(privacy).toContain("welcome video");
    expect(privacy).toContain("Clerk user ID into the");
    expect(privacy).toContain("welcome video URL");
  });
});
