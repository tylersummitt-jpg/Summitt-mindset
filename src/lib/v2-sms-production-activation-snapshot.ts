/**
 * Wave 13 — Server-side SMS / AI production activation snapshot (read-only observability).
 * Used by `/internal/sms-qa` to show effective feature states at deploy time — not a source of defaults.
 */

import {
  isV2AiInboundEnabled,
  isV2AiInboundGatedOutcomesEnabled,
  isV2AiInboundInterpretationShadowEnabled,
  isV2InboundInterpretationRequested,
} from "@/lib/v2-ai-inbound";
import { isV2InboundMemorySignalsEnabled } from "@/lib/v2-inbound-memory-signals";
import { isV2AiOutboundEnabled } from "@/lib/v2-ai-outbound";
import { isV2WeeklyProofAiEnabled } from "@/lib/v2-weekly-proof-sms";
import { isV2AiBlockerAckEnabled } from "@/lib/v2-ai-blocker-ack";
import { isV2CoachingMemorySummaryAiEnabled } from "@/lib/v2-coaching-memory";
import {
  isV2CentralSmsBrainControlEnabled,
  isV2CentralSmsBrainShadowEnabled,
} from "@/lib/v2-central-sms-brain";
import {
  parseOperatorConsoleAllowedClerkUserIds,
  parseOperatorConsoleAllowedEmails,
} from "@/lib/operator-console-allowlist";
import { isTwilioReady } from "@/lib/twilio";

export type V2SmsActivationFlagRow = {
  key: string;
  effective: boolean;
  /** Short hint when unset behaves differently than effective "on". */
  note?: string;
};

/**
 * Resolved booleans mirror runtime helpers (`isV2*`). Raw env parity for rollout debugging.
 */
export function getV2SmsProductionActivationSnapshot(): {
  nodeEnv: string;
  infra: V2SmsActivationFlagRow[];
  aiAndSms: V2SmsActivationFlagRow[];
  reminders: readonly string[];
} {
  const openai = Boolean(process.env.OPENAI_API_KEY?.trim());
  const gated = isV2AiInboundGatedOutcomesEnabled();
  const shadow = isV2AiInboundInterpretationShadowEnabled();
  const memory = isV2InboundMemorySignalsEnabled();
  const interpretation = isV2InboundInterpretationRequested();

  const infra: V2SmsActivationFlagRow[] = [
    { key: "NODE_ENV production", effective: process.env.NODE_ENV === "production" },
    {
      key: "CRON_SECRET configured",
      effective: Boolean(process.env.CRON_SECRET?.trim()),
      note: "Required for secured cron hits + Twilio→inbound worker kick",
    },
    { key: "Twilio outbound ready (SID/token + Messaging Service or From)", effective: isTwilioReady() },
    { key: "SMS_DRY_RUN", effective: process.env.SMS_DRY_RUN === "true", note: "Must be false to send SMS" },
    { key: "OPENAI_API_KEY configured", effective: openai },
    {
      key: "Operator console allowlist populated",
      effective:
        parseOperatorConsoleAllowedClerkUserIds().size > 0 || parseOperatorConsoleAllowedEmails().size > 0,
      note: "OPERATOR_CONSOLE_ALLOWED_* — needed for /internal/*",
    },
  ];

  const aiAndSms: V2SmsActivationFlagRow[] = [
    {
      key: "V2_AI_INBOUND_ENABLED (AI reply packaging)",
      effective: isV2AiInboundEnabled(),
      note: 'Unset ⇒ false everywhere — inbound uses templates/banks when AI path fails',
    },
    {
      key: "V2_AI_INBOUND_INTERPRETATION_SHADOW_ENABLED",
      effective: shadow,
      note:
        process.env.NODE_ENV === "production"
          ? 'Unset ⇒ OFF in prod (explicit "true"/"1" to enable)'
          : 'Unset ⇒ mirrors dev unless explicit "false"',
    },
    {
      key: "V2_AI_INBOUND_GATED_OUTCOMES_ENABLED",
      effective: gated,
      note:
        process.env.NODE_ENV === "production"
          ? 'Unset ⇒ OFF — deterministic scorer wins unless explicit "true"'
          : "Unset ⇒ dev default ON",
    },
    {
      key: "Interpretation OpenAI pipeline runs",
      effective: interpretation,
      note: "True when shadow OR gated requests interpreter",
    },
    {
      key: "V2_INBOUND_MEMORY_SIGNALS_ENABLED",
      effective: memory,
      note:
        process.env.NODE_ENV === "production"
          ? 'Unset ⇒ OFF unless "true"'
          : "Unset ⇒ ON in development",
    },
    {
      key: "V2_AI_OUTBOUND_ENABLED (daily check AI body)",
      effective: isV2AiOutboundEnabled(),
      note: 'Unset ⇒ false — deterministic / template outbound only',
    },
    {
      key: "V2_WEEKLY_PROOF_AI_ENABLED",
      effective: isV2WeeklyProofAiEnabled(),
      note: 'Defaults ON; set "false"/"0" for deterministic-only weekly SMS',
    },
    {
      key: "V2_AI_BLOCKER_ACK_ENABLED",
      effective: isV2AiBlockerAckEnabled(),
      note: "AI blocker acknowledgment SMS — unset ⇒ OFF",
    },
    {
      key: "V2_COACHING_MEMORY_SUMMARY_ENABLED",
      effective: isV2CoachingMemorySummaryAiEnabled(),
      note: "Optional AI projection for coaching_summary — unset ⇒ OFF",
    },
    {
      key: "Victory Room summary paragraph (AI)",
      effective: openai,
      note: "Uses OPENAI when key present — no dedicated kill switch",
    },
    {
      key: "SMS pending candidate extraction AI",
      effective: openai,
      note: "No separate env gate — gated by OPENAI on fallback extract path",
    },
    {
      key: "V2_CENTRAL_SMS_BRAIN_SHADOW_ENABLED",
      effective: isV2CentralSmsBrainShadowEnabled(),
      note:
        process.env.NODE_ENV === "production"
          ? 'Unset ⇒ OFF — set "true" to log/store central turn shadow metadata'
          : "Unset ⇒ ON in development (writes payload_json.central_sms_turn_shadow when enabled)",
    },
    {
      key: "V2_CENTRAL_SMS_BRAIN_CONTROL_ENABLED",
      effective: isV2CentralSmsBrainControlEnabled(),
      note:
        'Unset ⇒ OFF in code. Set "true"/"1" to apply Wave 14.2 guardrails (runs central brain even if shadow is off).',
    },
  ];

  const reminders: readonly string[] = [
    "Apply Supabase migrations (especially sms_memory_signal event_type) before relying on Wave 9+ memory inserts.",
    "Production: set V2_AI_INBOUND_GATED_OUTCOMES_ENABLED=true and V2_AI_INBOUND_INTERPRETATION_SHADOW_ENABLED=true if you want AI classification evidence + gated outcomes.",
    "Production: set V2_INBOUND_MEMORY_SIGNALS_ENABLED=true for living-memory detection on inbound.",
    "Production: set V2_AI_OUTBOUND_ENABLED=true + V2_AI_INBOUND_ENABLED=true for human-style AI SMS copy.",
  ];

  return { nodeEnv: process.env.NODE_ENV ?? "", infra, aiAndSms, reminders };
}
