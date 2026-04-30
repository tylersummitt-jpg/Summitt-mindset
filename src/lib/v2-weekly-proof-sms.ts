/**
 * Wave 5 — V2-native weekly proof / reflection SMS (AI + deterministic fallback).
 * Does not mutate commitments or write fake accountability outcomes.
 */

import OpenAI from "openai";

import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { loadV2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { getRecentV2EventsForAi } from "@/lib/v2-commitment";
import { evaluateCommitmentEvolutionV1 } from "@/lib/v2-commitment-evolution-engine-v1";
import { fetchPendingEvolutionRecommendation } from "@/lib/v2-commitment-evolution-recommendation";
import { pickWave7DailyEvolutionAction } from "@/lib/v2-sms-evolution-signal";
import { isQuotableIdentitySource } from "@/lib/v2-identity-anchor";
import { supabaseServer } from "@/lib/supabase-server";
import { getDateKeyInTimezone, resolveUserTimezone } from "@/lib/timezone";

export const V2_WEEKLY_PROOF_AI_MODEL = "gpt-4o-mini";
export const V2_WEEKLY_PROOF_PROMPT_VERSION = "v2_weekly_proof_v1";

const SMS_BODY_MAX = 720;
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

function getOpenAIClientOrNull(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return null;
  return new OpenAI({ apiKey });
}

export function isV2WeeklyProofAiEnabled(): boolean {
  const v = process.env.V2_WEEKLY_PROOF_AI_ENABLED?.trim().toLowerCase();
  if (v === "false" || v === "0") return false;
  return true;
}

function addCalendarDays(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const nd = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = nd.getUTCFullYear();
  const mm = String(nd.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(nd.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Monday = 0 … Sunday = 6 for week starting Monday (matches legacy weekly shadow). */
function weekdayMon0Sun6InTimezoneFixed(date: Date, timezone: string): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(date);
  const key = short.slice(0, 3);
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return map[key] ?? 0;
}

export type V2WeeklyProofPack = {
  week_start: string;
  week_end: string;
  yes_count: number;
  no_count: number;
  partial_count: number;
  check_sent_count: number;
  blocker_count: number;
  response_count: number;
  silent_week: boolean;
  comeback_after_miss: boolean;
  blocker_preview_short: string | null;
  effective_ask_preview: string;
  coaching_summary_short: string | null;
  preferred_name: string | null;
  identity_anchor_short: string | null;
  /** Wave 7: optional coaching cue when evolution/blocking pattern is strong (not a mutation command). */
  weekly_evolution_coaching_line: string | null;
  /** Wave 12: grounded proof lines from spine metadata this week (deduped). */
  proof_moment_hints: string[];
};

export function validateV2WeeklyProofSmsBody(body: string): boolean {
  const t = body.trim();
  if (!t || t.length > SMS_BODY_MAX) return false;
  const lower = t.toLowerCase();
  if (/\{[\s\S]*"[\s\S]*\}/.test(t)) return false;
  if (/\breply\s+(yes|no|partial)\b/i.test(t)) return false;
  if (/\byes\s*\/\s*no\s*\/\s*partial\b/i.test(t)) return false;
  if (/reply\s+stop\s+to\s+opt\s+out/i.test(lower)) return false;
  return true;
}

function truncate(s: string, max: number): string {
  const x = s.trim().replace(/\s+/g, " ");
  if (x.length <= max) return x;
  return `${x.slice(0, max - 1)}…`;
}

function detectComebackAfterMiss(
  weekEventsAsc: { event_type: string }[]
): boolean {
  let seenNegative = false;
  for (const e of weekEventsAsc) {
    const et = e.event_type;
    if (et === "user_no" || et === "user_partial") seenNegative = true;
    if (seenNegative && et === "user_yes") return true;
  }
  return false;
}

export async function buildV2WeeklyProofPack(args: {
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow;
  localNow: Date;
  timezone: string;
}): Promise<V2WeeklyProofPack> {
  const tz = resolveUserTimezone(args.timezone);
  const todayKey = getDateKeyInTimezone(args.localNow, tz);
  const dow = weekdayMon0Sun6InTimezoneFixed(args.localNow, tz);
  const weekStart = addCalendarDays(todayKey, -dow);
  const weekEnd = addCalendarDays(weekStart, 6);

  const commitmentId = args.commitment.id;

  const [{ data: profile }, coachingMemory, recentEventsAi, pendingEvolutionWeekly] = await Promise.all([
    supabaseServer
      .from("user_profiles")
      .select("preferred_name, identity_anchor_text, identity_source")
      .eq("clerk_user_id", args.clerkUserId)
      .maybeSingle(),
    loadV2CoachingMemoryForPrompt(commitmentId),
    getRecentV2EventsForAi(commitmentId),
    fetchPendingEvolutionRecommendation(commitmentId),
  ]);

  const preferredName =
    typeof profile?.preferred_name === "string" && profile.preferred_name.trim()
      ? profile.preferred_name.trim()
      : null;

  let identityShort: string | null = null;
  const ia = typeof profile?.identity_anchor_text === "string" ? profile.identity_anchor_text.trim() : "";
  const src = typeof profile?.identity_source === "string" ? profile.identity_source : null;
  if (ia && isQuotableIdentitySource(src)) {
    identityShort = truncate(ia, 90);
  }

  const cutoffIso = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const { data: rawEvents, error: evErr } = await supabaseServer
    .from("v2_commitment_event")
    .select("event_type, occurred_at, payload_json")
    .eq("commitment_id", commitmentId)
    .gte("occurred_at", cutoffIso)
    .order("occurred_at", { ascending: true });

  if (evErr) {
    console.error("[v2-weekly-proof] events query failed", { message: evErr.message });
  }

  let yes = 0;
  let no = 0;
  let partial = 0;
  let checks = 0;
  let blockers = 0;
  const blockerSnippets: string[] = [];
  const weekEventsAsc: { event_type: string; occurred_at: string }[] = [];
  const proofMomentHints: string[] = [];
  const proofLinesSeen = new Set<string>();

  for (const row of rawEvents ?? []) {
    const dk = getDateKeyInTimezone(new Date(String(row.occurred_at)), tz);
    if (dk < weekStart || dk > weekEnd) continue;

    const et = String(row.event_type);
    weekEventsAsc.push({ event_type: et, occurred_at: String(row.occurred_at) });

    const pj = row.payload_json as Record<string, unknown> | null;
    if (
      pj?.proof_moment === true &&
      typeof pj.user_visible_proof_line === "string" &&
      pj.user_visible_proof_line.trim() &&
      proofMomentHints.length < 5
    ) {
      const line = truncate(String(pj.user_visible_proof_line).trim(), 96);
      const ty = typeof pj.proof_moment_type === "string" ? pj.proof_moment_type : "";
      const dedupe = ty || line;
      if (!proofLinesSeen.has(dedupe)) {
        proofLinesSeen.add(dedupe);
        proofMomentHints.push(line);
      }
    }

    if (et === "user_yes") yes += 1;
    else if (et === "user_no") no += 1;
    else if (et === "user_partial") partial += 1;
    else if (et === "check_sent") checks += 1;
    else if (et === "blocker_captured") {
      blockers += 1;
      const p = row.payload_json as Record<string, unknown> | null;
      const msg = typeof p?.message === "string" ? p.message.trim() : "";
      if (msg && blockerSnippets.length < 2) {
        blockerSnippets.push(truncate(msg, 72));
      }
    }
  }

  const responseCount = yes + no + partial;
  const silentWeek = checks >= 1 && responseCount === 0;
  const comeback = detectComebackAfterMiss(weekEventsAsc.map((e) => ({ event_type: e.event_type })));

  const effectiveAsk = truncate(getEffectiveCoachingAsk(args.commitment), 200);
  const summaryRaw =
    coachingMemory && typeof coachingMemory.coaching_summary === "string"
      ? coachingMemory.coaching_summary.trim()
      : "";
  const coachingSummaryShort = summaryRaw ? truncate(summaryRaw, 220) : null;

  const nowMs = Date.now();
  const evolutionEvaluation = evaluateCommitmentEvolutionV1({
    commitment: args.commitment,
    eventsNewestFirst: recentEventsAi,
    nowMs,
  });
  const evolutionPick = pickWave7DailyEvolutionAction({
    commitment: args.commitment,
    pendingRow: pendingEvolutionWeekly,
    evaluation: evolutionEvaluation,
    nowMs,
  });
  const negWeek = no + partial;
  let weekly_evolution_coaching_line: string | null = null;
  if (
    evolutionPick &&
    evolutionPick.action !== "keep_commitment" &&
    evolutionPick.action !== "adapt_commitment_temporary" &&
    (evolutionPick.action === "replace_commitment" ||
      evolutionPick.action === "reframe_commitment" ||
      blockers >= 2 ||
      negWeek >= 4 ||
      pendingEvolutionWeekly?.status === "pending")
  ) {
    weekly_evolution_coaching_line =
      "The pattern may be telling us the bar needs to get clearer next week—not as judgment, but so your standard matches the real fight.";
  }

  return {
    week_start: weekStart,
    week_end: weekEnd,
    yes_count: yes,
    no_count: no,
    partial_count: partial,
    check_sent_count: checks,
    blocker_count: blockers,
    response_count: responseCount,
    silent_week: silentWeek,
    comeback_after_miss: comeback,
    blocker_preview_short: blockerSnippets.length > 0 ? blockerSnippets.join(" · ") : null,
    effective_ask_preview: effectiveAsk,
    coaching_summary_short: coachingSummaryShort,
    preferred_name: preferredName,
    identity_anchor_short: identityShort,
    weekly_evolution_coaching_line,
    proof_moment_hints: proofMomentHints,
  };
}

function buildDeterministicWeeklyProofBody(pack: V2WeeklyProofPack): string {
  const { yes_count: y, no_count: n, partial_count: p, response_count: r, silent_week: silent } = pack;

  if (silent || r === 0) {
    return "Quiet week. That does not have to become quitting. Next week starts with one honest reply.";
  }

  const neg = n + p;

  if (pack.comeback_after_miss && y >= 1) {
    return "This week wasn’t perfect, but you came back after a miss—that’s proof you’re still in it. Next week, stay with the bar.";
  }

  if (pack.blocker_count >= 2 && pack.blocker_preview_short) {
    return `You named what got in the way more than once (${truncate(pack.blocker_preview_short, 100)}). Next week’s win is a smaller start before the day gets away from you.`;
  }

  if (y > neg && y >= 1) {
    return "You stacked real proof this week. Keep the bar clear next week.";
  }

  if (neg > y || (y === neg && y > 0)) {
    return "This week was mixed, but you kept answering. That matters. Next week, stay with the bar.";
  }

  if (neg >= y && y === 0 && neg > 0) {
    return "This week showed the fight clearly. No shame — but we need a smaller, cleaner next move.";
  }

  return "This week was mixed, but you kept answering. That matters. Next week, stay with the bar.";
}

const WEEKLY_PROOF_SYSTEM = `You write ONE weekly SMS for Pat Summitt Mindset V2 accountability.
This is NOT a daily check-in. It is a short weekly proof/reflection: how the user showed up, patterns, proof, honest next step.
The user may only experience Summitt through SMS—keep it human, grounded, and retention-focused (feeling known), not hype or a stats dump.
Rules:
- Use ONLY facts provided in the structured brief (counts, flags, previews). Never invent numbers or events.
- If COMPACT_SMS_THREAD is present, use it for conversational continuity only; it must not override WEEK_BRIEF counts.
- Do not shame. Do not moralize.
- Do not quote sensitive profile fields; preferred name is optional and safe.
- Onboarding-era profile hints in the brief may be older than recent SMS reality—do not treat them as dated facts; stay with WEEK_BRIEF evidence.
- Mention identity anchor only if provided and only as light grounding (one short clause max)—often omit.
- Reference proof, comeback, blocker pattern, or next edge when the brief supports it.
- If EVOLUTION_PATTERN_NOTE is present, weave it gently as coaching ("may", "pattern suggests")—never as a command to change goals or as shame.
- No JSON. No bullet lists. No command menus. No "Reply YES/NO/PARTIAL".
- Max ~480 characters of core message (under ${SMS_BODY_MAX} total); concise paragraphs ok with single newlines.
- Output plain SMS body text only (no subject, no quotes).`;

function buildWeeklyProofUserPrompt(
  pack: V2WeeklyProofPack,
  recentSmsThreadAppend?: string | null
): string {
  const lines: string[] = [];
  lines.push("WEEK_BRIEF (authoritative; do not invent beyond this):");
  lines.push(`- week_start_date: ${pack.week_start}`);
  lines.push(`- week_end_date: ${pack.week_end}`);
  lines.push(`- user_yes_count: ${pack.yes_count}`);
  lines.push(`- user_no_count: ${pack.no_count}`);
  lines.push(`- user_partial_count: ${pack.partial_count}`);
  lines.push(`- check_sent_count: ${pack.check_sent_count}`);
  lines.push(`- response_total (yes+no+partial): ${pack.response_count}`);
  lines.push(`- blocker_events_count: ${pack.blocker_count}`);
  lines.push(`- silent_week (had checks but zero replies): ${pack.silent_week}`);
  lines.push(`- comeback_after_miss (replied yes after no/partial same week): ${pack.comeback_after_miss}`);
  if (pack.proof_moment_hints.length > 0) {
    lines.push("- proof_moment_lines_from_spine (deduped; optional weave—do not invent beyond these):");
    for (const h of pack.proof_moment_hints.slice(0, 4)) {
      lines.push(`  • ${h}`);
    }
  }
  if (pack.blocker_preview_short) {
    lines.push(`- blocker_preview_truncated: ${pack.blocker_preview_short}`);
  }
  lines.push(`- effective_coaching_ask_truncated: ${pack.effective_ask_preview}`);
  if (pack.coaching_summary_short) {
    lines.push(`- coaching_memory_summary_truncated: ${pack.coaching_summary_short}`);
  }
  if (pack.preferred_name) {
    lines.push(`- preferred_name_safe: ${pack.preferred_name}`);
  }
  if (pack.identity_anchor_short) {
    lines.push(`- identity_anchor_optional_short (quotable source only): ${pack.identity_anchor_short}`);
  }
  lines.push("");
  if (pack.weekly_evolution_coaching_line?.trim()) {
    lines.push("EVOLUTION_PATTERN_NOTE (optional coaching cue; not a directive):");
    lines.push(truncate(pack.weekly_evolution_coaching_line.trim(), 320));
    lines.push("");
  }
  const thread = recentSmsThreadAppend?.trim();
  if (thread) {
    lines.push("COMPACT_SMS_THREAD (optional continuity; bounded server-derived snippets):");
    lines.push(truncate(thread, 700));
    lines.push("");
  }
  lines.push("Write the weekly proof SMS body now.");
  return lines.join("\n");
}

export async function generateV2WeeklyProofSmsBody(
  pack: V2WeeklyProofPack,
  options?: { recentSmsThreadAppend?: string | null }
): Promise<{
  body: string;
  aiUsed: boolean;
}> {
  const fallback = buildDeterministicWeeklyProofBody(pack);

  if (!isV2WeeklyProofAiEnabled()) {
    return { body: fallback, aiUsed: false };
  }

  const client = getOpenAIClientOrNull();
  if (!client) {
    return { body: fallback, aiUsed: false };
  }

  try {
    const completion = await client.chat.completions.create({
      model: V2_WEEKLY_PROOF_AI_MODEL,
      messages: [
        { role: "system", content: WEEKLY_PROOF_SYSTEM },
        {
          role: "user",
          content: buildWeeklyProofUserPrompt(pack, options?.recentSmsThreadAppend),
        },
      ],
      temperature: 0.45,
      max_tokens: 400,
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw || !validateV2WeeklyProofSmsBody(raw)) {
      return { body: fallback, aiUsed: false };
    }

    const normalized = raw.replace(/\r\n/g, "\n").trim();
    return { body: truncate(normalized, SMS_BODY_MAX), aiUsed: true };
  } catch (e) {
    console.error("[v2-weekly-proof] ai_failed", {
      message: e instanceof Error ? e.message : String(e),
    });
    return { body: fallback, aiUsed: false };
  }
}
