/**
 * Wave 6 — Bounded SMS conversation / memory context for V2 AI prompts.
 * Read-only; does not mutate state. No giant prompts stored on events by default.
 */

import { supabaseServer } from "@/lib/supabase-server";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { getRecentV2EventsForAi, type V2EventRowForAi } from "@/lib/v2-commitment";
import { loadV2CoachingMemoryForPrompt, type V2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory";
import {
  getPendingResolutionOrNull,
  isSmsInboundPendingResolutionActionable,
  type V2SmsPendingResolutionPayload,
} from "@/lib/v2-guided-resolution";
import { isQuotableIdentitySource } from "@/lib/v2-identity-anchor";
import {
  EVOLUTION_V1_SURFACED_ACTIONS,
  evaluateCommitmentEvolutionV1,
} from "@/lib/v2-commitment-evolution-engine-v1";
import { fetchPendingEvolutionRecommendation } from "@/lib/v2-commitment-evolution-recommendation";
import {
  formatWave7EvolutionContextLines,
  pickWave7DailyEvolutionAction,
} from "@/lib/v2-sms-evolution-signal";

const DEFAULT_MAX_TRANSCRIPT = 12;
const DEFAULT_LINE_CHARS = 118;
const PROMPT_BLOCK_MAX = 3200;
const SEVEN_D_MS = 7 * 24 * 60 * 60 * 1000;

function truncate(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ").replace(/\r?\n/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function stripSmsComplianceFooter(text: string): string {
  return text
    .replace(/\bReply STOP to opt out[\s\S]*$/i, "")
    .replace(/\bReply HELP for help\.?[\s\S]*$/i, "")
    .trim();
}

export type V2SmsConversationContextPack = {
  recentTranscriptLines: string[];
  lastOutboundPreview: string | null;
  lastInboundPreview: string | null;
  recentOutcomeSummary: {
    yesCount7d: number;
    noCount7d: number;
    partialCount7d: number;
    blockerCount7d: number;
    checkSentCount7d: number;
  };
  recentRepairOrClarification: string | null;
  recentBlockerPattern: string | null;
  proofHighlight: string | null;
  comebackSignal: string | null;
  pendingStateSummary: string | null;
  safeProfileSummary: string | null;
  sensitiveContextAvailableButNotQuotable: boolean;
  /** Wave 7: compact evolution hint (no raw evidence_json). */
  evolutionRecommendationSummary: string | null;
  evolutionRecommendedAction: string | null;
  promptBlock: string;
  meta: {
    sms_context_pack_used: true;
    transcript_line_count: number;
    recent_event_count: number;
    proof_highlight_used: boolean;
    blocker_pattern_used: boolean;
    evolution_recommendation_used?: boolean;
    evolution_recommended_action?: string | null;
    /** V3 — which DB sources contributed to RECENT_THREAD (deduped). */
    transcript_sources_used?: string[];
  };
};

type TimelineEntry = { t: number; role: "Coach" | "User"; text: string };

type TimelineSource =
  | "sms_last_outbound_context"
  | "sms_inbound_messages"
  | "sms_send_events"
  | "sms_inbound_coach_jobs"
  | "v2_commitment_event_check_sent";

type RichTimelineEntry = {
  t: number;
  role: "Coach" | "User";
  text: string;
  source: TimelineSource;
  /** Higher wins on duplicate body within dedupe window. */
  priority: number;
};

const DEDUPE_WINDOW_MS = 2500;

function normalizeTimelineDedupeKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function dedupeRichTimeline(entries: RichTimelineEntry[]): RichTimelineEntry[] {
  const sorted = [...entries].sort((a, b) => a.t - b.t || b.priority - a.priority);
  const out: RichTimelineEntry[] = [];
  for (const e of sorted) {
    let replaced = false;
    for (let i = out.length - 1; i >= 0 && i >= out.length - 5; i--) {
      const prev = out[i]!;
      if (prev.role !== e.role) continue;
      if (Math.abs(e.t - prev.t) > DEDUPE_WINDOW_MS) break;
      if (normalizeTimelineDedupeKey(prev.text) !== normalizeTimelineDedupeKey(e.text)) continue;
      if (e.priority >= prev.priority) {
        out[i] = e;
      }
      replaced = true;
      break;
    }
    if (!replaced) out.push(e);
  }
  return out.sort((a, b) => a.t - b.t);
}

function repairSignalFromEvents(eventsNewestFirst: V2EventRowForAi[]): string | null {
  for (const e of eventsNewestFirst.slice(0, 20)) {
    const p = e.payload_json as Record<string, unknown> | undefined;
    if (!p) continue;
    if (e.event_type === "sms_memory_signal") {
      const gm = typeof p.gated_mode === "string" ? p.gated_mode : "";
      if (gm === "repair_reply_only") {
        return "Recent repair thread (non-scoring turn): user challenged understanding—stay precise; do not treat as a proof miss.";
      }
    }
    const ai = p.ai;
    if (ai && typeof ai === "object" && !Array.isArray(ai)) {
      const gm = (ai as Record<string, unknown>).gated_mode;
      if (gm === "repair" || gm === "use_ai_outcome") {
        const rs = (ai as Record<string, unknown>).reply_style;
        if (rs === "repair") return "Recent exchange included a repair-style coach correction.";
      }
    }
    if (p.reply_resolution && typeof p.reply_resolution === "object") {
      const rr = p.reply_resolution as Record<string, unknown>;
      if (rr.reply_mode === "repair" || rr.gated_mode === "repair") {
        return "Recent exchange included a repair-style coach correction.";
      }
    }
  }
  return null;
}

/** Wave 9.1 — compact lines from durable memory_signal rows + pending payload mirror (tone hints only). */
function buildCompactMemorySignalHint(
  eventsNewestFirst: V2EventRowForAi[],
  pendingSms: V2SmsPendingResolutionPayload | null
): string | null {
  const parts: string[] = [];

  for (const e of eventsNewestFirst.slice(0, 15)) {
    const raw = e.payload_json;
    const p = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    if (!p) continue;

    if (e.event_type === "sms_memory_signal") {
      const ms = p.memory_signal as Record<string, unknown> | undefined;
      if (ms && ms.memory_signal_detected === true) {
        const ty = typeof ms.memory_signal_type === "string" ? ms.memory_signal_type : "signal";
        const gm = typeof p.gated_mode === "string" ? p.gated_mode : "";
        let sum = typeof ms.memory_signal_summary === "string" ? ms.memory_signal_summary : "";
        sum = truncate(sum.replace(/\s+/g, " "), 72);
        parts.push(`${ty}${gm ? ` (${gm})` : ""}${sum ? ` — ${sum}` : ""}`);
      }
    } else if (
      e.event_type === "user_yes" ||
      e.event_type === "user_no" ||
      e.event_type === "user_partial"
    ) {
      const ms = p.memory_signal as Record<string, unknown> | undefined;
      if (ms && ms.memory_signal_detected === true) {
        const ty = typeof ms.memory_signal_type === "string" ? ms.memory_signal_type : "signal";
        let sum = typeof ms.memory_signal_summary === "string" ? ms.memory_signal_summary : "";
        sum = truncate(sum.replace(/\s+/g, " "), 72);
        parts.push(`scored turn: ${ty}${sum ? ` — ${sum}` : ""}`);
      }
    } else if (e.event_type === "blocker_captured") {
      const ms = p.memory_signal as Record<string, unknown> | undefined;
      if (ms && ms.memory_signal_detected === true) {
        const ty = typeof ms.memory_signal_type === "string" ? ms.memory_signal_type : "signal";
        parts.push(`blocker turn: ${ty}`);
      }
    }
    if (parts.length >= 2) break;
  }

  if (pendingSms?.memory_signal_snapshot && typeof pendingSms.memory_signal_snapshot === "object") {
    const snap = pendingSms.memory_signal_snapshot as Record<string, unknown>;
    if (snap.memory_signal_detected === true) {
      const ty = typeof snap.memory_signal_type === "string" ? snap.memory_signal_type : "signal";
      parts.push(`SMS tighten/replace pending: ${ty}`);
    }
  }

  if (parts.length === 0) return null;
  return `RECENT_MEMORY_SIGNALS (bounded; not verified facts; do not quote verbatim): ${parts.slice(0, 2).join(" · ")}`;
}

/** Wave 11 — pending confirmation + recent confirmed updates (no raw sensitive dumps). */
function buildWave11MemoryContextHints(eventsNewestFirst: V2EventRowForAi[]): string | null {
  const parts: string[] = [];
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  for (const e of eventsNewestFirst.slice(0, 22)) {
    if (e.event_type !== "sms_memory_signal") continue;
    const raw = e.payload_json;
    const p = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    if (!p) continue;
    if (p.memory_confirmation_pending === true && p.status === "awaiting_confirmation") {
      parts.push("Pending: SMS memory confirmation awaiting your reply (identity or relationship context).");
      break;
    }
  }

  for (const e of eventsNewestFirst.slice(0, 22)) {
    if (e.event_type !== "sms_memory_signal") continue;
    const raw = e.payload_json;
    const p = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    if (!p || p.wave11_memory_resolution !== true) continue;
    const t = new Date(e.occurred_at).getTime();
    if (!Number.isFinite(t) || now - t > sevenDaysMs) continue;
    const ident = p.applied_identity_anchor === true;
    const rel = p.applied_people_summary === true || p.applied_responsibility === true;
    if (ident && rel) {
      parts.push("Confirmed memory update: identity anchor and relationship context updated recently.");
    } else if (ident) {
      parts.push("Confirmed memory update: identity anchor changed recently.");
    } else if (rel) {
      parts.push("Recent relationship context update confirmed.");
    }
    if (parts.length >= 3) break;
  }

  if (parts.length === 0) return null;
  return parts.slice(0, 3).join(" ");
}

/** Wave 12 — compact proof lines from spine metadata (no raw payload dumps). */
function buildCompactRecentProofLines(eventsNewestFirst: V2EventRowForAi[]): string | null {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const e of eventsNewestFirst.slice(0, 24)) {
    const raw = e.payload_json;
    const p = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    if (!p || p.proof_moment !== true) continue;
    const ty = typeof p.proof_moment_type === "string" ? p.proof_moment_type.trim() : "";
    if (!ty || seen.has(ty)) continue;
    seen.add(ty);
    const map: Record<string, string> = {
      comeback_after_miss: "came back after a miss",
      followed_through: "followed through on the bar",
      streak_continued: "stacked honest yeses",
      first_completion: "first clear yes on this bar",
      meaningful_streak: "sustained honest yes streak",
      honest_miss: "answered honestly on a miss",
      partial_but_stayed_engaged: "stayed engaged on a partial",
      blocker_named: "named the obstacle instead of disappearing",
      repair_trust: "repaired clarity after friction",
      memory_updated: "confirmed coaching context on SMS",
      commitment_tightened: "tightened the bar with intention",
      commitment_replaced: "chose a clearer commitment",
    };
    labels.push(map[ty] ?? ty.replace(/_/g, " "));
    if (labels.length >= 4) break;
  }
  if (labels.length === 0) return null;
  return `RECENT_PROOF_MOMENTS (server-derived): ${labels.slice(0, 3).join(" · ")}`;
}

