export const PROGRAMS_COPY = {
  reflectionRequired: "Enter a response before continuing.",
  unsavedReflectionRequired: "Submit your reflection before continuing.",
  reflectionTooLong: "Keep this response under 4000 characters.",
  reflectionSaveFailed: "We couldn't save your response. You're still on this step.",
  progressSaveFailed: "We couldn't save your place. You're still on this step.",
  progressLoadFailed: "We couldn't load your place in this program.",
  tablesMissing:
    "Programs progress isn't available yet. Your place in this lesson can't be saved until the Programs tables are created.",
  sortIncomplete: "Place every card before continuing.",
  sortRetry: "Not that one. Try the other category.",
  sortCorrect: "That's the one.",
  sortReplay: "Replay",
  scenarioComplete: "Scenario Complete!",
  scenarioStartOver: "Start over",
  quizTakeAgain: "Try again",
  quizCheckResults: "See results",
  quizYourScore: "Your score",
  quizReview: "Review your answers below.",
  finishedProgram:
    "Congratulations! That concludes this lesson. You can revisit the completed course material at any time.",
  stepLocked: "This step isn't available yet.",
  unavailable: "This step is unavailable.",
  sortCardMissing: "That card isn't part of this step.",
} as const;

export const REFLECTION_ANSWER_MAX = 4000;
export const REFLECTION_PROMPT_MAX = 1000;

export function quizInstructions(): string {
  return "Let's do a quick knowledge check about what we've just covered. Answer the questions, then see your results. You have unlimited attempts, and you can continue after you see how you did.";
}

export function quizScoreLine(correctCount: number, questionCount: number): string {
  return `${correctCount} of ${questionCount} correct`;
}

export function quizPrimaryLabel(input: {
  saving: boolean;
  hasQuiz: boolean;
  graded: boolean;
  isLastStep: boolean;
  enforceRequirements: boolean;
}): "Saving…" | "See results" | "Finish" | "Back to Programs" | "Continue" {
  if (input.saving) return "Saving…";
  if (input.hasQuiz && !input.graded) return "See results";
  if (input.isLastStep && input.enforceRequirements) return "Finish";
  if (input.isLastStep) return "Back to Programs";
  return "Continue";
}

export function sortCompleteMessage(count: number): string {
  return `${count}/${count} Cards Correct`;
}

export function sortCardLabel(index: number, total: number): string {
  return `Card ${index} of ${total}`;
}
