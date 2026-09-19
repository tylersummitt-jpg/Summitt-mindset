/**
 * Morning/Evening post-writer style hygiene: drop emojis that already appeared
 * in the member's previous 5 successfully sent Coach SMS.
 *
 * History comes from exact_thread, which is already writer-facing sent-only
 * (inbound replies + Morning/Evening/Weekly Coach sends; not drafts/previews).
 */

export const RECENT_SENT_COACH_EMOJI_LOOKBACK = 5 as const;

const EMOJI_SEQUENCE_RE =
  /\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*/gu;

export type ExactThreadSenderBody = {
  sender: "coach" | "user";
  body: string;
};

export function extractEmojiSequences(text: string): string[] {
  return text.match(EMOJI_SEQUENCE_RE) ?? [];
}

function emojiKey(sequence: string): string {
  return sequence.replace(/\uFE0F|\uFE0E/g, "");
}

export function recentSentCoachBodiesFromExactThread(
  messages: readonly ExactThreadSenderBody[],
  lookback: number = RECENT_SENT_COACH_EMOJI_LOOKBACK
): string[] {
  return messages
    .filter((m) => m.sender === "coach")
    .slice(-lookback)
    .map((m) => m.body);
}

function recentlyUsedCoachEmojiKeys(recentSentCoachBodies: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const body of recentSentCoachBodies) {
    for (const seq of extractEmojiSequences(body)) {
      const key = emojiKey(seq);
      if (key) keys.add(key);
    }
  }
  return keys;
}

function removeSequencesAndCleanSpacing(body: string, sequences: readonly string[]): string {
  let out = body;
  for (const seq of sequences) {
    if (!seq) continue;
    out = out.split(seq).join("");
  }
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/ +([.,!?;:])/g, "$1");
  return out.trim();
}

/**
 * Remove emojis from a newly generated Morning/Evening SMS when that same emoji
 * appeared in any of the previous successfully sent Coach bodies supplied.
 * Does not substitute a different emoji. Empty result falls back to original.
 */
export function applyRepeatedCoachEmojiHygiene(args: {
  body: string;
  recentSentCoachBodies: readonly string[];
}): string {
  const body = args.body;
  if (!body.trim()) return body;

  const used = recentlyUsedCoachEmojiKeys(args.recentSentCoachBodies);
  if (used.size === 0) return body;

  const repeatedInBody = [
    ...new Set(
      extractEmojiSequences(body).filter((seq) => used.has(emojiKey(seq)))
    ),
  ];
  if (repeatedInBody.length === 0) return body;

  const cleaned = removeSequencesAndCleanSpacing(body, repeatedInBody);
  return cleaned.trim() ? cleaned : body;
}
