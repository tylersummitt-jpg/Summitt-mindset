import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyDailyPostFvgStaleAskDetectOnly,
  applyDailyStaleAskDetectOnly,
  detectDailyStaleAskViolation,
  DAILY_LANE_STALE_ASK_BLOCKED,
  DAILY_POST_FVG_STALE_ASK_BLOCKED,
} from "@/lib/daily-stale-ask-guard";
import type { DailySatisfiedAskContext } from "@/lib/daily-satisfied-ask-context";

const CALENDAR_ASK =
  "let me know if you're ready to put one family connection on the calendar for tomorrow";

function familySatisfiedContext(): DailySatisfiedAskContext {
  return {
    has_satisfied_recent_ask: true,
    satisfied_ask_type: "plan_detail",
    do_not_repeat_asks: [CALENDAR_ASK],
    evidence_preview: "Call Bond about 12PM tomorrow",
    source: "inbound_turn_telemetry",
    occurred_at: "2026-06-04T18:00:00.000Z",
    last_ask_satisfied: "yes",
    stale_ask_risk: true,
    relationship_meaning: "plan_made",
    response_intent: "acknowledge_prior_ask_satisfied",
    prior_question_type: "plan_confirmation",
    outcome_proof_eligible: false,
    persistence_note: "no proof",
  };
}

function planConfirmationContext(): DailySatisfiedAskContext {
  return {
    has_satisfied_recent_ask: true,
    satisfied_ask_type: "plan_confirmation",
    do_not_repeat_asks: ["Does this 7-day step plan work?"],
    evidence_preview: "Yes",
    source: "inbound_turn_telemetry",
    occurred_at: "2026-06-03T12:00:00.000Z",
    last_ask_satisfied: "yes",
    stale_ask_risk: true,
    relationship_meaning: "plan_confirmed",
    response_intent: "acknowledge_prior_ask_satisfied",
    prior_question_type: "plan_confirmation",
    outcome_proof_eligible: false,
    persistence_note: "no proof",
  };
}

describe("detectDailyStaleAskViolation", () => {
  it("A: blocks family/calendar re-ask after satisfied plan detail", () => {
    const hit = detectDailyStaleAskViolation({
      body: "Are you ready to put one family connection on the calendar?",
      satisfiedAskContext: familySatisfiedContext(),
    });
    expect(hit.violation).toBe(true);
  });

  it("B: allows safe outcome-close question", () => {
    const hit = detectDailyStaleAskViolation({
      body: "Did the noon call with Bond happen, or did something get in the way?",
      satisfiedAskContext: familySatisfiedContext(),
    });
    expect(hit.violation).toBe(false);
  });

  it("C: blocks plan-confirmation feel re-ask after user said yes", () => {
    const hit = detectDailyStaleAskViolation({
      body: "How does staying committed for the next 7 days feel?",
      satisfiedAskContext: planConfirmationContext(),
      answeredOpenQuestion: "Does this 7-day step plan work?",
    });
    expect(hit.violation).toBe(true);
  });

  it("D: allows safe next-step protection question", () => {
    const hit = detectDailyStaleAskViolation({
      body: "What will help you protect today's 10,000 steps?",
      satisfiedAskContext: planConfirmationContext(),
    });
    expect(hit.violation).toBe(false);
  });

  it("E: no satisfied context leaves normal accountability question unchanged", () => {
    const hit = detectDailyStaleAskViolation({
      body: "Did you get your steps in yesterday?",
      satisfiedAskContext: null,
    });
    expect(hit.violation).toBe(false);
  });

  it("P0-A: allows Bond outcome-close after plan detail", () => {
    const hit = detectDailyStaleAskViolation({
      body: "Did the conversation with Bond happen, or did something get in the way?",
      satisfiedAskContext: familySatisfiedContext(),
      lastCoachQuestions: [
        "What actually happened with your distribution plan since your last check-in?",
      ],
      answeredOpenQuestion:
        "What actually happened with your distribution plan since your last check-in?",
      latestAnswerText: "Call Bond at 12PM tomorrow",
    });
    expect(hit.violation).toBe(false);
  });

  it("P0-A: allows planned block outcome-close", () => {
    const hit = detectDailyStaleAskViolation({
      body: "Did the planned block happen, or did something get in the way?",
      satisfiedAskContext: familySatisfiedContext(),
    });
    expect(hit.violation).toBe(false);
  });

  it("P0-A: blocks family calendar re-ask after plan detail", () => {
    const hit = detectDailyStaleAskViolation({
      body: "Are you ready to put one family connection on the calendar?",
      satisfiedAskContext: familySatisfiedContext(),
    });
    expect(hit.violation).toBe(true);
  });
});

