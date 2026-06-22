/**
 * Recent sent coach SMS bodies from 72h thread — anti-repeat guard + writer authority (no I/O).
 */

import {
  capThreadMessagesForBriefWithTelemetry,
  type RecentExactThreadForBriefResult,
} from "@/lib/sms-recent-exact-thread-72h";
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

/** Coach bodies from writer-facing capped brief thread (same pool as brief.recent_exact_thread). */
export function extractCoachBodiesFromBriefThread(
  brief: RecentExactThreadForBriefResult | null | undefined,
  nowMs: number,
  options?: { maxBodies?: number }
): RecentCoachBodyDoNotRepeat[] {
  const maxBodies = options?.maxBodies ?? GUARD_COACH_BODY_ANTI_REPEAT_MAX;
  if (!brief?.timeline_7d?.messages?.length) return [];

  const capped = capThreadMessagesForBriefWithTelemetry(brief.timeline_7d.messages, nowMs);
  const timeline = brief.timeline_7d.messages;
  const seen = new Set<string>();
  const collected: RecentCoachBodyDoNotRepeat[] = [];

  for (const cap of capped.messages) {
    if (cap.role !== "coach") continue;
    const match =
      timeline.find(
        (m) =>
          m.role === "coach" &&
          m.delivery_status === "sent" &&
          m.at_local === cap.at_local &&
          normCoachBodyDedupeKey(m.body).startsWith(normCoachBodyDedupeKey(cap.body).slice(0, 40))
      ) ??
      timeline.find((m) => m.role === "coach" && m.delivery_status === "sent" && m.at_local === cap.at_local);

    const body = (match?.body ?? cap.body)?.trim();
    if (!body || body.length < COACH_BODY_ANTI_REPEAT_MIN_CHARS) continue;
    const key = normCoachBodyDedupeKey(body);
    if (seen.has(key)) continue;
    seen.add(key);
    collected.push({
      body,
      body_preview: coachBodyPreviewForAntiRepeat(body),
      sent_at: match?.at ?? cap.at_local,
      at_local: cap.at_local,
      source_table: match?.source_table ?? "brief_writer_thread",
      role: "coach",
    });
  }

  return collected.slice(-maxBodies);
}
