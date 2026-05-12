import OpenAI from "openai";

import {
  buildDailyCommitmentAsk,
  finalizeNorthStarCoachSms,
  matchesMalformedDidRawPhraseHappenToday,
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

export type VoiceOwnershipResult = {
  body: string;
  voiceOwner: SmsVoiceOwner;
  source: string;
  v3Owned: boolean;
  repaired: boolean;
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

function isNormalCoaching(args: ApplyFinalVoiceOwnershipGateArgs): boolean {
  if (args.bypassKind) return false;
  if (args.normalCoaching === false) return false;
  if (args.normalCoaching === true) return true;
  if (!args.activeCommitmentId?.trim()) return false;
  return [
    "daily_outbound",
    "inbound_coach_reply",
    "weekly_sms",
    "followup_sms",
    "missed_yesterday_sms",
    "inactivity_rescue",
    "post_churn_winback",
    "blocker_followup",
    "refresh",
    "contract_prompt",
    "contract_ack",
    "guided_contract_proposal",
    "central_brain_pivot",
    "clarification",
    "reactivation",
    "other_coaching",
  ].includes(args.channel);
}

function ownerFromBypass(kind: FinalVoiceBypassKind): SmsVoiceOwner {
  if (kind === "compliance") return "compliance";
  if (kind === "transactional") return "transactional";
  if (kind === "onboarding_consent") return "onboarding_consent";
  return "no_active_commitment";
}

function classifyVoiceOwner(replySource: string | null | undefined, northStarMeta?: NorthStarCoachSmsMeta | null): SmsVoiceOwner {
  const src = replySource?.trim() ?? "";
  if (src === "v3_daily_check_in") return "v3_daily";
  if (src === "v3_answer_to_open_question") return "v3_open_question";
  if (V3_OPENAI_SOURCES.has(src)) return "v3_openai";
  if (V3_MACHINE_REFINED_SOURCES.has(src)) return "v3_machine_refine";
  if (V3_FALLBACK_SOURCES.has(src)) return "v3_deterministic_fallback";
  if (northStarMeta?.source === "openai_finalized") return "v3_repair";
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
  const checks: Array<[string, RegExp]> = [
    ["long_user_quote", /["'][^"']{45,}["']/],
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
  ];
  for (const [name, re] of checks) {
    if (re.test(t)) hits.push(name);
  }
  if (matchesMalformedDidRawPhraseHappenToday(t)) hits.push("malformed_did_raw_phrase_happen_today");
  if ((t.match(/[.!?](?:\s|$)/g) ?? []).length > 2) hits.push("too_many_sentences");
  if (t.length > 320) hits.push("too_long");
  return hits;
}

function effectiveAskSuggestsFocusDistractionAsk(args: ApplyFinalVoiceOwnershipGateArgs): boolean {
  const merged = `${args.effectiveAsk ?? ""} ${args.behaviorStatement ?? ""} ${args.contextPacket?.effectiveAskText ?? ""}`.toLowerCase();
  if (/\bfocus(ed|\s+on)?\b.*\bwork\b|\bwork\b.*\bwithout\b.*\bdistraction|\bfocused\s+work\b|\bdistractions?\b/.test(merged)) {
    return true;
  }
  const body = normalize(args.proposedBody).toLowerCase();
  return /\bfocused work session\b|\bwork session today without distractions\b|\bwithout distractions\b/i.test(body);
}

function emergencyFallback(args: ApplyFinalVoiceOwnershipGateArgs): string {
  if (args.channel === "daily_outbound" || args.channel === "reactivation") {
    const focusAsk = "Did you protect the focused work block today?";
    if (effectiveAskSuggestsFocusDistractionAsk(args) && detectFinalVoiceBlockedReasons(focusAsk).length === 0) {
      return focusAsk;
    }
    const ask = buildDailyCommitmentAsk(args.effectiveAsk || args.behaviorStatement || "");
    return detectFinalVoiceBlockedReasons(ask).length ? "Did the rep happen today?" : ask;
  }
  if (args.contextPacket?.v3AnswerToOpenQuestion || args.latestOpenQuestion?.trim()) {
    if (/\b(tomorrow|later)\b/i.test(args.latestInboundRaw ?? "")) return "Fair. What time tomorrow?";
    return "Got it. I'll use that. What's the next concrete time?";
  }
  const ft = args.finalEventType ?? args.contextPacket?.finalEventType;
  if (ft === "user_yes") return "That counts. What made it work?";
  if (ft === "user_no") return "That's honest. What broke — time, size, or environment?";
  if (ft === "user_partial") return "That's useful. What got done, and what broke?";
  if (/\b(tomorrow|later|meeting|interview)\b/i.test(args.latestInboundRaw ?? "")) return "Fair. What time tomorrow?";
  return "I'm not going to guess. What happened with the commitment?";
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
      temperature: 0.25,
      max_tokens: 180,
      messages: [
        {
          role: "system",
          content:
            "Rewrite this SMS to fix the blocked reasons. Preserve the turn meaning. Do not repeat the prior question. Do not quote the user. One short SMS. No labels, no bullets.",
        },
        {
          role: "user",
          content: [
            `Blocked reasons: ${blockedReasons.join(", ")}`,
            `Channel: ${args.channel}`,
            `Effective ask: ${args.effectiveAsk ?? args.contextPacket?.effectiveAskText ?? "(none)"}`,
            `Latest inbound: ${args.latestInboundRaw ?? args.contextPacket?.latestInboundRaw ?? "(none)"}`,
            `Latest outbound: ${args.latestOutboundBody ?? args.contextPacket?.latestOutboundBody ?? "(none)"}`,
            `Latest open question: ${args.latestOpenQuestion ?? args.contextPacket?.latestOpenQuestion ?? "(none)"}`,
            `Original SMS: ${args.proposedBody}`,
          ].join("\n"),
        },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    return text.replace(/^["'`]+|["'`]+$/g, "").replace(/^coach:\s*/i, "").trim() || null;
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
}): VoiceOwnershipResult {
  return {
    body: args.body,
    voiceOwner: args.voiceOwner,
    source: args.source,
    v3Owned: args.v3Owned,
    repaired: args.repaired,
    emergencyFallbackUsed: args.emergencyFallbackUsed,
    blockedReasons: args.blockedReasons,
    metadata: {
      voice_owner: args.voiceOwner,
      final_voice_source: args.source,
      v3_finalized: args.v3Owned,
      v3_repair_attempted: args.repairAttempted,
      v3_repair_succeeded: args.repairSucceeded,
      v3_emergency_fallback_used: args.emergencyFallbackUsed,
      final_voice_blocked_reasons: args.blockedReasons,
      original_pre_voice_gate_body: args.originalBody,
      final_voice_gate_body: args.body,
      deterministic_code_blocked: args.deterministicBlocked,
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
      voiceOwner: initialOwner,
      source: args.replySource ?? args.northStarMeta?.source ?? "v3_owned",
      v3Owned: true,
      repaired: false,
      emergencyFallbackUsed: initialOwner === "v3_deterministic_fallback",
      blockedReasons: [],
      originalBody,
      repairAttempted: false,
      repairSucceeded: false,
      deterministicBlocked: false,
    });
  }

  const repaired = await repairWithOpenAI(args, blocked.length ? blocked : ["non_v3_voice_owner"]);
  if (repaired) {
    const cleaned = finalizeNorthStarCoachSms({
      proposedBody: repaired,
      channel: args.channel,
      latestInboundRaw: args.latestInboundRaw ?? args.contextPacket?.latestInboundRaw ?? undefined,
      latestOutboundBody: args.latestOutboundBody ?? args.contextPacket?.latestOutboundBody ?? undefined,
      effectiveAskText: args.effectiveAsk ?? args.contextPacket?.effectiveAskText ?? undefined,
      behaviorStatement: args.behaviorStatement ?? args.contextPacket?.behaviorStatement ?? undefined,
      finalEventType: args.finalEventType ?? args.contextPacket?.finalEventType ?? undefined,
      replySource: "v3_voice_repair",
      contextPacket: args.contextPacket ?? undefined,
    }).visibleBody;
    const repairBlocked = detectFinalVoiceBlockedReasons(cleaned);
    if (repairBlocked.length === 0) {
      return result({
        body: cleaned,
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
      });
    }
    blocked.push(...repairBlocked.map((r) => `repair_${r}`));
  }

  const fallbackRaw = emergencyFallback(args);
  const fallback = finalizeNorthStarCoachSms({
    proposedBody: fallbackRaw,
    channel: args.channel,
    latestInboundRaw: args.latestInboundRaw ?? args.contextPacket?.latestInboundRaw ?? undefined,
    latestOutboundBody: args.latestOutboundBody ?? args.contextPacket?.latestOutboundBody ?? undefined,
    effectiveAskText: args.effectiveAsk ?? args.contextPacket?.effectiveAskText ?? undefined,
    behaviorStatement: args.behaviorStatement ?? args.contextPacket?.behaviorStatement ?? undefined,
    finalEventType: args.finalEventType ?? args.contextPacket?.finalEventType ?? undefined,
    replySource: "v3_deterministic_fallback",
    contextPacket: args.contextPacket ?? undefined,
  }).visibleBody;

  return result({
    body: fallback,
    voiceOwner: "v3_deterministic_fallback",
    source: "v3_emergency_fallback",
    v3Owned: true,
    repaired: false,
    emergencyFallbackUsed: true,
    blockedReasons: blocked.length ? blocked : ["non_v3_voice_owner"],
    originalBody,
    repairAttempted: openaiRepairEligible,
    repairSucceeded: false,
    deterministicBlocked,
  });
}
