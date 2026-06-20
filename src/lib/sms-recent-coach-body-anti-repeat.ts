/**
 * Recent sent coach SMS bodies from 72h thread — anti-repeat guard + writer authority (no I/O).
 */

import type { RecentExactThread72hResult } from "@/lib/sms-recent-exact-thread-72h";

export type RecentCoachBodyDoNotRepeat = {
  body: string;
  body_preview: string;
  sent_at: string;
  at_local: string | null;
  source_table: string;
  role: "coach";
};

export const PROMPT_COACH_BODY_DO_NOT_REPEAT_MAX = 3;
export const GUARD_COACH_BODY_ANTI_REPEAT_MAX = 12;

const COACH_BODY_ANTI_REPEAT_MIN_CHARS = 16;
const COACH_BODY_PREVIEW_MAX = 160;

function normCoachBodyDedupeKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function coachBodyPreviewForAntiRepeat(body: string): string {
  const t = body.trim();
  return t.length <= COACH_BODY_PREVIEW_MAX ? t : `${t.slice(0, COACH_BODY_PREVIEW_MAX - 1)}…`;
}

/** Extract sent coach SMS bodies from existing 72h thread (newest-first scan, chronological return). */
export function extractRecentCoachBodiesForAntiRepeat(
  thread72h: RecentExactThread72hResult | null | undefined,
  options?: { maxBodies?: number }
): RecentCoachBodyDoNotRepeat[] {
  const maxBodies = options?.maxBodies ?? GUARD_COACH_BODY_ANTI_REPEAT_MAX;
  if (!thread72h?.messages?.length) return [];

  const seen = new Set<string>();
  const collected: RecentCoachBodyDoNotRepeat[] = [];

  for (let i = thread72h.messages.length - 1; i >= 0 && collected.length < maxBodies; i--) {
    const m = thread72h.messages[i]!;
    if (m.role !== "coach") continue;
    if (m.delivery_status !== "sent") continue;
    if (!m.is_exact_body) continue;
    const body = m.body?.trim();
    if (!body || body.length < COACH_BODY_ANTI_REPEAT_MIN_CHARS) continue;
    const key = normCoachBodyDedupeKey(body);
    if (seen.has(key)) continue;
    seen.add(key);
    collected.push({
      body,
      body_preview: coachBodyPreviewForAntiRepeat(body),
      sent_at: m.at,
      at_local: m.at_local?.trim() || null,
      source_table: m.source_table,
      role: "coach",
    });
  }

  return collected.reverse();
}
