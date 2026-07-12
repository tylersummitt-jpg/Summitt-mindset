import { dayKeyOffset } from "@/lib/sms-temporal-contract-v1";
import { getDateKeyInTimezone } from "@/lib/timezone";
import {
  getLocalHourInTimezone,
  type V2UserSendTimeProfileRow,
} from "@/lib/v2-send-time-profile";
import type { V2UserSmsCommsPreferencesRow } from "@/lib/v2-sms-comms-preferences";

export type ResolveTylerTextOverviewDraftForDayKeyArgs = {
  now: Date;
  timezone: string;
  /**
   * Kept for call-site compatibility. Morning TTO day-key no longer branches on
   * legacy evening-style send preference — evening_checkin uses a separate helper.
   */
  clerkSmsTimePreference: string;
  commsPrefs: V2UserSmsCommsPreferencesRow | null;
  learnedProfile: V2UserSendTimeProfileRow | null;
};

/** Morning TTO / noon generate: roll to tomorrow from this local hour onward. */
const MORNING_ROLLOVER_LOCAL_HOUR = 11;

/**
 * Per-user accountability day key for Tyler Text Overview morning draft generation.
 * Always uses morning-style rollover (local hour ≥ 11 → tomorrow).
 * Legacy evening/midday send preferences must not change Morning TTO day-key.
 * Must match the key passed to buildDailySmsContent for that preview.
 */
export function resolveTylerTextOverviewDraftForDayKey(
  args: ResolveTylerTextOverviewDraftForDayKeyArgs
): string {
  const todayKey = getDateKeyInTimezone(args.now, args.timezone);
  const localHour = getLocalHourInTimezone(args.now, args.timezone);

  if (localHour >= MORNING_ROLLOVER_LOCAL_HOUR) {
    return dayKeyOffset(todayKey, 1);
  }
  return todayKey;
}

export type ResolveTylerTextOverviewEveningDraftForDayKeyArgs = {
  now: Date;
  timezone: string;
};

/**
 * Accountability day for evening_checkin previews: user-local calendar today.
 * No morning/noon rollover and no tomorrow shift — evening asks about today's goal.
 */
export function resolveTylerTextOverviewEveningDraftForDayKey(
  args: ResolveTylerTextOverviewEveningDraftForDayKeyArgs
): string {
  return getDateKeyInTimezone(args.now, args.timezone);
}
