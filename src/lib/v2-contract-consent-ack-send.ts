/**
 * Contract-consent human-voice ack finalizer (Phase A):
 * Routing/state are deterministic; user-visible SMS is OpenAI-generated only.
 * Legacy template strings may appear as internal meaning anchors — never as final reply_body.
 */

import OpenAI from "openai";
import {
  buildV2ContractOverlayNoAckSms,
  buildV2ContractOverlayYesAckSms,
  type V2ContractOverlayKind,
} from "@/lib/v2-sms-accountability";
import {
  assertRequiredVerbatimSubstringsPresent,
  type RequiredVerbatimAssertionStage,
} from "@/lib/v3-inbound-relationship-lane";
import {
  applyFinalVoiceOwnershipGate,
  type VoiceOwnershipResult,
} from "@/lib/v3-sms-voice-ownership";
import type { NorthStarSmsContextPacket } from "@/lib/north-star-coach-sms";
import type { InboundV3ContractConsentFacts } from "@/lib/v3-inbound-relationship-lane";

export const FORBIDDEN_CONTRACT_CONSENT_ACK_PHRASES = [
  "reply yes",
  "reply no",
  "text yes",
  "yes to confirm",
  "victory room",
  " overlay",
  "mutation",
  " rpc",
  "contract proposal",
  "adaptive overlay",
  "pending resolution",
  "streak",
  "fake proof",
] as const;

export type ContractConsentAckIntent = {
  consent_parse: "user_yes" | "user_no";
  overlay_action: InboundV3ContractConsentFacts["overlay_action"];
  rpc_result: string;
  contract_kind: V2ContractOverlayKind;
  proposal_text_digest: string;
  effective_ask: string;
  behavior_statement: string;
  required_meaning_summary: string | null;
  /** Internal only — guides OpenAI; must not be sent verbatim as final SMS. */
  legacy_meaning_anchor_preview: string | null;
  /** Optional short binding hint for generation (not a verbatim paste requirement). */
  optional_binding_hint: string | null;
};

export type BuildContractConsentAckIntentArgs = {
  consentParse: "user_yes" | "user_no";
  messageSid: string;
  proposalText: string;
  contractKind: V2ContractOverlayKind;
  behaviorStatement: string;
  effectiveAsk: string;
  contractConsentFacts: Pick<
    InboundV3ContractConsentFacts,
    "overlay_action" | "rpc_result" | "proposal_text_digest" | "required_meaning_summary"
  >;
  optionalBindingHint?: string | null;
};

export function buildContractConsentAckIntent(
  args: BuildContractConsentAckIntentArgs
): ContractConsentAckIntent {
  const legacyPreview =
    args.consentParse === "user_yes"
      ? buildV2ContractOverlayYesAckSms({
          messageSid: args.messageSid,
          adoptedAskText: args.proposalText,
          contractKind: args.contractKind,
        }).body.slice(0, 500)
      : buildV2ContractOverlayNoAckSms({
          messageSid: args.messageSid,
          originalBehaviorStatement: args.behaviorStatement,
        }).body.slice(0, 500);

  return {
    consent_parse: args.consentParse,
    overlay_action: args.contractConsentFacts.overlay_action,
    rpc_result: args.contractConsentFacts.rpc_result,
    contract_kind: args.contractKind,
    proposal_text_digest: args.contractConsentFacts.proposal_text_digest,
    effective_ask: args.effectiveAsk.trim(),
    behavior_statement: args.behaviorStatement.trim(),
    required_meaning_summary: args.contractConsentFacts.required_meaning_summary ?? null,
    legacy_meaning_anchor_preview: legacyPreview,
    optional_binding_hint: args.optionalBindingHint?.trim() || null,
  };
}

function getOpenAIClientOrNull(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return null;
  return new OpenAI({ apiKey });
}

function modelName(): string {
  return process.env.V2_SMS_CONVERSATION_BRAIN_MODEL?.trim() || "gpt-4o-mini";
}

export function validateContractConsentAckForbiddenLanguage(body: string): {
  ok: true;
} | { ok: false; reason: "forbidden_phrase"; phrase: string } {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, reason: "forbidden_phrase", phrase: "(empty)" };

  const bodyLc = trimmed.toLowerCase();
  for (const phrase of FORBIDDEN_CONTRACT_CONSENT_ACK_PHRASES) {
    if (bodyLc.includes(phrase)) {
      return { ok: false, reason: "forbidden_phrase", phrase };
    }
  }
  if (/\bpat summitt\b/i.test(trimmed) && /["“']/i.test(trimmed)) {
    return { ok: false, reason: "forbidden_phrase", phrase: "quoted_pat" };
  }
  return { ok: true };
}

