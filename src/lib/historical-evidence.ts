/**
 * Shared model-facing historical evidence slice for Sol Hallway packets
 * and Morning-derived interpreter input.
 *
 * Commit 2: populated from public.v2_durable_user_evidence (source=user_message).
 * Wins are not loaded here.
 */

export const HISTORICAL_EVIDENCE_SOURCES = ["user_message", "win"] as const;
export type HistoricalEvidenceSource = (typeof HISTORICAL_EVIDENCE_SOURCES)[number];

export type HistoricalEvidenceItem = {
  source: HistoricalEvidenceSource;
  /** Calendar date YYYY-MM-DD. */
  occurred_at: string;
  evidence: string;
  user_quote?: string;
};

export type HistoricalEvidenceSlice = readonly HistoricalEvidenceItem[];

export const EMPTY_HISTORICAL_EVIDENCE: HistoricalEvidenceSlice = Object.freeze(
  [] as HistoricalEvidenceItem[]
);

/**
 * Field-scoped history law for interpreter + writer system prompts.
 * Applies only to packet/input field historical_evidence — not exact_thread.
 */
export const HISTORICAL_EVIDENCE_HISTORY_LAW =
  "Historical evidence records what the member said or did then; it is not proof of current state. source=win is a dated completion fact, not a user quote; source=user_message is exact user wording. Use it only when it materially improves today's coaching. The live human situation and latest explicit user truth outrank it. Historical evidence is available context, not a prompt to mention history. This law applies only to packet/input field historical_evidence. exact_thread is the current conversation. If historical_evidence is empty, ignore it and coach as you do today.";
