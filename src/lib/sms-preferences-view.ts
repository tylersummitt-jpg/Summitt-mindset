import { resolveUserTimezone } from "@/lib/timezone";
import type { V2AccountabilityPhase } from "@/lib/v2-accountability-phase";
import {
  maskSmsPhoneDisplay,
  SMS_PREFS_COMPLIANCE_COPY,
  type SmsPreferencesEditable,
  type SmsPreferencesView,
  type SmsRelationshipStatus,
} from "@/lib/sms-preferences-types";

import {
  isPauseActive,
  MAX_PAUSE_DURATION_MS,
  type V2SmsCommsCadenceOverride,
  type V2SmsCommsPauseReasonCategory,
  type V2SmsCommsWeekendPolicy,
  type V2UserSmsCommsPreferencesRow,
} from "@/lib/v2-sms-comms-preferences";

export type {
  SmsPreferencesEditable,
  SmsPreferencesView,
  SmsRelationshipStatus,
} from "@/lib/sms-preferences-types";
export { SMS_PREFS_COMPLIANCE_COPY, maskSmsPhoneDisplay } from "@/lib/sms-preferences-types";

const PAUSE_REASON_LABELS: Record<V2SmsCommsPauseReasonCategory, string> = {
  vacation: "Vacation",
  travel: "Travel",
  illness: "Illness",
  family_emergency: "Family emergency",
  grief: "Grief",
  hospital_or_surgery: "Hospital or surgery",
  competition_or_camp: "Competition or camp",
  work_or_schedule_overload: "Work or schedule overload",
  pause_request: "Requested pause",
  weekend_or_short_break: "Short break",
  other: "Other",
};

const PAUSE_REASON_CATEGORIES = new Set<string>(Object.keys(PAUSE_REASON_LABELS));
const CADENCE_OVERRIDE_VALUES = new Set<string>(["every_other_day", "every_3_days"]);
const WEEKEND_POLICY_VALUES = new Set<string>(["all", "weekdays_only"]);

const PATCH_ALLOWLIST = new Set([
  "pause_until",
  "pause_reason_category",
  "cadence_override",
  "clearCadenceOverride",
  "weekend_send_policy",
  "clearPause",
]);

function hasConfiguredPhone(phoneRaw: unknown): boolean {
  return typeof phoneRaw === "string" && phoneRaw.trim().length > 0;
}

function cadenceLabelFromOverride(override: V2SmsCommsCadenceOverride | null): string {
  if (override === "every_other_day") return "Every other day";
  if (override === "every_3_days") return "Every 3 days";
  return "Daily (default rhythm)";
}

function weekendLabelFromPolicy(policy: V2SmsCommsWeekendPolicy | null): string {
  if (policy === "weekdays_only") return "Weekdays only";
  return "All days";
}

export function deriveRelationshipStatus(args: {
  smsEnabled: boolean;
  phoneConfigured: boolean;
  prefs: V2UserSmsCommsPreferencesRow | null;
  now?: Date;
}): SmsRelationshipStatus {
  if (!args.phoneConfigured) return "not_configured";
  if (!args.smsEnabled) return "stopped";
  if (isPauseActive(args.prefs, args.now)) return "paused";
  return "active";
}

export function buildSmsPreferencesViewModel(args: {
  uiEnabled: boolean;
  smsEnabled: boolean;
  phoneNumber: unknown;
  timezoneRaw: unknown;
  smsDisclosureAccepted: boolean;
  prefs: V2UserSmsCommsPreferencesRow | null;
  accountabilityPhase: V2AccountabilityPhase | null;
  now?: Date;
}): SmsPreferencesView {
  const now = args.now ?? new Date();
  const timezone = resolveUserTimezone(args.timezoneRaw);
  const phoneConfigured = hasConfiguredPhone(args.phoneNumber);
  const pauseActive = isPauseActive(args.prefs, now);

  const cadenceOverride = args.prefs?.cadence_override ?? null;
  const weekendSendPolicy = args.prefs?.weekend_send_policy ?? null;
  const lowPressureActive = args.accountabilityPhase === "low_pressure_reactivation";

  return {
    ok: true,
    uiEnabled: args.uiEnabled,
    smsEnabled: args.smsEnabled,
    phoneMasked: maskSmsPhoneDisplay(args.phoneNumber),
    timezone,
    smsDisclosureAccepted: args.smsDisclosureAccepted,
    relationshipStatus: deriveRelationshipStatus({
      smsEnabled: args.smsEnabled,
      phoneConfigured,
      prefs: args.prefs,
      now,
    }),
    pauseActive,
    pauseUntil: pauseActive ? args.prefs?.pause_until ?? null : null,
    pauseReasonLabel:
      pauseActive && args.prefs?.pause_reason_category
        ? PAUSE_REASON_LABELS[args.prefs.pause_reason_category]
        : null,
    cadenceLabel: cadenceLabelFromOverride(cadenceOverride),
    cadenceOverride,
    weekendLabel: weekendLabelFromPolicy(weekendSendPolicy),
    weekendSendPolicy,
    accountabilityPhase: args.accountabilityPhase,
    lowPressureActive,
    editable: {
      pauseUntil: args.prefs?.pause_until ?? null,
      pauseReasonCategory: args.prefs?.pause_reason_category ?? null,
      cadenceOverride,
      weekendSendPolicy,
    },
    compliance: {
      stopHelpStart: SMS_PREFS_COMPLIANCE_COPY,
    },
  };
}

