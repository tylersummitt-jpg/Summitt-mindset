/**
 * Forensic copy of a nonempty Tyler sentence that a newer real conversation replaced.
 * History only. Not an authority clock.
 */

export const STALE_TYLER_REPLACEMENT_REASON = "conversation_newer_than_tyler_edit";

export function staleTylerConversationReplacementMetadata(args: {
  body: string | null;
  editedAt: string | null;
}): Record<string, string | null> {
  return {
    replaced_stale_tyler_body: args.body,
    replaced_stale_tyler_edited_at: args.editedAt,
    replacement_reason: STALE_TYLER_REPLACEMENT_REASON,
  };
}

/**
 * Same pin as public.tto_finish_generation_persistence.
 * The new flag lifts Tyler protection only for a nonempty Tyler body.
 */
export function ttoFinishWouldProtectDraft(args: {
  draftExists: boolean;
  tyler: boolean;
  nonempty: boolean;
  protectTylerProvenanceOnly: boolean;
  allowReplaceStaleTylerNonempty: boolean;
}): boolean {
  if (!args.draftExists) return false;
  const replace =
    args.allowReplaceStaleTylerNonempty && args.tyler && args.nonempty;
  return (args.tyler && !replace) || (!args.protectTylerProvenanceOnly && args.nonempty);
}