function aggregateSevenDay(events: V2EventRowForAi[]): V2SmsConversationContextPack["recentOutcomeSummary"] {
  const nowMs = Date.now();
  const cutoff = nowMs - SEVEN_D_MS;
  let yes = 0;
  let no = 0;
  let partial = 0;
  let blockers = 0;
  let checks = 0;
  for (const e of events) {
    const t = new Date(e.occurred_at).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;
    switch (e.event_type) {
      case "user_yes":
        yes += 1;
        break;
      case "user_no":
        no += 1;
        break;
      case "user_partial":
        partial += 1;
        break;
      case "blocker_captured":
        blockers += 1;
        break;
      case "check_sent":
        checks += 1;
        break;
      default:
        break;
    }
  }
  return {
    yesCount7d: yes,
    noCount7d: no,
    partialCount7d: partial,
    blockerCount7d: blockers,
    checkSentCount7d: checks,
  };
}

function detectComebackLine(eventsAsc: { event_type: string }[]): string | null {
  let seenNeg = false;
  for (const e of eventsAsc) {
    if (e.event_type === "user_no" || e.event_type === "user_partial") seenNeg = true;
    if (seenNeg && e.event_type === "user_yes") return "Comeback: user answered yes after a miss/partial in this window.";
  }
  return null;
}

