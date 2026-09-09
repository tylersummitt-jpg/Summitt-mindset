import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  applyFalseAppliedGoalChangeGuard,
  applyGoalChangeMachineBodySafety,
  applyUnauthorizedGoalChangeBindingConfirmationGuard,
  AUTHORIZED_AWAITING_CANDIDATE_ELICITATION_ASK,
  bodyAsksBindingSavedGoalChangeConfirmation,
  bodyClaimsSavedGoalChangeAlreadyApplied,
  bodyConflictsWithAuthoritativeAppliedGoal,
  buildAuthorizedPendingConfirmationAsk,
  tryBuildAuthorizedGoalChangeWriterFailureFallback,
  SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
  UNAUTHORIZED_GOAL_CHANGE_BINDING_CLARIFICATION,
  type SolGoalChangeConfirmationAuthorization,
} from "@/lib/sol-goal-change-confirmation-guard";

const BINDING = "Do you want 10:30 to replace 9:30 going forward?";
const CANDIDATE = "I will be in bed by 10:30 pm nightly.";
const CANONICAL = "I will be in bed by 9:30 pm nightly.";
const PENDING_ASK = `Do you want ${CANDIDATE.replace(/\.+$/, "")} to replace ${CANONICAL.replace(/\.+$/, "")} going forward?`;

const pendingAuth: SolGoalChangeConfirmationAuthorization = {
  goal_change_confirmation_authorized: true,
  goal_change_apply_authorized: false,
  candidate_behavior_statement: CANDIDATE,
  canonical_behavior_statement: CANONICAL,
  pending_state: "awaiting_confirmation",
  previous_behavior_statement: null,
  previous_commitment_id: null,
  active_commitment_id: "cmt_angela",
  pending_cleared: false,
};

const noneAuth: SolGoalChangeConfirmationAuthorization = {
  ...SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
  canonical_behavior_statement: CANONICAL,
};

describe("unauthorized Goal Change binding confirmation guard", () => {
  it("treats binding replacement questions as confirmation language", () => {
    expect(bodyAsksBindingSavedGoalChangeConfirmation(BINDING)).toBe(true);
    expect(
      bodyAsksBindingSavedGoalChangeConfirmation(
        "Do you want 10:30 to replace 9:30 every night going forward?"
      )
    ).toBe(true);
    expect(
      bodyAsksBindingSavedGoalChangeConfirmation("Should I change your saved goal to 10:30?")
    ).toBe(true);
    expect(
      bodyAsksBindingSavedGoalChangeConfirmation("Want me to lock in 10:30 as the new goal?")
    ).toBe(true);
    expect(
      bodyAsksBindingSavedGoalChangeConfirmation("Want me to make 10:30 the goal going forward?")
    ).toBe(true);
  });

  it("does not treat tonight-vs-going-forward clarification as binding confirmation", () => {
    expect(
      bodyAsksBindingSavedGoalChangeConfirmation(
        UNAUTHORIZED_GOAL_CHANGE_BINDING_CLARIFICATION
      )
    ).toBe(false);
    expect(
      bodyAsksBindingSavedGoalChangeConfirmation(
        "What do you want the new nightly target to be?"
      )
    ).toBe(false);
    expect(
      bodyAsksBindingSavedGoalChangeConfirmation("Proud you named that. Rest tonight.")
    ).toBe(false);
  });

  it("9: unauthorized writer binding question is replaced with safe clarification", () => {
    const r = applyUnauthorizedGoalChangeBindingConfirmationGuard({
      body: BINDING,
      authorized: false,
    });
    expect(r.blocked).toBe(true);
    expect(r.body).toBe(UNAUTHORIZED_GOAL_CHANGE_BINDING_CLARIFICATION);
    expect(r.reason).toBe("unauthorized_binding_goal_change_confirmation");
  });

  it("8: authorized pending may ask the same binding question", () => {
    const r = applyUnauthorizedGoalChangeBindingConfirmationGuard({
      body: BINDING,
      authorized: true,
    });
    expect(r.blocked).toBe(false);
    expect(r.body).toBe(BINDING);
  });
});

