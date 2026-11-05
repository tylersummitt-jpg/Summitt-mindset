"use client";

import { useId } from "react";

import {
  EXIT_SURVEY_COMMENT_MAX,
  EXIT_SURVEY_COMMENT_QUESTION,
  EXIT_SURVEY_REASON_QUESTION,
  EXIT_SURVEY_REASONS,
  type ExitSurveyReasonCode,
} from "@/lib/exit-survey";

export type ExitSurveyStep = "reason" | "comment";

export type ExitFeedbackClassNames = {
  question: string;
  note: string;
  choice: string;
  choiceOn: string;
  primary: string;
  secondary: string;
  field: string;
};

const PAPER: ExitFeedbackClassNames = {
  question: "font-semibold text-gray-900",
  note: "text-sm text-gray-600",
  choice: "w-full text-left px-4 py-3 rounded-md border text-sm hover:bg-gray-50",
  choiceOn: "w-full text-left px-4 py-3 rounded-md border border-black bg-gray-50 text-sm font-semibold",
  primary:
    "w-full sm:w-auto rounded-md bg-black text-white px-5 py-3 text-sm font-semibold disabled:opacity-50",
  secondary:
    "w-full sm:w-auto rounded-md border border-black bg-white text-black px-5 py-3 text-sm font-semibold",
  field: "w-full border rounded-md p-3 text-base",
};

export function ExitFeedbackScreens({
  step,
  reasonCode,
  comment,
  onChangeReason,
  onChangeComment,
  onSkipReason,
  onContinueReason,
  onBackToReason,
  onSkipComment,
  onContinueComment,
  preface,
  commentNotice,
  retainLabel,
  retainChecked = false,
  onChangeRetain,
  classes = PAPER,
}: {
  step: ExitSurveyStep;
  reasonCode: ExitSurveyReasonCode | null;
  comment: string;
  onChangeReason: (code: ExitSurveyReasonCode) => void;
  onChangeComment: (value: string) => void;
  onSkipReason: () => void;
  onContinueReason: () => void;
  onBackToReason: () => void;
  onSkipComment: () => void;
  onContinueComment: () => void;
  preface?: string;
  commentNotice?: string;
  retainLabel?: string;
  retainChecked?: boolean;
  onChangeRetain?: (value: boolean) => void;
  classes?: ExitFeedbackClassNames;
}) {
  const reasonQuestionId = useId();
  const commentQuestionId = useId();
  const commentFieldId = useId();

  return (
    <div className="space-y-4" data-testid="exit-survey">
      {preface ? <p className={classes.note}>{preface}</p> : null}
      {step === "reason" ? (
        <div className="space-y-3">
          <h2 id={reasonQuestionId} className={classes.question} tabIndex={-1}>
            {EXIT_SURVEY_REASON_QUESTION}
          </h2>
          <div role="radiogroup" aria-labelledby={reasonQuestionId} className="space-y-2">
            {EXIT_SURVEY_REASONS.map((reason) => {
              const selected = reasonCode === reason.code;
              return (
                <button
                  key={reason.code}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onChangeReason(reason.code)}
                  className={selected ? classes.choiceOn : classes.choice}
                >
                  {reason.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button type="button" className={classes.secondary} onClick={onSkipReason}>
              Skip
            </button>
            <button
              type="button"
              className={classes.primary}
              onClick={onContinueReason}
              disabled={reasonCode == null}
            >
              Continue
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <h2 id={commentQuestionId} className={classes.question} tabIndex={-1}>
            {EXIT_SURVEY_COMMENT_QUESTION}
          </h2>
          <label htmlFor={commentFieldId} className={classes.note}>
            Optional. You can leave this blank.
          </label>
          {commentNotice ? <p className={classes.note}>{commentNotice}</p> : null}
          {retainLabel ? (
            <label className={`${classes.note} flex items-start gap-2`}>
              <input
                type="checkbox"
                className="mt-1"
                checked={retainChecked}
                onChange={(event) => onChangeRetain?.(event.target.checked)}
              />
              <span>{retainLabel}</span>
            </label>
          ) : null}
          <textarea
            id={commentFieldId}
            rows={4}
            maxLength={EXIT_SURVEY_COMMENT_MAX}
            value={comment}
            onChange={(event) => onChangeComment(event.target.value)}
            className={classes.field}
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button type="button" className={classes.secondary} onClick={onBackToReason}>
              Back
            </button>
            <button type="button" className={classes.secondary} onClick={onSkipComment}>
              Skip
            </button>
            <button type="button" className={classes.primary} onClick={onContinueComment}>
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
