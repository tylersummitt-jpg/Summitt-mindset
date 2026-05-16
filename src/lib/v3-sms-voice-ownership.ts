import OpenAI from "openai";

import {
  finalizeNorthStarCoachSms,
  matchesMalformedDidRawPhraseHappenToday,
  pickNorthStarWriterAttributionFields,
  type NorthStarCoachChannel,
  type NorthStarCoachSmsMeta,
  type NorthStarSmsContextPacket,
} from "@/lib/north-star-coach-sms";

export type SmsVoiceOwner =
  | "v3_openai"
  | "v3_repair"
  | "v3_deterministic_fallback"
  | "v3_machine_refine"
  | "v3_daily"
  | "v3_open_question"
  | "compliance"
  | "transactional"
  | "onboarding_consent"
  | "no_active_commitment"
  | "unknown";

/** Fail-closed relationship coaching: no Twilio send when V3 repair cannot produce safe copy. */
export type FinalVoiceSkipReason = "no_safe_v3_voice" | "v3_repair_failed" | "final_voice_blocked";

export type VoiceOwnershipResult = {
  body: string;
  /** When false, callers must not send `body` as user-visible coaching (daily fail-closed uses empty `body`). */
  shouldSend: boolean;
  skipReason?: FinalVoiceSkipReason;
  voiceOwner: SmsVoiceOwner;
  source: string;
  v3Owned: boolean;
  repaired: boolean;
  /** Always false for normal coaching paths — deterministic emergency fallback SMS is removed. */
  emergencyFallbackUsed: boolean;
  blockedReasons: string[];
  metadata: Record<string, unknown>;
};

export type FinalVoiceBypassKind =
  | "compliance"
  | "transactional"
  | "onboarding_consent"
  | "no_active_commitment";

export type ApplyFinalVoiceOwnershipGateArgs = {
  proposedBody: string;
  replySource?: string | null;
  channel: NorthStarCoachChannel;
  activeCommitmentId?: string | null;
  effectiveAsk?: string | null;
  behaviorStatement?: string | null;
  latestInboundRaw?: string | null;
  latestOutboundBody?: string | null;
  latestOpenQuestion?: string | null;
  contextPacket?: NorthStarSmsContextPacket | null;
  todayCompleted?: boolean | null;
  finalEventType?: string | null;
  v3BrainMetadata?: Record<string, unknown> | null;
  northStarMeta?: NorthStarCoachSmsMeta | null;
  bypassKind?: FinalVoiceBypassKind | null;
  normalCoaching?: boolean;
};

export function appendPreservedSmsSuffix(body: string, suffix: string): string {
  const cleanBody = body.trimEnd();
  const cleanSuffix = suffix.trim();
  if (!cleanSuffix) return cleanBody;
  return `${cleanBody}\n\n${cleanSuffix}`;
}

export function appendPreservedSignedLink(body: string, link: string): string {
  const cleanBody = body.trimEnd();
  const cleanLink = link.trim();
  if (!cleanLink) return cleanBody;
  return `${cleanBody}\n\n${cleanLink}`;
}

const V3_OPENAI_SOURCES = new Set([
  "v3_sms_brain",
  "v3_answer_to_open_question",
  "v3_daily_check_in",
  "v3_daily_relationship_lane",
  "v3_weekly_relationship_lane",
]);

const V3_MACHINE_REFINED_SOURCES = new Set([
  "v3_refined_prior_draft",
  "v3_refresh_refined",
  "v3_memory_confirmation_refined",
  "v3_contract_consent_refined",
  "v3_adaptive_proposal_refined",
  "v3_weekly_proof_refined",
  "v3_followup_sms_refined",
  "v3_missed_yesterday_sms_refined",
  "v3_winback_refined",
  "v3_inactivity_rescue_refined",
]);

const V3_FALLBACK_SOURCES = new Set([
  "v3_deterministic_fallback",
  "v3_daily_deterministic_fallback",
  "v3_machine_deterministic_fallback",
]);

