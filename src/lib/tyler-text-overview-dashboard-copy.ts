import { getDateKeyInTimezone } from "@/lib/timezone";
import { resolveTylerTextOverviewWeeklyPeriod } from "@/lib/tyler-text-overview-weekly-period";
import {
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
  SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
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

export const EVENING_TTO_NO_BODY_GENERATED_COPY = "No evening text body generated.";

export const EVENING_TTO_NOT_SENDABLE_LABEL = "Not sendable";

export const WEEKLY_TTO_AUTHORITY_BANNER =
  "Weekly TTO drafts are the future authority for weekly SMS, but this page does not send yet. The existing /api/cron/weekly-sms live send path is not changed by this slice. Do not assume weekly drafts are live until the send cutover is completed.";

export const WEEKLY_TTO_NEXT_CUTOVER_COPY =
  "Next cutover step: manual one-row weekly send, then weekly-sms cron becomes draft-authoritative.";

export const WEEKLY_TTO_SAVE_ONLY_COPY =
  "Save updates the draft only. It does not send.";

export const WEEKLY_TTO_REGENERATE_OVERWRITE_COPY =
  "Regenerate may replace saved edits.";

export const WEEKLY_TTO_NO_BODY_GENERATED_COPY = "No weekly text body generated.";

export const WEEKLY_TTO_NOT_SENDABLE_LABEL = "Not sendable";

export type TylerTextOverviewDashboardSendSlot =
  | typeof SMS_DAILY_PRODUCTION_SEND_SLOT
  | typeof SMS_DAILY_EVENING_PREVIEW_SEND_SLOT
  | typeof SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT;

export type TylerTextOverviewSiblingPage = "morning" | "evening" | "weekly";

export function isEveningDashboardSendSlot(
  sendSlot: TylerTextOverviewDashboardSendSlot
): boolean {
  return sendSlot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT;
}

export function isWeeklyDashboardSendSlot(
  sendSlot: TylerTextOverviewDashboardSendSlot
): boolean {
  return sendSlot === SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT;
}

/**
 * Send busy only when a real draft id matches — never treat null===null as sending.
 */
export function isEveningSendBusy(args: {
  draftId: string | null | undefined;
  sendingDraftId: string | null | undefined;
}): boolean {
  const draftId = args.draftId?.trim() ?? "";
  if (!draftId) return false;
  return args.sendingDraftId === draftId;
}

export function eveningSendButtonLabel(isSending: boolean): string {
  return isSending ? "Sending…" : "Send Evening Text";
}

export function eveningGenerateButtonLabel(args: {
  isGenerating: boolean;
  hasPreview: boolean;
}): string {
  if (args.isGenerating) {
    return args.hasPreview ? "Regenerating…" : "Generating…";
  }
  return args.hasPreview ? "Regenerate Evening Preview" : "Generate Evening Preview";
}

export function weeklyGenerateButtonLabel(args: {
  isGenerating: boolean;
  hasDraft: boolean;
}): string {
  if (args.isGenerating) {
    return args.hasDraft ? "Regenerating…" : "Generating…";
  }
  return args.hasDraft ? "Regenerate Weekly Draft" : "Generate Weekly Draft";
}

/** Toast after evening-preview POST succeeds (including valid no-send / null-body). */
export function formatEveningPreviewGenerateSuccessToast(args: {
  machineShouldSend: boolean | null | undefined;
  machineDraftBody: string | null | undefined;
  machineNoSendReason?: string | null;
}): string {
  const body = args.machineDraftBody?.trim() ?? "";
  const reason = args.machineNoSendReason?.trim() ?? "";

  if (args.machineShouldSend === false) {
    const parts = ["Evening preview saved as not sendable."];
    if (reason) parts.push(`Reason: ${reason}`);
    if (!body) parts.push("No text body was generated for this preview.");
    return parts.join(" ");
  }

  if (!body) {
    return "Evening preview generated. No text body was generated for this preview.";
  }

  return "Evening preview generated.";
}

export function formatWeeklyGenerateSuccessToast(args: {
  machineShouldSend: boolean | null | undefined;
  machineDraftBody: string | null | undefined;
  machineNoSendReason?: string | null;
  weekKey?: string | null;
}): string {
  const body = args.machineDraftBody?.trim() ?? "";
  const reason = args.machineNoSendReason?.trim() ?? "";
  const week = args.weekKey?.trim() ?? "";

  if (args.machineShouldSend === false) {
    const parts = ["Weekly draft saved as not sendable."];
    if (week) parts.push(`Week: ${week}.`);
    if (reason) parts.push(`Reason: ${reason}`);
    if (!body) parts.push("No text body was generated for this draft.");
    return parts.join(" ");
  }

  if (!body) {
    return week
      ? `Weekly draft generated for ${week}. No text body was generated.`
      : "Weekly draft generated. No text body was generated.";
  }

  return week ? `Weekly draft generated for ${week}.` : "Weekly draft generated.";
}

/** Empty / no-send body panel copy for Evening TTO (not a fake message body). */
export function formatEveningEmptyBodyPanelCopy(args: {
  machineShouldSend: boolean | null | undefined;
  machineNoSendReason?: string | null;
}): { primary: string; secondary: string | null } {
  const reason = args.machineNoSendReason?.trim() || null;
  if (args.machineShouldSend === false) {
    return {
      primary: EVENING_TTO_NOT_SENDABLE_LABEL,
      secondary: reason
        ? `Reason: ${reason}`
        : EVENING_TTO_NO_BODY_GENERATED_COPY,
    };
  }
  return {
    primary: EVENING_TTO_NO_BODY_GENERATED_COPY,
    secondary: reason ? `Reason: ${reason}` : null,
  };
}

export function formatWeeklyEmptyBodyPanelCopy(args: {
  machineShouldSend: boolean | null | undefined;
  machineNoSendReason?: string | null;
}): { primary: string; secondary: string | null } {
  const reason = args.machineNoSendReason?.trim() || null;
  if (args.machineShouldSend === false) {
    return {
      primary: WEEKLY_TTO_NOT_SENDABLE_LABEL,
      secondary: reason ? `Reason: ${reason}` : WEEKLY_TTO_NO_BODY_GENERATED_COPY,
    };
  }
  return {
    primary: WEEKLY_TTO_NO_BODY_GENERATED_COPY,
    secondary: reason ? `Reason: ${reason}` : null,
  };
}

export function getTylerTextOverviewAdminLocalDayKey(now: Date = new Date()): string {
  return getDateKeyInTimezone(now, TYLER_TEXT_OVERVIEW_ADMIN_TIMEZONE);
}

/** Admin-local Sunday week-end for Weekly TTO day filter default. */
export function getTylerTextOverviewAdminWeeklySundayKey(now: Date = new Date()): string {
  return resolveTylerTextOverviewWeeklyPeriod({
    now,
    timezone: TYLER_TEXT_OVERVIEW_ADMIN_TIMEZONE,
  }).draftForDayKey;
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

export function resolveWeeklyTtoInitialSelectedDayKey(args: {
  searchParamDayKey?: string | null;
  now?: Date;
}): string {
  const fromUrl = args.searchParamDayKey?.trim() ?? "";
  if (fromUrl) return fromUrl;
  return getTylerTextOverviewAdminWeeklySundayKey(args.now);
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
 * Weekly: preserve Sunday week-end keys when present.
 */
export function resolveSiblingLinkDraftForDayKey(args: {
  page: TylerTextOverviewSiblingPage;
  draftForDayKey?: string;
  now?: Date;
}): string | undefined {
  const day = args.draftForDayKey?.trim();
  if (!day) return undefined;
  if (args.page === "morning" || args.page === "weekly") return day;
  const today = getTylerTextOverviewAdminLocalDayKey(args.now);
  return day === today ? day : undefined;
}

export function buildSiblingTylerTextOverviewPageHref(args: {
  page: TylerTextOverviewSiblingPage;
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

export function tylerTextOverviewNavPages(
  current: TylerTextOverviewSiblingPage
): Array<{ page: TylerTextOverviewSiblingPage; label: string; href: string }> {
  const pages: Array<{ page: TylerTextOverviewSiblingPage; label: string }> = [
    { page: "morning", label: "Morning" },
    { page: "evening", label: "Evening" },
    { page: "weekly", label: "Weekly" },
  ];
  return pages
    .filter((p) => p.page !== current)
    .map((p) => ({
      ...p,
      href: buildSiblingTylerTextOverviewPageHref({ page: p.page }),
    }));
}

export function rowStateLabel(
  rowState: TylerTextOverviewRowState,
  sendSlot: TylerTextOverviewDashboardSendSlot
): string {
  const evening = isEveningDashboardSendSlot(sendSlot);
  const weekly = isWeeklyDashboardSendSlot(sendSlot);
  switch (rowState) {
    case "no_draft_yet":
      if (weekly) return "No weekly draft";
      return evening ? "No evening preview" : "No morning draft";
    case "draft_current":
      if (weekly) return "Current weekly draft";
      return evening ? "Current evening preview" : "Current morning draft";
    case "draft_sent":
      if (weekly) return "Weekly draft marked sent";
      return evening ? "Evening check-in sent" : "Morning sent";
    case "draft_skipped":
      if (weekly) return "Weekly skipped / not sendable";
      return evening ? "Evening skipped / not sendable" : "Morning skipped";
    case "draft_other":
      if (weekly) return "Other weekly state";
      return evening ? "Other evening state" : "Other morning state";
    default:
      if (weekly) return "Other weekly state";
      return evening ? "Other evening state" : "Other morning state";
  }
}

export function adminCountLabel(
  key: keyof TylerTextOverviewAdminCounts,
  sendSlot: TylerTextOverviewDashboardSendSlot
): string {
  const evening = isEveningDashboardSendSlot(sendSlot);
  const weekly = isWeeklyDashboardSendSlot(sendSlot);
  switch (key) {
    case "sendableUsers":
      return "Sendable users";
    case "noDraftYet":
      if (weekly) return "No weekly draft";
      return evening ? "No evening preview" : "No morning draft";
    case "draftCurrent":
      if (weekly) return "Current weekly draft";
      return evening ? "Current evening preview" : "Current morning draft";
    case "draftSent":
      if (weekly) return "Weekly marked sent";
      return evening ? "Evening check-in sent" : "Morning sent";
    case "draftSkipped":
      if (weekly) return "Weekly skipped";
      return evening ? "Evening skipped / not sendable" : "Morning skipped";
    case "machineShouldSendTrue":
      if (weekly) return "Would send";
      return evening ? "Would send" : "machine_should_send true";
    case "machineShouldSendFalse":
      if (weekly) return "Would skip";
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
  let target: TylerTextOverviewSiblingPage = "morning";
  if (sendSlot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT) target = "evening";
  if (sendSlot === SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT) target = "weekly";

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
