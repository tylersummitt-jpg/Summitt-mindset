/**
 * Inbound reflection reply guards — block accountability-check / worksheet posture
 * on reflective shares and non-proof turns.
 */

import { repairV3RelationshipLaneBodyWithOpenAI } from "@/lib/v3-sms-voice-ownership";
import type {
  InboundRequiredReplyMove,
  InboundResolvedTruth,
  InboundV3RelationshipLaneInput,
} from "@/lib/v3-inbound-relationship-lane";

export const INBOUND_PROOF_CHECKIN_REPLY_MOVES: readonly InboundRequiredReplyMove[] = [
  "acknowledge_completion",
  "close_loop_on_answered_ask",
  "acknowledge_partial",
  "acknowledge_miss_without_shame",
  "acknowledge_blocker",
] as const;

const INBOUND_DID_YOU_DO_IT_RE = /\bdid you do it\b/i;

const INBOUND_GENERIC_WORKSHEET_RES: ReadonlyArray<{ re: RegExp; reason: string }> = [
  { re: /\bwhat specific (strategies|steps|aspects)\b/i, reason: "inbound_generic_what_specific" },
  { re: /\bcan you share more about\b/i, reason: "inbound_generic_share_more" },
  { re: /\bhow can you\b/i, reason: "inbound_generic_how_can_you" },
  { re: /\bwhat can you do to\b/i, reason: "inbound_generic_what_can_you_do" },
];

export type InboundReflectionReplyGuardTelemetry = {
  inbound_reflection_reply_guard_applied?: boolean;
  inbound_reflection_reply_guard_reasons?: string[];
  inbound_did_you_do_it_guard_result?: "pass" | "violation" | "repaired";
  inbound_generic_question_guard_result?: "pass" | "violation" | "repaired";
  final_reply_source?: "inbound_reflection_reply_guard_repair";
};

export function isInboundProofCheckInReplyMove(
  move: InboundRequiredReplyMove | null | undefined
): boolean {
  return move != null && INBOUND_PROOF_CHECKIN_REPLY_MOVES.includes(move);
}

export function detectInboundDidYouDoItViolation(
  body: string,
  rt: InboundResolvedTruth | null | undefined
): { violation: boolean; reason: string | null } {
  const b = body.trim();
  if (!b || !INBOUND_DID_YOU_DO_IT_RE.test(b)) {
    return { violation: false, reason: null };
  }
  if (isInboundProofCheckInReplyMove(rt?.required_reply_move)) {
    return { violation: false, reason: null };
  }
  return { violation: true, reason: "inbound_did_you_do_it_wrong_move" };
}

export function detectInboundGenericWorksheetQuestionViolation(
  body: string,
  rt: InboundResolvedTruth | null | undefined
): { violation: boolean; reason: string | null } {
  if (rt?.required_reply_move === "clarify_once") {
    return { violation: false, reason: null };
  }
  const b = body.trim();
  if (!b) return { violation: false, reason: null };
  for (const { re, reason } of INBOUND_GENERIC_WORKSHEET_RES) {
    if (re.test(b)) return { violation: true, reason };
  }
  return { violation: false, reason: null };
}

export function detectInboundReflectionReplyGuardViolations(
  body: string,
  rt: InboundResolvedTruth | null | undefined
): string[] {
  const reasons: string[] = [];
  const didYou = detectInboundDidYouDoItViolation(body, rt);
  if (didYou.violation && didYou.reason) reasons.push(didYou.reason);
  const worksheet = detectInboundGenericWorksheetQuestionViolation(body, rt);
  if (worksheet.violation && worksheet.reason) reasons.push(worksheet.reason);
  return reasons;
}

function buildReflectionReplyGuardRepairInstruction(
  rt: InboundResolvedTruth | null | undefined,
  violations: string[]
): string {
  const move = rt?.required_reply_move ?? "general_support";
  const lines = [
    `required_reply_move=${move}.`,
    "The user shared reflection, story, or meaning — acknowledge one specific detail they named.",
    "Write statement-only SMS: no question mark, no accountability check, no worksheet coaching.",
    "Do NOT use: Did you do it, what specific strategies/steps/aspects, can you share more about, how can you, what can you do to.",
    "Do not ask for proof, outcome triad, or generic follow-up questions.",
  ];
  if (violations.length) {
    lines.push(`Fix blocked_reasons only: ${violations.join(", ")}.`);
  }
  if (rt?.must_not_do?.length) {
    lines.push(`Honor must_not_do: ${rt.must_not_do.slice(0, 4).join("; ")}.`);
  }
  return lines.join(" ");
}

export async function tryRecoverInboundReflectionReplyGuardBody(
  candidate: string,
  args: InboundV3RelationshipLaneInput,
  violations: string[],
  validateBody: (body: string) => boolean
): Promise<
  | { ok: true; body: string; telemetry: InboundReflectionReplyGuardTelemetry }
  | { ok: false; telemetry: InboundReflectionReplyGuardTelemetry }
> {
  const rt = args.facts.inbound_resolved_truth ?? null;
  const baseTelemetry: InboundReflectionReplyGuardTelemetry = {
    inbound_reflection_reply_guard_applied: false,
    inbound_reflection_reply_guard_reasons: violations,
    inbound_did_you_do_it_guard_result: violations.includes("inbound_did_you_do_it_wrong_move")
      ? "violation"
      : "pass",
    inbound_generic_question_guard_result: violations.some((v) => v.startsWith("inbound_generic_"))
      ? "violation"
      : "pass",
  };

  if (violations.length === 0) {
    return { ok: false, telemetry: baseTelemetry };
  }

  const repaired = await repairV3RelationshipLaneBodyWithOpenAI({
    routeKind: "inbound",
    routePurpose: args.facts.route_purpose,
    originalBody: candidate,
    blockedReasons: violations,
    factsJson: args.facts as unknown as Record<string, unknown>,
    systemInstruction: buildReflectionReplyGuardRepairInstruction(rt, violations),
  });

  if (!repaired?.body?.trim()) {
    return { ok: false, telemetry: baseTelemetry };
  }

  const body = repaired.body.trim();
  const remaining = detectInboundReflectionReplyGuardViolations(body, rt);
  if (remaining.length > 0 || !validateBody(body)) {
    return {
      ok: false,
      telemetry: {
        ...baseTelemetry,
        inbound_reflection_reply_guard_reasons: [...violations, ...remaining],
      },
    };
  }

  return {
    ok: true,
    body,
    telemetry: {
      ...baseTelemetry,
      inbound_reflection_reply_guard_applied: true,
      inbound_did_you_do_it_guard_result: violations.includes("inbound_did_you_do_it_wrong_move")
        ? "repaired"
        : baseTelemetry.inbound_did_you_do_it_guard_result,
      inbound_generic_question_guard_result: violations.some((v) => v.startsWith("inbound_generic_"))
        ? "repaired"
        : baseTelemetry.inbound_generic_question_guard_result,
      final_reply_source: "inbound_reflection_reply_guard_repair",
    },
  };
}
