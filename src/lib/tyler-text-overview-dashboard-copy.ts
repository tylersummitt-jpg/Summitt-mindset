import { getDateKeyInTimezone } from "@/lib/timezone";
import {
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
  type TylerTextOverviewAdminCounts,
  type TylerTextOverviewRowState,
} from "@/lib/tyler-text-overview-types";

/** Admin TTO calendar day — Eastern, matching Summitt ops default. */
export const TYLER_TEXT_OVERVIEW_ADMIN_TIMEZONE = "America/New_York";

export const MORNING_TTO_AUTHORITY_BANNER =
  "Morning SMS is draft-authoritative. Users without a current morning draft, blank body, missing generation, machine_should_send=false, or non-main route will not receive a morning text unless you edit the draft. Run morning TTO generation before the send window.";

export const EVENING_TTO_MANUAL_BANNER =
  "Evening check-in — manual send only. Generate a preview, review it, then send one row at a time via Twilio. Morning / primary daily SMS is unchanged.";

export const EVENING_TTO_NO_PREVIEW_COPY =
  "No evening preview exists. Evening manual send is impossible until a preview exists and is sendable.";

export const EVENING_TTO_NON_TODAY_WARNING =
  "You are viewing an evening preview for a non-today date. Do not send unless this is intentional.";

export const EVENING_TTO_SAVE_ONLY_COPY =
  "Save updates the draft only. It does not send.";

export const EVENING_TTO_SAVE_BEFORE_SEND_COPY = "Save changes before sending.";

export const EVENING_TTO_REGENERATE_OVERWRITE_COPY =
  "Regenerate may replace saved edits.";

export type TylerTextOverviewDashboardSendSlot =
  | typeof SMS_DAILY_PRODUCTION_SEND_SLOT
  | typeof SMS_DAILY_EVENING_PREVIEW_SEND_SLOT;

export function isEveningDashboardSendSlot(
  sendSlot: TylerTextOverviewDashboardSendSlot
): boolean {
  return sendSlot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT;
}

export function getTylerTextOverviewAdminLocalDayKey(now: Date = new Date()): string {
  return getDateKeyInTimezone(now, TYLER_TEXT_OVERVIEW_ADMIN_TIMEZONE);
}

/**
 * Evening TTO selected day: explicit URL/filter wins; otherwise admin-local today.
 * Morning keeps blank ("All current days") when no query param.
 */
export function resolveEveningTtoInitialSelectedDayKey(args: {
  searchParamDayKey?: string | null;
  now?: Date;
}): string {
  const fromUrl = args.searchParamDayKey?.trim() ?? "";
  if (fromUrl) return fromUrl;
  return getTylerTextOverviewAdminLocalDayKey(args.now);
}

export function shouldShowEveningNonTodayWarning(
  selectedDayKey: string,
  now: Date = new Date()
): boolean {
  return selectedDayKey.trim() !== getTylerTextOverviewAdminLocalDayKey(now);
}

/**
 * When linking to Evening, do not carry a non-today morning prep day (e.g. tomorrow after 11am).
 * Same-day or Morning target: preserve the day when present.
 */
export function resolveSiblingLinkDraftForDayKey(args: {
  page: "morning" | "evening";
  draftForDayKey?: string;
  now?: Date;
}): string | undefined {
  const day = args.draftForDayKey?.trim();
  if (!day) return undefined;
  if (args.page === "morning") return day;
  const today = getTylerTextOverviewAdminLocalDayKey(args.now);
  return day === today ? day : undefined;
}

export function buildSiblingTylerTextOverviewPageHref(args: {
  page: "morning" | "evening";
  draftForDayKey?: string;
  now?: Date;
}): string {
  const params = new URLSearchParams();
  const dayKey = resolveSiblingLinkDraftForDayKey(args);
  if (dayKey) {
    params.set("draft_for_day_key", dayKey);
  }
  const qs = params.toString();
  return `/admin/tyler-text-overview/${args.page}${qs ? `?${qs}` : ""}`;
}

export function buildTylerTextOverviewEveningPageHref(
  draftForDayKey?: string,
  now?: Date
): string {
  return buildSiblingTylerTextOverviewPageHref({ page: "evening", draftForDayKey, now });
}

export function rowStateLabel(
  rowState: TylerTextOverviewRowState,
  sendSlot: TylerTextOverviewDashboardSendSlot
): string {
  const evening = isEveningDashboardSendSlot(sendSlot);
  switch (rowState) {
    case "no_draft_yet":
      return evening ? "No evening preview" : "No morning draft";
    case "draft_current":
      return evening ? "Current evening preview" : "Current morning draft";
    case "draft_sent":
      return evening ? "Evening check-in sent" : "Morning sent";
    case "draft_skipped":
      return evening ? "Evening skipped / not sendable" : "Morning skipped";
    case "draft_other":
      return evening ? "Other evening state" : "Other morning state";
    default:
      return evening ? "Other evening state" : "Other morning state";
  }
}

export function adminCountLabel(
  key: keyof TylerTextOverviewAdminCounts,
  sendSlot: TylerTextOverviewDashboardSendSlot
): string {
  const evening = isEveningDashboardSendSlot(sendSlot);
  switch (key) {
    case "sendableUsers":
      return "Sendable users";
    case "noDraftYet":
      return evening ? "No evening preview" : "No morning draft";
    case "draftCurrent":
      return evening ? "Current evening preview" : "Current morning draft";
    case "draftSent":
      return evening ? "Evening check-in sent" : "Morning sent";
    case "draftSkipped":
      return evening ? "Evening skipped / not sendable" : "Morning skipped";
    case "machineShouldSendTrue":
      return evening ? "Would send" : "machine_should_send true";
    case "machineShouldSendFalse":
      return evening ? "Would skip" : "machine_should_send false";
    default:
      return key;
  }
}

export function resolveTylerTextOverviewRootRedirectPath(
  searchParams: Record<string, string | string[] | undefined>,
  now: Date = new Date()
): string {
  const rawSlot = searchParams.send_slot;
  const sendSlot = Array.isArray(rawSlot) ? rawSlot[0] : rawSlot;
  const target = sendSlot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT ? "evening" : "morning";

  const params = new URLSearchParams();
  const rawDay = searchParams.draft_for_day_key;
  const dayKey = Array.isArray(rawDay) ? rawDay[0] : rawDay;
  if (dayKey?.trim()) {
    if (target === "evening") {
      const preserved = resolveSiblingLinkDraftForDayKey({
        page: "evening",
        draftForDayKey: dayKey,
        now,
      });
      if (preserved) {
        params.set("draft_for_day_key", preserved);
      }
    } else {
      params.set("draft_for_day_key", dayKey.trim());
    }
  }

  const rawQ = searchParams.q ?? searchParams.search;
  const q = Array.isArray(rawQ) ? rawQ[0] : rawQ;
  if (q?.trim()) {
    params.set("q", q.trim());
  }

  const qs = params.toString();
  return `/admin/tyler-text-overview/${target}${qs ? `?${qs}` : ""}`;
}
