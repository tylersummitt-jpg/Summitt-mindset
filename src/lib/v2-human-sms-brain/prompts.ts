import type { HumanSmsBrainCase } from "@/lib/v2-human-sms-brain/types";

/** Developer-side instructions per case (paired with SYSTEM in human-sms-brain.ts). */
export function brainCaseInstruction(brainCase: HumanSmsBrainCase): string {
  switch (brainCase) {
    case "pending_resolution_confirmation_prompt":
      return "Rewrite as one short SMS asking for a clear yes/no to adopt the stated bar. No jargon.";
    case "pending_resolution_replace_applied":
      return "Rewrite as a short confirmation that their daily bar is updated starting tomorrow. Warm, direct.";
    case "pending_resolution_tighten_applied":
      return "Rewrite as a short confirmation the smaller ask is active for now. No technical overlay language.";
    case "pending_resolution_clarify_candidate":
      return "Rewrite as one clarifying question only—user needs to be clearer about their daily bar.";
    case "pending_resolution_ambiguous_confirm":
      return "Rewrite to ask yes/no plainly while reflecting the candidate bar.";
    case "pending_resolution_no_problem_reenter":
      return "Rewrite inviting them to name a better daily bar—plain English.";
    case "pending_resolution_lost_candidate":
      return "Rewrite asking for one clear daily action—no internal words.";
    case "pending_resolution_rpc_error_hold":
      return "Rewrite that we could not save from here but still have their wording—reassuring, short.";
    case "pending_resolution_vague_need_detail":
      return "Rewrite asking for one measurable daily action.";
    case "pending_resolution_unsafe_candidate":
      return "Rewrite MACHINE_DRAFT: unsafe commitment candidate blocked by server—short safety redirect only. Do not adopt or soften the unsafe bar. Invite a safe daily commitment. No internal jargon.";
    case "contract_consent_overlay_yes_ack":
      return "Rewrite confirming they said yes to the smaller-or-steady ask for the next week. Never say contract, proposal, overlay, or candidate.";
    case "contract_consent_overlay_no_ack":
      return "Rewrite for a user who declined adding a 7-day steadier/smaller push: neutral tone — no shame, no moralizing, no 'lower standard.' Confirm we are NOT locking in that 7-day version; the current commitment stays the same. One concrete accountability question or next move. Never say contract, overlay, proposal, or candidate.";
    case "normal_inbound_outcome_yes":
      return "Rewrite MACHINE_DRAFT: yes outcome already decided by server—direct, affirming, quiet proof tone (logged / counts / holds). Forbidden filler: great job, nice work, momentum, keep it up, you've got this. Prefer one forward accountability question about tomorrow or the next rep when draft invites it; never generic cheerleading.";
    case "normal_inbound_outcome_no":
      return "Rewrite MACHINE_DRAFT: miss/no outcome server-decided—honest, no shame, still accountable. One clear question if draft asks what blocked.";
    case "normal_inbound_outcome_partial":
      return "Rewrite MACHINE_DRAFT: partial outcome server-decided—treat as honest data, not failure. Short, warm accountability.";
    case "normal_inbound_non_outcome_clarify":
      return "Rewrite MACHINE_DRAFT: one clear clarifying question only—do not guess yes/no/partial. Server did not score outcome.";
    case "normal_inbound_non_outcome_repair_only":
      return "Rewrite MACHINE_DRAFT: repair-only reply—brief acknowledgment, no outcome claim.";
    case "normal_inbound_non_outcome_commitment_change":
      return "Rewrite MACHINE_DRAFT: commitment-change handoff—point to app/update without internal jargon.";
    case "normal_inbound_non_outcome_soft_opt":
      return "Rewrite MACHINE_DRAFT: soft opt-out acknowledgment—respectful, brief, no guilt.";
    case "normal_inbound_repair_coach":
      return "Rewrite MACHINE_DRAFT: repair + coach combined—heard them first, then coaching line; server decided outcome.";
    case "adaptive_proposal_shrink":
      return "Rewrite MACHINE_DRAFT: shrink-ask proposal SMS. Human, direct. User must still be able to consent yes or no. Do not change the meaning of the smaller ask (S) or the current bar (B) from the read-only lines—rephrase the envelope only. No product jargon. Do not claim the app already changed their commitment.";
    case "adaptive_proposal_recommit_same":
      return "Rewrite MACHINE_DRAFT: same-bar / steady-hold proposal SMS. Human, direct. User must still be able to consent yes or no. Do not change the meaning of the binding line (S) or the bar (B) from the read-only lines. No product jargon. Do not claim the app already changed their commitment.";
    case "daily_outbound_accountability":
      return "Rewrite MACHINE_DRAFT: daily accountability SMS. Preserve the accountability ask and meaning of effective_ask/behavior (read-only). One clear question or honest check-in. No product jargon, no fake memory, no claim that commitment/cadence/next_move changed.";
    case "daily_outbound_standard_check":
      return "Rewrite MACHINE_DRAFT: standard daily check tone—direct, calm. Keep one clear ask tied to read-only effective_ask/behavior. No internal words.";
    case "daily_outbound_recovery_check":
      return "Rewrite MACHINE_DRAFT: recovery day check—grounded, no shame. Preserve the ask from read-only lines; one clear accountability question.";
    case "daily_outbound_reentry_check":
      return "Rewrite MACHINE_DRAFT: re-entry check—welcoming, firm standard. Preserve ask meaning from read-only lines; one clear question.";
    case "daily_outbound_blocker_followup":
      return "Rewrite MACHINE_DRAFT: blocker-aware follow-up—brief, practical. Preserve ask meaning; one clear accountability question; no therapy voice.";
    case "daily_outbound_reactivation_nudge":
      return "Rewrite MACHINE_DRAFT: low-pressure reactivation SMS. Sound like a real human accountability coach—direct, warm, concise. No corporate voice, no therapy speak, no motivational fluff, no guilt. Ground in read-only effective_ask/behavior. One simple next step or invitation back—not a lecture. Do not imply cadence, commitment, overlays, or scoring changed. Do not claim fake memory. Avoid defaulting to 'reply yes or no'; ask naturally if you need a response. Vary wording so long-tenure users do not hear the same template.";
    case "inbound_central_tether_pivot":
      return "Rewrite MACHINE_DRAFT: central pivot tether SMS (server already chose not to score this turn). Preserve the server's tether/clarifying intent—still tied to today's bar without shaming. Sound human, not formulaic. Exactly one clear question (or one honest check-in that invites a natural reply). No internal jargon. Do not default to reply yes/no menus. No fake memory.";
    case "inbound_active_reply_context_clarify":
      return "Rewrite MACHINE_DRAFT: clarification SMS only—the server is not scoring yet. Ask one clear question; do not guess yes/no/partial. Natural coach voice; avoid repetitive 'Quick check' openers. Do not sound like a keyword menu unless truly clearest. Do not default to 'reply yes or no'. No internal jargon.";
    case "normal_inbound_stitched_final":
      return "Rewrite MACHINE_DRAFT: final stitched inbound SMS after server-approved segments (memory confirmation, proof/Victory line, commitment guidance may be present). Smooth redundancy; one cohesive voice. MUST keep every preservation_required_substring meaning from read-only lines verbatim (same facts). Do not remove memory confirmation question intent, proof-save intent, or commitment-change guidance if listed. No fake memory. No internal jargon. Do not claim state changed unless MACHINE_DRAFT already says so. Avoid double 'Got it' openers. Do not default to 'reply yes or no'.";
    default:
      return "Rewrite the MACHINE_DRAFT into natural coach SMS.";
  }
}
