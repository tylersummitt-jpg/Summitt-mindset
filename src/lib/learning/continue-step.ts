import type { LearningMiniProgram } from "./curriculum-types";
import {
  validateStepRequirements,
  type QuizClientScore,
  type StepSubmission,
} from "./grade-step";
import {
  applyProgressTransition,
  getMiniProgramProgress,
  type ContinueDestination,
  type ProgressDb,
} from "./mini-program-progress";
import { PROGRAMS_COPY } from "./programs-copy";
import { saveStepReflections, type ReflectionDb } from "./reflection-answers";
import { decideContinue } from "./step-access";

export async function continueMiniProgramStep(args: {
  progressDb: ProgressDb;
  reflectionDb: ReflectionDb;
  memberId: string;
  program: LearningMiniProgram;
  stepId: string;
  submission: StepSubmission;
  now: string;
}): Promise<
  | { ok: true; destination: ContinueDestination; quiz?: QuizClientScore }
  | { ok: false; message: string; quiz?: QuizClientScore }
> {
  const step = args.program.steps.find((candidate) => candidate.id === args.stepId);
  if (!step) return { ok: false, message: PROGRAMS_COPY.unavailable };

  const loaded = await getMiniProgramProgress(args.progressDb, args.memberId, args.program.id);
  if (!loaded.ok) return loaded;
  if (!loaded.row) return { ok: false, message: PROGRAMS_COPY.progressSaveFailed };

  const decision = decideContinue(loaded.row, args.program.steps, step.id);
  if (decision.kind === "reject") {
    return { ok: false, message: PROGRAMS_COPY.stepLocked };
  }

  const frontier = decision.kind === "advance" || decision.kind === "complete";
  const saved = await saveStepReflections({
    db: args.reflectionDb,
    memberId: args.memberId,
    miniProgramId: args.program.id,
    step,
    answers: args.submission.reflections,
    now: args.now,
    requireComplete: frontier,
  });
  if (!saved.ok) return saved;

  if (frontier) {
    const requirements = validateStepRequirements(step, args.submission);
    if (!requirements.ok) {
      return requirements.quiz
        ? { ok: false, message: requirements.message, quiz: requirements.quiz }
        : { ok: false, message: requirements.message };
    }
    const moved = await applyProgressTransition({
      db: args.progressDb,
      memberId: args.memberId,
      miniProgramId: args.program.id,
      stepId: step.id,
      decision,
      now: args.now,
    });
    if (!moved.ok || !requirements.quiz) return moved;
    return { ...moved, quiz: requirements.quiz };
  }

  return applyProgressTransition({
    db: args.progressDb,
    memberId: args.memberId,
    miniProgramId: args.program.id,
    stepId: step.id,
    decision,
    now: args.now,
  });
}
