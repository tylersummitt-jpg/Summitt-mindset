/**
 * Ordinary inbound post-writer style hygiene: drop emojis Coach already used
 * in the previous 5 successfully sent Coach SMS on packet.exact_thread.
 *
 * Reuses deterministic extraction/lookback. User emoji is not a repeat source.
 * Does not substitute a different emoji. Empty result falls back to original.
 */

import {
  applyRepeatedCoachEmojiHygiene,
  recentSentCoachBodiesFromExactThread,
  type ExactThreadSenderBody,
} from "@/lib/morning-tto-repeated-emoji-hygiene";

export function applyOrdinaryInboundRepeatedCoachEmojiHygiene(args: {
  body: string;
  exactThreadMessages: readonly ExactThreadSenderBody[];
}): string {
  return applyRepeatedCoachEmojiHygiene({
    body: args.body,
    recentSentCoachBodies: recentSentCoachBodiesFromExactThread(
      args.exactThreadMessages
    ),
  });
}