function buildPromptBlock(args: {
  safeProfileSummary: string | null;
  sensitiveToneOnly: boolean;
  pendingStateSummary: string | null;
  outcomeLine: string;
  proofHighlight: string | null;
  comebackSignal: string | null;
  blockerPattern: string | null;
  repairLine: string | null;
  memorySignalCompactLine: string | null;
  transcriptLines: string[];
  evolutionCompactLine: string | null;
}): string {
  const lines: string[] = [];
  lines.push("RECENT_SMS_CONTEXT (bounded; authoritative facts below are from server aggregates only):");
  lines.push("");
  lines.push(
    "LIVING_PROFILE: Onboarding-derived profile hints may be older than today’s thread. RECENT_THREAD and coaching aggregates can be more current—do not treat old onboarding as permanent truth. If facts seem stale or conflicting, ask briefly rather than assume. Do not quote sensitive or stale profile details as fact."
  );
  lines.push("");
  if (args.safeProfileSummary?.trim()) {
    lines.push(`SAFE_PROFILE: ${args.safeProfileSummary.trim()}`);
  }
  if (args.sensitiveToneOnly) {
    lines.push(
      "SENSITIVE_ONBOARDING_CONTEXT: available for tone only — do not quote people_summary, responsibility, family/health/finance pressure, or non-quotable identity verbatim."
    );
  }
  if (args.pendingStateSummary?.trim()) {
    lines.push(`PENDING_STATE: ${args.pendingStateSummary.trim()}`);
  }
  if (args.evolutionCompactLine?.trim()) {
    lines.push(`EVOLUTION_HINT (advisory; commitment unchanged): ${args.evolutionCompactLine.trim()}`);
  }
  if (args.memorySignalCompactLine?.trim()) {
    lines.push(args.memorySignalCompactLine.trim());
    lines.push("");
  }
  lines.push(`RECENT_ACCOUNTABILITY_7D: ${args.outcomeLine}`);
  if (args.proofHighlight?.trim()) {
    lines.push(`PROOF_NOTE: ${args.proofHighlight.trim()}`);
  }
  if (args.comebackSignal?.trim()) {
    lines.push(args.comebackSignal.trim());
  }
  if (args.blockerPattern?.trim()) {
    lines.push(`BLOCKER_PATTERN: ${args.blockerPattern.trim()}`);
  }
  if (args.repairLine?.trim()) {
    lines.push(args.repairLine.trim());
  }
  if (args.transcriptLines.length > 0) {
    lines.push("");
    lines.push("RECENT_THREAD (chronological; Coach/User labels):");
    for (const ln of args.transcriptLines) {
      lines.push(ln);
    }
  }
  lines.push("");
  lines.push(
    "Use this thread for continuity only. Do not invent facts. If RECENT_THREAD conflicts with structured RECENT_ACCOUNTABILITY_7D, trust structured counts."
  );

  let body = lines.join("\n");
  if (body.length > PROMPT_BLOCK_MAX) {
    body = `${body.slice(0, PROMPT_BLOCK_MAX - 1)}…`;
  }
  return body;
}

