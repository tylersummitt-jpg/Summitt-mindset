export const COMMITMENT_MEANING_INTERPRETER_PROMPT_VERSION = "v1_phase1";

export type CommitmentInterpretationPendingKind = "commitment_replace" | "commitment_tighten";

export type CommitmentInterpretationInput = {
  rawUserText: string;
  pendingKind: CommitmentInterpretationPendingKind;
  currentBarSummary: string | null;
  promptVersion: string;
};

export type CommitmentInterpretationResult =
  | {
      ok: true;
      interpreted_daily_bar: string | null;
      confidence: number;
      needs_clarification: boolean;
      clarification_question: string | null;
      promptVersion: string;
    }
  | { ok: false; reason: string };
