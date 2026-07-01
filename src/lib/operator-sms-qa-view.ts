/**
 * Wave 10 — Read-only operator SMS transcript QA (internal console).
 * No mutations. Payloads redact keys containing "prompt" (case-insensitive) for safety.
 */

import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { getActiveCommitment, type ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { loadV2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory";
import { isQuotableIdentitySource } from "@/lib/v2-identity-anchor";
import { supabaseServer } from "@/lib/supabase-server";

const RECENT_SCAN = 180;
const SPINE_LIMIT = 80;
const TIMELINE_LIMIT_EACH = 120;

export type OperatorSmsQaRecentUser = {
  clerk_user_id: string;
  last_activity_at: string;
  phone_hint: string | null;
};

export type OperatorSmsQaTimelineRow = {
  at: string;
  role: "user" | "coach";
  label: string;
  body: string;
  ref: string;
};

export type OperatorSmsQaSpineRow = {
  occurred_at: string;
  event_type: string;
  flags: string[];
  payload_redacted_json: string;
};

export type OperatorSmsQaWeeklyRow = {
  week_key: string | null;
  status: string | null;
  message_sid: string | null;
  metadata_summary: string;
  metadata_redacted_json: string;
};

export type OperatorSmsQaProfileHeader = {
  preferred_name: string | null;
  identity_anchor_text: string | null;
  identity_source: string | null;
  identity_shown_as_quotable: boolean;
  people_summary: string | null;
  responsibility: string | null;
  relationship_context_note: string;
};

export type OperatorSmsQaLoaded = {
  kind: "loaded";
  target_clerk_user_id: string;
  profile: OperatorSmsQaProfileHeader;
  commitment: ActiveV2CommitmentRow | null;
  effective_coaching_ask: string | null;
  coaching_summary: string | null;
  latest_blocker_preview: string | null;
  accountability_phase: string | null;
  pending_resolution_kind: string | null;
  yes_no_partial_hint: string | null;
  timeline: OperatorSmsQaTimelineRow[];
  spine: OperatorSmsQaSpineRow[];
  weekly_send_events: OperatorSmsQaWeeklyRow[];
  global_flags: string[];
};

export type OperatorSmsQaView =
  | { kind: "needs_target" }
  | OperatorSmsQaLoaded
  | { kind: "user_not_found"; target: string };

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Remove keys whose names include "prompt" (shallow + one-level nested objects only for speed). */
export function redactPromptLikeKeys(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((x) => redactPromptLikeKeys(x));
  const o = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k.toLowerCase().includes("prompt")) {
      out[k] = "[redacted: prompt-related key]";
      continue;
    }
    if (v != null && typeof v === "object" && !Array.isArray(v)) {
      const inner = v as Record<string, unknown>;
      const innerOut: Record<string, unknown> = {};
      for (const [ik, iv] of Object.entries(inner)) {
        if (ik.toLowerCase().includes("prompt")) innerOut[ik] = "[redacted]";
        else innerOut[ik] = iv;
      }
      out[k] = innerOut;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function summaryFromMetadata(m: unknown): string {
  if (m == null || typeof m !== "object" || Array.isArray(m)) return "—";
  const r = m as Record<string, unknown>;
  const bits: string[] = [];
  if (r.v2_weekly_proof_sms === true) bits.push("v2_weekly_proof");
  if (r.message_purpose === "weekly_proof_reflection") bits.push("weekly_proof_reflection");
  if (r.ai_used === true) bits.push("ai_used");
  if (r.ai_used === false) bits.push("ai_fallback");
  if (r.weekly_evolution_note_used === true) bits.push("weekly_evolution_note_used");
  if (r.v2_accountability === true) bits.push("v2_accountability");
  if (typeof r.daily_message_purpose === "string") bits.push(`purpose=${r.daily_message_purpose}`);
  if (typeof r.note === "string" && r.note) bits.push(`note=${String(r.note).slice(0, 40)}`);
  return bits.length ? bits.join(" · ") : "sms_send";
}

function coachBodyFromSendRow(row: Record<string, unknown>): string {
  const topLevel = row.sms_body;
  if (typeof topLevel === "string" && topLevel.trim()) return topLevel;
  const m = row.metadata;
  if (m == null || typeof m !== "object" || Array.isArray(m)) return "";
  const metaBody = (m as Record<string, unknown>).sms_body;
  return typeof metaBody === "string" ? metaBody : "";
}

function extractSpineFlags(eventType: string, p: Record<string, unknown>): string[] {
  const flags: string[] = [];
  const rr = p.reply_resolution as Record<string, unknown> | undefined;
  const gated = p.ai_gated_decision as Record<string, unknown> | undefined;
  const shadow = p.shadow_interpretation as Record<string, unknown> | undefined;
  const mem = p.memory_signal as Record<string, unknown> | undefined;
  const ai = p.ai as Record<string, unknown> | undefined;

  if (typeof p.normalized_hint === "string" && p.normalized_hint)
    flags.push(`normalized_hint=${p.normalized_hint}`);
  if (typeof shadow?.ai_intent === "string") flags.push(`shadow intent: ${shadow.ai_intent}`);
  if (typeof shadow?.deterministic_event_type === "string") {
    flags.push(`deterministic_event_type=${shadow.deterministic_event_type}`);
  }
  if (shadow?.deterministic_normalized_hint != null && String(shadow.deterministic_normalized_hint).trim()) {
    flags.push(`deterministic_normalized_hint=${String(shadow.deterministic_normalized_hint)}`);
  }
  if (shadow?.shadow_ai_failed === true) flags.push("Shadow interpretation failed");

  if (shadow?.ai_agrees_with_classifier === false) flags.push("AI disagreed with classifier");
  if (gated?.overrode_deterministic === true) flags.push("AI overrode deterministic classifier");
  if (shadow?.ai_would_have_asked_clarification === true) flags.push("AI would have clarified");
  if (rr?.reply_mode === "clarification" || gated?.mode === "clarify") flags.push("Clarification sent");
  if (typeof rr?.final_event_type === "string") flags.push(`final_event_type=${rr.final_event_type}`);
  if (rr?.reply_mode === "repair" || p.repair_context) flags.push("Repair mode");
  if (mem?.memory_signal_detected === true) flags.push("Memory signal");
  if (gated?.mode === "soft_opt_out_reply") flags.push("Soft opt-out");
  if (gated?.mode === "commitment_change_handoff") flags.push("Commitment change requested");
  if (typeof gated?.mode === "string") flags.push(`ai_gated_decision.mode=${gated.mode}`);
  if (ai?.fallback_used === true) flags.push("AI fallback used");
  if (rr && rr.suggested_reply_used === false && rr.suggested_reply_rejected_reason) {
    flags.push("Suggested reply rejected");
  }
  if (eventType === "sms_memory_signal") flags.push("Living memory row (non-score)");
  if (p.memory_confirmation_pending === true) flags.push("Wave11 memory confirmation pending");
  if (p.wave11_memory_resolution === true) flags.push("Wave11 memory confirmation resolved");
  if (p.proof_moment === true) flags.push("Proof moment");
  if (typeof p.proof_moment_type === "string" && p.proof_moment_type.trim()) {
    flags.push(`proof_type=${p.proof_moment_type}`);
  }
  if (typeof p.proof_weight === "string" && p.proof_weight.trim()) {
    flags.push(`proof_weight=${p.proof_weight}`);
  }
  if (typeof p.user_visible_proof_line === "string" && p.user_visible_proof_line.trim()) {
    flags.push(`proof_line=${String(p.user_visible_proof_line).slice(0, 72)}`);
  }
  if (p.victory_room_callout_sent === true) flags.push("Victory Room SMS callout sent");
  if (typeof p.victory_room_callout_reason === "string" && p.victory_room_callout_reason.trim()) {
    flags.push(`victory_callout_reason=${p.victory_room_callout_reason}`);
  }
  const cen = p.central_sms_turn_shadow as Record<string, unknown> | undefined;
  if (cen && typeof cen === "object") {
    if (cen.central_sms_brain_failed === true) flags.push("central_failed");
    if (typeof cen.central_turn_purpose === "string" && cen.central_turn_purpose.trim()) {
      flags.push(`central_purpose=${cen.central_turn_purpose}`);
    }
    if (typeof cen.confidence === "number" && Number.isFinite(cen.confidence)) {
      flags.push(`central_confidence=${cen.confidence.toFixed(2)}`);
    }
    if (cen.should_use_existing_branch != null && String(cen.should_use_existing_branch).trim()) {
      flags.push(`central_branch=${String(cen.should_use_existing_branch)}`);
    }
    const sf = cen.safety_flags;
    if (Array.isArray(sf) && sf.length > 0) {
      flags.push(`central_safety=${sf.slice(0, 4).map(String).join(",")}`);
    }
    const riskyCentral =
      typeof cen.central_turn_purpose === "string" &&
      (cen.central_turn_purpose === "meta_question_or_confusion" ||
        cen.central_turn_purpose === "human_conversation" ||
        cen.central_turn_purpose === "advice_or_coaching_request");
    if (riskyCentral && eventType === "blocker_captured") {
      flags.push("CENTRAL_MISMATCH_META_vs_blocker_event");
    }
    if (riskyCentral && eventType === "user_partial") {
      flags.push("CENTRAL_REVIEW_humanish_turn_vs_partial_event");
    }
    if (
      riskyCentral &&
      (eventType === "user_partial" || eventType === "user_no") &&
      cen.should_answer_without_scoring === true
    ) {
      flags.push("CENTRAL_MISMATCH_meta_vs_negative_outcome");
    }
  }
  const cenCtrl = p.central_sms_turn_control as Record<string, unknown> | undefined;
  if (cenCtrl && typeof cenCtrl === "object") {
    if (cenCtrl.control_action === "blocked_blocker_capture") flags.push("CENTRAL_CONTROL_BLOCKED_BLOCKER");
    if (cenCtrl.control_action === "blocked_outcome_scoring") flags.push("CENTRAL_CONTROL_BLOCKED_OUTCOME");
    if (typeof cenCtrl.no_event_reason === "string" && cenCtrl.no_event_reason.trim()) {
      flags.push(`no_event_reason=${String(cenCtrl.no_event_reason).slice(0, 80)}`);
    }
    if (cenCtrl.reply_source === "central_brain_deterministic_v14_2") {
      flags.push("reply_source=central_brain_deterministic_v14_2");
    }
  }
  if (eventType === "blocker_captured" && mem?.memory_signal_detected === true) {
    flags.push("Blocker + memory signal");
  }

  if (eventType === "check_sent") {
    const outAi = p.ai as Record<string, unknown> | undefined;
    const dp = outAi?.daily_message_purpose ?? p.daily_message_purpose;
    if (typeof dp === "string") flags.push(`Daily purpose: ${dp}`);
    if (outAi?.identity_reference_used === true) flags.push("Identity reference used (outbound)");
    if (outAi?.proof_reference_used === true) flags.push("Proof reference used");
    if (outAi?.blocker_pattern_coaching_used === true) flags.push("Blocker pattern coaching used");
    const ev = outAi?.evolution_recommended_action ?? p.evolution_recommended_action;
    if (typeof ev === "string") flags.push(`Evolution action: ${ev}`);
    if (outAi?.fallback_used === true || outAi?.ai_rejected_reason) flags.push("Outbound AI fallback / rejected");
  }

  return flags;
}

function mergeRecentUsers(
  inbound: { clerk_user_id?: string; phone_number?: string | null; received_at?: string }[],
  sends: { clerk_user_id?: string; created_at?: string }[]
): OperatorSmsQaRecentUser[] {
  const best = new Map<string, { at: string; phone: string | null }>();
  for (const r of inbound) {
    const id = typeof r.clerk_user_id === "string" ? r.clerk_user_id.trim() : "";
    if (!id) continue;
    const at = typeof r.received_at === "string" ? r.received_at : "";
    const ph = typeof r.phone_number === "string" ? r.phone_number : null;
    const prev = best.get(id);
    if (!prev || (at && at > prev.at)) best.set(id, { at: at || prev?.at || "", phone: ph ?? prev?.phone ?? null });
  }
  for (const r of sends) {
    const id = typeof r.clerk_user_id === "string" ? r.clerk_user_id.trim() : "";
    if (!id) continue;
    const at = typeof r.created_at === "string" ? r.created_at : "";
    const prev = best.get(id);
    if (!prev || (at && at > prev.at)) best.set(id, { at: at || prev?.at || "", phone: prev?.phone ?? null });
  }
  return [...best.entries()]
    .map(([clerk_user_id, v]) => ({
      clerk_user_id,
      last_activity_at: v.at,
      phone_hint: v.phone,
    }))
    .sort((a, b) => (a.last_activity_at < b.last_activity_at ? 1 : -1))
    .slice(0, 40);
}

export async function loadOperatorSmsQaRecentUsers(args: {
  phoneFilter: string | null;
}): Promise<OperatorSmsQaRecentUser[]> {
  const digits = args.phoneFilter?.replace(/\D/g, "") ?? "";
  const [inRes, sRes] = await Promise.all([
    supabaseServer
      .from("sms_inbound_messages")
      .select("clerk_user_id, phone_number, received_at")
      .order("received_at", { ascending: false })
      .limit(RECENT_SCAN),
    supabaseServer
      .from("sms_send_events")
      .select("clerk_user_id, created_at")
      .order("created_at", { ascending: false })
      .limit(RECENT_SCAN),
  ]);

  let merged = mergeRecentUsers(
    (inRes.data ?? []) as { clerk_user_id?: string; phone_number?: string | null; received_at?: string }[],
    (sRes.data ?? []) as { clerk_user_id?: string; created_at?: string }[]
  );

  if (digits.length >= 7) {
    merged = merged.filter((u) => {
      const ph = u.phone_hint?.replace(/\D/g, "") ?? "";
      return ph.includes(digits) || digits.includes(ph);
    });
  }

  return merged;
}

export async function loadOperatorSmsQaDetail(targetClerkUserId: string): Promise<OperatorSmsQaView> {
  const target = targetClerkUserId.trim();
  if (!target) return { kind: "needs_target" };

  const [profileRes, commitment, inboundRes, sendRes, weeklyRes] = await Promise.all([
    supabaseServer
      .from("user_profiles")
      .select(
        "preferred_name, identity_anchor_text, identity_source, people_summary, responsibility"
      )
      .eq("clerk_user_id", target)
      .maybeSingle(),
    getActiveCommitment(target),
    supabaseServer
      .from("sms_inbound_messages")
      .select("message_sid, raw_body, received_at")
      .eq("clerk_user_id", target)
      .order("received_at", { ascending: false })
      .limit(TIMELINE_LIMIT_EACH),
    supabaseServer
      .from("sms_send_events")
      .select("created_at, sms_body, metadata, message_sid, day_key, status")
      .eq("clerk_user_id", target)
      .order("created_at", { ascending: false })
      .limit(TIMELINE_LIMIT_EACH),
    supabaseServer
      .from("sms_weekly_send_events")
      .select("week_key, status, message_sid, metadata")
      .eq("clerk_user_id", target)
      .order("week_key", { ascending: false })
      .limit(16),
  ]);

  const coachingMem =
    commitment?.id != null ? await loadV2CoachingMemoryForPrompt(commitment.id) : null;

  if (!profileRes.data && !commitment && (inboundRes.data ?? []).length === 0 && (sendRes.data ?? []).length === 0) {
    return { kind: "user_not_found", target };
  }

  const pr = profileRes.data as Record<string, unknown> | null;
  const preferredName = typeof pr?.preferred_name === "string" ? pr.preferred_name : null;
  const iaRaw = typeof pr?.identity_anchor_text === "string" ? pr.identity_anchor_text.trim() : null;
  const idSrc = typeof pr?.identity_source === "string" ? pr.identity_source : null;
  const quotable = iaRaw && isQuotableIdentitySource(idSrc);
  const peopleSummary = typeof pr?.people_summary === "string" && pr.people_summary.trim() ? pr.people_summary.trim() : null;
  const responsibility =
    typeof pr?.responsibility === "string" && pr.responsibility.trim() ? pr.responsibility.trim() : null;

  const timeline: OperatorSmsQaTimelineRow[] = [];
  for (const row of inboundRes.data ?? []) {
    const r = row as Record<string, unknown>;
    const raw = typeof r.raw_body === "string" ? r.raw_body : "";
    const sid = typeof r.message_sid === "string" ? r.message_sid : "";
    const at = typeof r.received_at === "string" ? r.received_at : "";
    if (at)
      timeline.push({
        at,
        role: "user",
        label: "Inbound SMS",
        body: raw,
        ref: sid ? `message_sid=${sid}` : "",
      });
  }
  for (const row of sendRes.data ?? []) {
    const r = row as Record<string, unknown>;
    const at = typeof r.created_at === "string" ? r.created_at : "";
    const meta = r.metadata;
    const body = coachBodyFromSendRow(r);
    const sid = typeof r.message_sid === "string" ? r.message_sid : "";
    const dk = typeof r.day_key === "string" ? r.day_key : "";
    if (at)
      timeline.push({
        at,
        role: "coach",
        label: summaryFromMetadata(meta),
        body: body || "(body in sms_body/metadata missing — see metadata in spine)",
        ref: [sid && `message_sid=${sid}`, dk && `day_key=${dk}`].filter(Boolean).join(" · "),
      });
  }
  timeline.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  let spine: OperatorSmsQaSpineRow[] = [];
  const globalFlags = new Set<string>();

  if (commitment?.id) {
    const evRes = await supabaseServer
      .from("v2_commitment_event")
      .select("event_type, occurred_at, payload_json")
      .eq("commitment_id", commitment.id)
      .order("occurred_at", { ascending: false })
      .limit(SPINE_LIMIT);

    spine = (evRes.data ?? []).map((row) => {
      const eventType = typeof row.event_type === "string" ? row.event_type : "unknown";
      const occurredAt = typeof row.occurred_at === "string" ? row.occurred_at : "";
      const payload =
        row.payload_json != null && typeof row.payload_json === "object" && !Array.isArray(row.payload_json)
          ? (row.payload_json as Record<string, unknown>)
          : {};
      const flags = extractSpineFlags(eventType, payload);
      for (const f of flags) globalFlags.add(f);
      return {
        occurred_at: occurredAt,
        event_type: eventType,
        flags,
        payload_redacted_json: safeJson(redactPromptLikeKeys(payload)),
      };
    });
  }

  if (commitment?.pending_resolution_kind) globalFlags.add("Pending resolution active");

  const weekly_send_events: OperatorSmsQaWeeklyRow[] = (weeklyRes.data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const meta = r.metadata;
    return {
      week_key: typeof r.week_key === "string" ? r.week_key : null,
      status: typeof r.status === "string" ? r.status : null,
      message_sid: typeof r.message_sid === "string" ? r.message_sid : null,
      metadata_summary: summaryFromMetadata(meta),
      metadata_redacted_json: safeJson(redactPromptLikeKeys(meta)),
    };
  });

  for (const w of weekly_send_events) {
    if (w.metadata_summary.includes("v2_weekly_proof")) globalFlags.add("Weekly proof (V2) sent metadata present");
  }

  const nowMs = Date.now();
  const effectiveAsk = commitment ? getEffectiveCoachingAsk(commitment, nowMs) : null;

  let yesNoPartialHint: string | null = null;
  if (coachingMem) {
    yesNoPartialHint = `yes_streak_14d=${coachingMem.yes_streak_14d}, no_14d=${coachingMem.no_count_14d}, partial_14d=${coachingMem.partial_count_14d}`;
  }

  return {
    kind: "loaded",
    target_clerk_user_id: target,
    profile: {
      preferred_name: preferredName,
      identity_anchor_text: quotable ? iaRaw : iaRaw ? "(hidden — not quotable source)" : null,
      identity_source: idSrc,
      identity_shown_as_quotable: Boolean(quotable && iaRaw),
      people_summary: peopleSummary,
      responsibility,
      relationship_context_note:
        "people_summary & responsibility are relationship/context hints — not the canonical identity line.",
    },
    commitment: commitment ?? null,
    effective_coaching_ask: effectiveAsk,
    coaching_summary: coachingMem?.coaching_summary ?? null,
    latest_blocker_preview: coachingMem?.latest_blocker_preview ?? null,
    accountability_phase: commitment?.accountability_phase ?? null,
    pending_resolution_kind: commitment?.pending_resolution_kind ?? null,
    yes_no_partial_hint: yesNoPartialHint,
    timeline,
    spine,
    weekly_send_events,
    global_flags: [...globalFlags].sort(),
  };
}
