"use client";

import { useEffect, useRef } from "react";
import { utBody, utBodyMuted, utSecondaryBtn } from "@/components/utility-page-visual";
import {
  programsChoiceIdle,
  programsChoiceSelected,
  programsMissPanel,
  programsSectionCard,
  programsSuccessPanel,
} from "@/components/programs/programs-visual";
import type { PublicQuizBlock } from "@/lib/learning/curriculum-types";
import { PROGRAMS_COPY, quizInstructions, quizScoreLine } from "@/lib/learning/programs-copy";

export type KnowledgeCheckResult = {
  correctCount: number;
  questionCount: number;
  minimumCorrect: number;
  questions?: Array<{ questionId: string; correct: boolean }>;
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
  const scoreIsEnough = result !== null && result.correctCount >= result.minimumCorrect;

  useEffect(() => {
    if (!result || typeof resultsRef.current?.scrollIntoView !== "function") return;
    resultsRef.current.scrollIntoView({ block: "center" });
  }, [result]);

  return (
    <div className="space-y-5">
      <p className={utBodyMuted}>{quizInstructions(block.minimum_correct, block.questions.length)}</p>
      {block.questions.map((question) => {
        const multiple = question.question_type === "multiple_choice";
        const selected = answers[question.question_id] ?? [];
        const questionResult = result?.questions?.find(
          (item) => item.questionId === question.question_id
        );
        return (
          <div
            key={question.question_id}
            data-question-card=""
            role="group"
            aria-label={question.prompt}
            className={programsSectionCard}
          >
            <p className={`${utBody} break-words font-medium text-stone-100`}>{question.prompt}</p>
            {questionResult ? (
              <p
                className={
                  questionResult.correct
                    ? "text-sm font-semibold text-emerald-200"
                    : "text-sm font-semibold text-red-200"
                }
              >
                {questionResult.correct ? "Correct" : "Incorrect"}
              </p>
            ) : null}
            <div className="space-y-3">
              {question.choices.map((choice) => {
                const chosen = selected.includes(choice.id);
                return (
                  <label
                    key={choice.id}
                    data-selected={chosen ? "true" : "false"}
                    className={`${utBody} ${chosen ? programsChoiceSelected : programsChoiceIdle}`}
                  >
                    <input
                      className="mt-1 h-5 w-5 shrink-0"
                      type={multiple ? "checkbox" : "radio"}
                      name={question.question_id}
                      checked={chosen}
                      onChange={() => onToggleChoice(question.question_id, choice.id, multiple)}
                    />
                    <span className="break-words">{choice.text}</span>
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
          className={`${scoreIsEnough ? programsSuccessPanel : programsMissPanel} space-y-1 text-base`}
          role="status"
        >
          <p className="font-semibold">{PROGRAMS_COPY.quizYourScore}</p>
          <p className="text-lg font-semibold">
            {scoreIsEnough ? PROGRAMS_COPY.quizPassed : PROGRAMS_COPY.quizFailed}
          </p>
          <p>{quizScoreLine(result.correctCount, result.questionCount)}</p>
          <p>
            Passing: {result.minimumCorrect} of {result.questionCount}
          </p>
          {scoreIsEnough ? null : (
            <button type="button" className={`${utSecondaryBtn} mt-3`} onClick={onTakeAgain}>
              {PROGRAMS_COPY.quizTakeAgain}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