export type SmsPreferencesPatchUpsert = {
  patch: Partial<
    Pick<
      V2UserSmsCommsPreferencesRow,
      | "pause_until"
      | "pause_reason_category"
      | "cadence_override"
      | "weekend_send_policy"
    >
  >;
  clearPause?: boolean;
  clearCadenceOverride?: boolean;
};

export type SmsPreferencesPatchResult =
  | { ok: true; upsert: SmsPreferencesPatchUpsert }
  | { ok: false; error: string; status: 400 | 403 };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasSettingFields(body: Record<string, unknown>): boolean {
  if (body.pause_until !== undefined && body.pause_until !== null) return true;
  if (body.pause_reason_category !== undefined && body.pause_reason_category !== null) return true;
  if (body.cadence_override !== undefined && body.cadence_override !== null) return true;
  if (body.weekend_send_policy !== undefined && body.weekend_send_policy !== null) return true;
  return false;
}

export function isClearOnlySmsPreferencesPatch(body: Record<string, unknown>): boolean {
  const hasClear =
    body.clearPause === true ||
    body.clearCadenceOverride === true ||
    body.pause_until === null ||
    body.cadence_override === null;
  return hasClear && !hasSettingFields(body);
}

function parsePauseReasonCategory(raw: unknown): V2SmsCommsPauseReasonCategory | null {
  if (typeof raw !== "string" || !PAUSE_REASON_CATEGORIES.has(raw)) return null;
  return raw as V2SmsCommsPauseReasonCategory;
}

function validatePauseUntil(raw: unknown, now: Date): string | null | "invalid" {
  if (raw === null) return null;
  if (typeof raw !== "string") return "invalid";
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return "invalid";
  if (t <= now.getTime()) return "invalid";
  if (t > now.getTime() + MAX_PAUSE_DURATION_MS) return "invalid";
  return new Date(t).toISOString();
}

export function validateSmsPreferencesPatch(
  body: unknown,
  now: Date = new Date()
): SmsPreferencesPatchResult {
  if (!isRecord(body)) {
    return { ok: false, error: "Invalid request body", status: 400 };
  }

  for (const key of Object.keys(body)) {
    if (!PATCH_ALLOWLIST.has(key)) {
      return { ok: false, error: `Unknown field: ${key}`, status: 400 };
    }
  }

  const upsert: SmsPreferencesPatchUpsert = { patch: {} };
  let hasMutation = false;

  if (body.clearPause === true) {
    upsert.clearPause = true;
    hasMutation = true;
  }

  if (body.clearCadenceOverride === true) {
    upsert.clearCadenceOverride = true;
    hasMutation = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, "pause_until")) {
    const validated = validatePauseUntil(body.pause_until, now);
    if (validated === "invalid") {
      return {
        ok: false,
        error: "pause_until must be a future ISO date within 30 days, or null",
        status: 400,
      };
    }
    if (validated === null) {
      upsert.clearPause = true;
    } else {
      upsert.patch.pause_until = validated;
      const reason = parsePauseReasonCategory(body.pause_reason_category);
      upsert.patch.pause_reason_category = reason ?? "pause_request";
    }
    hasMutation = true;
  } else if (Object.prototype.hasOwnProperty.call(body, "pause_reason_category")) {
    const reason = parsePauseReasonCategory(body.pause_reason_category);
    if (!reason) {
      return { ok: false, error: "Invalid pause_reason_category", status: 400 };
    }
    upsert.patch.pause_reason_category = reason;
    hasMutation = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, "cadence_override")) {
    if (body.cadence_override === null) {
      upsert.clearCadenceOverride = true;
      hasMutation = true;
    } else if (body.cadence_override === "daily") {
      return {
        ok: false,
        error: 'cadence_override "daily" is not allowed; clear to restore default rhythm',
        status: 400,
      };
    } else if (
      typeof body.cadence_override === "string" &&
      CADENCE_OVERRIDE_VALUES.has(body.cadence_override)
    ) {
      upsert.patch.cadence_override = body.cadence_override as V2SmsCommsCadenceOverride;
      hasMutation = true;
    } else {
      return { ok: false, error: "Invalid cadence_override", status: 400 };
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "weekend_send_policy")) {
    if (body.weekend_send_policy === null) {
      upsert.patch.weekend_send_policy = null;
      hasMutation = true;
    } else if (
      typeof body.weekend_send_policy === "string" &&
      WEEKEND_POLICY_VALUES.has(body.weekend_send_policy)
    ) {
      upsert.patch.weekend_send_policy = body.weekend_send_policy as V2SmsCommsWeekendPolicy;
      hasMutation = true;
    } else {
      return { ok: false, error: "Invalid weekend_send_policy", status: 400 };
    }
  }

  if (!hasMutation) {
    return { ok: false, error: "No valid preference changes", status: 400 };
  }

  return { ok: true, upsert };
}

export function assertSmsPreferencesPatchAllowed(args: {
  smsEnabled: boolean;
  body: Record<string, unknown>;
}): SmsPreferencesPatchResult | { ok: true } {
  if (args.smsEnabled) return { ok: true };
  if (isClearOnlySmsPreferencesPatch(args.body)) return { ok: true };
  return {
    ok: false,
    error: "SMS is opted out. Reply START to resume before changing preferences.",
    status: 403,
  };
}

export { PAUSE_REASON_LABELS };
