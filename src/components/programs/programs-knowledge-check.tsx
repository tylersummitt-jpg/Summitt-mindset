"use client";

import { useEffect, useRef } from "react";
import { utBody, utBodyMuted, utSecondaryBtn } from "@/components/utility-page-visual";
import {
  programsChoiceCorrect,
  programsChoiceIdle,
  programsChoiceIncorrect,
  programsChoiceNeutral,
  programsChoiceSelected,
  programsSectionCard,
  programsSuccessPanel,
} from "@/components/programs/programs-visual";
import type { PublicQuizBlock } from "@/lib/learning/curriculum-types";
import { PROGRAMS_COPY, quizInstructions, quizScoreLine } from "@/lib/learning/programs-copy";

export type KnowledgeCheckResult = {
  correctCount: number;
  questionCount: number;
  minimumCorrect: number;
  questions?: Array<{
    questionId: string;
    correct: boolean;
    selectedChoiceIds?: string[];
    correctChoiceIds?: string[];
  }>;
};

export function ProgramsKnowledgeCheck({
  block,
  answers,
  result,
  onToggleChoice,
  onTakeAgain,
}: {
  block: PublicQuizBlock;
  answers: Record<string, string[]>;
  result: KnowledgeCheckResult | null;
  onToggleChoice: (questionId: string, choiceId: string, multiple: boolean) => void;
  onTakeAgain: () => void;
}) {
  const resultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!result || typeof resultsRef.current?.scrollIntoView !== "function") return;
    resultsRef.current.scrollIntoView({ block: "center" });
  }, [result]);

  return (
    <div className="min-w-0 space-y-5">
      <p className={utBodyMuted}>{quizInstructions()}</p>
      {block.questions.map((question) => {
        const multiple = question.question_type === "multiple_choice";
        const questionResult = result?.questions?.find(
          (item) => item.questionId === question.question_id
        );
        const selected = questionResult?.selectedChoiceIds ?? answers[question.question_id] ?? [];
        const correctChoiceIds = new Set(questionResult?.correctChoiceIds ?? []);
        const revealed = questionResult !== undefined && correctChoiceIds.size > 0;
        return (
          <div
            key={question.question_id}
            data-question-card=""
            data-question-result={
              questionResult ? (questionResult.correct ? "correct" : "incorrect") : undefined
            }
            role="group"
            aria-label={question.prompt}
            className={`${programsSectionCard} min-w-0`}
          >
            <p className={`${utBody} break-words font-medium text-stone-100`}>{question.prompt}</p>
            {questionResult ? (
              <p
                className={
                  questionResult.correct
                    ? "inline-flex items-center gap-2 text-sm font-semibold text-emerald-200"
                    : "inline-flex items-center gap-2 text-sm font-semibold text-red-200"
                }
              >
                <ResultIcon correct={questionResult.correct} />
                {questionResult.correct ? "Correct" : "Incorrect"}
              </p>
            ) : null}
            <div className="space-y-3">
              {question.choices.map((choice) => {
                const chosen = selected.includes(choice.id);
                const isCorrectChoice = revealed && correctChoiceIds.has(choice.id);
                const isWrongSelection = revealed && chosen && !isCorrectChoice;
                const marker = isCorrectChoice
                  ? "Correct answer"
                  : isWrongSelection
                    ? "Your answer"
                    : null;
                const tone = isCorrectChoice
                  ? programsChoiceCorrect
                  : isWrongSelection
                    ? programsChoiceIncorrect
                    : revealed
                      ? programsChoiceNeutral
                      : chosen
                        ? programsChoiceSelected
                        : programsChoiceIdle;
                return (
                  <label
                    key={choice.id}
                    data-selected={chosen ? "true" : "false"}
                    data-choice-result={
                      isCorrectChoice ? "correct" : isWrongSelection ? "incorrect" : revealed ? "neutral" : undefined
                    }
                    className={`${utBody} ${tone}`}
                  >
                    <input
                      className="mt-1 h-5 w-5 shrink-0"
                      type={multiple ? "checkbox" : "radio"}
                      name={question.question_id}
                      checked={chosen}
                      disabled={result !== null}
                      onChange={() => onToggleChoice(question.question_id, choice.id, multiple)}
                    />
                    <span className="min-w-0 flex-1 break-words">{choice.text}</span>
                    {marker ? (
                      <span
                        className={
                          isCorrectChoice
                            ? "inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-emerald-200"
                            : "inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-red-200"
                        }
                      >
                        <ResultIcon correct={isCorrectChoice} />
                        {marker}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
      {result ? (
        <div
          ref={resultsRef}
          className={`${programsSuccessPanel} min-w-0 space-y-2 text-base`}
          role="status"
        >
          <p className="font-semibold">{PROGRAMS_COPY.quizYourScore}</p>
          <p className="text-lg font-semibold">
            {quizScoreLine(result.correctCount, result.questionCount)}
          </p>
          <p>{PROGRAMS_COPY.quizReview}</p>
          <p>{PROGRAMS_COPY.quizAnotherTry}</p>
          <button
            type="button"
            className={`${utSecondaryBtn} mt-1 w-full sm:w-auto`}
            onClick={onTakeAgain}
          >
            {PROGRAMS_COPY.quizTakeAgain}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ResultIcon({ correct }: { correct: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden="true">
      {correct ? (
        <path
          d="M3 8.5 6.2 12 13 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M4 4 12 12 M12 4 4 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
