import crypto from "crypto";

import { finalizeAdaptiveProposalOutboundSms } from "@/lib/v2-human-sms-brain/finalize-adaptive-proposal-outbound-sms";
import {
  isV2HumanSmsPhase3AdaptiveProposalEnabled,
  shouldRunPhase3AdaptiveProposalBrain,
} from "@/lib/v2-human-sms-brain/flags";
import type { ActiveV2CommitmentRow, V2AccountabilityOutcome } from "@/lib/v2-commitment";

/** Max length for `behavior_statement` when embedded in SMS ({{B}}). */
const BEHAVIOR_SNIPPET_MAX = 100;

export type V2InboundEventType = "user_yes" | "user_no" | "user_partial";

export type V2OutboundTemplateId = 1 | 2 | 3 | 4 | 5 | 6;

export type V2OutboundTemplateFamily = "standard" | "recovery" | "reactivation";

/** Mirrors `V2OutboundStrategy` in v2-ai-outbound (kept local to avoid circular imports). */
export type V2OutboundSmsStrategy =
  | "standard_check"
  | "recovery_check"
  | "blocker_followup"
  | "silence_nudge"
  | "reentry_check"
  | "reactivation_nudge";

/** Mirrors next_move.type in v2-ai-outbound (local to avoid circular imports). */
export type V2NextMoveKind = "hold_standard" | "recommit_same" | "shrink_ask" | "reset_day";

const RECOMMIT_NEXT_TEMPLATES: readonly string[] = [
  `No hiding today: {{B}} Did it happen?`,
  `Same line today: {{B}} What’s the honest answer?`,
  `Keep it clean: {{B}} Did you follow through?`,
];

const RESET_DAY_TEMPLATES: readonly string[] = [
  `Clean reset today on {{B}} No backlog lecture. Did it happen?`,
  `Fresh sheet on today’s commitment: {{B}} Keep it honest and tell me straight.`,
  `No shame, just today: did {{B}} happen, or did something pull you off it?`,
];

const SHRINK_NEXT_TEMPLATES: readonly string[] = [
  `Let’s simplify today: {{S}} Did it happen?`,
  `Keep it simple today: {{S}} What happened?`,
  `Today is just this: {{S}} Tell me the truth tonight.`,
];

/** Shrink overlay consent: server binding text {{S}} + current bar {{B}}; not accountability YES/NO. */
const SHRINK_PROPOSAL_TEMPLATES: readonly string[] = [
  `Let’s simplify for a bit: {{S}} Want me to hold you to that? A clear yes or no is enough.`,
  `Keep it clean for a bit: {{S}} Do you want me holding you to that? A clear yes or no is enough.`,
];

/** Recommit-same overlay consent: binding {{S}} + anchor {{B}}; natural yes/no consent. */
const RECOMMIT_PROPOSAL_TEMPLATES: readonly string[] = [
  `Want me to hold you to the same line for a week? {{S}} A clear yes or no is enough.`,
  `Keep the same line steady for a week? {{S}} A clear yes or no is enough.`,
];

const CONTRACT_OVERLAY_YES_ACK: readonly [string, string] = [
  `Good. For the next week, keep it this simple: {{S}} That’s the rep.`,
  `Locked in. Keep it simple for the next week: {{S}} No drama—just the rep.`,
];

const CONTRACT_OVERLAY_YES_ACK_RECOMMIT: readonly [string, string] = [
  `Good. Same line for the next week: {{S}} Show me the rep.`,
  `Alright. Same line for the next week: {{S}} Keep it honest.`,
];

const CONTRACT_OVERLAY_NO_ACK: readonly [string, string] = [
  `No problem. We’ll keep it simple today: "{{B}}" What’s the honest answer?`,
  `All good. Keep it clean today: "{{B}}" Did it happen?`,
];

const SILENCE_NUDGE_TEMPLATES: readonly string[] = [
  `Quiet stretch on {{B}} No guilt. Did it happen today?`,
  `Simple doorway back in on {{B}} What’s the honest answer today?`,
  `No backlog lecture. Just today on {{B}}: did you follow through?`,
  `Still here with the same line: {{B}} Give me the real version.`,
  `Quick reset check on {{B}}: did the work happen, or did something pull you off?`,
];

