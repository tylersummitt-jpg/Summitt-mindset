import type { LearningStep } from "./curriculum-types";
import { PROGRAMS_COPY, REFLECTION_PROMPT_MAX } from "./programs-copy";
import { isMissingProgramsTable, type ProgramsDbError } from "./programs-db-error";
import { normalizeReflectionAnswer } from "./reflection-text";

export type LearningReflectionRow = {
  id: string;
  clerk_user_id: string;
  mini_program_id: string;
  step_id: string;
  question_id: string;
  question_text: string;
  answer_text: string;
  created_at: string;
  updated_at: string;
};

export type ReflectionDbResult<T> = {
  data: T | null;
  error: ProgramsDbError | null;
};

export type ReflectionDb = {
  listForStep(
    clerkUserId: string,
    miniProgramId: string,
    stepId: string
  ): Promise<ReflectionDbResult<LearningReflectionRow[]>>;
  upsert(input: {
    clerkUserId: string;
    miniProgramId: string;
    stepId: string;
    questionId: string;
    questionText: string;
    answerText: string;
    updatedAt: string;
  }): Promise<ReflectionDbResult<LearningReflectionRow>>;
};

export async function listReflectionAnswers(
  db: ReflectionDb,
  memberId: string,
  miniProgramId: string,
  stepId: string
): Promise<{ ok: true; rows: LearningReflectionRow[] } | { ok: false; message: string }> {
  const result = await db.listForStep(memberId, miniProgramId, stepId);
  if (result.error) return { ok: false, message: failureMessage(result.error, "load") };
  return { ok: true, rows: result.data ?? [] };
}

export async function saveReflectionAnswer(
  db: ReflectionDb,
  args: {
    memberId: string;
    miniProgramId: string;
    stepId: string;
    questionId: string;
    questionText: string;
    answerText: string;
    now: string;
  }
): Promise<{ ok: true; row: LearningReflectionRow } | { ok: false; message: string }> {
  const questionText = args.questionText.trim();
  if (!questionText || questionText.length > REFLECTION_PROMPT_MAX) {
    return { ok: false, message: PROGRAMS_COPY.reflectionSaveFailed };
  }
  const normalized = normalizeReflectionAnswer(args.answerText);
  if (!normalized.ok) return normalized;

  const saved = await db.upsert({
    clerkUserId: args.memberId,
    miniProgramId: args.miniProgramId,
    stepId: args.stepId,
    questionId: args.questionId,
    questionText,
    answerText: normalized.text,
    updatedAt: args.now,
  });
  if (saved.error || !saved.data) {
    return { ok: false, message: failureMessage(saved.error, "save") };
  }
  return { ok: true, row: saved.data };
}

export async function saveStepReflections(args: {
  db: ReflectionDb;
  memberId: string;
  miniProgramId: string;
  step: LearningStep;
  answers: Record<string, string>;
  now: string;
  requireComplete: boolean;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  let failure: string | null = null;

  for (const block of args.step.blocks) {
    if (block.type !== "reflection" || block.persist === false) continue;
    const raw = args.answers[block.question_id] ?? "";
    const normalized = normalizeReflectionAnswer(raw);
    if (!normalized.ok) {
      if (!args.requireComplete && raw.trim().length === 0) continue;
      if (!failure) failure = normalized.message;
      continue;
    }
    const saved = await saveReflectionAnswer(args.db, {
      memberId: args.memberId,
      miniProgramId: args.miniProgramId,
      stepId: args.step.id,
      questionId: block.question_id,
      questionText: block.prompt,
      answerText: normalized.text,
      now: args.now,
    });
    if (!saved.ok) return saved;
  }

  if (failure) return { ok: false, message: failure };
  return { ok: true };
}

function failureMessage(error: ProgramsDbError | null, kind: "load" | "save"): string {
  if (error && isMissingProgramsTable(error)) return PROGRAMS_COPY.tablesMissing;
  return kind === "load" ? PROGRAMS_COPY.progressLoadFailed : PROGRAMS_COPY.reflectionSaveFailed;
}