describe("false-applied Goal Change guard", () => {
  it("detects applied claims", () => {
    expect(bodyClaimsSavedGoalChangeAlreadyApplied("Your goal is now 10:30.")).toBe(true);
    expect(bodyClaimsSavedGoalChangeAlreadyApplied("Your goal going forward is 10:30.")).toBe(
      true
    );
    expect(bodyClaimsSavedGoalChangeAlreadyApplied("We'll use 10:30 going forward.")).toBe(true);
    expect(bodyClaimsSavedGoalChangeAlreadyApplied("10:30 is locked in.")).toBe(true);
    expect(bodyClaimsSavedGoalChangeAlreadyApplied("I've changed your goal.")).toBe(true);
    expect(bodyClaimsSavedGoalChangeAlreadyApplied("I've updated your goal.")).toBe(true);
    expect(bodyClaimsSavedGoalChangeAlreadyApplied("Your goal has been changed.")).toBe(true);
    expect(bodyClaimsSavedGoalChangeAlreadyApplied("Your goal has been updated.")).toBe(true);
    expect(bodyClaimsSavedGoalChangeAlreadyApplied("Done — your saved goal is set.")).toBe(true);
  });

  it("4–7: pending authorized still cannot claim applied", () => {
    for (const body of [
      "Your goal is now 10:30.",
      "Your goal going forward is 10:30.",
      "We'll use 10:30 going forward.",
      "10:30 is locked in.",
    ]) {
      const r = applyFalseAppliedGoalChangeGuard({
        body,
        applyAuthorized: false,
        confirmationAuthorization: pendingAuth,
      });
      expect(r.blocked).toBe(true);
      expect(r.body).toBe(PENDING_ASK);
      expect(r.reason).toBe("false_applied_goal_change_claim");
    }
  });

  it("10: no pending + false-applied claim → clarification", () => {
    const r = applyFalseAppliedGoalChangeGuard({
      body: "Your goal is now 10:30.",
      applyAuthorized: false,
      confirmationAuthorization: noneAuth,
    });
    expect(r.blocked).toBe(true);
    expect(r.body).toBe(UNAUTHORIZED_GOAL_CHANGE_BINDING_CLARIFICATION);
  });
});

