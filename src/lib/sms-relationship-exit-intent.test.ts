import { describe, expect, it } from "vitest";
import {
  applyRelationshipExitGatedOverride,
  detectSmsRelationshipExitIntent,
  isRelationshipExitLaneActive,
  shouldDeferRelationshipExitToGoalHandoff,
} from "@/lib/sms-relationship-exit-intent";

describe("detectSmsRelationshipExitIntent", () => {
  it("detects app abandonment", () => {
    const d = detectSmsRelationshipExitIntent("I'm done with this app");
    expect(d.detected).toBe(true);
    expect(d.category).toBe("app_abandonment");
    expect(d.confidence).toBe("high");
    expect(d.noProof).toBe(true);
    expect(d.noOutcomeEvent).toBe(true);
  });

  it("detects Summitt Mindset abandonment", () => {
    const d = detectSmsRelationshipExitIntent("I'm done with Summitt Mindset");
    expect(d.category).toBe("app_abandonment");
    expect(d.detected).toBe(true);
  });

  it("detects coach-directed exit", () => {
    const d = detectSmsRelationshipExitIntent("I'm done with you");
    expect(d.category).toBe("coach_directed_exit");
    expect(d.detected).toBe(true);
    expect(d.noProof).toBe(true);
  });

  it("detects subscription billing", () => {
    const d = detectSmsRelationshipExitIntent("cancel my subscription");
    expect(d.category).toBe("subscription_billing");
    expect(d.subscriptionIntegrity).toBe(true);
    expect(d.detected).toBe(true);
  });

  it("detects stop charging", () => {
    expect(detectSmsRelationshipExitIntent("stop charging me").category).toBe("subscription_billing");
  });

  it("detects texting soft opt-out", () => {
    const d = detectSmsRelationshipExitIntent("stop texting me");
    expect(d.category).toBe("texting_soft_opt_out");
    expect(d.textOptOutSoft).toBe(true);
    expect(d.detected).toBe(true);
  });

  it("detects leave me alone as soft opt-out", () => {
    expect(detectSmsRelationshipExitIntent("leave me alone").category).toBe("texting_soft_opt_out");
  });

  it("detects frustration phrases", () => {
    expect(detectSmsRelationshipExitIntent("this is annoying").category).toBe("frustration");
    expect(detectSmsRelationshipExitIntent("this isn't helping").category).toBe("frustration");
    expect(detectSmsRelationshipExitIntent("I want to quit").category).toBe("frustration");
  });

  it("detects goal abandonment", () => {
    const d = detectSmsRelationshipExitIntent("I'm done with this goal");
    expect(d.category).toBe("goal_abandonment");
    expect(d.goalAbandonment).toBe(true);
  });

  it.each([
    "I'm done with texting",
    "I'm done with texts",
    "I'm done with SMS",
    "done with texting",
    "done with the texts",
  ])("detects done-with-texting abandonment as texting_soft_opt_out: %j", (body) => {
    const d = detectSmsRelationshipExitIntent(body);
    expect(d.detected).toBe(true);
    expect(d.category).toBe("texting_soft_opt_out");
    expect(d.textOptOutSoft).toBe(true);
    expect(d.noProof).toBe(true);
    expect(d.noOutcomeEvent).toBe(true);
    expect(applyRelationshipExitGatedOverride(d).should_write_outcome_event).toBe(false);
  });

  it("does not treat completion as exit", () => {
    expect(detectSmsRelationshipExitIntent("done").detected).toBe(false);
    expect(detectSmsRelationshipExitIntent("already got it done").detected).toBe(false);
    expect(detectSmsRelationshipExitIntent("done with my workout").detected).toBe(false);
    expect(detectSmsRelationshipExitIntent("got the walk done").detected).toBe(false);
  });

  it("does not treat exact STOP as exit detector match", () => {
    expect(detectSmsRelationshipExitIntent("STOP").detected).toBe(false);
  });

  it("does not treat I need help as exit", () => {
    expect(detectSmsRelationshipExitIntent("I need help").detected).toBe(false);
  });
});

describe("applyRelationshipExitGatedOverride", () => {
  it("blocks outcome events and proof", () => {
    const det = detectSmsRelationshipExitIntent("I'm done with this app");
    const g = applyRelationshipExitGatedOverride(det);
    expect(g.mode).toBe("relationship_exit_integrity");
    expect(g.should_write_outcome_event).toBe(false);
    expect(g.final_event_type).toBeNull();
    expect(g.should_open_blocker_capture).toBe(false);
    expect(g.reply_style).toBe("relationship_exit");
  });
});