/**
 * Every `NorthStarCoachChannel` used with `applyFinalVoiceOwnershipGate` for normal active-commitment
 * coaching/relationship SMS in this repo. Fail-closed + no deterministic emergency fallback applies here.
 *
 * Not included: `lifecycle_sms`, `day4_5_sms_pulse` — no FVG call sites today; add when wired.
 *
 * `open_question_answer` uses `inbound_coach_reply` at the gate. Adaptive overlay outbound from the daily
 * cron is gated as `contract_prompt`; guided shrink consent SMS uses `guided_contract_proposal`.
 */
export const ACTIVE_COMMITMENT_RELATIONSHIP_VOICE_CHANNELS: ReadonlyArray<NorthStarCoachChannel> = [
  "daily_outbound",
  "reactivation",
  "pending_resolution",
  "refresh",
  "contract_prompt",
  "contract_ack",
  "guided_contract_proposal",
  "inbound_coach_reply",
  "other_coaching",
  "memory_confirmation",
  "blocker_followup",
  "central_brain_pivot",
  "clarification",
  "weekly_sms",
  "followup_sms",
  "missed_yesterday_sms",
  "inactivity_rescue",
  "post_churn_winback",
];

const ACTIVE_COMMITMENT_RELATIONSHIP_VOICE_CHANNEL_SET = new Set<NorthStarCoachChannel>(
  ACTIVE_COMMITMENT_RELATIONSHIP_VOICE_CHANNELS
);

function isActiveCommitmentRelationshipVoiceChannel(ch: NorthStarCoachChannel): boolean {
  return ACTIVE_COMMITMENT_RELATIONSHIP_VOICE_CHANNEL_SET.has(ch);
}

function getOpenAIClientOrNull(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return null;
  return new OpenAI({ apiKey });
}

function modelName(): string {
  return process.env.V2_SMS_CONVERSATION_BRAIN_MODEL?.trim() || "gpt-4o-mini";
}

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** Sentence-ending punctuation followed by whitespace or end of string (one unit ≈ one closed sentence). */
function countSentenceEndings(text: string): number {
  return (text.match(/[.!?](?:\s|$)/g) ?? []).length;
}

/** Stuttered / rambly repetition (not a second author — tight SMS seatbelt). */
function hasRamblyAdjacentWordRepeat(text: string): boolean {
  return /\b(\w{3,})\s+\1\b/i.test(text);
}

function isNormalCoaching(args: ApplyFinalVoiceOwnershipGateArgs): boolean {
  if (args.bypassKind) return false;
  if (args.normalCoaching === false) return false;
  if (args.normalCoaching === true) {
    return isActiveCommitmentRelationshipVoiceChannel(args.channel);
  }
  if (!args.activeCommitmentId?.trim()) return false;
  return isActiveCommitmentRelationshipVoiceChannel(args.channel);
}

/**
 * Normal active-commitment coaching/relationship SMS: never ship deterministic emergency fallback;
 * if repair cannot fix unsafe copy, withhold send.
 *
 * Equivalent to the coaching branch of `isNormalCoaching` (post-bypass, non-false normalCoaching).
 */
export function isFailClosedActiveCommitmentRelationshipVoice(args: ApplyFinalVoiceOwnershipGateArgs): boolean {
  return isNormalCoaching(args);
}

/** @deprecated Use {@link isFailClosedActiveCommitmentRelationshipVoice}. */
export const isDailyFailClosedActiveCommitmentVoice = isFailClosedActiveCommitmentRelationshipVoice;

function ownerFromBypass(kind: FinalVoiceBypassKind): SmsVoiceOwner {
  if (kind === "compliance") return "compliance";
  if (kind === "transactional") return "transactional";
  if (kind === "onboarding_consent") return "onboarding_consent";
  return "no_active_commitment";
}

