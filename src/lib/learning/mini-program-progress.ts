import type { LearningMiniProgram } from "./curriculum-types";
import { PROGRAMS_COPY } from "./programs-copy";
import {
  isMissingProgramsTable,
  isUniqueProgramsConflict,
  type ProgramsDbError,
} from "./programs-db-error";
import {
  orderedSteps,
  type ContinueDecision,
  type LearningProgressSnapshot,
  type LearningProgressStatus,
  type StepRef,
} from "./step-access";

export type LearningProgressRow = LearningProgressSnapshot & {
  clerk_user_id: string;
  mini_program_id: string;
  curriculum_version: number;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
  status: LearningProgressStatus;
};

export type ProgressDbResult<T> = {
  data: T | null;
  error: ProgramsDbError | null;
};

export type ProgressDb = {
  getOne(
    clerkUserId: string,
    miniProgramId: string
  ): Promise<ProgressDbResult<LearningProgressRow>>;
  list(
    clerkUserId: string,
    miniProgramIds: readonly string[]
  ): Promise<ProgressDbResult<LearningProgressRow[]>>;
  insert(row: LearningProgressRow): Promise<ProgressDbResult<LearningProgressRow>>;
  updateFrontier(args: {
    clerkUserId: string;
    miniProgramId: string;
    fromStepId: string;
    nextStepId: string;
    updatedAt: string;
  }): Promise<ProgressDbResult<LearningProgressRow>>;
  markCompleted(args: {
    clerkUserId: string;
    miniProgramId: string;
    stepId: string;
    completedAt: string;
  }): Promise<ProgressDbResult<LearningProgressRow>>;
};

export type ContinueDestination =
  | { type: "step"; stepId: string }
  | { type: "programs" };

type ProgressResult<T> = { ok: true; row: T } | { ok: false; message: string };

export async function getMiniProgramProgress(
  db: ProgressDb,
  memberId: string,
  miniProgramId: string
): Promise<ProgressResult<LearningProgressRow | null>> {
  const result = await db.getOne(memberId, miniProgramId);
  if (result.error) return { ok: false, message: loadMessage(result.error) };
  return { ok: true, row: result.data };
}

export async function listMiniProgramProgress(
  db: ProgressDb,
  memberId: string,
  miniProgramIds: readonly string[]
): Promise<{ ok: true; rows: LearningProgressRow[] } | { ok: false; message: string }> {
  if (miniProgramIds.length === 0) return { ok: true, rows: [] };
  const result = await db.list(memberId, miniProgramIds);
  if (result.error) return { ok: false, message: loadMessage(result.error) };
  return { ok: true, rows: result.data ?? [] };
}

export async function initializeMiniProgramProgress(
  db: ProgressDb,
  args: { memberId: string; program: LearningMiniProgram; now: string }
): Promise<ProgressResult<LearningProgressRow>> {
  const existing = await getMiniProgramProgress(db, args.memberId, args.program.id);
  if (!existing.ok) return existing;
  if (existing.row) return { ok: true, row: existing.row };

  const first = orderedSteps(args.program.steps)[0];
  if (!first) return { ok: false, message: PROGRAMS_COPY.progressSaveFailed };

  const row: LearningProgressRow = {
    clerk_user_id: args.memberId,
    mini_program_id: args.program.id,
    current_step_id: first.id,
    status: "in_progress",
    curriculum_version: args.program.curriculum_version,
    started_at: args.now,
    completed_at: null,
    updated_at: args.now,
  };
  const inserted = await db.insert(row);
  if (inserted.error && isUniqueProgramsConflict(inserted.error)) {
    const raced = await getMiniProgramProgress(db, args.memberId, args.program.id);
    if (!raced.ok) return raced;
    if (raced.row) return { ok: true, row: raced.row };
    return { ok: false, message: PROGRAMS_COPY.progressSaveFailed };
  }
  if (inserted.error || !inserted.data) {
    return { ok: false, message: saveMessage(inserted.error) };
  }
  return { ok: true, row: inserted.data };
}

