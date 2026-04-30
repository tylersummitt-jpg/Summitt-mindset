/**
 * Wave 12 — Deterministic SMS proof moments (metadata only; no invented success).
 * Wave 12.1 — Victory Room SMS callouts + commitment-change proof rows.
 * Attached to `v2_commitment_event.payload_json` where relevant spine rows are written.
 */

import { supabaseServer } from "@/lib/supabase-server";

export type ProofMomentType =
  | "followed_through"
  | "comeback_after_miss"
  | "honest_miss"
  | "partial_but_stayed_engaged"
  | "blocker_named"
  | "repair_trust"
  | "commitment_tightened"
  | "commitment_replaced"
  | "memory_updated"
  | "streak_continued"
  | "first_completion"
  | "meaningful_streak";

export type ProofWeight = "light" | "medium" | "strong";

export type ProofMomentMeta = {
  proof_moment: true;
  proof_moment_type: ProofMomentType;
  proof_moment_reason: string;
  proof_weight: ProofWeight;
  user_visible_proof_line: string;
};

export function proofMomentPayloadFields(meta: ProofMomentMeta | null): Record<string, unknown> {
  if (!meta) return {};
  return {
    proof_moment: meta.proof_moment,
    proof_moment_type: meta.proof_moment_type,
    proof_moment_reason: meta.proof_moment_reason,
    proof_weight: meta.proof_weight,
    user_visible_proof_line: meta.user_visible_proof_line,
  };
}

