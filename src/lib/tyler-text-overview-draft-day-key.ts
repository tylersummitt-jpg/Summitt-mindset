import { clerkSendHourFromPreference } from "@/lib/daily-sms-scheduling";
import { dayKeyOffset } from "@/lib/sms-temporal-contract-v1";
import { getDateKeyInTimezone } from "@/lib/timezone";
import {
  getLocalHourInTimezone,
  shouldUseLearnedSendTimeGate,
  type V2UserSendTimeProfileRow,
} from "@/lib/v2-send-time-profile";
import type { V2UserSmsCommsPreferencesRow } from "@/lib/v2-sms-comms-preferences";

export type ResolveTylerTextOverviewDraftForDayKeyArgs = {
  now: Date;
  timezone: string;
  clerkSmsTimePreference: string;
  commsPrefs: V2UserSmsCommsPreferencesRow | null;
  learnedProfile: V2UserSendTimeProfileRow | null;
};

const MORNING_ROLLOVER_LOCAL_HOUR = 11;
const EVENING_ROLLOVER_LOCAL_HOUR = 22;

export function isTylerTextOverviewEveningStyleSendUser(
  args: Pick<
    ResolveTylerTextOverviewDraftForDayKeyArgs,
    "clerkSmsTimePreference" | "commsPrefs" | "learnedProfile"
  >
): boolean {
  const window = args.commsPrefs?.preferred_send_window;
  if (window === "evening" || window === "midday" || window === "afternoon") {
    return true;
  }

  const explicitHour = args.commsPrefs?.preferred_local_hour;
  if (explicitHour != null && explicitHour >= 17) {
    return true;
  }

  const clerkHour = clerkSendHourFromPreference(args.clerkSmsTimePreference);
  if (clerkHour >= 17) {
    return true;
  }

  const learned = args.learnedProfile;
  if (learned && shouldUseLearnedSendTimeGate(learned)) {
    const learnedWindow = learned.preferred_window;
    if (
      learnedWindow === "evening" ||
      learnedWindow === "midday" ||
      learnedWindow === "afternoon"
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Per-user accountability day key for Tyler Text Overview noon draft generation.
 * Must match the key passed to buildDailySmsContent for that preview.
 */
export function resolveTylerTextOverviewDraftForDayKey(
  args: ResolveTylerTextOverviewDraftForDayKeyArgs
): string {
  const todayKey = getDateKeyInTimezone(args.now, args.timezone);
  const localHour = getLocalHourInTimezone(args.now, args.timezone);
  const eveningUser = isTylerTextOverviewEveningStyleSendUser(args);
  const rolloverHour = eveningUser
    ? EVENING_ROLLOVER_LOCAL_HOUR
    : MORNING_ROLLOVER_LOCAL_HOUR;

  if (localHour >= rolloverHour) {
    return dayKeyOffset(todayKey, 1);
  }
  return todayKey;
}