export async function repairFrontierIfMissing(
  db: ProgressDb,
  memberId: string,
  steps: readonly StepRef[],
  row: LearningProgressRow
): Promise<ProgressResult<LearningProgressRow>> {
  if (row.status !== "in_progress") return { ok: true, row };
  if (steps.some((step) => step.id === row.current_step_id)) return { ok: true, row };

  const first = orderedSteps(steps)[0];
  if (!first) return { ok: false, message: PROGRAMS_COPY.progressSaveFailed };

  const updated = await db.updateFrontier({
    clerkUserId: memberId,
    miniProgramId: row.mini_program_id,
    fromStepId: row.current_step_id,
    nextStepId: first.id,
    updatedAt: new Date().toISOString(),
  });
  if (updated.error) return { ok: false, message: saveMessage(updated.error) };
  if (updated.data) return { ok: true, row: updated.data };

  const again = await getMiniProgramProgress(db, memberId, row.mini_program_id);
  if (!again.ok) return again;
  const current = again.row;
  if (current && steps.some((step) => step.id === current.current_step_id)) {
    return { ok: true, row: current };
  }
  return { ok: false, message: PROGRAMS_COPY.progressSaveFailed };
}

export async function applyProgressTransition(args: {
  db: ProgressDb;
  memberId: string;
  miniProgramId: string;
  stepId: string;
  decision: ContinueDecision;
  now: string;
}): Promise<{ ok: true; destination: ContinueDestination } | { ok: false; message: string }> {
  if (args.decision.kind === "advance") {
    const updated = await args.db.updateFrontier({
      clerkUserId: args.memberId,
      miniProgramId: args.miniProgramId,
      fromStepId: args.stepId,
      nextStepId: args.decision.nextStepId,
      updatedAt: args.now,
    });
    if (updated.error) return { ok: false, message: saveMessage(updated.error) };
    if (updated.data) {
      return { ok: true, destination: { type: "step", stepId: args.decision.nextStepId } };
    }
    return currentDestination(args.db, args.memberId, args.miniProgramId, args.stepId);
  }

  if (args.decision.kind === "complete") {
    const updated = await args.db.markCompleted({
      clerkUserId: args.memberId,
      miniProgramId: args.miniProgramId,
      stepId: args.stepId,
      completedAt: args.now,
    });
    if (updated.error) return { ok: false, message: saveMessage(updated.error) };
    if (updated.data) return { ok: true, destination: { type: "programs" } };
    return currentDestination(args.db, args.memberId, args.miniProgramId, args.stepId);
  }

  if (args.decision.kind === "review-next") {
    return { ok: true, destination: { type: "step", stepId: args.decision.nextStepId } };
  }
  if (args.decision.kind === "review-end") {
    return { ok: true, destination: { type: "programs" } };
  }
  return { ok: false, message: PROGRAMS_COPY.stepLocked };
}

async function currentDestination(
  db: ProgressDb,
  memberId: string,
  miniProgramId: string,
  stepId: string
): Promise<{ ok: true; destination: ContinueDestination } | { ok: false; message: string }> {
  const again = await getMiniProgramProgress(db, memberId, miniProgramId);
  if (!again.ok) return again;
  if (!again.row) return { ok: false, message: PROGRAMS_COPY.progressSaveFailed };
  if (again.row.status === "in_progress" && again.row.current_step_id === stepId) {
    return { ok: false, message: PROGRAMS_COPY.progressSaveFailed };
  }
  if (again.row.status === "completed") {
    return { ok: true, destination: { type: "programs" } };
  }
  return { ok: true, destination: { type: "step", stepId: again.row.current_step_id } };
}

function loadMessage(error: ProgramsDbError | null): string {
  if (error && isMissingProgramsTable(error)) return PROGRAMS_COPY.tablesMissing;
  return PROGRAMS_COPY.progressLoadFailed;
}

function saveMessage(error: ProgramsDbError | null): string {
  if (error && isMissingProgramsTable(error)) return PROGRAMS_COPY.tablesMissing;
  return PROGRAMS_COPY.progressSaveFailed;
}
