import type { V2AccountabilityPhase } from "@/lib/v2-accountability-phase";
import type {
  V2SmsCommsCadenceOverride,
  V2SmsCommsPauseReasonCategory,
  V2SmsCommsWeekendPolicy,
} from "@/lib/v2-sms-comms-preferences";

export type SmsRelationshipStatus = "active" | "paused" | "stopped" | "not_configured";

export type SmsPreferencesEditable = {
  pauseUntil: string | null;
  pauseReasonCategory: V2SmsCommsPauseReasonCategory | null;
  cadenceOverride: V2SmsCommsCadenceOverride | null;
  weekendSendPolicy: V2SmsCommsWeekendPolicy | null;
};

export type SmsPreferencesView = {
  ok: true;
  uiEnabled: boolean;
  smsEnabled: boolean;
  phoneMasked: string | null;
  timezone: string;
  smsDisclosureAccepted: boolean;
  relationshipStatus: SmsRelationshipStatus;
  pauseActive: boolean;
  pauseUntil: string | null;
  pauseReasonLabel: string | null;
  cadenceLabel: string;
  cadenceOverride: V2SmsCommsCadenceOverride | null;
  weekendLabel: string;
  weekendSendPolicy: V2SmsCommsWeekendPolicy | null;
  accountabilityPhase: V2AccountabilityPhase | null;
  lowPressureActive: boolean;
  editable: SmsPreferencesEditable;
  compliance: {
    stopHelpStart: string;
  };
};

export const SMS_PREFS_COMPLIANCE_COPY =
  "Reply STOP to opt out. Reply START to resume. Reply HELP for info.";

export function maskSmsPhoneDisplay(phoneRaw: unknown): string | null {
  if (typeof phoneRaw !== "string" || !phoneRaw.trim()) return null;
  const digits = phoneRaw.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `(***) ***-${digits.slice(-4)}`;
}
