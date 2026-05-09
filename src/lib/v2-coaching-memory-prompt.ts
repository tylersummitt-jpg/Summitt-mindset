/**
 * Coaching memory types + prompt formatting only (no DB / no imports from v2-ai-outbound).
 */

import type { V2AccountabilityPhase } from "@/lib/v2-accountability-phase";
import type { V1SmsRelationshipProfile } from "@/lib/v2-sms-relationship-profile";

export type V2CoachingMemoryForPrompt = {
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
  /** From latest contract_overlay_activated payload when present. */
  overlay_contract_kind?: "shrink_ask" | "recommit_same" | null;
  overlay_expires_at: string | null;
  yes_streak_14d: number;
  no_count_14d: number;
  partial_count_14d: number;
  latest_blocker_preview: string | null;
  blocker_tags: string[];
  coaching_summary: string | null;
  /** Mirrored from v2_commitment (authoritative over summary). */
  accountability_phase: V2AccountabilityPhase;
  reactivation_entered_at: string | null;
  reactivation_last_sent_at: string | null;
  /**
   * Optional mirror of `user_profiles` for prompts only (non-authoritative).
   * Authoritative identity text always lives on `user_profiles`.
   */
  identity_anchor_text?: string | null;
  /** True when `identity_refresh_due_at` is in the past (informational). */
  identity_refresh_due?: boolean;
  /**
   * Mirror of `v2_commitment.refresh_session` for prompts only (authoritative on commitment row).
   */
  coaching_refresh_active?: boolean;
  coaching_refresh_step?: "identity" | "commitment" | null;
  /** Mirror of `v2_commitment` pending guided resolution (non-authoritative). */
  pending_resolution_kind?: string | null;
  pending_resolution_expires_at?: string | null;
  /**
   * Rule-derived long-horizon relationship fit (v2_commitment_coaching_memory.relationship_profile).
   * Non-authoritative: wording / soft tone only.
   */
  sms_relationship_profile?: V1SmsRelationshipProfile | null;
  relationship_profile_version?: string | null;
  relationship_profile_updated_at?: string | null;
};

const SUMMARY_MAX_CHARS = 400;

function truncateOneLine(s: string, max: number): string {
  const x = s.trim().replace(/\s+/g, " ");
  if (x.length <= max) return x;
  return `${x.slice(0, max - 1)}…`;
}