describe("central Goal Change machine body safety", () => {
  it("1: handoff/main + no pending + binding question → blocked", () => {
    const r = applyGoalChangeMachineBodySafety({ body: BINDING, authorization: noneAuth });
    expect(r.blocked).toBe(true);
    expect(r.body).toBe(UNAUTHORIZED_GOAL_CHANGE_BINDING_CLARIFICATION);
  });

  it("2: pending awaiting_confirmation + binding question → allowed", () => {
    const r = applyGoalChangeMachineBodySafety({ body: BINDING, authorization: pendingAuth });
    expect(r.blocked).toBe(false);
    expect(r.body).toBe(BINDING);
  });

  it("3: pending + Your goal is now 10:30 → blocked despite confirmation authorization", () => {
    const r = applyGoalChangeMachineBodySafety({
      body: "Your goal is now 10:30.",
      authorization: pendingAuth,
    });
    expect(r.blocked).toBe(true);
    expect(r.body).toBe(PENDING_ASK);
    expect(r.reason).toBe("false_applied_goal_change_claim");
  });

  it("4–7: pending authorized false-applied claims are replaced with the confirmation ask", () => {
    for (const body of [
      "Your goal is now 10:30.",
      "Your goal going forward is 10:30.",
      "We'll use 10:30 going forward.",
      "10:30 is locked in.",
    ]) {
      const r = applyGoalChangeMachineBodySafety({ body, authorization: pendingAuth });
      expect(r.blocked).toBe(true);
      expect(r.body).toBe(PENDING_ASK);
      expect(r.reason).toBe("false_applied_goal_change_claim");
    }
  });

  it("8: pending authorized + legitimate confirmation question → allowed", () => {
    const r = applyGoalChangeMachineBodySafety({ body: BINDING, authorization: pendingAuth });
    expect(r.blocked).toBe(false);
    expect(r.body).toBe(BINDING);
  });

  it("9: no pending + binding question → blocked", () => {
    const r = applyGoalChangeMachineBodySafety({
      body: BINDING,
      authorization: SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
    });
    expect(r.blocked).toBe(true);
    expect(r.body).toBe(UNAUTHORIZED_GOAL_CHANGE_BINDING_CLARIFICATION);
  });

  it("10: no pending + false-applied claim → blocked", () => {
    const r = applyGoalChangeMachineBodySafety({
      body: "I've changed your goal to 10:30.",
      authorization: noneAuth,
    });
    expect(r.blocked).toBe(true);
    expect(r.body).toBe(UNAUTHORIZED_GOAL_CHANGE_BINDING_CLARIFICATION);
  });

  it("11–15: ordinary coaching is not rewritten", () => {
    const allowed = [
      "Going forward, let's focus on consistency.",
      "Replace perfection with consistency.",
      "Lock in on what you can control.",
      "Your goal today is to get some rest.",
      "You can change the plan if life changes.",
    ];
    for (const body of allowed) {
      const unauthorized = applyGoalChangeMachineBodySafety({
        body,
        authorization: noneAuth,
      });
      const authorized = applyGoalChangeMachineBodySafety({
        body,
        authorization: pendingAuth,
      });
      expect(unauthorized.blocked).toBe(false);
      expect(unauthorized.body).toBe(body);
      expect(authorized.blocked).toBe(false);
      expect(authorized.body).toBe(body);
    }
  });

  it("pending confirmation ask uses candidate and canonical, not hardcoded clocks", () => {
    expect(buildAuthorizedPendingConfirmationAsk(pendingAuth)).toBe(PENDING_ASK);
    expect(PENDING_ASK).toContain(CANDIDATE.replace(/\.+$/, ""));
    expect(PENDING_ASK).toContain(CANONICAL.replace(/\.+$/, ""));
  });
});

describe("applied Goal Change body safety", () => {
  const appliedAuth: SolGoalChangeConfirmationAuthorization = {
    goal_change_confirmation_authorized: false,
    goal_change_apply_authorized: true,
    candidate_behavior_statement: null,
    canonical_behavior_statement: CANDIDATE,
    pending_state: null,
    previous_behavior_statement: CANONICAL,
    previous_commitment_id: "cmt_old",
    active_commitment_id: "cmt_new",
    pending_cleared: true,
  };

  it("16: post-apply writer saying a different clock is blocked", () => {
    const r = applyGoalChangeMachineBodySafety({
      body: "Your goal is now 11:00.",
      authorization: appliedAuth,
    });
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe("wrong_applied_goal_change_claim");
    expect(r.body).toContain("10:30");
    expect(r.body).not.toContain("11:00");
  });

  it("17: post-apply writer saying the authoritative 10:30 goal is allowed", () => {
    const r = applyGoalChangeMachineBodySafety({
      body: "Got it, Angela. Your goal going forward is 10:30.",
      authorization: appliedAuth,
    });
    expect(r.blocked).toBe(false);
    expect(r.body).toBe("Got it, Angela. Your goal going forward is 10:30.");
  });

  it("apply authorized still cannot ask a binding staged confirmation", () => {
    const r = applyGoalChangeMachineBodySafety({
      body: BINDING,
      authorization: appliedAuth,
    });
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe("post_apply_goal_change_reask");
    expect(r.body).toBe(
      "Got it. Your goal going forward is I will be in bed by 10:30 pm nightly."
    );
    expect(r.body).not.toBe(UNAUTHORIZED_GOAL_CHANGE_BINDING_CLARIFICATION);
  });

  it("post-apply token seatbelt allows previous∪active tokens and vetoes neither", () => {
    expect(
      bodyConflictsWithAuthoritativeAppliedGoal(
        "9:30 wasn't working. 10:30 is the bar now.",
        CANDIDATE,
        CANONICAL
      )
    ).toBe(false);
    expect(
      bodyConflictsWithAuthoritativeAppliedGoal("11:00 is your goal now.", CANDIDATE, CANONICAL)
    ).toBe(true);
    expect(
      bodyConflictsWithAuthoritativeAppliedGoal("Your goal is still 9:30.", CANDIDATE, CANONICAL)
    ).toBe(false);
  });
});

