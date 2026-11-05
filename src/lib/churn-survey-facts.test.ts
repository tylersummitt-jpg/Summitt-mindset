import { describe, expect, it } from "vitest";

import {
  buildChurnSurveyFacts,
  formatChurnSurveyLines,
  splitWrittenFeedbackCounts,
  type CancellationFeedbackFact,
} from "@/lib/churn-survey-facts";

function row(overrides: Partial<CancellationFeedbackFact>): CancellationFeedbackFact {
  return {
    moment: "cancel_attempt",
    reasonCode: null,
    messagePresent: false,
    surveyVersion: null,
    skippedReason: false,
    skippedComment: false,
    confirmedStripeCancel: false,
    source: "cancel_flow",
    createdAt: "2026-01-02T12:00:00.000Z",
    ...overrides,
  };
}

const apple = {
  appleRenewalOffStillActive: 3,
  appleExpiredStatus: 2,
  appleExpiredNotifications: 4,
  completedDeletions: 10,
  openDeletionRequests: 1,
};

describe("churn survey facts", () => {
  it("keeps legacy wording, version 2 wording, pauses, and skips apart", () => {
    const facts = buildChurnSurveyFacts({
      feedbackReadable: true,
      feedbackNote: null,
      rows: [
        row({ reasonCode: "cost", messagePresent: true, createdAt: "2026-01-01T00:00:00.000Z" }),
        row({
          reasonCode: "too_expensive",
          surveyVersion: 2,
          confirmedStripeCancel: true,
          messagePresent: true,
          skippedComment: false,
        }),
        row({
          reasonCode: "prefer_not_to_say",
          surveyVersion: 2,
          confirmedStripeCancel: true,
          skippedReason: false,
          skippedComment: true,
        }),
        row({
          reasonCode: null,
          surveyVersion: 2,
          confirmedStripeCancel: true,
          skippedReason: true,
          skippedComment: true,
        }),
        row({ moment: "pause_offer_accepted", reasonCode: "pause_instead" }),
      ],
      ...apple,
    });

    expect(facts.legacyRows).toBe(1);
    expect(facts.version2Rows).toBe(3);
    expect(facts.pauseRows).toBe(1);
    expect(facts.confirmedStripeCancels).toBe(3);
    expect(facts.attemptRowsNotProven).toBe(1);
    expect(facts.version2Written).toBe(1);
    expect(facts.version2SkippedReason).toBe(1);
    expect(facts.version2PreferNotToSay).toBe(1);
    expect(facts.legacy[0]?.label).toContain("financial");
    expect(facts.version2.find((item) => item.code === "too_expensive")?.label).toBe(
      "It cost more than I wanted to spend."
    );
    expect(facts.version2.find((item) => item.code === "skipped")?.label).toBe(
      "Skipped the reason question"
    );
    expect(JSON.stringify(facts)).not.toContain("a member wrote");

    const lines = formatChurnSurveyLines(facts).join("\n");
    expect(lines).toContain("Pause selections: 1");
    expect(lines).toContain("Apple memberships still in their paid period with auto-renew off: 3");
    expect(lines).toContain("Apple rows stored as expired: 2");
    expect(lines).toContain("Completed account deletions: 10");
    expect(lines).toContain("Written deletion notes are not in this report.");
    expect(lines).not.toContain("clerk");
  });

  it("splits written-comment counts without needing the comment text", () => {
    expect(splitWrittenFeedbackCounts(4, 1)).toEqual({
      legacyWritten: 3,
      version2Written: 1,
    });
    expect(splitWrittenFeedbackCounts(null, 1)).toEqual({
      legacyWritten: null,
      version2Written: null,
    });
  });
});
