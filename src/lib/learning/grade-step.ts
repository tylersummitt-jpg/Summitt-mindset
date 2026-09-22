import type {
  LearningQuizBlock,
  LearningQuizQuestion,
  LearningSortBlock,
  LearningSortCard,
  LearningStep,
} from "./curriculum-types";
import { PROGRAMS_COPY, quizResultMessage } from "./programs-copy";
import { normalizeReflectionAnswer } from "./reflection-text";

export type StepSubmission = {
  reflections: Record<string, string>;
  quizAnswers: Record<string, string[]>;
  sortPlacements: Record<string, string>;
};

export type QuizQuestionResult = {
  questionId: string;
  correct: boolean;
};

export type QuizClientScore = {
  correctCount: number;
  questionCount: number;
  minimumCorrect: number;
  questions: QuizQuestionResult[];
};

export function gradeQuizQuestion(
  question: LearningQuizQuestion,
  selectedIds: readonly string[]
): boolean {
  return sameSet(selectedIds, question.correct_choice_ids);
}

export function gradeQuiz(
  block: LearningQuizBlock,
  answers: Record<string, string[]>
): { correctCount: number; passed: boolean; questions: QuizQuestionResult[] } {
  const questions = block.questions.map((question) => ({
    questionId: question.question_id,
    correct: gradeQuizQuestion(question, answers[question.question_id] ?? []),
  }));
  const correctCount = questions.filter((question) => question.correct).length;
  return {
    correctCount,
    passed: correctCount >= block.minimum_correct,
    questions,
  };
}

export function gradeSortCard(card: LearningSortCard, category: string): boolean {
  return category === card.correct_category;
}

export function gradeSort(
  block: LearningSortBlock,
  placements: Record<string, string>
): { complete: boolean; incorrectCardIds: string[] } {
  const incorrectCardIds = block.cards
    .filter((card) => placements[card.id] !== card.correct_category)
    .map((card) => card.id);
  return {
    complete: incorrectCardIds.length === 0,
    incorrectCardIds,
  };
}

export function validateStepRequirements(
  step: LearningStep,
  submission: StepSubmission
):
  | { ok: true; quiz: QuizClientScore | null }
  | { ok: false; message: string; quiz?: QuizClientScore } {
  for (const block of step.blocks) {
    if (block.type !== "reflection") continue;
    const normalized = normalizeReflectionAnswer(submission.reflections[block.question_id] ?? "");
    if (!normalized.ok) return normalized;
  }

  let quiz: QuizClientScore | null = null;
  for (const block of step.blocks) {
    if (block.type !== "quiz") continue;
    const graded = gradeQuiz(block, submission.quizAnswers);
    const score: QuizClientScore = {
      correctCount: graded.correctCount,
      questionCount: block.questions.length,
      minimumCorrect: block.minimum_correct,
      questions: graded.questions,
    };
    if (!graded.passed) {
      return {
        ok: false,
        message: quizResultMessage(score.correctCount, score.questionCount, score.minimumCorrect),
        quiz: score,
      };
    }
    quiz = score;
  }

  for (const block of step.blocks) {
    if (block.type !== "sort") continue;
    const graded = gradeSort(block, submission.sortPlacements);
    if (!graded.complete) {
      return { ok: false, message: PROGRAMS_COPY.sortIncomplete };
    }
  }

  return { ok: true, quiz };
}

export function gradeQuizBlock(
  step: LearningStep,
  answers: Record<string, string[]>
):
  | { ok: true; quiz: QuizClientScore }
  | { ok: false; message: string; quiz?: QuizClientScore } {
  const block = step.blocks.find((candidate) => candidate.type === "quiz");
  if (!block || block.type !== "quiz") {
    return { ok: false, message: PROGRAMS_COPY.unavailable };
  }
  const graded = gradeQuiz(block, answers);
  const quiz: QuizClientScore = {
    correctCount: graded.correctCount,
    questionCount: block.questions.length,
    minimumCorrect: block.minimum_correct,
    questions: graded.questions,
  };
  if (graded.correctCount < block.minimum_correct) {
    return {
      ok: false,
      message: quizResultMessage(quiz.correctCount, quiz.questionCount, quiz.minimumCorrect),
      quiz,
    };
  }
  return { ok: true, quiz };
}

export function checkSortPlacement(
  step: LearningStep,
  cardId: string,
  category: string
): { ok: true; correct: boolean } | { ok: false; message: string } {
  for (const block of step.blocks) {
    if (block.type !== "sort") continue;
    const card = block.cards.find((candidate) => candidate.id === cardId);
    if (!card) continue;
    if (!block.categories.includes(category)) {
      return { ok: true, correct: false };
    }
    return { ok: true, correct: gradeSortCard(card, category) };
  }
  return { ok: false, message: PROGRAMS_COPY.sortCardMissing };
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}
