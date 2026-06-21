import { describe, expect, it } from "vitest";

import {
  buildDailyProofCalibrationPromptBlock,
  deriveDailyProofCalibration,
} from "@/lib/sms-daily-proof-calibration";
import {
  deriveDailyFreshMoveFacts,
  detectDailyRepeatedCtaViolation,
} from "@/lib/sms-daily-fresh-move";
import {
  detectDailyUnsupportedPraiseViolation,
} from "@/lib/sms-daily-unsupported-praise-validator";
import type { RecentCoachBodyDoNotRepeat } from "@/lib/sms-recent-coach-body-anti-repeat";

function weakStaleCalibrationArgs() {
  return {
    facts: {
      accountability: {
        prior_outcome: "user_yes",
        yes_streak_14d: 0,
        no_count_14d: 1,
        partial_count_14d: 0,
        days_since_last_user_outcome: 3,
      },
      thread_memory: {
        relationship_memory_7d: {
          outcome_counts: { yes: 2, no: 1, partial: 0, unclear: 0 },
          context_flags: { days_since_last_user_outcome: 3 },
          wins: [{ at: "2026-06-17T12:00:00Z", local_day_key: "2026-06-17", label: "win" }],
        } as never,
      },
    },
  };
}

describe("deriveDailyProofCalibration", () => {
  it("Test 1 — 2 wins / 7d, proof 3 days old → capability_only, no consistency praise", () => {
    const cal = deriveDailyProofCalibration(weakStaleCalibrationArgs());
    expect(cal.wins_7d).toBe(2);
    expect(cal.proof_age_days).toBe(3);
    expect(cal.praise_allowed_level).toBe("capability_only");
    expect(cal.consistency_claim_allowed).toBe(false);
    expect(cal.strong_commitment_claim_allowed).toBe(false);
    expect(cal.stale_proof_warning).toMatch(/Only 2 win/);
    expect(cal.truth_summary_for_writer).toMatch(/Do not praise consistency/);
  });

  it("Test 6 — streak allows stronger praise", () => {
    const cal = deriveDailyProofCalibration({
      facts: {
        accountability: {
          prior_outcome: "user_yes",
          yes_streak_14d: 5,
          no_count_14d: 0,
          partial_count_14d: 0,
          days_since_last_user_outcome: 0,
        },
        thread_memory: {
          relationship_memory_7d: {
            outcome_counts: { yes: 5, no: 0, partial: 0, unclear: 0 },
            context_flags: { days_since_last_user_outcome: 0 },
          } as never,
        },
      },
    });
    expect(cal.praise_allowed_level).toBe("streak");
    expect(cal.consistency_claim_allowed).toBe(true);
    const hit = detectDailyUnsupportedPraiseViolation({
      body: "You've been consistent this week.",
      calibration: cal,
    });
    expect(hit).toBeNull();
  });
});

describe("daily fresh move extraction", () => {
  function coachBody(body: string): RecentCoachBodyDoNotRepeat {
    return {
      body,
      body_preview: body.slice(0, 120),
      sent_at: "2026-06-19T12:00:00Z",
      at_local: "Jun 19",
      source_table: "sms_send_events",
      role: "coach",
    };
  }

  it("Test 7 — distribution CTA extracted and repeated candidate blocked", () => {
    const prior =
      "You completed your distribution yesterday. Aim for one hour of distribution today to keep progressing.";
    const fresh = deriveDailyFreshMoveFacts([coachBody(prior)]);
    expect(
      fresh.recent_cta_do_not_repeat.some((x) => /one hour of distribution/i.test(x.phrase))
    ).toBe(true);
    const violation = detectDailyRepeatedCtaViolation({
      body: "You've shown commitment — focus on one hour of distribution today.",
      freshMove: fresh,
    });
    expect(violation).not.toBeNull();
    expect(violation?.phrase).toMatch(/one hour of distribution/i);
  });

  it("Test 8 — prayer timer advice repeated and blocked", () => {
    const prior = "When you pray, use a timer or gentle sound to stay present.";
    const fresh = deriveDailyFreshMoveFacts([coachBody(prior)]);
    expect(
      fresh.recent_advice_do_not_repeat.some((x) => /timer or gentle sound/i.test(x.phrase))
    ).toBe(true);
    const violation = detectDailyRepeatedCtaViolation({
      body: "Consider using a timer or gentle sound when you start.",
      freshMove: fresh,
    });
    expect(violation).not.toBeNull();
  });

  it("Test 9 — same goal fresh move allowed", () => {
    const prior = "Aim for one hour of distribution before lunch.";
    const fresh = deriveDailyFreshMoveFacts([coachBody(prior)]);
    const violation = detectDailyRepeatedCtaViolation({
      body: "Start with the first 10 minutes before checking anything else.",
      freshMove: fresh,
    });
    expect(violation).toBeNull();
  });
});

describe("unsupported praise validator", () => {
  it("Test 4 — blocks great commitment on weak stale proof", () => {
    const cal = deriveDailyProofCalibration(weakStaleCalibrationArgs());
    const hit = detectDailyUnsupportedPraiseViolation({
      body: "You've shown great commitment by completing your distribution recently.",
      calibration: cal,
    });
    expect(hit).not.toBeNull();
    expect(hit?.phrase).toMatch(/great commitment/i);
  });

  it("Test 5 — allows truthful capability language", () => {
    const cal = deriveDailyProofCalibration(weakStaleCalibrationArgs());
    const hit = detectDailyUnsupportedPraiseViolation({
      body: "You've shown you can do it; the job now is one honest win today.",
      calibration: cal,
    });
    expect(hit).toBeNull();
  });
});

describe("buildDailyProofCalibrationPromptBlock", () => {
  it("includes authoritative calibration fields", () => {
    const cal = deriveDailyProofCalibration(weakStaleCalibrationArgs());
    const block = buildDailyProofCalibrationPromptBlock(cal);
    expect(block).toMatch(/DAILY PROOF CALIBRATION/);
    expect(block).toMatch(/wins_7d: 2/);
    expect(block).toMatch(/proof_age_days: 3/);
    expect(block).toMatch(/consistency_claim_allowed: false/);
  });
});
