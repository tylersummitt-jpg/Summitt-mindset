import { describe, expect, it } from "vitest";
import { getLearningMiniProgram } from "./load-curriculum";
import {
  decideContinue,
  decideStepView,
  entryStepId,
  canPersistOnStep,
  programCardState,
} from "./step-access";

function program() {
  const loaded = getLearningMiniProgram("dd_mp_02");
  if (!loaded) throw new Error("missing dd_mp_02");
  return loaded;
}

describe("step access", () => {
  it("maps the three card states without a percentage", () => {
    expect(programCardState(null)).toBe("Not Started");
    expect(programCardState({ status: "in_progress" })).toBe("In Progress");
    expect(programCardState({ status: "completed" })).toBe("Completed");
  });

  it("opens step 1 when new or completed, and the saved step while in progress", () => {
    const steps = program().steps;
    expect(entryStepId(steps, null)).toBe("dd_mp_02_st_001");
    expect(
      entryStepId(steps, { status: "in_progress", current_step_id: "dd_mp_02_st_011" })
    ).toBe("dd_mp_02_st_011");
    expect(
      entryStepId(steps, { status: "completed", current_step_id: "dd_mp_02_st_018" })
    ).toBe("dd_mp_02_st_001");
    expect(
      entryStepId(steps, { status: "in_progress", current_step_id: "removed-step" })
    ).toBe("dd_mp_02_st_001");
  });

  it("locks future steps and does not treat review as the frontier", () => {
    const steps = program().steps;
    expect(decideStepView(null, steps, "dd_mp_02_st_001")).toEqual({ kind: "initialize" });
    expect(decideStepView(null, steps, "dd_mp_02_st_002")).toEqual({
      kind: "redirect",
      stepId: "dd_mp_02_st_001",
    });
    expect(decideStepView(null, steps, "missing")).toEqual({ kind: "missing" });

    const progress = { status: "in_progress" as const, current_step_id: "dd_mp_02_st_006" };
    expect(decideStepView(progress, steps, "dd_mp_02_st_008")).toEqual({
      kind: "redirect",
      stepId: "dd_mp_02_st_006",
    });
    expect(decideStepView(progress, steps, "dd_mp_02_st_006")).toEqual({
      kind: "render",
      enforceRequirements: true,
    });
    expect(decideStepView(progress, steps, "dd_mp_02_st_002")).toEqual({
      kind: "render",
      enforceRequirements: false,
    });
    expect(canPersistOnStep(null, steps, "dd_mp_02_st_001")).toBe(false);
    expect(canPersistOnStep(progress, steps, "dd_mp_02_st_008")).toBe(false);
    expect(canPersistOnStep(progress, steps, "dd_mp_02_st_002")).toBe(true);
    expect(canPersistOnStep(progress, steps, "dd_mp_02_st_006")).toBe(true);
    expect(
      decideStepView(
        { status: "completed", current_step_id: "dd_mp_02_st_018" },
        steps,
        "dd_mp_02_st_014"
      )
    ).toEqual({ kind: "render", enforceRequirements: false });
  });

  it("moves the frontier only from the current step", () => {
    const steps = program().steps;
    const progress = { status: "in_progress" as const, current_step_id: "dd_mp_02_st_006" };
    expect(decideContinue(progress, steps, "dd_mp_02_st_002")).toEqual({
      kind: "review-next",
      nextStepId: "dd_mp_02_st_003",
    });
    expect(decideContinue(progress, steps, "dd_mp_02_st_008")).toEqual({ kind: "reject" });
    expect(decideContinue(progress, steps, "dd_mp_02_st_006")).toEqual({
      kind: "advance",
      nextStepId: "dd_mp_02_st_007",
    });
    expect(
      decideContinue(
        { status: "in_progress", current_step_id: "dd_mp_02_st_018" },
        steps,
        "dd_mp_02_st_018"
      )
    ).toEqual({ kind: "complete" });
    expect(
      decideContinue(
        { status: "completed", current_step_id: "dd_mp_02_st_018" },
        steps,
        "dd_mp_02_st_001"
      )
    ).toEqual({ kind: "review-next", nextStepId: "dd_mp_02_st_002" });
    expect(decideContinue(null, steps, "dd_mp_02_st_001")).toEqual({ kind: "reject" });
  });
});