export function validateContractConsentAckRequiredMeaning(args: {
  body: string;
  intent: ContractConsentAckIntent;
}): { ok: true } | { ok: false; reason: string } {
  const body = args.body.trim();
  if (!body) return { ok: false, reason: "empty_body" };

  const b = body.toLowerCase();
  const { intent } = args;

  if (intent.consent_parse === "user_yes") {
    if (intent.overlay_action === "activated" || intent.overlay_action === "noop_already_applied") {
      const hasWeekHold =
        /\b(week|7 day|seven day|next 7|hold|standard|locked|same line|got it|good|alright|yes)\b/i.test(
          body
        );
      if (!hasWeekHold) {
        return { ok: false, reason: "yes_ack_missing_week_or_acceptance" };
      }
    }
    return { ok: true };
  }

  if (intent.consent_parse === "user_no") {
    const hasDeclineOrKeep =
      /\b(no problem|all good|keep|current|unchanged|not applying|won't|will not|staying|same commitment|declined|without|stays the same)\b/i.test(
        body
      );
    if (!hasDeclineOrKeep && intent.overlay_action === "declined") {
      return { ok: false, reason: "no_ack_missing_decline_or_current_commitment" };
    }
    return { ok: true };
  }

  return { ok: true };
}

export function validateContractConsentAckHumanBody(args: {
  body: string;
  intent: ContractConsentAckIntent;
  optionalBindingSubstring?: string | null;
  stage?: RequiredVerbatimAssertionStage;
}): { ok: true } | { ok: false; reason: string; detail?: unknown } {
  const forbidden = validateContractConsentAckForbiddenLanguage(args.body);
  if (!forbidden.ok) {
    return { ok: false, reason: forbidden.reason, detail: forbidden.phrase };
  }

  const meaning = validateContractConsentAckRequiredMeaning({
    body: args.body,
    intent: args.intent,
  });
  if (!meaning.ok) {
    return { ok: false, reason: meaning.reason };
  }

  const binding = args.optionalBindingSubstring?.trim();
  if (binding && binding.length <= 28) {
    const verbatim = assertRequiredVerbatimSubstringsPresent(
      args.stage ?? "post_final_voice_gate",
      args.body,
      [binding]
    );
    if (!verbatim.ok) {
      return { ok: false, reason: "optional_binding_missing", detail: verbatim.missing };
    }
  }

  if (
    args.intent.legacy_meaning_anchor_preview &&
    args.body.trim() === args.intent.legacy_meaning_anchor_preview.trim()
  ) {
    return { ok: false, reason: "verbatim_legacy_template_paste" };
  }

  return { ok: true };
}

export type ContractConsentAckGenerateFn = (prompt: {
  system: string;
  user: string;
}) => Promise<string | null>;

const CONTRACT_CONSENT_ACK_SYSTEM_PROMPT = `You write ONE outbound SMS as Coach Pat for Summitt Mindset accountability.
The server already recorded the user's contract consent decision — do NOT re-ask YES/NO or invent new terms.
Write a short, human, direct confirmation (max ~280 characters). One SMS. No bullets or labels.
Do NOT sound like a system notification, menu bot, or template.
Do NOT use: Reply YES, Reply NO, text YES, Victory Room, overlay, contract proposal, mutation, RPC, streak language, or fake proof.
Do NOT quote Pat Summitt or invent quotes.
Sound like a real coach continuing the relationship thread.`;