describe("applyDailyStaleAskDetectOnly @ daily_lane_pre_send", () => {
  const STALE_CALENDAR_BODY =
    "Are you ready to put one family connection on the calendar for tomorrow?";

  it("1: daily_lane_pre_send stale violation no-sends", () => {
    const result = applyDailyStaleAskDetectOnly({
      body: STALE_CALENDAR_BODY,
      satisfiedAskContext: familySatisfiedContext(),
      routePurpose: "main_active_accountability",
      stage: "daily_lane_pre_send",
    });
    expect(result.outcome).toBe("no_send");
    if (result.outcome === "no_send") {
      expect(result.noSendReason).toBe(DAILY_LANE_STALE_ASK_BLOCKED);
      expect(result.metadata.daily_lane_stale_ask_detected).toBe(true);
      expect(result.metadata.daily_lane_stale_ask_source).toBe("daily_lane_pre_send");
      expect(result.metadata.stale_guard_repair_body_preview).toBeUndefined();
    }
  });

  it("2: clear no-send reason and metadata", () => {
    const result = applyDailyStaleAskDetectOnly({
      body: "Are you ready to put one family connection on the calendar?",
      satisfiedAskContext: familySatisfiedContext(),
      routePurpose: "main_active_accountability",
      stage: "daily_lane_pre_send",
    });
    expect(result.outcome).toBe("no_send");
    if (result.outcome === "no_send") {
      expect(result.metadata.daily_lane_stale_ask_no_send_reason).toBe(DAILY_LANE_STALE_ASK_BLOCKED);
      expect(result.metadata.daily_stale_ask_repair_attempted).toBe(false);
      expect(result.metadata.skip_source).toBe("stale_ask_no_send");
    }
  });

  it("3: non-stale body proceeds unchanged", () => {
    const safeBody = "Did the noon call with Bond happen, or did something get in the way?";
    const result = applyDailyStaleAskDetectOnly({
      body: safeBody,
      satisfiedAskContext: familySatisfiedContext(),
      routePurpose: "main_active_accountability",
      stage: "daily_lane_pre_send",
    });
    expect(result.outcome).toBe("ok");
    if (result.outcome === "ok") {
      expect(result.body).toBe(safeBody);
      expect(result.metadata.daily_lane_stale_ask_detected).toBe(false);
    }
  });

  it("4: true stale repeated daily question still blocks", () => {
    const result = applyDailyStaleAskDetectOnly({
      body: "Are you ready to put one family connection on the calendar?",
      satisfiedAskContext: familySatisfiedContext(),
      routePurpose: "low_pressure_reactivation",
      stage: "daily_lane_pre_send",
    });
    expect(result.outcome).toBe("no_send");
  });
});

describe("applyDailyPostFvgStaleAskDetectOnly", () => {
  const POST_FVG_STALE_CALENDAR_BODY =
    "Are you ready to put one family connection on the calendar for tomorrow?";

  it("1: post-FVG stale calendar re-ask no-sends without replacement SMS", () => {
    const result = applyDailyPostFvgStaleAskDetectOnly({
      body: POST_FVG_STALE_CALENDAR_BODY,
      satisfiedAskContext: familySatisfiedContext(),
      routePurpose: "main_active_accountability",
      stage: "daily_post_final_voice_gate",
    });
    expect(result.outcome).toBe("no_send");
    if (result.outcome === "no_send") {
      expect(result.noSendReason).toBe(DAILY_POST_FVG_STALE_ASK_BLOCKED);
      expect(result.metadata.daily_post_fvg_stale_ask_detected).toBe(true);
      expect(result.metadata.daily_post_fvg_stale_ask_source).toBe("daily_post_final_voice_gate");
      expect(result.metadata.stale_guard_repair_body_preview).toBeUndefined();
    }
  });

  it("3: no-send reason is daily_post_fvg_stale_ask_blocked", () => {
    const result = applyDailyPostFvgStaleAskDetectOnly({
      body: "Are you ready to put one family connection on the calendar?",
      satisfiedAskContext: familySatisfiedContext(),
      routePurpose: "main_active_accountability",
    });
    expect(result.outcome).toBe("no_send");
    if (result.outcome === "no_send") {
      expect(result.noSendReason).toBe(DAILY_POST_FVG_STALE_ASK_BLOCKED);
      expect(result.metadata.daily_post_fvg_stale_ask_no_send_reason).toBe(
        DAILY_POST_FVG_STALE_ASK_BLOCKED
      );
      expect(result.metadata.daily_stale_ask_repair_attempted).toBe(false);
    }
  });

  it("4: non-stale FVG body proceeds unchanged", () => {
    const safeBody = "Did the noon call with Bond happen, or did something get in the way?";
    const result = applyDailyPostFvgStaleAskDetectOnly({
      body: safeBody,
      satisfiedAskContext: familySatisfiedContext(),
      routePurpose: "main_active_accountability",
      stage: "daily_post_final_voice_gate",
    });
    expect(result.outcome).toBe("ok");
    if (result.outcome === "ok") {
      expect(result.body).toBe(safeBody);
      expect(result.metadata.daily_post_fvg_stale_ask_detected).toBe(false);
    }
  });

  it("5: true stale repeated daily question still blocks", () => {
    const result = applyDailyPostFvgStaleAskDetectOnly({
      body: "Are you ready to put one family connection on the calendar?",
      satisfiedAskContext: familySatisfiedContext(),
      routePurpose: "main_active_accountability",
    });
    expect(result.outcome).toBe("no_send");
  });
});

describe("daily stale helper production wiring", () => {
  const guardSrc = readFileSync(
    join(process.cwd(), "src/lib/daily-stale-ask-guard.ts"),
    "utf8"
  );
  const laneSrc = readFileSync(
    join(process.cwd(), "src/lib/v3-daily-relationship-lane.ts"),
    "utf8"
  );

  it("daily stale helper has no OpenAI repair path", () => {
    expect(guardSrc).not.toContain("repairV3RelationshipLaneBodyWithOpenAI");
    expect(guardSrc).not.toContain("applyDailyStaleAskGuard");
    expect(guardSrc).not.toContain("buildDailyStaleAskRepairInstruction");
  });

  it("lane pre-send stale is detect-only with contract exclusion", () => {
    expect(laneSrc).toContain("applyDailyStaleAskDetectOnly");
    expect(laneSrc).toContain('stage: "daily_lane_pre_send"');
    expect(laneSrc).not.toContain("applyDailyStaleAskGuard");
    expect(laneSrc).toContain('laneFacts.route_kind !== "contract_prompt"');
  });
});