const REENTRY_CHECK_TEMPLATES: readonly string[] = [
  `Good return. Same line today: {{B}} Tell me straight—did it happen?`,
  `You’re back in. Keep today simple on {{B}}: what happened?`,
  `Welcome back—no drama, same standard: {{B}} Did you follow through today?`,
  `Clean re-entry check: did {{B}} happen, or did something pull you off?`,
  `Back to it. Today’s commitment is {{B}} I’m asking it plain: did you do it?`,
];

/** Low-pressure optional re-engagement (no YES/NO/PARTIAL accountability framing). */
const REACTIVATION_NUDGE_TEMPLATES: readonly string[] = [
  `Still here. If you want to pick {{B}} back up when it fits, text me—either way is fine.`,
  `Quiet check-in: want to reconnect on {{B}} when you're ready? A short line is plenty if you feel like it.`,
  `No pressure note: if today is a good day to restart {{B}}, send a short line.`,
  `Door is open when you’re ready to re-enter {{B}}. One line is enough.`,
  `Low-pressure check: want to pick {{B}} back up this week?`,
  `If you want back in on {{B}}, we can start clean from here.`,
];

const OUTBOUND_TEMPLATES: readonly string[] = [
  `Simple check: did you follow through on {{B}} today?`,
  `Today’s check: did {{B}} happen? Tell me straight.`,
  `Keep it honest and simple on {{B}} today. What’s the real answer?`,
  `Did you protect today’s commitment: {{B}}?`,
  `Clear check-in: did you do what you committed to today on {{B}}?`,
  `No drama, just truth: was {{B}} done today?`,
  `Today is simple: {{B}} Did it happen?`,
  `Checking the standard today: {{B}} What happened?`,
  `Did {{B}} happen before the day got away from you?`,
  `Tell me straight on {{B}} today.`,
];

const RECOVERY_OUTBOUND_TEMPLATES: readonly string[] = [
  `No shame, don’t waste the miss. Did {{B}} happen today?`,
  `Clean reset today: {{B}} Tell me straight where it landed.`,
  `The standard is still there on {{B}}. Did you follow through today?`,
  `Misses are information. Did you get back to {{B}} today?`,
  `Back on the line today: {{B}} Give me the real version.`,
  `Yesterday missed, today still counts. Did {{B}} happen?`,
];

const BLOCKER_ACK_TEMPLATES: readonly [string, string, string] = [
  `Good honesty. I’m not giving you a guilt speech—I’m giving you the next move. Protect the first block tomorrow.`,
  `That’s the pattern to catch. Tomorrow, make the first move the commitment before anything else.`,
  `Useful signal. Use it tomorrow: commitment first, escape hatch second.`,
];

