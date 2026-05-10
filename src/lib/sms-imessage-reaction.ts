/**
 * Apple Messages tapbacks sometimes arrive as pseudo-text lines on the inbound webhook.
 * These must not drive accountability scoring or full coaching turns.
 */

export function isAppleMessengerTapbackLine(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 6 || t.length > 420) return false;
  return /^(Liked|Loved|Laughed at|Emphasized|Disliked|Questioned)\s+[\u2018\u2019\u201c\u201d"']/.test(t);
}
