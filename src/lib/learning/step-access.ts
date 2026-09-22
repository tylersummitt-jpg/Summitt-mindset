export type LearningProgressStatus = "in_progress" | "completed";

export type LearningProgressSnapshot = {
  status: LearningProgressStatus;
  current_step_id: string;
};

export type StepRef = {
  id: string;
  sequence: number;
};

export type ProgramCardState = "Not Started" | "In Progress" | "Completed";

export type StepViewDecision =
  | { kind: "initialize" }
  | { kind: "render"; enforceRequirements: boolean }
  | { kind: "redirect"; stepId: string }
  | { kind: "missing" };

export type ContinueDecision =
  | { kind: "advance"; nextStepId: string }
  | { kind: "complete" }
  | { kind: "review-next"; nextStepId: string }
  | { kind: "review-end" }
  | { kind: "reject" };

export function orderedSteps<T extends StepRef>(steps: readonly T[]): T[] {
  return [...steps].sort((left, right) => left.sequence - right.sequence);
}

export function programCardState(
  row: { status: LearningProgressStatus } | null
): ProgramCardState {
  if (!row) return "Not Started";
  if (row.status === "completed") return "Completed";
  return "In Progress";
}

export function programCardAction(state: ProgramCardState): "Start" | "Continue" | "Review" {
  if (state === "Completed") return "Review";
  if (state === "In Progress") return "Continue";
  return "Start";
}

export function entryStepId(
  steps: readonly StepRef[],
  progress: LearningProgressSnapshot | null
): string {
  const ordered = orderedSteps(steps);
  const first = ordered[0];
  if (!first) {
    throw new Error("Program has no steps");
  }
  if (!progress || progress.status === "completed") {
    return first.id;
  }
  const current = ordered.find((step) => step.id === progress.current_step_id);
  return current?.id ?? first.id;
}

export function decideStepView(
  progress: LearningProgressSnapshot | null,
  steps: readonly StepRef[],
  stepId: string
): StepViewDecision {
  const ordered = orderedSteps(steps);
  const stepIndex = ordered.findIndex((step) => step.id === stepId);
  if (stepIndex < 0 || !ordered[0]) {
    return { kind: "missing" };
  }
  if (!progress) {
    if (stepIndex === 0) return { kind: "initialize" };
    return { kind: "redirect", stepId: ordered[0].id };
  }
  if (progress.status === "completed") {
    return { kind: "render", enforceRequirements: false };
  }

  const frontierIndex = ordered.findIndex((step) => step.id === progress.current_step_id);
  if (frontierIndex < 0) {
    if (stepIndex === 0) return { kind: "render", enforceRequirements: true };
    return { kind: "redirect", stepId: ordered[0].id };
  }
  if (stepIndex > frontierIndex) {
    return { kind: "redirect", stepId: ordered[frontierIndex].id };
  }
  return {
    kind: "render",
    enforceRequirements: stepIndex === frontierIndex,
  };
}

export function canPersistOnStep(
  progress: LearningProgressSnapshot | null,
  steps: readonly StepRef[],
  stepId: string
): boolean {
  return decideStepView(progress, steps, stepId).kind === "render";
}

export function decideContinue(
  progress: LearningProgressSnapshot | null,
  steps: readonly StepRef[],
  stepId: string
): ContinueDecision {
  const ordered = orderedSteps(steps);
  const stepIndex = ordered.findIndex((step) => step.id === stepId);
  if (!progress || stepIndex < 0) return { kind: "reject" };

  const next = ordered[stepIndex + 1];
  if (progress.status === "completed") {
    return next ? { kind: "review-next", nextStepId: next.id } : { kind: "review-end" };
  }

  const frontierIndex = ordered.findIndex((step) => step.id === progress.current_step_id);
  if (frontierIndex < 0 || stepIndex > frontierIndex) return { kind: "reject" };
  if (stepIndex < frontierIndex) {
    return next ? { kind: "review-next", nextStepId: next.id } : { kind: "review-end" };
  }
  return next ? { kind: "advance", nextStepId: next.id } : { kind: "complete" };
}
