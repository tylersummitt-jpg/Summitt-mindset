import { describe, expect, it } from "vitest";

import { evaluateTrialActivatedWithin24h } from "@/lib/admin-growth-activation-pure";
import { isLikelySmsComplianceOrOptOutTurn } from "@/lib/v2-sms-conversation-brain-eligibility";

const TRIAL_START = Math.floor(Date.parse("2026-08-01T12:00:00.000Z") / 1000);
const HOUR = 60 * 60 * 1000;

function base(partial: Partial<Parameters<typeof evaluateTrialActivatedWithin24h>[0]> = {}) {
  return evaluateTrialActivatedWithin24h({
    trialStartUnix: TRIAL_START,
    identityIntakeCompletedAtMs: TRIAL_START * 1000 + 1 * HOUR,
    goalStartedAtMs: [TRIAL_START * 1000 + 2 * HOUR],
    checkSentAtMs: [TRIAL_START * 1000 + 3 * HOUR],
    inbounds: [
      { receivedAtMs: TRIAL_START * 1000 + 4 * HOUR, rawBody: "yes I did it" },
    ],
    isComplianceOrOptOut: isLikelySmsComplianceOrOptOutTurn,
    ...partial,
  });
}

describe("activation within 24 hours", () => {
  it("requires onboarding, goal, check_sent, and a qualifying inbound after check_sent", () => {
    expect(base()).toBe(true);
  });

  it("requires onboarding timestamp inside the window", () => {
    expect(base({ identityIntakeCompletedAtMs: null })).toBe(false);
    expect(base({ identityIntakeCompletedAtMs: TRIAL_START * 1000 + 30 * HOUR })).toBe(false);
  });

  it("requires goal started_at inside the window", () => {
    expect(base({ goalStartedAtMs: [] })).toBe(false);
    expect(base({ goalStartedAtMs: [TRIAL_START * 1000 + 30 * HOUR] })).toBe(false);
  });

  it("requires check_sent inside the window", () => {
    expect(base({ checkSentAtMs: [] })).toBe(false);
  });

  it("requires inbound after check_sent and before 24h", () => {
    expect(
      base({
        inbounds: [
          { receivedAtMs: TRIAL_START * 1000 + 2 * HOUR, rawBody: "yes I did it" },
        ],
      })
    ).toBe(false);
  });

  it("excludes STOP, HELP, and other compliance/opt-out-only replies", () => {
    expect(base({ inbounds: [{ receivedAtMs: TRIAL_START * 1000 + 4 * HOUR, rawBody: "STOP" }] })).toBe(
      false
    );
    expect(base({ inbounds: [{ receivedAtMs: TRIAL_START * 1000 + 4 * HOUR, rawBody: "HELP" }] })).toBe(
      false
    );
    expect(
      base({
        inbounds: [
          { receivedAtMs: TRIAL_START * 1000 + 4 * HOUR, rawBody: "unsubscribe" },
        ],
      })
    ).toBe(false);
  });

  it("excludes replies after 24 hours", () => {
    expect(
      base({
        identityIntakeCompletedAtMs: TRIAL_START * 1000 + 1 * HOUR,
        goalStartedAtMs: [TRIAL_START * 1000 + 2 * HOUR],
        checkSentAtMs: [TRIAL_START * 1000 + 3 * HOUR],
        inbounds: [
          { receivedAtMs: TRIAL_START * 1000 + 30 * HOUR, rawBody: "yes I did it" },
        ],
      })
    ).toBe(false);
  });
});