describe("Slice 5 correction — writer-failure fallback renders proven state only", () => {
  it("pending confirmation authorized → deterministic binding ask, not applied claim", () => {
    const body = tryBuildAuthorizedGoalChangeWriterFailureFallback(pendingAuth);
    expect(body).toBe(PENDING_ASK);
    expect(bodyClaimsSavedGoalChangeAlreadyApplied(body!)).toBe(false);
    const guarded = applyGoalChangeMachineBodySafety({
      body,
      authorization: pendingAuth,
    });
    expect(guarded.blocked).toBe(false);
    expect(guarded.body).toBe(PENDING_ASK);
    expect(guarded.body).not.toMatch(/your goal is now|locked in|has been changed/i);
  });

  it("no pending → no fake binding ask", () => {
    expect(tryBuildAuthorizedGoalChangeWriterFailureFallback(noneAuth)).toBeNull();
  });

  it("awaiting_candidate hallway → elicitation, not a binding confirmation", () => {
    const hallway: SolGoalChangeConfirmationAuthorization = {
      ...noneAuth,
      pending_state: "awaiting_candidate",
      candidate_behavior_statement: null,
    };
    const body = tryBuildAuthorizedGoalChangeWriterFailureFallback(hallway);
    expect(body).toBe(AUTHORIZED_AWAITING_CANDIDATE_ELICITATION_ASK);
    expect(bodyClaimsSavedGoalChangeAlreadyApplied(body!)).toBe(false);
    expect(bodyAsksBindingSavedGoalChangeConfirmation(body!)).toBe(false);
    const guarded = applyGoalChangeMachineBodySafety({
      body: body!,
      authorization: hallway,
    });
    expect(guarded.blocked).toBe(false);
    expect(guarded.body).toBe(AUTHORIZED_AWAITING_CANDIDATE_ELICITATION_ASK);
    expect(guarded.body).not.toMatch(/do you want .+ replace/i);
  });

  it("applied state uses applied ack, not pending ask", () => {
    const applied: SolGoalChangeConfirmationAuthorization = {
      goal_change_confirmation_authorized: false,
      goal_change_apply_authorized: true,
      candidate_behavior_statement: null,
      canonical_behavior_statement: CANDIDATE,
      pending_state: null,
      previous_behavior_statement: CANONICAL,
      previous_commitment_id: "cmt_old",
      active_commitment_id: "cmt_new",
      pending_cleared: true,
    };
    const body = tryBuildAuthorizedGoalChangeWriterFailureFallback(applied);
    expect(body).toBe(`Got it. Your goal going forward is ${CANDIDATE.replace(/\.+$/, "")}.`);
    expect(body).not.toMatch(/do you want/i);
    const guarded = applyGoalChangeMachineBodySafety({
      body: body!,
      authorization: applied,
    });
    expect(guarded.body).not.toMatch(/do you want .+ replace/i);
  });

  it("confirmation authorized without a candidate does not invent an ask", () => {
    const noCand: SolGoalChangeConfirmationAuthorization = {
      ...pendingAuth,
      candidate_behavior_statement: null,
    };
    expect(tryBuildAuthorizedGoalChangeWriterFailureFallback(noCand)).toBeNull();
  });
});

