/**
 * V2 coaching memory: recomputable projection from commitment + events.
 * Not authoritative for gates; optional AI summary is non-authoritative.
 */

import OpenAI from "openai";
import { randomUUID } from "crypto";

import type { V2AccountabilityPhase } from "@/lib/v2-accountability-phase";
import {
  clearStaleAdaptiveContractColumns,
  fetchLatestActivatedOverlayContractKind,
  getEffectiveCoachingAsk,
  isV2AdaptiveOverlayActive,
} from "@/lib/v2-adaptive-contract";
import { isIdentityRefreshDue, isQuotableIdentitySource } from "@/lib/v2-identity-anchor";
import { mirrorPendingResolutionForPrompt } from "@/lib/v2-guided-resolution";
import { parseRefreshSession } from "@/lib/v2-refresh-session";
import { deriveV2CadencePayload, type V2CadenceLevel } from "@/lib/v2-cadence";
import {
  deriveV2CoachingState,
  deriveV2NextMove,
  deriveV2ReentryContext,
  deriveV2SilenceContext,
  type V2CoachingState,
  type V2NextMoveDecision,
} from "@/lib/v2-ai-outbound";
import type { V2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory-prompt";
import { supabaseServer } from "@/lib/supabase-server";
import {
  computeRelationshipSignals,
  fetchEventsForRelationshipProfile,
  normalizeRelationshipProfileForPrompt,
  recomputeRelationshipProfileV1,
  SMS_RELATIONSHIP_PROFILE_VERSION,
} from "@/lib/v2-sms-relationship-profile";

export type { V2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory-prompt";
import {
  getLastV2CheckSentForCommitment,
  getLatestBlockerCapturedAfter,
  getLatestV2AccountabilityOutcome,
  getRecentV2EventsForAi,
  getV2CommitmentByIdForCoaching,
  type ActiveV2CommitmentRow,
  type V2EventRowForAi,
} from "@/lib/v2-commitment";

export const V2_COACHING_MEMORY_SUMMARY_VERSION = "memory_summary_v1";
export const V2_COACHING_MEMORY_PROJECTION_MODEL_VERSION = "coaching_memory_projection_v1";
const SUMMARY_MAX_CHARS = 400;
const COACHING_MEMORY_AI_MODEL = "gpt-4o-mini";
const MS_DAY = 86400000;

const CADENCE_LEVELS = new Set<string>(["daily", "every_other_day", "every_3_days"]);
const NEXT_MOVE_TYPES = new Set<string>(["hold_standard", "recommit_same", "shrink_ask", "reset_day"]);

type MemoryRowDb = {
  effective_ask_text: string;
  coaching_state: string;
  silence_tier_snapshot: string;
  unanswered_checks_snapshot: number;
  days_since_last_user_outcome_snapshot: number;
  cadence_level: string;
  cadence_reason_code: string;
  next_move_type: string;
  next_move_reason_code: string;
  overlay_active: boolean;
  overlay_expires_at: string | null;
  yes_streak_14d: number;
  no_count_14d: number;
  partial_count_14d: number;
  latest_blocker_preview: string | null;
  blocker_tags: unknown;
  coaching_summary: string | null;
  summary_updated_at?: string | null;
  summary_version?: string | null;
  accountability_phase?: string;
  reactivation_entered_at?: string | null;
  reactivation_last_sent_at?: string | null;
  relationship_profile?: unknown;
  relationship_profile_version?: string | null;
  relationship_profile_updated_at?: string | null;
  projection_model_version?: string | null;
  projection_prompt_version?: string | null;
  projection_last_recomputed_at?: string | null;
  projection_input_event_upper_bound_at?: string | null;
  projection_reason_code?: string | null;
  projection_run_id?: string | null;
};

function parseAccountabilityPhaseFromDb(v: unknown): V2AccountabilityPhase {
  return v === "low_pressure_reactivation" ? "low_pressure_reactivation" : "active_accountability";
}

function truncateOneLine(s: string, max: number): string {
  const x = s.trim().replace(/\s+/g, " ");
  if (x.length <= max) return x;
  return `${x.slice(0, max - 1)}…`;
}

function eventTimeMs(iso: string): number {
  const n = new Date(iso).getTime();
  return Number.isFinite(n) ? n : 0;
}

function sortedEventsAsc(eventsNewestFirst: V2EventRowForAi[]): V2EventRowForAi[] {
  return [...eventsNewestFirst].sort(
    (a, b) => eventTimeMs(a.occurred_at) - eventTimeMs(b.occurred_at)
  );
}

function countOutcome14d(
  asc: V2EventRowForAi[],
  nowMs: number,
  eventType: string
): number {
  const cutoff = nowMs - 14 * MS_DAY;
  let n = 0;
  for (const e of asc) {
    if (e.event_type !== eventType) continue;
    const te = eventTimeMs(e.occurred_at);
    if (te >= cutoff && te <= nowMs) n += 1;
  }
  return n;
}

/** Consecutive user_yes from the latest accountability signal (newest-first), within bounded recent events. */
function yesStreakFromNewest(eventsNewestFirst: V2EventRowForAi[]): number {
  let streak = 0;
  for (const e of eventsNewestFirst) {
    if (e.event_type === "user_yes") streak += 1;
    else if (e.event_type === "user_no" || e.event_type === "user_partial") break;
  }
  return streak;
}

function parseCadenceFromCheckSentPayload(
  payload: Record<string, unknown>
): { level: V2CadenceLevel; reason_code: string } | null {
  const c = payload.cadence;
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const level = (c as { level?: unknown }).level;
  const reason = (c as { reason_code?: unknown }).reason_code;
  if (typeof level !== "string" || typeof reason !== "string") return null;
  if (!CADENCE_LEVELS.has(level)) return null;
  return { level: level as V2CadenceLevel, reason_code: reason };
}

function parseNextMoveFromCheckSentPayload(
  payload: Record<string, unknown>
): { type: string; reason_code: string } | null {
  const nm = payload.next_move;
  if (!nm || typeof nm !== "object" || Array.isArray(nm)) return null;
  const t = (nm as { type?: unknown }).type;
  const rc = (nm as { reason_code?: unknown }).reason_code;
  if (typeof t !== "string" || typeof rc !== "string") return null;
  if (!NEXT_MOVE_TYPES.has(t)) return null;
  return { type: t, reason_code: rc };
}

async function resolveBlockerPreviewForMemory(
  commitmentId: string,
  latestOutcome: Awaited<ReturnType<typeof getLatestV2AccountabilityOutcome>>,
  recentEvents: V2EventRowForAi[]
): Promise<string | null> {
  let preview: string | null = null;
  if (
    latestOutcome &&
    (latestOutcome.type === "user_no" || latestOutcome.type === "user_partial")
  ) {
    const blocker = await getLatestBlockerCapturedAfter(commitmentId, latestOutcome.occurred_at);
    if (blocker?.message) preview = blocker.message.slice(0, 120);
  }
  if (!preview) {
    const blockerEv = recentEvents.find((e) => e.event_type === "blocker_captured");
    const rawMsg = blockerEv?.payload_json?.message;
    if (typeof rawMsg === "string" && rawMsg.trim()) preview = rawMsg.trim().slice(0, 120);
  }
  return preview && preview.trim().length > 0 ? preview : null;
}

const BLOCKER_TAG_RULES: readonly { tag: string; needles: readonly string[] }[] = [
  { tag: "time_pressure", needles: ["time", "busy", "slammed", "schedule", "deadline", "rush"] },
  { tag: "overwhelm", needles: ["overwhelm", "too much", "drowning", "swamped"] },
  { tag: "family_load", needles: ["kids", "family", "child", "baby", "parent"] },
  { tag: "health_disruption", needles: ["sick", "ill", "injury", "pain", "exhausted", "fatigue"] },
  { tag: "travel_disruption", needles: ["travel", "trip", "flight", "away", "timezone"] },
];

export function deriveBlockerTagsFromText(text: string | null): string[] {
  if (!text?.trim()) return [];
  const lower = text.toLowerCase();
  const out: string[] = [];
  for (const rule of BLOCKER_TAG_RULES) {
    if (rule.needles.some((n) => lower.includes(n))) out.push(rule.tag);
  }
  return [...new Set(out)];
}

function summarizeEventOneLine(e: V2EventRowForAi): string {
  const p = e.payload_json || {};
  const preview =
    typeof p.message === "string"
      ? truncateOneLine(p.message, 100)
      : typeof p.body_preview === "string"
        ? truncateOneLine(String(p.body_preview), 72)
        : "";
  const tail = preview ? ` text="${preview}"` : "";
  return `${e.occurred_at} ${e.event_type}${tail}`;
}

function buildRecentDigestLines(eventsNewestFirst: V2EventRowForAi[], max: number): string[] {
  return eventsNewestFirst.slice(0, max).map(summarizeEventOneLine);
}

async function countCheckSentEvents(commitmentId: string): Promise<number> {
  const { count, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("id", { count: "exact", head: true })
    .eq("commitment_id", commitmentId)
    .eq("event_type", "check_sent");

  if (error || count == null) return 0;
  return count;
}

function getOpenAIClientOrNull(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return null;
  return new OpenAI({ apiKey });
}

export function isV2CoachingMemorySummaryAiEnabled(): boolean {
  return process.env.V2_COACHING_MEMORY_SUMMARY_ENABLED === "true";
}

/**
 * Optional non-authoritative summary. Failures return null; never throws.
 * Grounded only on structured snapshot + short digest.
 */
async function tryGenerateCoachingSummaryText(args: {
  snapshot: Omit<V2CoachingMemoryForPrompt, "coaching_summary">;
  digestLines: string[];
}): Promise<string | null> {
  if (!isV2CoachingMemorySummaryAiEnabled()) return null;
  const client = getOpenAIClientOrNull();
  if (!client) return null;

  const structured = {
    effective_ask_text: args.snapshot.effective_ask_text,
    coaching_state: args.snapshot.coaching_state,
    silence_tier: args.snapshot.silence_tier_snapshot,
    unanswered_checks: args.snapshot.unanswered_checks_snapshot,
    days_since_last_user_outcome: args.snapshot.days_since_last_user_outcome_snapshot,
    cadence_level: args.snapshot.cadence_level,
    cadence_reason_code: args.snapshot.cadence_reason_code,
    next_move_type: args.snapshot.next_move_type,
    next_move_reason_code: args.snapshot.next_move_reason_code,
    overlay_active: args.snapshot.overlay_active,
    ...(args.snapshot.overlay_contract_kind
      ? { overlay_contract_kind: args.snapshot.overlay_contract_kind }
      : {}),
    yes_streak_14d: args.snapshot.yes_streak_14d,
    no_count_14d: args.snapshot.no_count_14d,
    partial_count_14d: args.snapshot.partial_count_14d,
    blocker_tags: args.snapshot.blocker_tags,
    latest_blocker_preview: args.snapshot.latest_blocker_preview,
    accountability_phase: args.snapshot.accountability_phase,
    reactivation_entered_at: args.snapshot.reactivation_entered_at,
    reactivation_last_sent_at: args.snapshot.reactivation_last_sent_at,
    ...(args.snapshot.identity_anchor_text?.trim()
      ? { identity_anchor_text: args.snapshot.identity_anchor_text }
      : {}),
    ...(args.snapshot.identity_refresh_due != null
      ? { identity_refresh_due: args.snapshot.identity_refresh_due }
      : {}),
  };

  const userPrompt = [
    "Write at most TWO short sentences summarizing coaching context for Coach Pat.",
    "Return ONLY valid JSON: {\"summary\":\"...\"}.",
    `Max ${SUMMARY_MAX_CHARS} characters for summary.`,
    "Do not invent facts beyond STRUCTURED_SNAPSHOT and DIGEST.",
    "STRUCTURED_SNAPSHOT:",
    JSON.stringify(structured),
    "DIGEST (newest first):",
    ...args.digestLines.map((l) => `- ${l}`),
  ].join("\n");

  try {
    const completion = await client.chat.completions.create({
      model: COACHING_MEMORY_AI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You compress V2 coaching snapshot into brief prose. JSON only. No medical claims. No new goals.",
        },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.35,
      max_tokens: 200,
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { summary?: unknown };
    const s = typeof parsed.summary === "string" ? parsed.summary.trim().replace(/\n+/g, " ") : "";
    if (!s || s.length > SUMMARY_MAX_CHARS) return null;
    const lower = s.toLowerCase();
    if (
      lower.includes("therapy") ||
      lower.includes("diagnos") ||
      lower.includes("openai") ||
      /\bai\b/i.test(s)
    ) {
      return null;
    }
    return s;
  } catch (err) {
    console.error("[v2-coaching-memory] summary generation failed", err);
    return null;
  }
}

function shouldRefreshSummary(args: {
  prev: MemoryRowDb | null;
  next: Omit<V2CoachingMemoryForPrompt, "coaching_summary">;
  checkSentCount: number;
}): boolean {
  const p = args.prev;
  if (!p || !p.coaching_summary?.trim()) return true;
  if (p.overlay_active !== args.next.overlay_active) return true;
  if (p.cadence_level !== args.next.cadence_level) return true;
  if (p.accountability_phase != null && p.accountability_phase !== args.next.accountability_phase) {
    return true;
  }
  if (p.coaching_state !== args.next.coaching_state) return true;
  if (p.effective_ask_text !== args.next.effective_ask_text) return true;
  if (args.checkSentCount > 0 && args.checkSentCount % 5 === 0) return true;
  return false;
}

function mapDbRowToPrompt(row: MemoryRowDb): V2CoachingMemoryForPrompt {
  let tags: string[] = [];
  if (Array.isArray(row.blocker_tags)) {
    tags = row.blocker_tags.filter((x): x is string => typeof x === "string");
  }
  return {
    effective_ask_text: row.effective_ask_text,
    coaching_state: row.coaching_state,
    silence_tier_snapshot: row.silence_tier_snapshot,
    unanswered_checks_snapshot: row.unanswered_checks_snapshot,
    days_since_last_user_outcome_snapshot: row.days_since_last_user_outcome_snapshot,
    cadence_level: row.cadence_level,
    cadence_reason_code: row.cadence_reason_code,
    next_move_type: row.next_move_type,
    next_move_reason_code: row.next_move_reason_code,
    overlay_active: row.overlay_active,
    overlay_contract_kind: null,
    overlay_expires_at: row.overlay_expires_at,
    yes_streak_14d: row.yes_streak_14d,
    no_count_14d: row.no_count_14d,
    partial_count_14d: row.partial_count_14d,
    latest_blocker_preview: row.latest_blocker_preview,
    blocker_tags: tags,
    coaching_summary: row.coaching_summary,
    accountability_phase: parseAccountabilityPhaseFromDb(row.accountability_phase),
    reactivation_entered_at:
      row.reactivation_entered_at != null && typeof row.reactivation_entered_at === "string"
        ? row.reactivation_entered_at
        : null,
    reactivation_last_sent_at:
      row.reactivation_last_sent_at != null && typeof row.reactivation_last_sent_at === "string"
        ? row.reactivation_last_sent_at
        : null,
    sms_relationship_profile: normalizeRelationshipProfileForPrompt(row.relationship_profile),
    relationship_profile_version:
      row.relationship_profile_version != null && typeof row.relationship_profile_version === "string"
        ? row.relationship_profile_version
        : null,
    relationship_profile_updated_at:
      row.relationship_profile_updated_at != null &&
      typeof row.relationship_profile_updated_at === "string"
        ? row.relationship_profile_updated_at
        : null,
  };
}

export async function loadV2CoachingMemoryForPrompt(
  commitmentId: string
): Promise<V2CoachingMemoryForPrompt | null> {
  const { data, error } = await supabaseServer
    .from("v2_commitment_coaching_memory")
    .select("*")
    .eq("commitment_id", commitmentId)
    .maybeSingle();

  if (error) {
    console.error("[v2-coaching-memory] load failed", { commitment_id: commitmentId, message: error.message });
    return null;
  }
  if (!data) return null;
  const mapped = mapDbRowToPrompt(data as MemoryRowDb);
  let merged: V2CoachingMemoryForPrompt = { ...mapped };
  merged = {
    ...merged,
    overlay_contract_kind: merged.overlay_active
      ? await fetchLatestActivatedOverlayContractKind(commitmentId)
      : null,
  };

  const { data: cRow } = await supabaseServer
    .from("v2_commitment")
    .select(
      "clerk_user_id, refresh_session, pending_resolution_kind, pending_resolution_expires_at"
    )
    .eq("id", commitmentId)
    .maybeSingle();
  const clerkId = typeof cRow?.clerk_user_id === "string" ? cRow.clerk_user_id : null;
  const commitmentRow = cRow as { refresh_session?: unknown } | null;
  const refreshSnap = commitmentRow?.refresh_session;
  const rs = parseRefreshSession(refreshSnap);
  const crow = cRow as Record<string, unknown> | null;
  const pendingMirror = mirrorPendingResolutionForPrompt({
    pending_resolution_kind:
      crow && typeof crow.pending_resolution_kind === "string"
        ? crow.pending_resolution_kind
        : null,
    pending_resolution_expires_at:
      crow && typeof crow.pending_resolution_expires_at === "string"
        ? crow.pending_resolution_expires_at
        : null,
  });
  merged = {
    ...merged,
    coaching_refresh_active: rs != null,
    coaching_refresh_step: rs?.step ?? null,
    pending_resolution_kind: pendingMirror.pending_resolution_kind,
    pending_resolution_expires_at: pendingMirror.pending_resolution_expires_at,
  };
  if (clerkId) {
    const { data: prof } = await supabaseServer
      .from("user_profiles")
      .select("identity_anchor_text, identity_refresh_due_at, identity_source")
      .eq("clerk_user_id", clerkId)
      .maybeSingle();
    const src = typeof prof?.identity_source === "string" ? prof.identity_source : null;
    const iaRaw = typeof prof?.identity_anchor_text === "string" ? prof.identity_anchor_text : null;
    const ia = isQuotableIdentitySource(src) ? iaRaw : null;
    merged = {
      ...merged,
      identity_anchor_text: ia,
      identity_refresh_due: isIdentityRefreshDue(
        typeof prof?.identity_refresh_due_at === "string" ? prof.identity_refresh_due_at : null,
        Date.now()
      ),
    };
  }

  return merged;
}

export async function recomputeV2CoachingMemory(
  commitmentId: string,
  context?: {
    reasonCode?: string | null;
    runId?: string | null;
    promptVersion?: string | null;
    /** Bounded fragment merged into `coaching_summary` (no migration) for V3 coach notebook retention. */
    v3LearningNotebookAppend?: string | null;
  }
): Promise<void> {
  try {
    await clearStaleAdaptiveContractColumns(commitmentId);
    const commitment = await getV2CommitmentByIdForCoaching(commitmentId);
    if (!commitment) {
      await supabaseServer.from("v2_commitment_coaching_memory").delete().eq("commitment_id", commitmentId);
      return;
    }

    const now = new Date();
    const nowMs = now.getTime();
    const [latestOutcome, recentEvents, lastCheck, prevRes, checkSentCount, profileIdentityRes] =
      await Promise.all([
        getLatestV2AccountabilityOutcome(commitmentId),
        getRecentV2EventsForAi(commitmentId),
        getLastV2CheckSentForCommitment(commitmentId),
        supabaseServer.from("v2_commitment_coaching_memory").select("*").eq("commitment_id", commitmentId).maybeSingle(),
        countCheckSentEvents(commitmentId),
        supabaseServer
          .from("user_profiles")
          .select("identity_anchor_text, identity_refresh_due_at, identity_source")
          .eq("clerk_user_id", commitment.clerk_user_id)
          .maybeSingle(),
      ]);

    const prev = prevRes.data as MemoryRowDb | null;

    const asc = sortedEventsAsc(recentEvents);
    const silence = deriveV2SilenceContext(recentEvents, now);
    const reentry = deriveV2ReentryContext(recentEvents, now);
    const coachingState: V2CoachingState = deriveV2CoachingState(recentEvents);
    const blockerPreview = await resolveBlockerPreviewForMemory(commitmentId, latestOutcome, recentEvents);
    const hasBlockerPreview = Boolean(blockerPreview?.trim());

    const cadenceFromPayload = lastCheck?.payload_json
      ? parseCadenceFromCheckSentPayload(lastCheck.payload_json)
      : null;
    const cadencePayload = cadenceFromPayload
      ? { level: cadenceFromPayload.level, reason_code: cadenceFromPayload.reason_code, version: 1 as const }
      : deriveV2CadencePayload({ eventsNewestFirst: recentEvents, now, hasBlockerPreview });

    const nextFromPayload = lastCheck?.payload_json
      ? parseNextMoveFromCheckSentPayload(lastCheck.payload_json)
      : null;
    const nextDerived: V2NextMoveDecision = deriveV2NextMove({
      eventsNewestFirst: recentEvents,
      now,
      silence,
      reentry,
      behaviorStatement: commitment.behavior_statement,
    });
    const nextMoveType = nextFromPayload?.type ?? nextDerived.type;
    const nextMoveReason = nextFromPayload?.reason_code ?? nextDerived.reason_code;

    const overlayActive = isV2AdaptiveOverlayActive(commitment, nowMs);
    const overlayExpiresAt =
      overlayActive && commitment.adaptive_ask_expires_at?.trim()
        ? commitment.adaptive_ask_expires_at.trim()
        : null;
    const overlayContractKind = overlayActive
      ? await fetchLatestActivatedOverlayContractKind(commitmentId)
      : null;

    const effectiveAsk = getEffectiveCoachingAsk(commitment, nowMs);
    const no14 = countOutcome14d(asc, nowMs, "user_no");
    const partial14 = countOutcome14d(asc, nowMs, "user_partial");
    const yesStreak = yesStreakFromNewest(recentEvents);
    const blockerTags = deriveBlockerTagsFromText(blockerPreview);

    const profileIdentity = profileIdentityRes.data as {
      identity_anchor_text?: string | null;
      identity_refresh_due_at?: string | null;
      identity_source?: string | null;
    } | null;
    const idSrc =
      typeof profileIdentity?.identity_source === "string" ? profileIdentity.identity_source : null;
    const identityAnchorTextRaw =
      typeof profileIdentity?.identity_anchor_text === "string"
        ? profileIdentity.identity_anchor_text
        : null;
    const identityAnchorText = isQuotableIdentitySource(idSrc) ? identityAnchorTextRaw : null;
    const identityRefreshDue = isIdentityRefreshDue(
      typeof profileIdentity?.identity_refresh_due_at === "string"
        ? profileIdentity.identity_refresh_due_at
        : null,
      nowMs
    );

    const snapshotBase: Omit<V2CoachingMemoryForPrompt, "coaching_summary"> = {
      effective_ask_text: effectiveAsk,
      coaching_state: coachingState,
      silence_tier_snapshot: silence.tier,
      unanswered_checks_snapshot: silence.unanswered_checks,
      days_since_last_user_outcome_snapshot: silence.days_since_last_user_outcome,
      cadence_level: cadencePayload.level,
      cadence_reason_code: cadencePayload.reason_code,
      next_move_type: nextMoveType,
      next_move_reason_code: nextMoveReason,
      overlay_active: overlayActive,
      overlay_contract_kind: overlayContractKind,
      overlay_expires_at: overlayExpiresAt,
      yes_streak_14d: yesStreak,
      no_count_14d: no14,
      partial_count_14d: partial14,
      latest_blocker_preview: blockerPreview,
      blocker_tags: blockerTags,
      accountability_phase: commitment.accountability_phase,
      reactivation_entered_at: commitment.reactivation_entered_at,
      reactivation_last_sent_at: commitment.reactivation_last_sent_at,
      identity_anchor_text: identityAnchorText,
      identity_refresh_due: identityRefreshDue,
    };

    const digest = buildRecentDigestLines(recentEvents, 6);
    const refresh = shouldRefreshSummary({
      prev,
      next: snapshotBase,
      checkSentCount,
    });

    let coachingSummary: string | null = prev?.coaching_summary ?? null;
    let summaryUpdatedAt: string | null = prev?.summary_updated_at ?? null;
    let summaryVersion: string | null = prev?.summary_version ?? null;

    if (refresh) {
      const generated = await tryGenerateCoachingSummaryText({
        snapshot: snapshotBase,
        digestLines: digest,
      });
      if (generated) {
        coachingSummary = generated;
        summaryUpdatedAt = now.toISOString();
        summaryVersion = V2_COACHING_MEMORY_SUMMARY_VERSION;
      }
    }

    const v3Nb = typeof context?.v3LearningNotebookAppend === "string" ? context.v3LearningNotebookAppend.trim() : "";
    if (v3Nb.length > 0) {
      const frag = v3Nb.slice(0, 280);
      const tag = frag.slice(0, 48);
      const existing = (coachingSummary ?? "").trim();
      if (!existing.includes(tag)) {
        coachingSummary = existing
          ? `${existing}\n[v3_notebook] ${frag}`.slice(0, 520)
          : `[v3_notebook] ${frag}`.slice(0, 520);
        summaryUpdatedAt = now.toISOString();
        summaryVersion = summaryVersion ?? V2_COACHING_MEMORY_SUMMARY_VERSION;
      }
    }

    const relEvents = await fetchEventsForRelationshipProfile(commitmentId);
    const relSignals = computeRelationshipSignals(relEvents, commitment, nowMs);
    const relationshipProfile = recomputeRelationshipProfileV1({
      signals: relSignals,
      previousProfileJson: prev?.relationship_profile ?? null,
      accountabilityPhase: commitment.accountability_phase,
    });
    const prevRelStr = JSON.stringify(prev?.relationship_profile ?? null);
    const nextRelStr = JSON.stringify(relationshipProfile);
    const relationshipProfileUpdatedAt =
      prevRelStr !== nextRelStr
        ? now.toISOString()
        : prev?.relationship_profile_updated_at != null &&
            typeof prev.relationship_profile_updated_at === "string"
          ? prev.relationship_profile_updated_at
          : now.toISOString();

    const projectionReasonCode =
      typeof context?.reasonCode === "string" && context.reasonCode.trim().length > 0
        ? context.reasonCode.trim().slice(0, 120)
        : "recompute";
    const projectionRunId =
      typeof context?.runId === "string" && context.runId.trim().length > 0
        ? context.runId.trim().slice(0, 120)
        : randomUUID();
    const projectionPromptVersion =
      typeof context?.promptVersion === "string" && context.promptVersion.trim().length > 0
        ? context.promptVersion.trim().slice(0, 120)
        : isV2CoachingMemorySummaryAiEnabled()
          ? V2_COACHING_MEMORY_SUMMARY_VERSION
          : null;
    const projectionInputEventUpperBoundAt =
      recentEvents.length > 0 ? recentEvents[0]?.occurred_at ?? null : null;
    const projectionLastRecomputedAt = now.toISOString();

    const upsertRow = {
      commitment_id: commitmentId,
      clerk_user_id: commitment.clerk_user_id,
      effective_ask_text: snapshotBase.effective_ask_text,
      coaching_state: snapshotBase.coaching_state,
      silence_tier_snapshot: snapshotBase.silence_tier_snapshot,
      unanswered_checks_snapshot: snapshotBase.unanswered_checks_snapshot,
      days_since_last_user_outcome_snapshot: snapshotBase.days_since_last_user_outcome_snapshot,
      cadence_level: snapshotBase.cadence_level,
      cadence_reason_code: snapshotBase.cadence_reason_code,
      next_move_type: snapshotBase.next_move_type,
      next_move_reason_code: snapshotBase.next_move_reason_code,
      overlay_active: snapshotBase.overlay_active,
      overlay_expires_at: snapshotBase.overlay_expires_at,
      yes_streak_14d: snapshotBase.yes_streak_14d,
      no_count_14d: snapshotBase.no_count_14d,
      partial_count_14d: snapshotBase.partial_count_14d,
      latest_blocker_preview: snapshotBase.latest_blocker_preview,
      blocker_tags: snapshotBase.blocker_tags,
      accountability_phase: snapshotBase.accountability_phase,
      reactivation_entered_at: snapshotBase.reactivation_entered_at,
      reactivation_last_sent_at: snapshotBase.reactivation_last_sent_at,
      coaching_summary: coachingSummary,
      summary_updated_at: summaryUpdatedAt,
      summary_version: summaryVersion,
      relationship_profile: relationshipProfile,
      relationship_profile_version: SMS_RELATIONSHIP_PROFILE_VERSION,
      relationship_profile_updated_at: relationshipProfileUpdatedAt,
      projection_model_version: V2_COACHING_MEMORY_PROJECTION_MODEL_VERSION,
      projection_prompt_version: projectionPromptVersion,
      projection_last_recomputed_at: projectionLastRecomputedAt,
      projection_input_event_upper_bound_at: projectionInputEventUpperBoundAt,
      projection_reason_code: projectionReasonCode,
      projection_run_id: projectionRunId,
      updated_at: projectionLastRecomputedAt,
    };

    const { error: upErr } = await supabaseServer
      .from("v2_commitment_coaching_memory")
      .upsert(upsertRow, { onConflict: "commitment_id" });

    if (upErr) {
      console.error("[v2-coaching-memory] upsert failed", {
        commitment_id: commitmentId,
        message: upErr.message,
      });
    }
  } catch (e) {
    console.error("[v2-coaching-memory] recompute threw", { commitment_id: commitmentId, e });
  }
}
