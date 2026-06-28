/**
 * Daily SMS send-window evaluation with 7AM product floor.
 * Scheduling authority uses getLocalHourInTimezone — not toLocaleString Date hacks.
 */

import type { V2UserSmsCommsPreferencesRow } from "@/lib/v2-sms-comms-preferences";
import {
  resolveDailySendWindowPolicy,
  type DailySendWindowPolicy,
} from "@/lib/v2-sms-comms-preferences";
import {
  getLocalHourInTimezone,
  localHourToSendWindow,
  shouldUseLearnedSendTimeGate,
  type V2SendTimeWindow,
  type V2UserSendTimeProfileRow,
} from "@/lib/v2-send-time-profile";

export const DAILY_SMS_PRODUCT_FLOOR_HOUR = 7;
export const DAILY_SMS_EXPLICIT_EARLY_MAX_HOUR = 6;

export const SEND_HOUR_BY_CLERK_PREFERENCE = {
  early_morning: 7,
  morning: 7,
  midday: 19,
  evening: 19,
} as const;

export type DailySendWindowPolicySource =
  | "explicit_hour"
  | "explicit_window"
  | "learned_profile"
  | "clerk_hour"
  | "unknown";

export type EvaluateDailySendWindowArgs = {
  now: Date;
  timezone: string;
  clerkSmsTimePreference: string;
  commsPrefs: V2UserSmsCommsPreferencesRow | null;
  learnedProfile: V2UserSendTimeProfileRow | null;
  /** When true, skip window/floor gating (retries, force). */
  bypassWindowGate: boolean;
};

export type EvaluateDailySendWindowResult = {
  computedLocalHour: number;
  clerkSendHour: number;
  sendWindowPolicy: DailySendWindowPolicy;
  sendWindowPolicySource: DailySendWindowPolicySource;
  explicitPreferredLocalHour: number | null;
  preferredSendWindow: V2SendTimeWindow | null;
  learnedWindow: V2SendTimeWindow | null;
  learnedConfidence: number | null;
  sendTimeWindowOk: boolean;
  productFloorApplied: boolean;
  productFloorBlockedSend: boolean;
  /** Window ok ignoring bypass — for retry_outside_window telemetry. */
  sendTimeWindowOkWithoutBypass: boolean;
  productFloorBlockedWithoutBypass: boolean;
};

export function clerkSendHourFromPreference(clerkSmsTimePreference: string): number {
  return (
    SEND_HOUR_BY_CLERK_PREFERENCE[
      clerkSmsTimePreference as keyof typeof SEND_HOUR_BY_CLERK_PREFERENCE
    ] ?? 7
  );
}

export function resolveSendWindowPolicySource(
  policy: DailySendWindowPolicy
): DailySendWindowPolicySource {
  if (policy.useExplicitHour && policy.explicitHour != null) return "explicit_hour";
  if (policy.useExplicitWindow && policy.explicitWindow) return "explicit_window";
  if (policy.useLearnedProfile) {
    return policy.learnedProfile ? "learned_profile" : "clerk_hour";
  }
  return "clerk_hour";
}

/** True when user explicitly chose an hour at or before 6AM local. */
export function isExplicitEarlySendHour(
  explicitPreferredLocalHour: number | null | undefined
): boolean {
  return (
    explicitPreferredLocalHour != null &&
    explicitPreferredLocalHour <= DAILY_SMS_EXPLICIT_EARLY_MAX_HOUR
  );
}

/**
 * Product floor: no proactive send before 7AM unless explicit preferred_local_hour <= 6
 * and current hour matches that explicit hour.
 */
export function isBlockedByDailyProductFloor(
  localHour: number,
  explicitPreferredLocalHour: number | null | undefined
): boolean {
  if (localHour >= DAILY_SMS_PRODUCT_FLOOR_HOUR) return false;
  if (
    explicitPreferredLocalHour != null &&
    explicitPreferredLocalHour <= DAILY_SMS_EXPLICIT_EARLY_MAX_HOUR &&
    localHour === explicitPreferredLocalHour
  ) {
    return false;
  }
  return true;
}

/** Morning send window is 7–10 unless user explicitly chose hour <= 6. */
export function isMorningSendHourAllowed(
  localHour: number,
  explicitPreferredLocalHour: number | null | undefined
): boolean {
  const minHour = isExplicitEarlySendHour(explicitPreferredLocalHour) ? 6 : 7;
  return localHour >= minHour && localHour <= 10;
}