describe("goal abandonment deferral", () => {
  it("defers goal abandonment to normal coaching without a Goal Change phrase list", () => {
    const det = detectSmsRelationshipExitIntent("I'm done with this goal");
    expect(det.goalAbandonment).toBe(true);
    expect(
      shouldDeferRelationshipExitToGoalHandoff({
        detection: det,
        plannedInterruptionActionable: false,
      })
    ).toBe(true);
    expect(
      isRelationshipExitLaneActive({
        detection: det,
        deferToGoalHandoff: true,
      })
    ).toBe(false);
  });

  it("does not defer app abandonment as if it were Goal Change", () => {
    const det = detectSmsRelationshipExitIntent("I'm done with this app");
    expect(det.goalAbandonment).toBe(false);
    expect(
      shouldDeferRelationshipExitToGoalHandoff({
        detection: det,
        plannedInterruptionActionable: false,
      })
    ).toBe(false);
    expect(
      isRelationshipExitLaneActive({
        detection: det,
        deferToGoalHandoff: false,
      })
    ).toBe(true);
  });

  it("does not defer goal abandonment when planned interruption is actionable", () => {
    const det = detectSmsRelationshipExitIntent("I'm done with this goal");
    expect(
      shouldDeferRelationshipExitToGoalHandoff({
        detection: det,
        plannedInterruptionActionable: true,
      })
    ).toBe(false);
  });
});

describe("Slice 5 correction — mixed relationship-exit precedence", () => {
  it("1: goal-only abandonment defers to coaching", () => {
    const d = detectSmsRelationshipExitIntent("I'm done with this goal.");
    expect(d.category).toBe("goal_abandonment");
    expect(d.goalAbandonment).toBe(true);
    expect(
      shouldDeferRelationshipExitToGoalHandoff({
        detection: d,
        plannedInterruptionActionable: false,
      })
    ).toBe(true);
  });

  it("2: I don't want this goal anymore stays goal-only", () => {
    const d = detectSmsRelationshipExitIntent("I don't want this goal anymore.");
    expect(d.category).toBe("goal_abandonment");
    expect(
      shouldDeferRelationshipExitToGoalHandoff({
        detection: d,
        plannedInterruptionActionable: false,
      })
    ).toBe(true);
  });

  it("3: mixed goal + app keeps app exit", () => {
    const d = detectSmsRelationshipExitIntent(
      "I'm done with this goal and I'm done with this app."
    );
    expect(d.category).toBe("app_abandonment");
    expect(d.goalAbandonment).toBe(false);
    expect(
      shouldDeferRelationshipExitToGoalHandoff({
        detection: d,
        plannedInterruptionActionable: false,
      })
    ).toBe(false);
    expect(
      isRelationshipExitLaneActive({ detection: d, deferToGoalHandoff: false })
    ).toBe(true);
  });

  it("4: mixed goal + billing keeps billing", () => {
    const d = detectSmsRelationshipExitIntent(
      "I'm done with this goal. Cancel my membership."
    );
    expect(d.category).toBe("subscription_billing");
    expect(d.subscriptionIntegrity).toBe(true);
  });

  it("5: mixed forget-goal + stop texting keeps texting/STOP-compatible path", () => {
    const d = detectSmsRelationshipExitIntent("Forget this goal. Stop texting me.");
    expect(d.category).toBe("texting_soft_opt_out");
    expect(d.textOptOutSoft).toBe(true);
  });

  it("6: mixed goal + coaching uses existing coach-exit English only", () => {
    const coaching = detectSmsRelationshipExitIntent(
      "I'm done with this goal and I'm done with coaching."
    );
    expect(coaching.category).toBe("goal_abandonment");
    const you = detectSmsRelationshipExitIntent(
      "I'm done with this goal and I'm done with you."
    );
    expect(you.category).toBe("coach_directed_exit");
  });

  it("7: done with this goal, not the program does not invent app exit", () => {
    const d = detectSmsRelationshipExitIntent("I'm done with this goal, not the program.");
    expect(d.category).toBe("goal_abandonment");
    expect(d.goalAbandonment).toBe(true);
  });

  it("8: done with the program, not the goal keeps program/app exit", () => {
    const d = detectSmsRelationshipExitIntent("I'm done with the program, not the goal.");
    expect(d.category).toBe("app_abandonment");
    expect(d.goalAbandonment).toBe(false);
  });
});