/** Bounded block for AI developer prompts (structured wins over summary). */
export function formatCoachingMemoryPromptBlock(m: V2CoachingMemoryForPrompt | null): string {
  if (!m) return "";
  const lines: string[] = [];
  lines.push("COACHING_MEMORY (recomputable projection; if conflict, ignore summary and trust structured lines):");
  lines.push(
    "May reflect recent SMS/accountability patterns more than older onboarding profile rows—do not treat onboarding-only hints as dated facts."
  );
  lines.push(`effective_ask: ${truncateOneLine(m.effective_ask_text, 160)}`);
  lines.push(`coaching_state: ${m.coaching_state}`);
  lines.push(
    `silence: tier=${m.silence_tier_snapshot}, unanswered_checks=${m.unanswered_checks_snapshot}, days_since_last_user_outcome=${m.days_since_last_user_outcome_snapshot}`
  );
  lines.push(`cadence: ${m.cadence_level} (${m.cadence_reason_code})`);
  lines.push(`next_move: ${m.next_move_type} (${m.next_move_reason_code})`);
  lines.push(`overlay_active: ${m.overlay_active}${m.overlay_expires_at ? ` until ${m.overlay_expires_at}` : ""}`);
  if (m.overlay_contract_kind) {
    lines.push(`overlay_contract_kind: ${m.overlay_contract_kind}`);
  }
  lines.push(
    `accountability_phase: ${m.accountability_phase}` +
      (m.reactivation_entered_at ? ` (reactivation_since=${m.reactivation_entered_at})` : "")
  );
  if (m.reactivation_last_sent_at) {
    lines.push(`reactivation_last_sent_at: ${m.reactivation_last_sent_at}`);
  }
  lines.push(`yes_streak_signal: ${m.yes_streak_14d}, no_14d: ${m.no_count_14d}, partial_14d: ${m.partial_count_14d}`);
  if (m.latest_blocker_preview) {
    lines.push(`latest_blocker_preview: ${truncateOneLine(m.latest_blocker_preview, 120)}`);
  }
  if (m.blocker_tags.length > 0) {
    lines.push(`blocker_tags (rule-derived): ${m.blocker_tags.join(", ")}`);
  }
  if (m.coaching_summary?.trim()) {
    lines.push(`coaching_summary (NON-AUTHORITATIVE prose): ${truncateOneLine(m.coaching_summary, SUMMARY_MAX_CHARS)}`);
    if (m.coaching_summary.includes("[v3_notebook]")) {
      const joined = m.coaching_summary
        .split("\n")
        .filter((l) => l.includes("[v3_notebook]"))
        .map((l) => l.replace(/^\s*\[v3_notebook\]\s*/i, "").trim())
        .filter(Boolean)
        .join(" · ");
      if (joined) {
        lines.push(
          `v3_notebook (retention; use to avoid repeating the same angle): ${truncateOneLine(joined, 360)}`
        );
      }
    }
  }
  if (m.identity_anchor_text?.trim()) {
    lines.push(
      `identity_anchor (NON-AUTHORITATIVE mirror of user_profiles): ${truncateOneLine(m.identity_anchor_text, 120)}`
    );
    lines.push(
      `identity_refresh_due (informational): ${m.identity_refresh_due ? "yes" : "no"} — whether SMS may quote anchor is decided at send time on the server.`
    );
  }
  if (m.coaching_refresh_active && m.coaching_refresh_step) {
    lines.push(
      `coaching_refresh_session (NON-AUTHORITATIVE mirror of v2_commitment.refresh_session): active=yes, step=${m.coaching_refresh_step} — contract proposals + identity grounding in normal checks are suppressed while this is active.`
    );
  }
  if (m.pending_resolution_kind && m.pending_resolution_expires_at) {
    lines.push(
      `guided_pending_resolution (NON-AUTHORITATIVE mirror of v2_commitment): kind=${m.pending_resolution_kind}, expires_at=${m.pending_resolution_expires_at} — may be app handoff after refresh SMS or SMS-native tighten/replace (Wave 4); not a strategy signal.`
    );
  }
  if (m.sms_relationship_profile) {
    const rp = m.sms_relationship_profile;
    lines.push("");
    lines.push(
      "RELATIONSHIP_PROFILE_FIT (rule-derived long-horizon layer on coaching_memory; NOT commitment state; NOT cadence/next_move/overlay/reactivation/identity authority):"
    );
    lines.push(`relationship_profile_version: ${m.relationship_profile_version ?? rp.version}`);
    if (m.relationship_profile_updated_at) {
      lines.push(`relationship_profile_updated_at: ${m.relationship_profile_updated_at}`);
    }
    lines.push(
      `directness_band: ${rp.directness_band} (confidence=${rp.directness_confidence}) — softer=brief acknowledgment ok; standard=default Coach Pat; firmer=slightly more declarative.`
    );
    lines.push(
      `message_density_tolerance: ${rp.message_density_tolerance} (confidence=${rp.message_density_confidence}) — low=slightly shorter copy when equivalent; high=slightly more context ok.`
    );
    lines.push(
      `comeback_sensitivity: ${rp.comeback_sensitivity} (confidence=${rp.comeback_confidence}) — low_pressure_first=first clause slightly lighter after reactivation/quiet.`
    );
    lines.push(
      `simplification_bias: ${rp.simplification_bias} (confidence=${rp.simplification_confidence}) — prefer_simplify vs hold_line nudges shrink framing only when next_move already allows it.`
    );
    lines.push(`signals_snapshot: ${truncateOneLine(JSON.stringify(rp.signals_snapshot), 320)}`);
    if (rp.rule_notes.length > 0) {
      lines.push(`rule_notes: ${truncateOneLine(rp.rule_notes.join(" | "), 260)}`);
    }
    lines.push(
      "Use RELATIONSHIP_PROFILE_FIT only to tune phrasing inside the locked server strategy—never override SILENCE_CONTEXT, NEXT_MOVE, CADENCE, CONTRACT_PROPOSAL_MODE, or identity_reference_allowed_this_send."
    );
  }
  return lines.join("\n");
}
