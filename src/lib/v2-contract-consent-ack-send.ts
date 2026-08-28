/**
 * Contract-consent ack intent + deterministic body validators.
 * Server owns consent meaning/state. Isolated Sol writer owns natural-language copy.
 * Legacy template strings may appear as internal meaning anchors — never as final reply_body.
 */

import {
  buildV2ContractOverlayNoAckSms,
  buildV2ContractOverlayYesAckSms,
  type V2ContractOverlayKind,
} from "@/lib/v2-sms-accountability";
import {
  assertRequiredVerbatimSubstringsPresent,
  type RequiredVerbatimAssertionStage,
} from "@/lib/v3-inbound-relationship-lane";
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
  /** Internal only — guides the writer; must not be sent verbatim as final SMS. */
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
