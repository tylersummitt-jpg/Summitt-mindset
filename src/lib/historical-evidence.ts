/**
 * Shared model-facing historical evidence slice for Sol Hallway packets
 * and Morning-derived interpreter input.
 *
 * Populated from durable user-message evidence and bounded v2_win candidates.
 * One array. source distinguishes them. Then, not now.
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
 * Internal merge carrier. Sort keys never appear on the model-facing item.
 */
export type HistoricalEvidenceChronologyCarrier = {
  occurred_at_ms: number;
  id: string;
  item: HistoricalEvidenceItem;
};

/**
 * Combine user-message + Win historical evidence oldest → newest.
 * Timestamps + id tie-break happen before YYYY-MM-DD projection.
 */
export function mergeHistoricalEvidenceChronologically(
  ...groups: ReadonlyArray<readonly HistoricalEvidenceChronologyCarrier[]>
): HistoricalEvidenceSlice {
  const merged = groups.flat();
  if (merged.length === 0) return EMPTY_HISTORICAL_EVIDENCE;
  merged.sort((a, b) => {
    if (a.occurred_at_ms !== b.occurred_at_ms) return a.occurred_at_ms - b.occurred_at_ms;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  return merged.map((row) => row.item);
}

/**
 * Field-scoped history law for interpreter + writer system prompts.
 * Applies only to packet/input field historical_evidence — not exact_thread.
 */
export const HISTORICAL_EVIDENCE_HISTORY_LAW =
  "Historical evidence records what the member said or did then; it is not proof of current state. source=win is a dated completion fact, not a user quote; source=user_message is exact user wording. Use it only when it materially improves today's coaching. The live human situation and latest explicit user truth outrank it. Historical evidence is available context, not a prompt to mention history. This law applies only to packet/input field historical_evidence. exact_thread is the current conversation. If historical_evidence is empty, ignore it and coach as you do today.";