function buildContractConsentAckUserPrompt(intent: ContractConsentAckIntent): string {
  return [
    "Write the SMS body only (no quotes, no Coach: prefix).",
    `Consent decision JSON (facts only — do not paste field names):`,
    JSON.stringify(
      {
        user_said: intent.consent_parse === "user_yes" ? "yes" : "no",
        overlay_action: intent.overlay_action,
        rpc_result: intent.rpc_result,
        contract_kind: intent.contract_kind,
        proposal_digest: intent.proposal_text_digest,
        effective_ask: intent.effective_ask,
        behavior_statement: intent.behavior_statement,
        required_meaning: intent.required_meaning_summary,
        optional_binding_hint: intent.optional_binding_hint,
      },
      null,
      0
    ),
    intent.consent_parse === "user_yes"
      ? "Required meaning: acknowledge their yes; confirm the standard/commitment is held for the next 7 days when overlay was activated."
      : "Required meaning: acknowledge their no; the proposed adjustment is not applied; current written commitment remains the anchor.",
    intent.legacy_meaning_anchor_preview
      ? `Internal meaning anchor (NON-SPEAKABLE — do NOT copy verbatim): ${intent.legacy_meaning_anchor_preview}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateContractConsentAckBodyWithOpenAI(args: {
  intent: ContractConsentAckIntent;
  generateBody?: ContractConsentAckGenerateFn;
}): Promise<{ ok: true; body: string } | { ok: false; reason: string }> {
  const user = buildContractConsentAckUserPrompt(args.intent);
  const generate =
    args.generateBody ??
    (async (prompt: { system: string; user: string }) => {
      const client = getOpenAIClientOrNull();
      if (!client) return null;
      try {
        const completion = await client.chat.completions.create({
          model: modelName(),
          temperature: 0.35,
          max_tokens: 180,
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
        });
        const raw = completion.choices[0]?.message?.content?.trim() ?? "";
        if (!raw) return null;
        return raw.replace(/^["']|["']$/g, "").trim();
      } catch {
        return null;
      }
    });

  const generated = await generate({
    system: CONTRACT_CONSENT_ACK_SYSTEM_PROMPT,
    user,
  });
  if (!generated?.trim()) {
    return { ok: false, reason: "openai_unavailable_or_empty" };
  }
  return { ok: true, body: generated.trim() };
}

export async function applyContractConsentHumanVoiceAckGate(args: {
  body: string;
  commitmentId: string;
  effectiveAsk: string | null;
  behaviorStatement: string | null;
  latestInboundRaw: string;
  latestOutboundBody: string | null;
  latestOpenQuestion: string | null;
  contextPacket: NorthStarSmsContextPacket | null;
  todayCompleted: boolean | null;
  finalEventType: string | null;
  intent: ContractConsentAckIntent;
}): Promise<VoiceOwnershipResult> {
  return applyFinalVoiceOwnershipGate({
    proposedBody: args.body,
    replySource: "v2_contract_consent_human_voice_ack",
    channel: "contract_ack",
    activeCommitmentId: args.commitmentId,
    effectiveAsk: args.effectiveAsk,
    behaviorStatement: args.behaviorStatement,
    latestInboundRaw: args.latestInboundRaw,
    latestOutboundBody: args.latestOutboundBody,
    latestOpenQuestion: args.latestOpenQuestion,
    contextPacket: args.contextPacket,
    todayCompleted: args.todayCompleted,
    finalEventType: args.finalEventType,
    v3BrainMetadata: {
      contract_consent_human_voice_ack: true,
      contract_consent_overlay_action: args.intent.overlay_action,
    },
    northStarMeta: null,
    normalCoaching: true,
  });
}

export type PrepareContractConsentHumanVoiceAckResult =
  | {
      ok: true;
      body: string;
      intent: ContractConsentAckIntent;
      voice: VoiceOwnershipResult;
      generation_source: "openai";
    }
  | { ok: false; reason: string; detail?: unknown };

export type PrepareContractConsentHumanVoiceAckArgs = {
  intent: ContractConsentAckIntent;
  optionalBindingSubstring?: string | null;
  generateBody?: ContractConsentAckGenerateFn;
  voiceArgs: Omit<
    Parameters<typeof applyContractConsentHumanVoiceAckGate>[0],
    "body" | "intent"
  >;
};

export async function finalizeContractConsentAckWithHumanVoice(
  args: PrepareContractConsentHumanVoiceAckArgs
): Promise<PrepareContractConsentHumanVoiceAckResult> {
  const generated = await generateContractConsentAckBodyWithOpenAI({
    intent: args.intent,
    generateBody: args.generateBody,
  });
  if (!generated.ok) {
    return { ok: false, reason: generated.reason };
  }

  const preVoice = validateContractConsentAckHumanBody({
    body: generated.body,
    intent: args.intent,
    optionalBindingSubstring: args.optionalBindingSubstring,
    stage: "post_north_star",
  });
  if (!preVoice.ok) {
    return { ok: false, reason: preVoice.reason, detail: preVoice.detail };
  }

  const voice = await applyContractConsentHumanVoiceAckGate({
    ...args.voiceArgs,
    body: generated.body,
    intent: args.intent,
  });

  if (!voice.shouldSend || !voice.body.trim()) {
    return {
      ok: false,
      reason: "final_voice_gate_no_send",
      detail: voice.skipReason ?? voice.metadata,
    };
  }

  const postVoice = validateContractConsentAckHumanBody({
    body: voice.body,
    intent: args.intent,
    optionalBindingSubstring: args.optionalBindingSubstring,
    stage: "post_final_voice_gate",
  });
  if (!postVoice.ok) {
    return { ok: false, reason: postVoice.reason, detail: postVoice.detail };
  }

  return {
    ok: true,
    body: voice.body.trim(),
    intent: args.intent,
    voice,
    generation_source: "openai",
  };
}

export async function prepareContractConsentHumanVoiceAckForSend(args: {
  buildArgs: BuildContractConsentAckIntentArgs;
  optionalBindingSubstring?: string | null;
  generateBody?: ContractConsentAckGenerateFn;
  voiceArgs: PrepareContractConsentHumanVoiceAckArgs["voiceArgs"];
}): Promise<PrepareContractConsentHumanVoiceAckResult> {
  const intent = buildContractConsentAckIntent(args.buildArgs);
  return finalizeContractConsentAckWithHumanVoice({
    intent,
    optionalBindingSubstring: args.optionalBindingSubstring,
    generateBody: args.generateBody,
    voiceArgs: args.voiceArgs,
  });
}