function clampLine(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Most recent past accountability outcome in spine (events newest-first). */
export function getMostRecentPastOutcomeType(
  eventsNewestFirst: { event_type: string }[]
): "user_yes" | "user_no" | "user_partial" | null {
  for (const e of eventsNewestFirst) {
    const t = e.event_type;
    if (t === "user_yes" || t === "user_no" || t === "user_partial") {
      return t;
    }
  }
  return null;
}

/** Count `user_yes` outcomes at the newest edge of the spine (stops at first non-yes). */
export function countLeadingUserYesStreakFromNewest(eventsNewestFirst: { event_type: string }[]): number {
  let n = 0;
  for (const e of eventsNewestFirst) {
    if (e.event_type === "user_yes") n += 1;
    else break;
  }
  return n;
}

export function countAllUserYesInWindow(eventsNewestFirst: { event_type: string }[]): number {
  return eventsNewestFirst.filter((e) => e.event_type === "user_yes").length;
}

/**
 * Proof metadata for scored inbound accountability outcomes (user_yes / user_no / user_partial).
 */
export function buildProofMomentForAccountabilityOutcome(args: {
  finalEventType: "user_yes" | "user_no" | "user_partial";
  eventsNewestFirst: { event_type: string }[];
  isRepairOutcome: boolean;
  userMessageCharCount: number;
}): ProofMomentMeta | null {
  const prev = getMostRecentPastOutcomeType(args.eventsNewestFirst);
  const leadingYes = countLeadingUserYesStreakFromNewest(args.eventsNewestFirst);
  const totalYes = countAllUserYesInWindow(args.eventsNewestFirst);

  if (args.finalEventType === "user_yes") {
    if (args.isRepairOutcome) {
      return {
        proof_moment: true,
        proof_moment_type: "repair_trust",
        proof_moment_reason: "repair_style_outcome_after_misunderstanding",
        proof_weight: "strong",
        user_visible_proof_line: "You stayed in the conversation and rebuilt clarity—that builds trust.",
      };
    }
    if (prev === "user_no" || prev === "user_partial") {
      return {
        proof_moment: true,
        proof_moment_type: "comeback_after_miss",
        proof_moment_reason: "yes_after_recent_negative_outcome",
        proof_weight: "strong",
        user_visible_proof_line: "You came back after the miss.",
      };
    }
    if (leadingYes >= 4) {
      return {
        proof_moment: true,
        proof_moment_type: "meaningful_streak",
        proof_moment_reason: "five_plus_consecutive_yes_in_bounded_window",
        proof_weight: "strong",
        user_visible_proof_line: "You stacked honest yeses—this is real momentum.",
      };
    }
    if (prev === "user_yes") {
      return {
        proof_moment: true,
        proof_moment_type: "streak_continued",
        proof_moment_reason: "consecutive_yes_after_prior_yes",
        proof_weight: "medium",
        user_visible_proof_line: "You stacked another honest yes—momentum matters.",
      };
    }
    if (totalYes === 0) {
      return {
        proof_moment: true,
        proof_moment_type: "first_completion",
        proof_moment_reason: "first_logged_yes_in_recent_spine_window",
        proof_weight: "strong",
        user_visible_proof_line: "You logged your first clear yes on this bar—that’s proof worth keeping.",
      };
    }
    return {
      proof_moment: true,
      proof_moment_type: "followed_through",
      proof_moment_reason: "clear_yes_on_daily_bar",
      proof_weight: "medium",
      user_visible_proof_line: "You followed through on the bar today.",
    };
  }

  if (args.finalEventType === "user_partial") {
    return {
      proof_moment: true,
      proof_moment_type: "partial_but_stayed_engaged",
      proof_moment_reason: "partial_reply_keeps_thread_alive",
      proof_weight: "medium",
      user_visible_proof_line: "You stayed engaged instead of disappearing.",
    };
  }

  const substantive = args.userMessageCharCount >= 36;
  return {
    proof_moment: true,
    proof_moment_type: "honest_miss",
    proof_moment_reason: substantive ? "honest_no_with_substance" : "honest_no_on_daily_check",
    proof_weight: substantive ? "medium" : "light",
    user_visible_proof_line: substantive
      ? "That honesty matters—now we can work the real blocker."
      : "Honest no still counts as showing up.",
  };
}

export function buildProofMomentForBlockerCaptured(args: {
  blockerMessageCharCount: number;
}): ProofMomentMeta | null {
  if (args.blockerMessageCharCount < 12) {
    return {
      proof_moment: true,
      proof_moment_type: "blocker_named",
      proof_moment_reason: "blocker_logged_after_miss",
      proof_weight: "light",
      user_visible_proof_line: "You named what got in the way instead of hiding it.",
    };
  }
  return {
    proof_moment: true,
    proof_moment_type: "blocker_named",
    proof_moment_reason: "named_obstacle_with_detail",
    proof_weight: "medium",
    user_visible_proof_line: "You named the obstacle instead of disappearing.",
  };
}

export function buildProofMomentForMemoryUpdated(args: {
  appliedIdentity: boolean;
  appliedPeopleSummary: boolean;
  appliedResponsibility: boolean;
}): ProofMomentMeta | null {
  const any = args.appliedIdentity || args.appliedPeopleSummary || args.appliedResponsibility;
  if (!any) return null;
  let line = "You confirmed an update so coaching stays current.";
  if (args.appliedIdentity && !args.appliedPeopleSummary && !args.appliedResponsibility) {
    line = "You confirmed your identity line—I'll hold that with you.";
  } else if (!args.appliedIdentity && (args.appliedPeopleSummary || args.appliedResponsibility)) {
    line = "You confirmed context so I remember what matters now.";
  }
  return {
    proof_moment: true,
    proof_moment_type: "memory_updated",
    proof_moment_reason: "sms_confirmed_profile_update",
    proof_weight: "medium",
    user_visible_proof_line: line,
  };
}

/** AI inbound: optional hint when weight is medium or strong (server-grounded). */
export type ProofMomentPromptHint = {
  proof_weight: ProofWeight;
  proof_moment_type: ProofMomentType;
  user_visible_proof_line: string;
};

export function proofMomentToPromptHint(meta: ProofMomentMeta | null): ProofMomentPromptHint | null {
  if (!meta) return null;
  if (meta.proof_weight === "light") return null;
  return {
    proof_weight: meta.proof_weight,
    proof_moment_type: meta.proof_moment_type,
    user_visible_proof_line: clampLine(meta.user_visible_proof_line, 140),
  };
}

export function buildProofMomentCommitmentTightened(): ProofMomentMeta {
  return {
    proof_moment: true,
    proof_moment_type: "commitment_tightened",
    proof_moment_reason: "sms_confirmed_shrink_overlay_consent",
    proof_weight: "medium",
    user_visible_proof_line: "You tightened the bar instead of quitting.",
  };
}

export function buildProofMomentCommitmentReplaced(): ProofMomentMeta {
  return {
    proof_moment: true,
    proof_moment_type: "commitment_replaced",
    proof_moment_reason: "sms_confirmed_guided_commitment_replace",
    proof_weight: "strong",
    user_visible_proof_line: "You named the next honest commitment instead of drifting.",
  };
}

const VICTORY_CALLOUT_COOLDOWN_MS = 5 * 24 * 60 * 60 * 1000;

export const SMS_REPLY_APPEND_MAX_CHARS = 320;

export function appendSmsParagraphIfUnderCap(
  base: string,
  addition: string | null,
  max: number = SMS_REPLY_APPEND_MAX_CHARS
): string {
  if (!addition?.trim()) return base;
  const sep = "\n\n";
  const c = `${base.trim()}${sep}${addition.trim()}`;
  return c.length <= max ? c : base;
}

export function findLastVictoryRoomCalloutSentAtMs(
  eventsNewestFirst: { occurred_at: string; payload_json?: Record<string, unknown> }[]
): number | null {
  for (const e of eventsNewestFirst) {
    const p = e.payload_json;
    if (!p || typeof p !== "object") continue;
    if (p.victory_room_callout_sent === true) {
      const at = new Date(e.occurred_at).getTime();
      if (Number.isFinite(at)) return at;
    }
  }
  return null;
}

export type VictorySmsCalloutDecision = {
  appendToReply: string | null;
  eventPayloadExtras: Record<string, unknown>;
};

function pickVictoryCalloutLine(t: ProofMomentType): string | null {
  switch (t) {
    case "comeback_after_miss":
      return "That comeback is going in your proof.";
    case "repair_trust":
      return "That adjustment matters — I’m saving it as proof.";
    case "memory_updated":
    case "commitment_tightened":
    case "commitment_replaced":
      return "That belongs in your Victory Room.";
    case "first_completion":
    case "meaningful_streak":
    case "streak_continued":
    case "followed_through":
    case "partial_but_stayed_engaged":
      return "I’m saving that as proof.";
    default:
      return null;
  }
}

/**
 * Server-only: whether to append a short Victory / proof line to the outbound SMS and tag the spine row.
 */
export function decideVictoryRoomSmsCallout(args: {
  proofMeta: ProofMomentMeta | null;
  eventsNewestFirst: { event_type: string; occurred_at: string; payload_json: Record<string, unknown> }[];
  nowMs?: number;
}): VictorySmsCalloutDecision {
  const empty: VictorySmsCalloutDecision = { appendToReply: null, eventPayloadExtras: {} };
  const proof = args.proofMeta;
  if (!proof || proof.proof_weight === "light") return empty;

  const now = args.nowMs ?? Date.now();
  const t = proof.proof_moment_type;

  if (t === "honest_miss" || t === "blocker_named") return empty;

  const always =
    t === "comeback_after_miss" ||
    t === "repair_trust" ||
    t === "commitment_tightened" ||
    t === "commitment_replaced" ||
    t === "memory_updated" ||
    t === "first_completion" ||
    t === "meaningful_streak";

  const last = findLastVictoryRoomCalloutSentAtMs(args.eventsNewestFirst);
  const cooldownOk = last == null || now - last >= VICTORY_CALLOUT_COOLDOWN_MS;

  if (!always && !cooldownOk) return empty;

  const line = pickVictoryCalloutLine(t);
  if (!line) return empty;

  return {
    appendToReply: line,
    eventPayloadExtras: {
      victory_room_callout_sent: true,
      victory_room_callout_reason: t,
    },
  };
}

/**
 * Supplemental spine row (sms_memory_signal) so commitment-change proof appears without duplicating RPC `created`/`activated`.
 */
export async function insertSmsCommitmentChangeProofEvent(args: {
  commitmentId: string;
  clerkUserId: string;
  messageSid: string;
  messagePreview: string;
  kind: "commitment_tightened" | "commitment_replaced";
  victoryCalloutExtras?: Record<string, unknown>;
}): Promise<void> {
  const preview = args.messagePreview.trim().replace(/\s+/g, " ").slice(0, 220);
  const proof =
    args.kind === "commitment_tightened" ? buildProofMomentCommitmentTightened() : buildProofMomentCommitmentReplaced();

  const memory_signal_stub: Record<string, unknown> = {
    prompt_version: "wave12_1_commitment_change_proof_stub",
    memory_signal_detected: false,
    wave12_commitment_change_proof: true,
  };

  const payload: Record<string, unknown> = {
    message_sid: args.messageSid,
    message_preview: preview,
    gated_mode: "commitment_change_confirmed",
    memory_signal: memory_signal_stub,
    ...proofMomentPayloadFields(proof),
    ...(args.victoryCalloutExtras ?? {}),
  };

  try {
    const { error } = await supabaseServer.from("v2_commitment_event").insert({
      commitment_id: args.commitmentId,
      clerk_user_id: args.clerkUserId,
      event_type: "sms_memory_signal",
      source: "sms_v2_wave12_commitment_proof",
      payload_json: payload,
      idempotency_key: `v2_sms_commitment_change_proof:${args.kind}:${args.messageSid}`,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") return;
      console.warn("[wave12.1] commitment_change_proof insert skipped", {
        commitment_id: args.commitmentId,
        message: error.message,
        code,
      });
    }
  } catch (e) {
    console.warn("[wave12.1] commitment_change_proof insert failed", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