function djb2Hash(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

/** Stable snippet for SMS bodies (single-line, bounded). */
export function truncateV2BehaviorStatementForSms(behaviorStatement: string): string {
  const t = behaviorStatement.trim().replace(/\s+/g, " ");
  if (t.length <= BEHAVIOR_SNIPPET_MAX) return t;
  return `${t.slice(0, BEHAVIOR_SNIPPET_MAX - 1)}…`;
}

/** Display cap for inbound SMS name prefix (must stay aligned with formatInboundFallbackPreferredOpening). */
export function capPreferredNameForInboundSms(
  preferredName: string | null | undefined
): string | null {
  const raw = typeof preferredName === "string" ? preferredName.trim() : "";
  if (!raw) return null;
  const one = raw.replace(/\s+/g, " ");
  return one.length > 22 ? `${one.slice(0, 21)}…` : one;
}

/** Optional "Name, " prefix for deterministic inbound fallbacks (keeps total length in check). */
export function formatInboundFallbackPreferredOpening(
  preferredName: string | null | undefined
): string {
  const cap = capPreferredNameForInboundSms(preferredName);
  if (!cap) return "";
  return `${cap}, `;
}

/**
 * Deterministic outbound template index for standard family (0..5).
 */
export function pickOutboundAccountabilityTemplateIndex(
  clerkUserId: string,
  dayKey: string
): number {
  const h = djb2Hash(`${clerkUserId}:${dayKey}`);
  return h % OUTBOUND_TEMPLATES.length;
}

function pickRecoveryOutboundTemplateIndex(clerkUserId: string, dayKey: string): number {
  const h = djb2Hash(`recovery:${clerkUserId}:${dayKey}`);
  return h % RECOVERY_OUTBOUND_TEMPLATES.length;
}

function pickSilenceNudgeTemplateIndex(clerkUserId: string, dayKey: string): number {
  const h = djb2Hash(`silence_nudge:${clerkUserId}:${dayKey}`);
  return h % SILENCE_NUDGE_TEMPLATES.length;
}

function pickReentryCheckTemplateIndex(clerkUserId: string, dayKey: string): number {
  const h = djb2Hash(`reentry_check:${clerkUserId}:${dayKey}`);
  return h % REENTRY_CHECK_TEMPLATES.length;
}

function pickRecommitNextTemplateIndex(clerkUserId: string, dayKey: string): number {
  const h = djb2Hash(`recommit_next:${clerkUserId}:${dayKey}`);
  return h % RECOMMIT_NEXT_TEMPLATES.length;
}

function pickResetDayTemplateIndex(clerkUserId: string, dayKey: string): number {
  const h = djb2Hash(`reset_day:${clerkUserId}:${dayKey}`);
  return h % RESET_DAY_TEMPLATES.length;
}

function pickShrinkNextTemplateIndex(clerkUserId: string, dayKey: string): number {
  const h = djb2Hash(`shrink_next:${clerkUserId}:${dayKey}`);
  return h % SHRINK_NEXT_TEMPLATES.length;
}

function pickShrinkProposalTemplateIndex(clerkUserId: string, dayKey: string): number {
  const h = djb2Hash(`shrink_proposal:${clerkUserId}:${dayKey}`);
  return h % SHRINK_PROPOSAL_TEMPLATES.length;
}

function pickRecommitProposalTemplateIndex(clerkUserId: string, dayKey: string): number {
  const h = djb2Hash(`recommit_proposal:${clerkUserId}:${dayKey}`);
  return h % RECOMMIT_PROPOSAL_TEMPLATES.length;
}

/** Standard vs recovery based on latest user accountability outcome. */
export function selectOutboundTemplateFamily(
  latestOutcome: V2AccountabilityOutcome | null
): V2OutboundTemplateFamily {
  if (!latestOutcome || latestOutcome === "user_yes") return "standard";
  return "recovery";
}

export function buildV2OutboundAccountabilitySms(args: {
  clerkUserId: string;
  dayKey: string;
  behaviorStatement: string;
  templateFamily: V2OutboundTemplateFamily;
}): { body: string; templateId: number } {
  const B = truncateV2BehaviorStatementForSms(args.behaviorStatement);
  if (args.templateFamily === "recovery") {
    const idx = pickRecoveryOutboundTemplateIndex(args.clerkUserId, args.dayKey);
    const template = RECOVERY_OUTBOUND_TEMPLATES[idx]!;
    return { body: template.replace(/\{\{B\}\}/g, B), templateId: idx + 1 };
  }
  const idx = pickOutboundAccountabilityTemplateIndex(args.clerkUserId, args.dayKey);
  const template = OUTBOUND_TEMPLATES[idx]!;
  return { body: template.replace(/\{\{B\}\}/g, B), templateId: idx + 1 };
}

function pickReactivationNudgeTemplateIndex(clerkUserId: string, dayKey: string): number {
  const h = crypto.createHash("sha256").update(`${clerkUserId}:${dayKey}:reactivation`).digest();
  return h[0]! % REACTIVATION_NUDGE_TEMPLATES.length;
}

export function buildV2ReactivationNudgeOutboundSms(args: {
  clerkUserId: string;
  dayKey: string;
  behaviorStatement: string;
}): { body: string; templateId: number } {
  const B = truncateV2BehaviorStatementForSms(args.behaviorStatement);
  const idx = pickReactivationNudgeTemplateIndex(args.clerkUserId, args.dayKey);
  const template = REACTIVATION_NUDGE_TEMPLATES[idx]!;
  return { body: template.replace(/\{\{B\}\}/g, B), templateId: 71 + idx };
}

/**
 * Deterministic outbound SMS for the full server strategy set (standard/recovery/silence/reentry).
 * Template ids: 1–6 standard/recovery pools; 11–13 silence_nudge; 21–23 reentry_check;
 * 31–32 recommit_same; 41–42 shrink_ask; 51–52 reset_day (when next_move overrides copy);
 * 61–62 shrink proposal; 63–64 recommit_same overlay proposal; 71–72 reactivation_nudge.
 */
export function buildV2OutboundAccountabilitySmsForStrategy(args: {
  clerkUserId: string;
  dayKey: string;
  behaviorStatement: string;
  serverStrategy: V2OutboundSmsStrategy;
  nextMove?: V2NextMoveKind;
  shrunkAskText?: string | null;
}): { body: string; templateId: number } {
  if (args.serverStrategy === "reactivation_nudge") {
    return buildV2ReactivationNudgeOutboundSms({
      clerkUserId: args.clerkUserId,
      dayKey: args.dayKey,
      behaviorStatement: args.behaviorStatement,
    });
  }
  const B = truncateV2BehaviorStatementForSms(args.behaviorStatement);
  const { clerkUserId, dayKey, serverStrategy } = args;
  const nextMove = args.nextMove ?? "hold_standard";

  if (nextMove === "reset_day") {
    const idx = pickResetDayTemplateIndex(clerkUserId, dayKey);
    const template = RESET_DAY_TEMPLATES[idx]!;
    return { body: template.replace(/\{\{B\}\}/g, B), templateId: 51 + idx };
  }
  if (nextMove === "shrink_ask") {
    const S = (args.shrunkAskText || "").trim() || `Today only: ${B}`;
    const idx = pickShrinkNextTemplateIndex(clerkUserId, dayKey);
    const template = SHRINK_NEXT_TEMPLATES[idx]!;
    return { body: template.replace(/\{\{S\}\}/g, S).replace(/\{\{B\}\}/g, B), templateId: 41 + idx };
  }
  if (nextMove === "recommit_same") {
    const idx = pickRecommitNextTemplateIndex(clerkUserId, dayKey);
    const template = RECOMMIT_NEXT_TEMPLATES[idx]!;
    return { body: template.replace(/\{\{B\}\}/g, B), templateId: 31 + idx };
  }

  if (serverStrategy === "silence_nudge") {
    const idx = pickSilenceNudgeTemplateIndex(clerkUserId, dayKey);
    const template = SILENCE_NUDGE_TEMPLATES[idx]!;
    return { body: template.replace(/\{\{B\}\}/g, B), templateId: 11 + idx };
  }
  if (serverStrategy === "reentry_check") {
    const idx = pickReentryCheckTemplateIndex(clerkUserId, dayKey);
    const template = REENTRY_CHECK_TEMPLATES[idx]!;
    return { body: template.replace(/\{\{B\}\}/g, B), templateId: 21 + idx };
  }
  if (serverStrategy === "recovery_check" || serverStrategy === "blocker_followup") {
    const idx = pickRecoveryOutboundTemplateIndex(clerkUserId, dayKey);
    const template = RECOVERY_OUTBOUND_TEMPLATES[idx]!;
    return { body: template.replace(/\{\{B\}\}/g, B), templateId: idx + 1 };
  }
  const idx = pickOutboundAccountabilityTemplateIndex(clerkUserId, dayKey);
  const template = OUTBOUND_TEMPLATES[idx]!;
  return { body: template.replace(/\{\{B\}\}/g, B), templateId: idx + 1 };
}

/**
 * Explicit shrink overlay proposal (template ids 61–62).
 * {{S}} = verbatim server-derived proposal text; {{B}} = truncated original bar.
 */
export function legacyBuildV2ShrinkProposalOutboundSms(args: {
  clerkUserId: string;
  dayKey: string;
  proposalBindingText: string;
  originalBehaviorStatement: string;
}): { body: string; templateId: number } {
  const S = args.proposalBindingText.trim();
  const B = truncateV2BehaviorStatementForSms(args.originalBehaviorStatement);
  const idx = pickShrinkProposalTemplateIndex(args.clerkUserId, args.dayKey);
  const template = SHRINK_PROPOSAL_TEMPLATES[idx]!;
  return { body: template.replace(/\{\{S\}\}/g, S).replace(/\{\{B\}\}/g, B), templateId: 61 + idx };
}

/**
 * Explicit recommit overlay proposal (template ids 63–64).
 * {{S}} = verbatim server-derived binding; {{B}} = truncated original bar.
 */
export function legacyBuildV2RecommitProposalOutboundSms(args: {
  clerkUserId: string;
  dayKey: string;
  proposalBindingText: string;
  originalBehaviorStatement: string;
}): { body: string; templateId: number } {
  const S = args.proposalBindingText.trim();
  const B = truncateV2BehaviorStatementForSms(args.originalBehaviorStatement);
  const idx = pickRecommitProposalTemplateIndex(args.clerkUserId, args.dayKey);
  const template = RECOMMIT_PROPOSAL_TEMPLATES[idx]!;
  return { body: template.replace(/\{\{S\}\}/g, S).replace(/\{\{B\}\}/g, B), templateId: 63 + idx };
}

/** Phase 3A optional Human SMS Brain pass on top of legacy proposal SMS (binding unchanged in DB). */
export async function buildV2ShrinkProposalOutboundSms(args: {
  clerkUserId: string;
  dayKey: string;
  proposalBindingText: string;
  originalBehaviorStatement: string;
  /** Preferred: V3 refine + North Star owns consent/proposal voice (Phase 3A skipped when V3 applies). */
  v3Refine?: { commitment: ActiveV2CommitmentRow; timezone: string };
  /**
   * When set without explicit `v3Refine`, auto-enables the same V3 refine path (defensive for callers
   * that load commitment but omit the wrapper object).
   */
  commitmentForV3Refine?: ActiveV2CommitmentRow | null;
  timezoneForV3Refine?: string | null;
}): Promise<{ body: string; templateId: number; northStarReplySource?: string | null }> {
  const legacy = legacyBuildV2ShrinkProposalOutboundSms(args);

  const effectiveV3Refine =
    args.v3Refine ??
    (args.commitmentForV3Refine?.id && args.timezoneForV3Refine?.trim()
      ? {
          commitment: args.commitmentForV3Refine,
          timezone: args.timezoneForV3Refine.trim(),
        }
      : undefined);

  if (effectiveV3Refine) {
    const finalized = await finalizeAdaptiveProposalOutboundSms({
      machineDraft: legacy.body,
      proposalKind: "shrink",
      bindingText: args.proposalBindingText,
      behaviorStatementPreview: truncateV2BehaviorStatementForSms(args.originalBehaviorStatement),
      templateId: legacy.templateId,
      v3Refine: {
        clerkUserId: args.clerkUserId,
        messageSid: `adaptive_proposal:${args.clerkUserId}:${args.dayKey}:shrink`,
        commitment: effectiveV3Refine.commitment,
        timezone: effectiveV3Refine.timezone,
      },
    });
    return {
      body: finalized.message,
      templateId: legacy.templateId,
      northStarReplySource: finalized.northStarReplySource,
    };
  }

  if (!isV2HumanSmsPhase3AdaptiveProposalEnabled() || !shouldRunPhase3AdaptiveProposalBrain()) {
    return legacy;
  }
  const finalized = await finalizeAdaptiveProposalOutboundSms({
    machineDraft: legacy.body,
    proposalKind: "shrink",
    bindingText: args.proposalBindingText,
    behaviorStatementPreview: truncateV2BehaviorStatementForSms(args.originalBehaviorStatement),
    templateId: legacy.templateId,
  });
  return {
    body: finalized.message,
    templateId: legacy.templateId,
    northStarReplySource: finalized.northStarReplySource,
  };
}

export async function buildV2RecommitProposalOutboundSms(args: {
  clerkUserId: string;
  dayKey: string;
  proposalBindingText: string;
  originalBehaviorStatement: string;
  v3Refine?: { commitment: ActiveV2CommitmentRow; timezone: string };
  commitmentForV3Refine?: ActiveV2CommitmentRow | null;
  timezoneForV3Refine?: string | null;
}): Promise<{ body: string; templateId: number; northStarReplySource?: string | null }> {
  const legacy = legacyBuildV2RecommitProposalOutboundSms(args);

  const effectiveV3RefineRecommit =
    args.v3Refine ??
    (args.commitmentForV3Refine?.id && args.timezoneForV3Refine?.trim()
      ? {
          commitment: args.commitmentForV3Refine,
          timezone: args.timezoneForV3Refine.trim(),
        }
      : undefined);

  if (effectiveV3RefineRecommit) {
    const finalized = await finalizeAdaptiveProposalOutboundSms({
      machineDraft: legacy.body,
      proposalKind: "recommit_same",
      bindingText: args.proposalBindingText,
      behaviorStatementPreview: truncateV2BehaviorStatementForSms(args.originalBehaviorStatement),
      templateId: legacy.templateId,
      v3Refine: {
        clerkUserId: args.clerkUserId,
        messageSid: `adaptive_proposal:${args.clerkUserId}:${args.dayKey}:recommit`,
        commitment: effectiveV3RefineRecommit.commitment,
        timezone: effectiveV3RefineRecommit.timezone,
      },
    });
    return {
      body: finalized.message,
      templateId: legacy.templateId,
      northStarReplySource: finalized.northStarReplySource,
    };
  }

  if (!isV2HumanSmsPhase3AdaptiveProposalEnabled() || !shouldRunPhase3AdaptiveProposalBrain()) {
    return legacy;
  }
  const finalized = await finalizeAdaptiveProposalOutboundSms({
    machineDraft: legacy.body,
    proposalKind: "recommit_same",
    bindingText: args.proposalBindingText,
    behaviorStatementPreview: truncateV2BehaviorStatementForSms(args.originalBehaviorStatement),
    templateId: legacy.templateId,
  });
  return {
    body: finalized.message,
    templateId: legacy.templateId,
    northStarReplySource: finalized.northStarReplySource,
  };
}

export type V2ContractOverlayKind = "shrink_ask" | "recommit_same";

export function buildV2ContractOverlayYesAckSms(args: {
  messageSid: string;
  adoptedAskText: string;
  contractKind?: V2ContractOverlayKind;
}): { body: string; ackTemplateId: string } {
  const S = args.adoptedAskText.trim();
  const v = (crypto.createHash("sha256").update(`${args.messageSid}:contract_yes`).digest()[0]! &
    1) as 0 | 1;
  const kind = args.contractKind ?? "shrink_ask";
  const pool = kind === "recommit_same" ? CONTRACT_OVERLAY_YES_ACK_RECOMMIT : CONTRACT_OVERLAY_YES_ACK;
  const tmpl = pool[v]!;
  return {
    body: tmpl.replace(/\{\{S\}\}/g, S),
    ackTemplateId: `contract_yes_${kind === "recommit_same" ? "recommit_" : ""}${v + 1}`,
  };
}

export function buildV2ContractOverlayNoAckSms(args: {
  messageSid: string;
  originalBehaviorStatement: string;
}): { body: string; ackTemplateId: string } {
  const B = truncateV2BehaviorStatementForSms(args.originalBehaviorStatement);
  const v = (crypto.createHash("sha256").update(`${args.messageSid}:contract_no`).digest()[0]! &
    1) as 0 | 1;
  const tmpl = CONTRACT_OVERLAY_NO_ACK[v]!;
  return { body: tmpl.replace(/\{\{B\}\}/g, B), ackTemplateId: `contract_no_${v + 1}` };
}

/** After a miss, short ack that blocker text was received (deterministic by inbound SID). */
export function buildBlockerAckSms(
  messageSid: string,
  opts?: { preferredName?: string | null }
): {
  body: string;
  ackTemplateId: string;
} {
  const h = crypto.createHash("sha256").update(messageSid).digest();
  const idx = h[0]! % BLOCKER_ACK_TEMPLATES.length;
  const prefix = formatInboundFallbackPreferredOpening(opts?.preferredName ?? null);
  const body = prefix + BLOCKER_ACK_TEMPLATES[idx]!;
  return { body, ackTemplateId: `ack_${idx + 1}` };
}

/** Strong yes/no correction: not treated as blocker text while capture is pending. */
export function isStrongV2YesNoOutcome(eventType: V2InboundEventType): boolean {
  return eventType === "user_yes" || eventType === "user_no";
}

function sidVariantIndex(messageSid: string, eventType: V2InboundEventType): 0 | 1 {
  const h = crypto.createHash("sha256").update(`${messageSid}:${eventType}`).digest();
  return (h[0]! & 1) as 0 | 1;
}

const REPLY_YES: readonly [string, string] = [
  `Good. Logged as proof.`,
  `That counts. Quiet follow-through matters. Same standard tomorrow.`,
];

const REPLY_NO: readonly [string, string] = [
  `No shame, let’s not waste the miss. What was the real block today?`,
  `Thanks for the honesty. What was the main blocker on {{B}} today?`,
];

const REPLY_PARTIAL: readonly [string, string] = [
  `You stayed in it. What kept it from being complete?`,
  `That’s partial, not failure. What pulled you off finishing {{B}}?`,
];

export type V2InboundReplyTemplateId =
  | "yes_a"
  | "yes_b"
  | "no_a"
  | "no_b"
  | "partial_a"
  | "partial_b";

export function pickInboundReplyTemplateId(
  messageSid: string,
  eventType: V2InboundEventType
): V2InboundReplyTemplateId {
  const v = sidVariantIndex(messageSid, eventType);
  if (eventType === "user_yes") return v === 0 ? "yes_a" : "yes_b";
  if (eventType === "user_no") return v === 0 ? "no_a" : "no_b";
  return v === 0 ? "partial_a" : "partial_b";
}

export function buildV2InboundReplySms(args: {
  behaviorStatement: string;
  messageSid: string;
  eventType: V2InboundEventType;
  /** When AI is disabled or fails, prepended sparingly as "Name, …" (empty if unset). */
  preferredName?: string | null;
}): { body: string; replyTemplateId: V2InboundReplyTemplateId } {
  const B = truncateV2BehaviorStatementForSms(args.behaviorStatement);
  const replyTemplateId = pickInboundReplyTemplateId(args.messageSid, args.eventType);
  const v = sidVariantIndex(args.messageSid, args.eventType);
  let tmpl: string;
  if (args.eventType === "user_yes") tmpl = REPLY_YES[v]!;
  else if (args.eventType === "user_no") tmpl = REPLY_NO[v]!;
  else tmpl = REPLY_PARTIAL[v]!;
  const prefix = formatInboundFallbackPreferredOpening(args.preferredName ?? null);
  return { body: prefix + tmpl.replace(/\{\{B\}\}/g, B), replyTemplateId };
}

const PARTIAL_PHRASE =
  /\b(partial|partially|kinda|kind of|sort of|somewhat|half|mixed|in between)\b/i;

/** True if inbound text matches classifier partial-keyword patterns (for AI-gated partial acceptance). */
export function messageHasKeywordPartialLanguage(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  return PARTIAL_PHRASE.test(lower);
}

/** Single-line commitment text for SMS; avoids awkward raw dumps. */
export function naturalizeCommitmentForSms(raw: string, maxLen = 72): string {
  let s = (raw || "").trim().replace(/\s+/g, " ");
  // Fix glued punctuation like "today-1 hour" → "today — 1 hour" for daily outbound glue.
  s = s.replace(/\b(today|tonight)(—|-|–)\s*(?=\d)/gi, "$1 — ");
  s = s.replace(/\b(today|tonight)\s*-\s*(?=\d)/gi, "$1 — ");
  s = s.replace(/\s*&\s*/g, " and ");
  s = s.replace(/^(i commit to|i will|my commitment is:?)\s+/i, "");
  s = s.replace(/\buse\s+ai\s+(and\s+)?/gi, "");
  s = s.replace(/^[,\s]+/, "").trim();
  s = s.replace(/[.!?]+$/g, "").trim();
  if (!s) return "the commitment";
  if (s.length > maxLen) return `${s.slice(0, maxLen - 1).trimEnd()}…`;
  return s;
}

/**
 * Prefer a short concrete phrase; fall back to "the bar" when the ask would be too long for SMS glue.
 */
export function getShortCommitmentPhraseForSms(args: {
  effectiveAsk: string;
  behaviorStatement: string;
}): string {
  const primary = args.effectiveAsk?.trim() || args.behaviorStatement?.trim() || "";
  const n = naturalizeCommitmentForSms(primary, 48);
  if (n.length >= 40 || n.endsWith("…")) return "the bar";
  return n;
}

/**
 * V2 inbound classifier: strong yes / strong no / partial keywords / blank / ambiguous → partial.
 */
export function classifyV2InboundReply(raw: string): {
  eventType: V2InboundEventType;
  normalizedHint: string | null;
} {
  const original = raw.trim();
  if (!original) {
    return { eventType: "user_partial", normalizedHint: "blank" };
  }

  const lower = original.toLowerCase();
  const collapsed = lower.replace(/\s+/g, " ");

  /**
   * Proof-detail / success-reflection signals (YES-equivalent).
   * We treat these as user_yes so the system doesn't re-ask "did you do it?" after the user is
   * clearly describing how the completed work went.
   *
   * Guardrails: do NOT classify generic emotions ("I feel tired", "I'm proud of myself") as yes
   * unless tied to focus/follow-through/progress/completion language.
   */
  const saysMiss =
    /\b(not\s+done|missed|wasn'?t able|couldn'?t)\b/i.test(original) ||
    /\b(didn'?t|did not)\s+(do|finish|complete|get\s+it\s+done|get\s+that\s+done)\b/i.test(original);
  if (!saysMiss) {
    const completionTokens =
      /\b(already\s+)?(got\s+it\s+done|got\s+that\s+done|got\s+it\s+done|did\s+it|did\s+that|finished|finished\s+it|completed|followed\s+through|follow\s+through|done)\b/i.test(
        original
      );
    const focusTokens =
      /\b(focused|super\s+focused|so\s+focused|locked\s+in|stayed\s+focused|protected\s+my\s+focus|protect(?:ed)?\s+focus|didn'?t\s+get\s+distracted|did\s+not\s+get\s+distracted|didn'?t\s+get\s+sidetracked|did\s+not\s+get\s+sidetracked)\b/i.test(
        original
      );
    const progressTokens =
      /\b(made\s+progress|finished\s+strong|felt\s+good|went\s+great|it\s+went\s+great)\b/i.test(original);

    const pride =
      /\b(proud\s+of\s+myself)\b/i.test(original) || /\bi'?m\s+proud\b/i.test(original);

    const tiedToWork =
      completionTokens ||
      focusTokens ||
      progressTokens ||
      (pride && (completionTokens || focusTokens || lower.includes("for being focused")));

    if (tiedToWork) {
      return {
        eventType: "user_yes",
        normalizedHint: completionTokens
          ? "completion_detail"
          : focusTokens
            ? "success_reflection_focus"
            : progressTokens
              ? "success_reflection"
              : "success_reflection_pride",
      };
    }
  }

  // Completion / proof language (treat as YES even without a literal "yes").
  // Examples: "already got it done", "done", "finished it", "2 stories today"
  const completion =
    /\b(already\s+)?(got\s+it\s+done|got\s+that\s+done|did\s+it|finished|completed|knocked\s+it\s+out|done)\b/i.test(
      original
    ) ||
    /^\s*\d+\s+\w+(\s+\w+)?\s*(today)?\s*$/i.test(original);
  if (completion) {
    // Avoid misclassifying explicit "not done" as yes.
    if (!/\b(not\s+done|didn'?t|did not|didnt|missed)\b/i.test(original)) {
      return { eventType: "user_yes", normalizedHint: "completion_phrase" };
    }
  }

  if (PARTIAL_PHRASE.test(lower)) {
    return { eventType: "user_partial", normalizedHint: "keyword_partial" };
  }

  const strongYesTokens = new Set(["yes", "y", "yeah", "yep", "yup", "✅"]);
  const strongNoTokens = new Set(["no", "n", "nope", "nah"]);

  const strongYes =
    strongYesTokens.has(collapsed) ||
    /\byes\b/.test(lower) ||
    /^yes[,.!\s]/i.test(original);

  let strongNo = false;
  if (strongNoTokens.has(collapsed)) {
    strongNo = true;
  } else if (/\bno\b/.test(lower)) {
    if (original.length <= 15) strongNo = true;
    else if (/^no\b/i.test(original)) strongNo = true;
    else if (/^no[,.!]/i.test(original)) strongNo = true;
  }

  if (strongYes && strongNo) {
    return { eventType: "user_partial", normalizedHint: "ambiguous" };
  }
  if (strongYes) return { eventType: "user_yes", normalizedHint: null };
  if (strongNo) return { eventType: "user_no", normalizedHint: null };
  return { eventType: "user_partial", normalizedHint: "unclear" };
}

export function v2UserReplyIdempotencyKey(
  eventType: V2InboundEventType,
  messageSid: string
): string {
  return `v2_${eventType}:${messageSid}`;
}