export type BuildV2SmsConversationContextPackArgs = {
  clerkUserId: string;
  commitmentId: string;
  commitment: ActiveV2CommitmentRow;
  timezone?: string;
  /** Skip duplicate coaching memory load when caller already has it. */
  preloadedCoachingMemory?: V2CoachingMemoryForPrompt | null;
  /** Skip duplicate event fetch when caller already loaded recent events (newest-first). */
  preloadedEventsNewestFirst?: V2EventRowForAi[] | null;
  currentInboundText?: string | null;
  maxTranscriptLines?: number;
};

/**
 * Assembles a bounded SMS conversation context pack for V2 AI prompts.
 */
export async function buildV2SmsConversationContextPack(
  args: BuildV2SmsConversationContextPackArgs
): Promise<V2SmsConversationContextPack> {
  const maxLines = args.maxTranscriptLines ?? DEFAULT_MAX_TRANSCRIPT;

  const events =
    args.preloadedEventsNewestFirst ?? (await getRecentV2EventsForAi(args.commitmentId));
  const coachingMemory =
    args.preloadedCoachingMemory ?? (await loadV2CoachingMemoryForPrompt(args.commitmentId));

  const outcomeSummary = aggregateSevenDay(events);

  function responseSum(o: V2SmsConversationContextPack["recentOutcomeSummary"]): number {
    return o.yesCount7d + o.noCount7d + o.partialCount7d;
  }

  const eventsAsc = [...events].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );
  const comebackSignal = detectComebackLine(eventsAsc.map((e) => ({ event_type: e.event_type })));

  const repairLine = repairSignalFromEvents(events);

  let blockerPattern: string | null = null;
  if (coachingMemory?.latest_blocker_preview?.trim()) {
    blockerPattern = truncate(coachingMemory.latest_blocker_preview, 140);
  }
  const blockerUsed = Boolean(blockerPattern);

  let proofHighlight: string | null = null;
  let proofUsed = false;
  const ys =
    typeof coachingMemory?.yes_streak_14d === "number" && Number.isFinite(coachingMemory.yes_streak_14d)
      ? coachingMemory.yes_streak_14d
      : 0;
  if (ys >= 3) {
    proofHighlight = `Proof streak signal: ${ys} yes days tracked (14d horizon; server-derived).`;
    proofUsed = true;
  } else if (outcomeSummary.yesCount7d >= 3) {
    proofHighlight = `Proof signal: ${outcomeSummary.yesCount7d} honest yes replies in the last 7 days.`;
    proofUsed = true;
  }

  if (
    proofHighlight == null &&
    responseSum(outcomeSummary) >= 4 &&
    outcomeSummary.yesCount7d >= outcomeSummary.noCount7d
  ) {
    proofHighlight = `Honest engagement: ${responseSum(outcomeSummary)} accountability replies in 7d.`;
    proofUsed = true;
  }

  const outcomeLine = `yes=${outcomeSummary.yesCount7d}, no=${outcomeSummary.noCount7d}, partial=${outcomeSummary.partialCount7d}, checks_sent=${outcomeSummary.checkSentCount7d}, blockers_logged=${outcomeSummary.blockerCount7d}`;

  let pendingStateSummary: string | null = null;
  const pend = getPendingResolutionOrNull(args.commitment);
  const pendingSmsPayload: V2SmsPendingResolutionPayload | null =
    pend?.payload?.source === "sms_inbound" ? pend.payload : null;
  if (pend?.payload?.source === "sms_inbound") {
    pendingStateSummary = `SMS pending resolution (${pend.kind}); state=${pend.payload.sms_state ?? "unknown"}.`;
  } else if (pend?.kind) {
    pendingStateSummary = `Pending guided resolution kind: ${pend.kind}.`;
  }
  if (isSmsInboundPendingResolutionActionable(args.commitment)) {
    pendingStateSummary = `${pendingStateSummary ?? ""} User may be finishing SMS tighten/replace — prioritize that thread over inventing new asks.`.trim();
  }

  const [{ data: profile }, lastCtx, inboundRows, sendRows, coachJobRows, pendingEvo] =
    await Promise.all([
      supabaseServer
        .from("user_profiles")
        .select(
          "preferred_name, life_desires, people_summary, responsibility, identity_anchor_text, identity_source"
        )
        .eq("clerk_user_id", args.clerkUserId)
        .maybeSingle(),
      supabaseServer
        .from("sms_last_outbound_context")
        .select("sent_at, full_body")
        .eq("clerk_user_id", args.clerkUserId)
        .maybeSingle(),
      supabaseServer
        .from("sms_inbound_messages")
        .select("raw_body, created_at")
        .eq("clerk_user_id", args.clerkUserId)
        .order("created_at", { ascending: false })
        .limit(8),
      supabaseServer
        .from("sms_send_events")
        .select("sms_body, created_at, metadata")
        .eq("clerk_user_id", args.clerkUserId)
        .order("created_at", { ascending: false })
        .limit(8),
      supabaseServer
        .from("sms_inbound_coach_jobs")
        .select("reply_body, sent_at, updated_at, created_at, message_sid, status, outbound_message_sid")
        .eq("clerk_user_id", args.clerkUserId)
        .not("reply_body", "is", null)
        .order("updated_at", { ascending: false })
        .limit(20),
      fetchPendingEvolutionRecommendation(args.commitmentId),
    ]);

  const nowMs = Date.now();
  const evolutionEvaluation = evaluateCommitmentEvolutionV1({
    commitment: args.commitment,
    eventsNewestFirst: events,
    nowMs,
  });
  const evolutionPick = pickWave7DailyEvolutionAction({
    commitment: args.commitment,
    pendingRow: pendingEvo,
    evaluation: evolutionEvaluation,
    nowMs,
  });
  const pendingAgeMs =
    pendingEvo?.status === "pending"
      ? nowMs - new Date(pendingEvo.created_at).getTime()
      : null;
  const pendingRowAppVisible = Boolean(
    pendingEvo?.recommended_action &&
      EVOLUTION_V1_SURFACED_ACTIONS.has(pendingEvo.recommended_action)
  );
  const evolutionFmt = formatWave7EvolutionContextLines({
    pick: evolutionPick,
    pendingRowAppVisible,
    pendingAgeMs,
  });
  const evolutionCompactLine = evolutionFmt.summaryLine;
  const evolutionMetaUsed = Boolean(evolutionPick);

  const rich: RichTimelineEntry[] = [];

  for (const e of eventsAsc) {
    if (e.event_type !== "check_sent") continue;
    const raw = e.payload_json as Record<string, unknown> | undefined;
    if (!raw) continue;
    const preview = typeof raw.body_preview === "string" ? raw.body_preview.trim() : "";
    if (!preview) continue;
    const ts = new Date(e.occurred_at).getTime();
    if (!Number.isFinite(ts) || ts < nowMs - SEVEN_D_MS) continue;
    const cleaned = truncate(stripSmsComplianceFooter(preview), DEFAULT_LINE_CHARS);
    if (cleaned) {
      rich.push({
        t: ts,
        role: "Coach",
        text: cleaned,
        source: "v2_commitment_event_check_sent",
        priority: 75,
      });
    }
  }

  if (lastCtx?.data && typeof (lastCtx.data as { sent_at?: string }).sent_at === "string") {
    const row = lastCtx.data as { sent_at: string; full_body?: string };
    const raw = typeof row.full_body === "string" ? row.full_body : "";
    const cleaned = truncate(stripSmsComplianceFooter(raw), DEFAULT_LINE_CHARS);
    if (cleaned) {
      rich.push({
        t: new Date(row.sent_at).getTime(),
        role: "Coach",
        text: cleaned,
        source: "sms_last_outbound_context",
        priority: 40,
      });
    }
  }

  for (const r of coachJobRows.data ?? []) {
    const row = r as {
      reply_body?: string | null;
      sent_at?: string | null;
      updated_at?: string | null;
      created_at?: string | null;
      status?: string | null;
      outbound_message_sid?: string | null;
    };
    const body = typeof row.reply_body === "string" ? row.reply_body.trim() : "";
    if (!body) continue;
    const sentLike =
      Boolean(row.sent_at?.trim()) ||
      row.status === "sent" ||
      Boolean(row.outbound_message_sid?.trim());
    if (!sentLike) continue;
    const tsRaw = row.sent_at ?? row.updated_at ?? row.created_at;
    const ts = typeof tsRaw === "string" ? new Date(tsRaw).getTime() : 0;
    if (!Number.isFinite(ts) || ts < nowMs - SEVEN_D_MS) continue;
    const cleaned = truncate(stripSmsComplianceFooter(body), DEFAULT_LINE_CHARS);
    if (cleaned) {
      rich.push({
        t: ts,
        role: "Coach",
        text: cleaned,
        source: "sms_inbound_coach_jobs",
        priority: 100,
      });
    }
  }

  for (const r of inboundRows.data ?? []) {
    const row = r as { raw_body?: string; created_at?: string };
    const raw = typeof row.raw_body === "string" ? row.raw_body : "";
    const ts = typeof row.created_at === "string" ? new Date(row.created_at).getTime() : 0;
    const low = raw.trim().toLowerCase();
    if (/^(stop|start|help|unstop|cancel)$/i.test(low) && raw.trim().length <= 12) continue;
    const cleaned = truncate(raw, DEFAULT_LINE_CHARS);
    if (cleaned) {
      rich.push({ t: ts, role: "User", text: cleaned, source: "sms_inbound_messages", priority: 50 });
    }
  }

  for (const r of sendRows.data ?? []) {
    const row = r as { sms_body?: string | null; created_at?: string; metadata?: unknown };
    const ts = typeof row.created_at === "string" ? new Date(row.created_at).getTime() : 0;
    let body =
      typeof row.sms_body === "string" && row.sms_body.trim()
        ? row.sms_body
        : "";
    if (!body && row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)) {
      const m = row.metadata as Record<string, unknown>;
      const mb = m.sms_body;
      if (typeof mb === "string") body = mb;
    }
    const cleaned = truncate(stripSmsComplianceFooter(body), DEFAULT_LINE_CHARS);
    if (cleaned) {
      rich.push({
        t: ts,
        role: "Coach",
        text: cleaned,
        source: "sms_send_events",
        priority: 80,
      });
    }
  }

  const mergedRich = dedupeRichTimeline(rich);
  const slicedRich = mergedRich.slice(-maxLines);
  const recentTranscriptLines = slicedRich.map((e) => `${e.role}: ${e.text}`);
  const transcriptSourcesUsed = [...new Set(slicedRich.map((e) => e.source))];

  const lastOutboundPreview =
    [...mergedRich].reverse().find((x) => x.role === "Coach")?.text ?? null;
  let lastInboundPreview =
    [...mergedRich].reverse().find((x) => x.role === "User")?.text ?? null;
  const inboundTrim = args.currentInboundText?.trim();
  if (inboundTrim && lastInboundPreview && inboundTrim === lastInboundPreview) {
    /* duplicate of latest stored inbound — keep single truth */
  } else if (inboundTrim) {
    lastInboundPreview = truncate(inboundTrim, DEFAULT_LINE_CHARS);
  }

  const pref =
    typeof profile?.preferred_name === "string" && profile.preferred_name.trim()
      ? profile.preferred_name.trim()
      : null;

  const identitySrc =
    typeof profile?.identity_source === "string" ? profile.identity_source : null;
  const iaRaw =
    typeof profile?.identity_anchor_text === "string" ? profile.identity_anchor_text.trim() : "";
  const quotableIa = iaRaw && isQuotableIdentitySource(identitySrc) ? truncate(iaRaw, 100) : null;

  const sensitive =
    Boolean(
      (typeof profile?.people_summary === "string" && profile.people_summary.trim()) ||
        (typeof profile?.responsibility === "string" && profile.responsibility.trim()) ||
        (iaRaw && !quotableIa)
    );

  const safeParts: string[] = [];
  if (pref) safeParts.push(`preferred_name=${truncate(pref, 48)}`);
  if (quotableIa) safeParts.push(`identity_anchor_quotable=${quotableIa}`);
  const relTone = coachingMemory?.sms_relationship_profile;
  if (relTone && typeof relTone === "object") {
    safeParts.push("relationship_tone=derived_from_SERVER_RELATIONSHIP_PROFILE (tone only)");
  }
  const safeProfileSummary = safeParts.length > 0 ? safeParts.join("; ") : null;

  const memorySignalCompactLine = [
    buildCompactMemorySignalHint(events, pendingSmsPayload),
    buildWave11MemoryContextHints(events),
    buildCompactRecentProofLines(events),
  ]
    .filter(Boolean)
    .join(" ");

  const promptBlock = buildPromptBlock({
    safeProfileSummary,
    sensitiveToneOnly: sensitive,
    pendingStateSummary,
    outcomeLine,
    proofHighlight,
    comebackSignal,
    blockerPattern,
    repairLine,
    memorySignalCompactLine,
    transcriptLines: recentTranscriptLines,
    evolutionCompactLine,
  });

  return {
    recentTranscriptLines,
    lastOutboundPreview,
    lastInboundPreview,
    recentOutcomeSummary: outcomeSummary,
    recentRepairOrClarification: repairLine,
    recentBlockerPattern: blockerPattern,
    proofHighlight,
    comebackSignal,
    pendingStateSummary,
    safeProfileSummary,
    sensitiveContextAvailableButNotQuotable: sensitive,
    evolutionRecommendationSummary: evolutionCompactLine,
    evolutionRecommendedAction: evolutionPick?.action ?? null,
    promptBlock,
    meta: {
      sms_context_pack_used: true,
      transcript_line_count: recentTranscriptLines.length,
      recent_event_count: events.length,
      proof_highlight_used: proofUsed,
      blocker_pattern_used: blockerUsed,
      ...(evolutionMetaUsed
        ? {
            evolution_recommendation_used: true,
            evolution_recommended_action: evolutionPick?.action ?? null,
          }
        : {}),
      transcript_sources_used: transcriptSourcesUsed,
    },
  };
}