describe("Slice 7B temporary confirmation body safety", () => {
  const tempAuth: SolGoalChangeConfirmationAuthorization = {
    ...pendingAuth,
    goal_change_confirmation_authorized: false,
    temporary_adjustment_confirmation_authorized: true,
    temporary_last_included_local_date: "2026-09-13",
    temporary_expires_at: "2026-09-14T04:00:00.000Z",
    temporary_duration_kind: "local_week",
  };

  it("blocks permanence claims and saved-binding questions; canned ask is temporary", () => {
    for (const body of [
      "Your goal is now 10:30.",
      "Your new goal is 10:30.",
      "I changed your Current Goal.",
      "Going forward your goal is 10:30.",
      "Going forward, 10:30.",
      "Done.",
      "10:30 is locked in.",
      "I'll hold you to 10:30 through Sunday.",
      BINDING,
    ]) {
      const r = applyGoalChangeMachineBodySafety({ body, authorization: tempAuth });
      expect(r.blocked).toBe(true);
      expect(r.body).toMatch(/temporary target/i);
      expect(r.body).not.toMatch(/going forward\?/i);
      expect(r.body).not.toBe(UNAUTHORIZED_GOAL_CHANGE_BINDING_CLARIFICATION);
    }
  });

  it("writer failure fallback is a temporary ask, not a saved-replace ask", () => {
    const body = tryBuildAuthorizedGoalChangeWriterFailureFallback(tempAuth);
    expect(body).toMatch(/temporary target/i);
    expect(body).toContain("2026-09-13");
    expect(body).not.toMatch(/going forward\?/i);
    const guarded = applyGoalChangeMachineBodySafety({ body: body!, authorization: tempAuth });
    expect(guarded.blocked).toBe(false);
  });

  it("allows a truthful temporary confirmation question", () => {
    const r = applyGoalChangeMachineBodySafety({
      body: "Do you want 10:30 to be your temporary target through Sunday while your Current Goal stays 9:30?",
      authorization: tempAuth,
    });
    expect(r.blocked).toBe(false);
  });

  it("blocks It's set and temporary-target-is-now before apply", () => {
    for (const body of ["It's set.", "10:30 is active through Friday.", "Your temporary target is now 10:30."]) {
      const r = applyGoalChangeMachineBodySafety({ body, authorization: tempAuth });
      expect(r.blocked).toBe(true);
      expect(r.body).toMatch(/temporary target/i);
    }
  });
});

describe("Slice 7C temporary applied body safety", () => {
  const appliedAuth: SolGoalChangeConfirmationAuthorization = {
    ...pendingAuth,
    goal_change_confirmation_authorized: false,
    goal_change_apply_authorized: false,
    temporary_adjustment_confirmation_authorized: false,
    temporary_adjustment_apply_authorized: true,
    candidate_behavior_statement: CANDIDATE,
    temporary_candidate_behavior_statement: CANDIDATE,
    temporary_last_included_local_date: "2026-09-13",
    temporary_expires_at: "2026-09-14T04:00:00.000Z",
    pending_cleared: true,
  };

  it("blocks false permanence after temp apply", () => {
    for (const body of [
      "I've changed your goal to 10:30.",
      "I've changed your Current Goal to 10:30.",
      "I've changed your current goal to 10:30.",
      "I'VE CHANGED YOUR CURRENT GOAL TO 10:30.",
      "I have changed your Current Goal to 10:30.",
      "I have changed your goal to 10:30.",
      "I've just changed your Current Goal to 10:30.",
      "I changed your goal to 10:30.",
      "I changed your Current Goal to 10:30.",
      "I changed your current goal to 10:30.",
      "I CHANGED YOUR CURRENT GOAL TO 10:30.",
      "I changed your   Current   Goal to 10:30.",
      "Your Current Goal is now 10:30.",
      "Your current goal is now 10:30.",
      "Your CURRENT GOAL is now 10:30.",
      "Your Current Goal is now set to 10:30.",
      "Your goal is now 10:30.",
      "Your new Current Goal is 10:30.",
      "Going forward, your goal is 10:30.",
      "I changed your goal permanently.",
    ]) {
      const r = applyGoalChangeMachineBodySafety({ body, authorization: appliedAuth });
      expect(r.blocked).toBe(true);
      expect(r.body).toMatch(/Current Goal stays/i);
      expect(r.body).not.toMatch(/going forward is/i);
    }
  });

  it("allows truthful Current Goal stays/remains and temporary coaching language", () => {
    for (const body of [
      "I haven't changed your Current Goal.",
      "I did not change your Current Goal.",
      "Your Current Goal stays 9:30.",
      "Your Current Goal remains 9:30.",
      "Your Current Goal is still 9:30.",
      "I've changed how I'll coach you through Sunday, but your Current Goal stays 9:30.",
      "I'll coach you against 10:30 through Sunday.",
      "Until Sunday, 10:30 is the temporary target.",
      "Your Current Goal stays 9:30 while I coach you against 10:30 through Sunday.",
    ]) {
      const r = applyGoalChangeMachineBodySafety({ body, authorization: appliedAuth });
      expect(r.blocked).toBe(false);
    }
  });

  it("writer failure fallback is temporary applied, not saved-goal language", () => {
    const body = tryBuildAuthorizedGoalChangeWriterFailureFallback(appliedAuth);
    expect(body).toMatch(/Current Goal stays/i);
    expect(body).not.toMatch(/going forward is/i);
    expect(body).toContain("2026-09-13");
  });
});