export function isPreferredWindowHourAllowed(
  localHour: number,
  preferredWindow: V2SendTimeWindow,
  explicitPreferredLocalHour: number | null | undefined
): boolean {
  if (preferredWindow === "morning") {
    return isMorningSendHourAllowed(localHour, explicitPreferredLocalHour);
  }
  return localHourToSendWindow(localHour) === preferredWindow;
}

export function evaluateDailySendTimeWindow(
  args: EvaluateDailySendWindowArgs
): EvaluateDailySendWindowResult {
  const computedLocalHour = getLocalHourInTimezone(args.now, args.timezone);
  const clerkSendHour = clerkSendHourFromPreference(args.clerkSmsTimePreference);
  const explicitPreferredLocalHour = args.commsPrefs?.preferred_local_hour ?? null;
  const preferredSendWindow = args.commsPrefs?.preferred_send_window ?? null;

  const sendWindowPolicy = resolveDailySendWindowPolicy({
    prefs: args.commsPrefs,
    learnedProfile: args.learnedProfile,
    clerkSmsTimePreference: args.clerkSmsTimePreference,
  });

  const learnedProfile = sendWindowPolicy.learnedProfile;
  const learnedWindow = learnedProfile?.preferred_window ?? null;
  const learnedConfidence =
    learnedProfile && typeof learnedProfile.confidence === "number"
      ? learnedProfile.confidence
      : null;

  const sendWindowPolicySource = resolveSendWindowPolicySource(sendWindowPolicy);
  const productFloorApplied = true;
  const productFloorBlockedWithoutBypass = isBlockedByDailyProductFloor(
    computedLocalHour,
    explicitPreferredLocalHour
  );

  let sendTimeWindowOkWithoutBypass = computedLocalHour === clerkSendHour;

  if (sendWindowPolicy.useExplicitHour && sendWindowPolicy.explicitHour != null) {
    sendTimeWindowOkWithoutBypass = computedLocalHour === sendWindowPolicy.explicitHour;
  } else if (sendWindowPolicy.useExplicitWindow && sendWindowPolicy.explicitWindow) {
    sendTimeWindowOkWithoutBypass = isPreferredWindowHourAllowed(
      computedLocalHour,
      sendWindowPolicy.explicitWindow,
      explicitPreferredLocalHour
    );
  } else if (
    sendWindowPolicy.useLearnedProfile &&
    learnedProfile &&
    shouldUseLearnedSendTimeGate(learnedProfile)
  ) {
    sendTimeWindowOkWithoutBypass = isPreferredWindowHourAllowed(
      computedLocalHour,
      learnedProfile.preferred_window,
      explicitPreferredLocalHour
    );
  }

  if (productFloorBlockedWithoutBypass) {
    sendTimeWindowOkWithoutBypass = false;
  }

  const sendTimeWindowOk = args.bypassWindowGate ? true : sendTimeWindowOkWithoutBypass;
  const productFloorBlockedSend = args.bypassWindowGate
    ? productFloorBlockedWithoutBypass
    : productFloorBlockedWithoutBypass;

  return {
    computedLocalHour,
    clerkSendHour,
    sendWindowPolicy,
    sendWindowPolicySource,
    explicitPreferredLocalHour,
    preferredSendWindow,
    learnedWindow,
    learnedConfidence,
    sendTimeWindowOk,
    productFloorApplied,
    productFloorBlockedSend,
    sendTimeWindowOkWithoutBypass,
    productFloorBlockedWithoutBypass,
  };
}

export function isLocalCatchupHour(localHour: number): boolean {
  return localHour >= 19 && localHour < 22;
}

export function buildDailySchedulingTelemetry(args: {
  timezone: string;
  evaluation: EvaluateDailySendWindowResult;
  retryOutsideWindow?: boolean;
}): Record<string, unknown> {
  const e = args.evaluation;
  return {
    user_timezone: args.timezone,
    computed_local_hour: e.computedLocalHour,
    product_floor_hour: DAILY_SMS_PRODUCT_FLOOR_HOUR,
    product_floor_applied: e.productFloorApplied,
    product_floor_blocked_send: e.productFloorBlockedSend,
    send_window_policy_source: e.sendWindowPolicySource,
    clerk_send_hour: e.clerkSendHour,
    explicit_preferred_local_hour: e.explicitPreferredLocalHour,
    preferred_send_window: e.preferredSendWindow,
    learned_window: e.learnedWindow,
    learned_confidence: e.learnedConfidence,
    ...(args.retryOutsideWindow === true ? { retry_outside_window: true } : {}),
  };
}
