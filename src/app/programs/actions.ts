"use server";

import { parseContinuePayload } from "@/lib/learning/continue-payload";
import { getLearningMiniProgram, getLearningStep } from "@/lib/learning/load-curriculum";
import { checkSortPlacement, gradeQuizBlock, type QuizClientScore } from "@/lib/learning/grade-step";
import { continueMiniProgramStep } from "@/lib/learning/continue-step";
import { supabaseProgressDb } from "@/lib/learning/mini-program-progress-db";
import { getMiniProgramProgress, type ContinueDestination } from "@/lib/learning/mini-program-progress";
import { learningStepPath } from "@/lib/learning/program-paths";
import { PROGRAMS_COPY } from "@/lib/learning/programs-copy";
import { requireProgramsMemberId } from "@/lib/learning/programs-session";
import { saveReflectionAnswer } from "@/lib/learning/reflection-answers";
import { supabaseReflectionDb } from "@/lib/learning/reflection-answers-db";
import { canPersistOnStep } from "@/lib/learning/step-access";

type ActionResult =
  | { ok: true; href: string; quiz?: QuizClientScore }
  | { ok: false; message: string; quiz?: QuizClientScore };

export async function continueLearningStep(input: unknown): Promise<ActionResult> {
  const memberId = await requireProgramsMemberId();
  const parsed = parseContinuePayload(input);
  if (!parsed) return { ok: false, message: PROGRAMS_COPY.unavailable };

  const program = getLearningMiniProgram(parsed.miniProgramId);
  if (!program) return { ok: false, message: PROGRAMS_COPY.unavailable };

  const result = await continueMiniProgramStep({
    progressDb: supabaseProgressDb(),
    reflectionDb: supabaseReflectionDb(),
    memberId,
    program,
    stepId: parsed.stepId,
    submission: {
      reflections: parsed.reflections,
      quizAnswers: parsed.quizAnswers,
      sortPlacements: parsed.sortPlacements,
    },
    now: new Date().toISOString(),
  });
  if (!result.ok) {
    return result.quiz
      ? { ok: false, message: result.message, quiz: result.quiz }
      : { ok: false, message: result.message };
  }
  const href = hrefFor(program.id, result.destination);
  return result.quiz ? { ok: true, href, quiz: result.quiz } : { ok: true, href };
}

export async function gradeLearningStep(input: unknown): Promise<
  { ok: true; quiz: QuizClientScore } | { ok: false; message: string; quiz?: QuizClientScore }
> {
  const memberId = await requireProgramsMemberId();
  const parsed = parseContinuePayload(input);
  if (!parsed) return { ok: false, message: PROGRAMS_COPY.unavailable };

  const step = getLearningStep(parsed.miniProgramId, parsed.stepId);
  if (!step) return { ok: false, message: PROGRAMS_COPY.unavailable };
  const writable = await memberCanPersist(memberId, parsed.miniProgramId, step.id);
  if (!writable.ok) return writable;
  return gradeQuizBlock(step, parsed.quizAnswers);
}

export async function saveLearningReflection(input: unknown): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const memberId = await requireProgramsMemberId();
  const parsed = parseReflectionInput(input);
  if (!parsed) return { ok: false, message: PROGRAMS_COPY.unavailable };

  const step = getLearningStep(parsed.miniProgramId, parsed.stepId);
  const block = step?.blocks.find(
    (candidate) => candidate.type === "reflection" && candidate.question_id === parsed.questionId
  );
  if (!step || !block || block.type !== "reflection" || block.persist === false) {
    return { ok: false, message: PROGRAMS_COPY.unavailable };
  }

  const program = getLearningMiniProgram(parsed.miniProgramId);
  if (!program) return { ok: false, message: PROGRAMS_COPY.unavailable };
  const writable = await memberCanPersist(memberId, program.id, step.id);
  if (!writable.ok) return writable;

  const saved = await saveReflectionAnswer(supabaseReflectionDb(), {
    memberId,
    miniProgramId: parsed.miniProgramId,
    stepId: step.id,
    questionId: block.question_id,
    questionText: block.prompt,
    answerText: parsed.answerText,
    now: new Date().toISOString(),
  });
  if (!saved.ok) return saved;
  return { ok: true };
}

export async function checkLearningSortCard(input: unknown): Promise<
  { ok: true; correct: boolean } | { ok: false; message: string }
> {
  const memberId = await requireProgramsMemberId();
  const parsed = parseSortInput(input);
  if (!parsed) return { ok: false, message: PROGRAMS_COPY.sortCardMissing };

  const step = getLearningStep(parsed.miniProgramId, parsed.stepId);
  if (!step) return { ok: false, message: PROGRAMS_COPY.sortCardMissing };
  const writable = await memberCanPersist(memberId, parsed.miniProgramId, step.id);
  if (!writable.ok) return { ok: false, message: writable.message };
  return checkSortPlacement(step, parsed.cardId, parsed.category);
}

function hrefFor(miniProgramId: string, destination: ContinueDestination): string {
  if (destination.type === "programs") return "/programs";
  return learningStepPath(miniProgramId, destination.stepId);
}

async function memberCanPersist(
  memberId: string,
  miniProgramId: string,
  stepId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const program = getLearningMiniProgram(miniProgramId);
  if (!program) return { ok: false, message: PROGRAMS_COPY.unavailable };
  const loaded = await getMiniProgramProgress(supabaseProgressDb(), memberId, program.id);
  if (!loaded.ok) return loaded;
  if (!canPersistOnStep(loaded.row, program.steps, stepId)) {
    return { ok: false, message: PROGRAMS_COPY.stepLocked };
  }
  return { ok: true };
}

function parseReflectionInput(input: unknown): {
  miniProgramId: string;
  stepId: string;
  questionId: string;
  answerText: string;
} | null {
  if (!isRecord(input)) return null;
  const miniProgramId = readId(input.miniProgramId);
  const stepId = readId(input.stepId);
  const questionId = readId(input.questionId);
  if (!miniProgramId || !stepId || !questionId) return null;
  if (typeof input.answerText !== "string" || input.answerText.length > 4500) return null;
  return { miniProgramId, stepId, questionId, answerText: input.answerText };
}

function parseSortInput(input: unknown): {
  miniProgramId: string;
  stepId: string;
  cardId: string;
  category: string;
} | null {
  if (!isRecord(input)) return null;
  const miniProgramId = readId(input.miniProgramId);
  const stepId = readId(input.stepId);
  const cardId = readId(input.cardId);
  if (!miniProgramId || !stepId || !cardId) return null;
  if (typeof input.category !== "string" || input.category.trim().length === 0) return null;
  if (input.category.length > 200) return null;
  return { miniProgramId, stepId, cardId, category: input.category };
}

function readId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) return null;
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