describe("Slice 7F-1 temporary reverted body safety", () => {
  const revertedAuth: SolGoalChangeConfirmationAuthorization = {
    ...noneAuth,
    temporary_adjustment_reverted: true,
    active_commitment_id: "cmt_angela",
  };

  it("blocks saved-goal applied claims, new-temp claims, and binding asks", () => {
    for (const body of [
      "Your goal is now 10:30.",
      "I've changed your goal.",
      "I changed your goal back to 9:30.",
      "I changed your current goal back to 9:30.",
      "Your temporary target is now 10:30.",
      "10:30 is active through Friday.",
      BINDING,
    ]) {
      const r = applyGoalChangeMachineBodySafety({ body, authorization: revertedAuth });
      expect(r.blocked).toBe(true);
      expect(r.body).toMatch(/regular goal/i);
      expect(r.body).not.toBe(UNAUTHORIZED_GOAL_CHANGE_BINDING_CLARIFICATION);
    }
  });

  it("allows truthful restore language that does not claim canonical mutation", () => {
    for (const body of [
      "We're back to your regular goal: 9:30.",
      "I removed the temporary change.",
      "Your regular goal is still 9:30.",
      "Your Current Goal remains 9:30.",
      "You're back to your regular goal: I will be in bed by 9:30 pm nightly.",
    ]) {
      const r = applyGoalChangeMachineBodySafety({ body, authorization: revertedAuth });
      expect(r.blocked).toBe(false);
    }
  });

  it("allows truthful back-to-regular-goal language and writer fallback", () => {
    const allowed = applyGoalChangeMachineBodySafety({
      body: "You're back to your regular goal: I will be in bed by 9:30 pm nightly.",
      authorization: revertedAuth,
    });
    expect(allowed.blocked).toBe(false);
    const fallback = tryBuildAuthorizedGoalChangeWriterFailureFallback(revertedAuth);
    expect(fallback).toMatch(/regular goal/i);
    expect(fallback).toContain("9:30");
    expect(fallback).not.toMatch(/going forward\?/i);
    const guarded = applyGoalChangeMachineBodySafety({
      body: fallback!,
      authorization: revertedAuth,
    });
    expect(guarded.blocked).toBe(false);
  });
});

describe("Goal Change state files stay outside Morning/Evening first-person line", () => {
  it("confirmation guard source does not contain the Morning next-turn sentence", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/sol-goal-change-confirmation-guard.ts"),
      "utf8"
    );
    expect(src).not.toContain(
      "The message should feel like the next human turn from Coach Pat: speak naturally in first person when it fits, as a real coach texting this member."
    );
  });
});