function classifyVoiceOwner(replySource: string | null | undefined, _northStarMeta?: NorthStarCoachSmsMeta | null): SmsVoiceOwner {
  void _northStarMeta;
  const src = replySource?.trim() ?? "";
  if (src === "v3_voice_repair") return "v3_repair";
  if (src === "v3_daily_relationship_lane") return "v3_daily";
  if (src === "v3_inbound_relationship_lane") return "v3_daily";
  if (src === "v3_daily_check_in") return "v3_daily";
  if (src === "v3_answer_to_open_question") return "v3_open_question";
  if (V3_OPENAI_SOURCES.has(src)) return "v3_openai";
  if (V3_MACHINE_REFINED_SOURCES.has(src)) return "v3_machine_refine";
  if (V3_FALLBACK_SOURCES.has(src)) return "v3_deterministic_fallback";
  return "unknown";
}

function voiceOwnerIsV3(owner: SmsVoiceOwner): boolean {
  return (
    owner === "v3_openai" ||
    owner === "v3_repair" ||
    owner === "v3_deterministic_fallback" ||
    owner === "v3_machine_refine" ||
    owner === "v3_daily" ||
    owner === "v3_open_question"
  );
}

export function detectFinalVoiceBlockedReasons(body: string): string[] {
  const t = normalize(body);
  const hits: string[] = [];
  if (!t || t.length < 2) {
    hits.push("empty_or_trivial_body");
  }
  const checks: Array<[string, RegExp]> = [
    /** Verbatim echo of a long user span in double quotes (SMS rarely uses `"`; avoids apostrophe-in-contraction false positives). */
    ["long_user_quote", /"[^"]{45,}"/],
    ["quote_with_ellipsis", /["'][^"']*…[^"']*["']/],
    ["got_it_quote_lead", /\bGot it\s+[—-]/i],
    ["next_concrete_move", /\bwhat'?s the next concrete move\b/i],
    ["say_it_straight", /\bSay it straight\b/i],
    ["today_line", /\bwhat moved with today'?s line\b/i],
    ["did_you_protect_use", /\bDid you protect use\b/i],
    ["did_you_protect_keep", /\bDid you protect keep\b/i],
    ["did_you_protect_put", /\bDid you protect put\b/i],
    ["did_you_protect_say", /\bDid you protect say\b/i],
    ["did_you_protect_declutter", /\bDid you protect declutter\b/i],
    ["did_you_protect_focus", /\bDid you protect Focus\b/],
    ["did_it_happen_with", /\bDid it happen with\b/i],
    ["lets_did", /\bLet'?s Did\b/i],
    ["did_you_manage", /\bDid you manage\b/i],
    ["how_did_focus_go", /\bHow did your focus go\b/i],
    ["let_me_know_how_it_went", /\blet me know how it went\b/i],
    ["staying_consistent_key", /\bstaying consistent is key\b/i],
    ["great_job", /\bgreat job\b/i],
    ["keep_momentum", /\bkeep (the |this )?momentum\b/i],
    ["journey", /\bjourney\b/i],
    ["powerful", /\bpowerful\b/i],
    ["great_step_forward", /\bgreat step forward\b/i],
    ["its_thats", /\bIt'?s That'?s\b/i],
    ["its_good", /\bIt'?s Good\b/i],
    ["clipped_part_of_the", /\bpart of the$/i],
    ["clipped_building_on_your", /\bbuilding on your$/i],
    ["clipped_because", /\bbecause$/i],
    ["clipped_with", /\bwith$/i],
    ["clipped_to", /\bto$/i],
    ["clipped_of", /\bof$/i],
    /** Structural leak from upstream role/label tokens into user-visible SMS. */
    ["structural_role_leak", /-in:\s*/i],
    /** Daily template fallback that reads like a broken check-in, not a real ask. */
    ["generic_rep_happen_ask", /\bDid the rep happen today\?\s*$/i],
    /** Generic “reset” copy that abandons thread continuity after an active reply. */
    ["generic_day_reminder_reset", /\bHope you(?:'re| are) having a great day\b.*\bremind you\b/is],
  ];
  for (const [name, re] of checks) {
    if (re.test(t)) hits.push(name);
  }
  if (matchesMalformedDidRawPhraseHappenToday(t)) hits.push("malformed_did_raw_phrase_happen_today");

  /**
   * `too_many_sentences` = density / ramble / SMS-unfriendly length — not “3 clauses = bad”.
   * - Under 480 chars: only when 5+ sentence endings, or obvious adjacent word stutter.
   * - 480–600 chars: compress/repair band (length budget).
   * - Over 600 chars: repair required (length).
   * 3–4 short sentences under 480 pass on count alone.
   */
  const n = t.length;
  const ends = countSentenceEndings(t);
  const tooManyFromStructure =
    (n < 480 && (ends >= 5 || hasRamblyAdjacentWordRepeat(t))) ||
    (n >= 480 && n <= 600) ||
    n > 600;
  if (tooManyFromStructure) hits.push("too_many_sentences");

  if (t.length > 320) hits.push("too_long");
  return hits;
}

/** Style / length / mild cliché hits from {@link detectFinalVoiceBlockedReasons} — lane may attempt OpenAI repair. */
const REPAIRABLE_FINAL_VOICE_BLOCK_REASONS = new Set<string>([
  "too_many_sentences",
  "too_long",
  "let_me_know_how_it_went",
  "staying_consistent_key",
  "great_job",
  "keep_momentum",
  "journey",
  "powerful",
  "great_step_forward",
  "generic_day_reminder_reset",
  "did_you_manage",
]);

export function isRepairableFinalVoiceBlockedReason(reason: string): boolean {
  return REPAIRABLE_FINAL_VOICE_BLOCK_REASONS.has(reason);
}

export function partitionFinalVoiceBlockedReasons(reasons: string[]): {
  repairable: string[];
  hard: string[];
} {
  const repairable: string[] = [];
  const hard: string[] = [];
  for (const r of reasons) {
    if (isRepairableFinalVoiceBlockedReason(r)) repairable.push(r);
    else hard.push(r);
  }
  return { repairable, hard };
}

export type RepairV3RelationshipLaneBodyArgs = {
  routeKind: "daily" | "inbound";
  routePurpose: string;
  originalBody: string;
  blockedReasons: string[];
  factsJson: unknown;
  systemInstruction?: string;
};

type LaneRepairModelJson = {
  body?: unknown;
  used_strategy?: unknown;
  safety_notes?: unknown;
};

function safeParseLaneRepairJson(raw: string): LaneRepairModelJson | null {
  try {
    return JSON.parse(raw) as LaneRepairModelJson;
  } catch {
    return null;
  }
}

/**
 * OpenAI-only compression pass for relationship lanes (not deterministic fallback).
 * Returns `null` when no client, request failure, invalid JSON, or empty body.
 */
export async function repairV3RelationshipLaneBodyWithOpenAI(
  args: RepairV3RelationshipLaneBodyArgs
): Promise<{
  body: string;
  openAiOk: boolean;
  repairError?: string | null;
  metadata: Record<string, unknown>;
} | null> {
  const client = getOpenAIClientOrNull();
  if (!client) return null;

  let factsSnippet: string;
  try {
    const raw = JSON.stringify(args.factsJson ?? null);
    factsSnippet = raw.length > 9000 ? `${raw.slice(0, 8999)}…` : raw;
  } catch {
    factsSnippet = "(facts_json_unserializable)";
  }

  const baseSystem = `You compress and repair SMS coaching copy for Summitt Mindset. You are NOT inventing a new coaching plan.

OUTPUT: strict JSON only with keys:
body (string, one SMS),
used_strategy (string, short),
safety_notes (string array, may be empty)

RULES FOR body:
- Exactly 1–2 sentences maximum.
- Preserve the same accountability / coaching meaning as the original; do not add new facts or commitments.
- Remove or rewrite away the issues implied by blocked_reasons (e.g. shorten if too_many_sentences or too_long; remove banned phrasing).
- If blocked_reasons includes did_you_manage: keep the same accountability meaning but do NOT use the exact phrase "Did you manage" — use natural alternatives (e.g. whether you completed the step, how the planned block went, if the calls landed).
- No markdown, bullets, or role labels.
- Do not quote the user. Do not paste raw database fields or internal system names.
- Do not add generic motivation filler.
- Never use the phrase "let me know how it went" or close variants.
- One short SMS suitable for Twilio; no newlines in body.`;

  const system = args.systemInstruction?.trim()
    ? `${baseSystem}\n\nADDITIONAL_INSTRUCTIONS:\n${args.systemInstruction.trim()}`
    : baseSystem;

  const userContent = [
    `route_kind: ${args.routeKind}`,
    `route_purpose: ${args.routePurpose}`,
    `blocked_reasons: ${args.blockedReasons.join(", ")}`,
    `original_candidate_sms: ${args.originalBody}`,
    `ACCOUNTABILITY_FACTS_JSON (facts only; do not paste as user-visible labels):`,
    factsSnippet,
  ].join("\n");

  try {
    const completion = await client.chat.completions.create({
      model: modelName(),
      temperature: 0.2,
      max_tokens: 220,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const parsed = safeParseLaneRepairJson(raw);
    const bodyRaw = typeof parsed?.body === "string" ? parsed.body.replace(/\r?\n/g, " ").trim() : "";
    const body = bodyRaw.replace(/^["']|["']$/g, "").trim();
    if (!body) return null;

    const used_strategy = typeof parsed?.used_strategy === "string" ? parsed.used_strategy.trim() : "lane_compress";
    const sn = Array.isArray(parsed?.safety_notes)
      ? parsed!.safety_notes!.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : [];

    return {
      body,
      openAiOk: true,
      repairError: null,
      metadata: {
        lane_repair_used_strategy: used_strategy,
        lane_repair_safety_notes: sn,
      },
    };
  } catch (e) {
    console.warn("[v3-sms-voice-ownership] lane_repair_failed", {
      routeKind: args.routeKind,
      routePurpose: args.routePurpose,
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

async function repairWithOpenAI(
  args: ApplyFinalVoiceOwnershipGateArgs,
  blockedReasons: string[]
): Promise<string | null> {
  const client = getOpenAIClientOrNull();
  if (!client) return null;
  try {
    const completion = await client.chat.completions.create({
      model: modelName(),
      temperature: 0.2,
      max_tokens: 180,
      messages: [
        {
          role: "system",
          content: `You repair SMS coaching copy for Summitt Mindset. You are NOT a second coach brain.

CONTRACT:
- Preserve the meaning of the original SMS; fix ONLY the blocked issues.
- One short SMS. No markdown, bullets, or labels.
- Do not quote the user. Do not paste raw database fields, titles, or behavior_statement as prose.
- Do not add generic motivation or a new coaching agenda.
- Do not repeat rejected times or re-ask the same blocked pattern.
- If unsafe or uncertain, reply with exactly: UNSAFE`,
        },
        {
          role: "user",
          content: [
            `Blocked reasons: ${blockedReasons.join(", ")}`,
            `Channel: ${args.channel}`,
            `Reply source: ${args.replySource ?? "(none)"}`,
            `Effective ask: ${args.effectiveAsk ?? args.contextPacket?.effectiveAskText ?? "(none)"}`,
            `Behavior statement (facts only; do not paste as prose): ${args.behaviorStatement ?? args.contextPacket?.behaviorStatement ?? "(none)"}`,
            `Latest inbound: ${args.latestInboundRaw ?? args.contextPacket?.latestInboundRaw ?? "(none)"}`,
            `Latest outbound: ${args.latestOutboundBody ?? args.contextPacket?.latestOutboundBody ?? "(none)"}`,
            `Latest open question: ${args.latestOpenQuestion ?? args.contextPacket?.latestOpenQuestion ?? "(none)"}`,
            `Original SMS: ${args.proposedBody}`,
          ].join("\n"),
        },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    const cleaned = text.replace(/^["'`]+|["'`]+$/g, "").replace(/^coach:\s*/i, "").trim();
    if (/^UNSAFE$/i.test(cleaned)) return null;
    return cleaned || null;
  } catch (e) {
    console.warn("[v3-sms-voice-ownership] repair_failed", {
      channel: args.channel,
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

function result(args: {
  body: string;
  voiceOwner: SmsVoiceOwner;
  source: string;
  v3Owned: boolean;
  repaired: boolean;
  emergencyFallbackUsed: boolean;
  blockedReasons: string[];
  originalBody: string;
  repairAttempted: boolean;
  repairSucceeded: boolean;
  deterministicBlocked: boolean;
  shouldSend?: boolean;
  skipReason?: FinalVoiceSkipReason;
  northStarMeta?: NorthStarCoachSmsMeta | null;
}): VoiceOwnershipResult {
  const shouldSend = args.shouldSend ?? true;
  const outBody = shouldSend ? args.body : "";
  const voiceDecision = shouldSend ? "accepted_post_final_voice_gate" : "skipped_no_safe_v3_voice";
  const finalVoiceGate: Record<string, unknown> = {
    should_send: shouldSend,
    skip_reason: args.skipReason ?? null,
    voice_decision: voiceDecision,
    voice_owner: args.voiceOwner,
    final_voice_owner: args.voiceOwner,
    final_voice_source: args.source,
    final_voice_blocked_reasons: args.blockedReasons,
    v3_repair_attempted: args.repairAttempted,
    v3_repair_succeeded: args.repairSucceeded,
    v3_emergency_fallback_used: args.emergencyFallbackUsed,
    twilio_send_attempted: shouldSend,
    original_pre_voice_gate_body: args.originalBody,
    final_voice_gate_body: outBody,
    deterministic_code_blocked: args.deterministicBlocked,
    v3_finalized: args.v3Owned,
    ...(args.northStarMeta ? pickNorthStarWriterAttributionFields(args.northStarMeta) : {}),
  };
  return {
    body: outBody,
    shouldSend,
    ...(args.skipReason && !shouldSend ? { skipReason: args.skipReason } : {}),
    voiceOwner: args.voiceOwner,
    source: args.source,
    v3Owned: args.v3Owned,
    repaired: args.repaired,
    emergencyFallbackUsed: args.emergencyFallbackUsed,
    blockedReasons: args.blockedReasons,
    metadata: {
      should_send: shouldSend,
      skip_reason: args.skipReason ?? null,
      voice_decision: voiceDecision,
      final_voice_gate: finalVoiceGate,
      ...(shouldSend ? {} : { twilio_send_attempted: false }),
      voice_owner: args.voiceOwner,
      final_voice_owner: args.voiceOwner,
      final_voice_source: args.source,
      v3_finalized: args.v3Owned,
      v3_repair_attempted: args.repairAttempted,
      v3_repair_succeeded: args.repairSucceeded,
      v3_emergency_fallback_used: args.emergencyFallbackUsed,
      final_voice_blocked_reasons: args.blockedReasons,
      original_pre_voice_gate_body: args.originalBody,
      final_voice_gate_body: outBody,
      deterministic_code_blocked: args.deterministicBlocked,
      ...(args.northStarMeta ? pickNorthStarWriterAttributionFields(args.northStarMeta) : {}),
    },
  };
}

export async function applyFinalVoiceOwnershipGate(
  args: ApplyFinalVoiceOwnershipGateArgs
): Promise<VoiceOwnershipResult> {
  const originalBody = normalize(args.proposedBody);
  const openaiRepairEligible = Boolean(getOpenAIClientOrNull());
  const bypass = args.bypassKind;
  if (bypass || !isNormalCoaching(args)) {
    const owner = bypass ? ownerFromBypass(bypass) : "no_active_commitment";
    return result({
      body: originalBody,
      shouldSend: true,
      voiceOwner: owner,
      source: bypass ?? "not_normal_coaching",
      v3Owned: false,
      repaired: false,
      emergencyFallbackUsed: false,
      blockedReasons: [],
      originalBody,
      repairAttempted: false,
      repairSucceeded: false,
      deterministicBlocked: false,
      northStarMeta: args.northStarMeta,
    });
  }

  const initialOwner = classifyVoiceOwner(args.replySource, args.northStarMeta);
  const initialV3Owned = voiceOwnerIsV3(initialOwner);
  const blocked = [
    ...detectFinalVoiceBlockedReasons(originalBody),
    ...(args.northStarMeta?.source === "deterministic_minimal" ? ["north_star_deterministic_replacement"] : []),
    ...(args.northStarMeta?.north_star_structural_replacement ? ["north_star_structural_replacement"] : []),
    ...(args.northStarMeta?.requires_v3_repair === true ? ["north_star_requires_v3_repair"] : []),
    ...(args.northStarMeta?.north_star_blocked_reasons?.map((r) => `north_star:${r}`) ?? []),
  ];
  const deterministicBlocked = !initialV3Owned || blocked.length > 0;

  if (initialV3Owned && blocked.length === 0) {
    return result({
      body: originalBody,
      shouldSend: true,
      voiceOwner: initialOwner,
      source: args.replySource ?? args.northStarMeta?.source ?? "v3_owned",
      v3Owned: true,
      repaired: false,
      emergencyFallbackUsed: false,
      blockedReasons: [],
      originalBody,
      repairAttempted: false,
      repairSucceeded: false,
      deterministicBlocked: false,
      northStarMeta: args.northStarMeta,
    });
  }

  const repaired = await repairWithOpenAI(args, blocked.length ? blocked : ["non_v3_voice_owner"]);
  if (repaired) {
    const nsRepair = finalizeNorthStarCoachSms({
      proposedBody: repaired,
      channel: args.channel,
      latestInboundRaw: args.latestInboundRaw ?? args.contextPacket?.latestInboundRaw ?? undefined,
      latestOutboundBody: args.latestOutboundBody ?? args.contextPacket?.latestOutboundBody ?? undefined,
      effectiveAskText: args.effectiveAsk ?? args.contextPacket?.effectiveAskText ?? undefined,
      behaviorStatement: args.behaviorStatement ?? args.contextPacket?.behaviorStatement ?? undefined,
      finalEventType: args.finalEventType ?? args.contextPacket?.finalEventType ?? undefined,
      replySource: "v3_voice_repair",
      contextPacket: args.contextPacket ?? undefined,
    });
    const cleaned = nsRepair.visibleBody;
    const repairBlocked = detectFinalVoiceBlockedReasons(cleaned);
    if (repairBlocked.length === 0) {
      return result({
        body: cleaned,
        shouldSend: true,
        voiceOwner: "v3_repair",
        source: "v3_voice_repair",
        v3Owned: true,
        repaired: true,
        emergencyFallbackUsed: false,
        blockedReasons: blocked,
        originalBody,
        repairAttempted: openaiRepairEligible,
        repairSucceeded: true,
        deterministicBlocked,
        northStarMeta: nsRepair.meta,
      });
    }
    blocked.push(...repairBlocked.map((r) => `repair_${r}`));
  }

  const skipReason: FinalVoiceSkipReason = openaiRepairEligible ? "v3_repair_failed" : "no_safe_v3_voice";
  return result({
    body: "",
    shouldSend: false,
    skipReason,
    voiceOwner: initialOwner,
    source: "skipped_no_safe_v3_voice",
    v3Owned: initialV3Owned,
    repaired: false,
    emergencyFallbackUsed: false,
    blockedReasons: blocked.length ? blocked : ["non_v3_voice_owner"],
    originalBody,
    repairAttempted: openaiRepairEligible,
    repairSucceeded: false,
    deterministicBlocked,
    northStarMeta: args.northStarMeta,
  });
}
