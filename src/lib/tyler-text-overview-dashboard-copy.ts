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
  "Morning SMS is draft-authoritative. Clicking Save on a non-empty Morning TTO body is Tyler approval: that exact body sends if normal delivery gates pass — even when machine_should_send=false. Blank saved body means no text. Machine no-send without a Tyler Save still blocks. Run morning TTO generation before the send window.";

export const MORNING_TTO_TYLER_APPROVED_COPY =
  "Tyler-approved: this saved Morning TTO body will send if normal delivery gates pass.";

export const MORNING_TTO_MACHINE_BLOCKED_TYLER_APPROVED_COPY =
  "Machine blocked this draft before review, but Tyler saved a replacement. Tyler’s saved body wins.";

export const MORNING_TTO_MACHINE_BLOCKED_NO_TYLER_SAVE_COPY =
  "Blocked by machine. It will not send unless Tyler saves a body.";

export const MORNING_TTO_BLANK_BODY_COPY =
  "Blank saved body: no text will send.";

export const MORNING_TTO_SAVE_TOAST_APPROVED =
  "Saved. Tyler-approved body will send if normal delivery gates pass.";

export const MORNING_TTO_SAVE_TOAST_BLANK =
  "Saved blank. This user will not receive a morning text.";

/** Morning row sendability copy for the control-room UI. */
export function formatMorningTtoSendabilityCopy(args: {
  editedByTyler: boolean | null | undefined;
  currentBodySource?: string | null;
  currentBodyToSend: string | null | undefined;
  machineShouldSend: boolean | null | undefined;
}): string | null {
  const body = args.currentBodyToSend?.trim() ?? "";
  const tylerApproved =
    args.editedByTyler === true || args.currentBodySource === "tyler_edit";

  if (!body) {
    if (tylerApproved) {
      return MORNING_TTO_BLANK_BODY_COPY;
    }
    if (args.machineShouldSend === false) {
      return MORNING_TTO_MACHINE_BLOCKED_NO_TYLER_SAVE_COPY;
    }
    return null;
  }

  if (tylerApproved) {
    if (args.machineShouldSend === false) {
      return MORNING_TTO_MACHINE_BLOCKED_TYLER_APPROVED_COPY;
    }
    return MORNING_TTO_TYLER_APPROVED_COPY;
  }

  if (args.machineShouldSend === false) {
    return MORNING_TTO_MACHINE_BLOCKED_NO_TYLER_SAVE_COPY;
  }

  return null;
}

export function formatMorningTtoSaveToast(normalizedBody: string | null | undefined): string {
  const body = typeof normalizedBody === "string" ? normalizedBody.trim() : "";
  return body ? MORNING_TTO_SAVE_TOAST_APPROVED : MORNING_TTO_SAVE_TOAST_BLANK;
}

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
  "Weekly cron (/api/cron/weekly-sms) is draft-authoritative: it only sends current Weekly TTO drafts. No draft, blank body, or machine_should_send=false means no weekly text.";

export const WEEKLY_TTO_NEXT_CUTOVER_COPY =
  "Generate Missing Weekly Drafts creates drafts only and does not send texts. Manual one-row send still uses the saved draft body.";

export const WEEKLY_TTO_SAVE_ONLY_COPY =
  "Save updates the draft only. It does not send.";

export const WEEKLY_TTO_SAVE_BEFORE_SEND_COPY = "Save changes before sending.";

export const WEEKLY_TTO_MANUAL_SEND_NOTE =
  "Manual send sends this saved Weekly TTO draft now. Weekly cron is also draft-authoritative: no draft, blank body, or machine_should_send=false means no cron weekly text. Manual send and cron both use sms_weekly_send_events for duplicate protection — if this user/week already has a weekly event, cron will not send another one.";

export const WEEKLY_TTO_FOOTER_AT_SEND_COPY =
  "STOP/HELP footer will be added at send-time.";

export const WEEKLY_TTO_REGENERATE_OVERWRITE_COPY =
  "Regenerate may replace saved edits.";

export const WEEKLY_TTO_NO_BODY_GENERATED_COPY = "No weekly text body generated.";

export const WEEKLY_TTO_NOT_SENDABLE_LABEL = "Not sendable";

export const WEEKLY_TTO_GENERATE_MISSING_BUTTON_LABEL = "Generate Missing Weekly Drafts";

export const WEEKLY_TTO_GENERATE_MISSING_BUTTON_BUSY_LABEL =
  "Generating Missing Weekly Drafts…";

export const WEEKLY_TTO_GENERATE_MISSING_HELP_COPY =
  "Generates missing weekly drafts for sendable users. It does not send texts, does not overwrite existing drafts or Tyler edits, and skips users already sent this week.";

export const WEEKLY_TTO_GENERATE_MISSING_CONFIRM_TITLE = "Generate missing weekly drafts?";

export const WEEKLY_TTO_GENERATE_MISSING_CONFIRM_COPY =
  "This generates weekly drafts only for sendable users who are missing a draft for their current week. It does not send texts, does not overwrite existing drafts or Tyler edits, and skips users already sent this week. Generation may take several minutes.";

export function weeklyGenerateMissingButtonLabel(isGenerating: boolean): string {
  return isGenerating
    ? WEEKLY_TTO_GENERATE_MISSING_BUTTON_BUSY_LABEL
    : WEEKLY_TTO_GENERATE_MISSING_BUTTON_LABEL;
}

export function formatWeeklyGenerateMissingSummaryToast(args: {
  generated: number;
  skippedExistingCurrent: number;
  skippedSent: number;
  skippedAlreadyWeeklyEvent: number;
  failed: number;
}): string {
  const alreadySent = args.skippedSent + args.skippedAlreadyWeeklyEvent;
  return `Generated ${args.generated} missing weekly drafts. Skipped ${args.skippedExistingCurrent} existing, ${alreadySent} already sent, ${args.failed} failed.`;
}
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

export function isWeeklySendBusy(args: {
  draftId: string | null | undefined;
  sendingDraftId: string | null | undefined;
}): boolean {
  const draftId = args.draftId?.trim() ?? "";
  if (!draftId) return false;
  return args.sendingDraftId === draftId;
}

export function eveningSendButtonLabel(isSending: boolean): string {
  void isSending;
  return "Evening send disabled";
}

export const EVENING_PROACTIVE_SEND_DISABLED_UI_COPY =
  "Evening proactive Twilio sends are disabled. Generate and review may remain available for later.";

export function weeklySendButtonLabel(isSending: boolean): string {
  return isSending ? "Sending Weekly Text…" : "Send Weekly Text";
}

/**
 * Eligible for Weekly TTO manual one-row send (UI gate; server re-checks authority).
 */
export function isWeeklyManualSendEligible(args: {
  rowState: TylerTextOverviewRowState | null | undefined;
  draftStatus: string | null | undefined;
  sendSlot: string | null | undefined;
  draftId: string | null | undefined;
  currentBodyToSend: string | null | undefined;
  machineShouldSend: boolean | null | undefined;
  dirty: boolean;
  sending: boolean;
}): boolean {
  if (args.rowState !== "draft_current") return false;
  if (args.draftStatus !== "current") return false;
  if (args.sendSlot !== SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT) return false;
  if (!args.draftId?.trim()) return false;
  if (!(args.currentBodyToSend?.trim() ?? "")) return false;
  if (args.machineShouldSend !== true) return false;
  if (args.dirty) return false;
  if (args.sending) return false;
  return true;
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

/** Morning TTO: explicit URL day wins; otherwise admin-local today (complete manifest). */
export function resolveMorningTtoInitialSelectedDayKey(args: {
  searchParamDayKey?: string | null;
  now?: Date;
}): string {
  const fromUrl = args.searchParamDayKey?.trim() ?? "";
  if (fromUrl) return fromUrl;
  return getTylerTextOverviewAdminLocalDayKey(args.now);
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
      return evening
        ? "No evening preview"
        : "MISSING DRAFT — GENERATION INCOMPLETE";
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

export const MORNING_MISSING_DRAFT_BANNER =
  "MISSING MORNING DRAFT — GENERATION INCOMPLETE";

export const MORNING_MISSING_DRAFT_SUPPORTING_COPY =
  "No live Morning draft exists for this user, day, and slot. This row cannot send.";

export const MORNING_TYLER_BLOCKED_LABEL = "BLOCKED BY TYLER";

export const MORNING_TYLER_BLANK_SAVED_COPY =
  "SAVED — blank body blocks this Morning text";

export const MORNING_UNSAVED_COPY =
  "UNSAVED — this change is not protecting the send yet";

export const MORNING_SAVE_FAILED_COPY =
  "SAVE FAILED — server body was not changed";

export const TTO_MANIFEST_INCOMPLETE_BANNER =
  "TTO MANIFEST INCOMPLETE — DO NOT TRUST THIS PAGE FOR SEND REVIEW";

export const TTO_DATA_STALE_OR_INCOMPLETE_BANNER =
  "TTO DATA IS STALE OR INCOMPLETE — DO NOT TRUST THIS PAGE FOR SEND REVIEW";

export const TTO_MANIFEST_SELECT_DAY_COPY =
  "Select a Draft day to load the complete Morning send manifest. “All current days” is not a complete send review.";

export const MORNING_SAVE_RELOAD_FAILED_COPY =
  "SAVE REACHED THE SERVER, BUT TTO COULD NOT RELOAD THE MANIFEST. REFRESH REQUIRED.";

export const TTO_FILTERED_ROWS_LABEL = "Visible filtered rows";

export const MORNING_BULK_ACTIONS_HEADING = "Bulk Morning actions";

export const MORNING_BULK_SEARCH_WARNING =
  "Search only filters the list below. Bulk actions still apply to the full selected-day Morning batch.";

export const MORNING_BULK_APPLY_EMPTY_HINT =
  "Type a non-empty text to apply, or use Blank all texts.";

export const MORNING_BULK_SELECT_DAY_HINT =
  "Select a Draft day before using bulk actions.";

export function formatMorningBulkBlankConfirm(args: {
  draftForDayKey: string;
  currentDraftCount: number;
}): string {
  return [
    `Blank all ${args.currentDraftCount} unsent Morning texts for ${args.draftForDayKey}?`,
    "",
    "No Morning text will send for these drafts unless you add text again.",
    "This overwrites existing Tyler edits on current drafts.",
    "Already-sent drafts are skipped.",
    "This saves blank bodies but does not send anything now.",
  ].join("\n");
}

export function formatMorningBulkApplyConfirm(args: {
  draftForDayKey: string;
  currentDraftCount: number;
  body: string;
}): string {
  return [
    `Replace the saved body for all ${args.currentDraftCount} unsent ${args.draftForDayKey} Morning drafts with this exact text?`,
    "",
    "This overwrites existing Tyler edits.",
    "Already-sent drafts are skipped.",
    "This saves the text but does not send it now.",
    "",
    "Exact text:",
    args.body,
  ].join("\n");
}

export function formatMorningBulkResultMessage(args: {
  updated: number;
  skippedNonCurrent: number;
  skippedMissing: number;
  failed: Array<{ clerkUserId: string; preferredName: string | null; error: string }>;
  textsSentByThisAction: number;
}): string {
  const lines = [
    `${args.updated} Morning drafts updated.`,
    `${args.skippedNonCurrent} already sent/skipped.`,
    `${args.skippedMissing} missing drafts skipped.`,
    `${args.failed.length} failed.`,
    `${args.textsSentByThisAction} texts sent by this action.`,
  ];
  if (args.failed.length > 0) {
    lines.push("");
    lines.push("Failed:");
    for (const f of args.failed.slice(0, 20)) {
      const label = f.preferredName?.trim() || f.clerkUserId;
      lines.push(`- ${label}: ${f.error}`);
    }
    if (args.failed.length > 20) {
      lines.push(`…and ${args.failed.length - 20} more`);
    }
  }
  return lines.join("\n");
}

/** True when a current draft was Tyler-blanked (blocks Morning send). */
export function matchesTylerTextOverviewSearchQuery(
  row: {
    clerkUserId: string;
    preferredName: string | null;
    phoneNumber: string | null;
    draftForDayKey: string;
  },
  rawQuery: string | null | undefined
): boolean {
  const query = rawQuery?.trim().toLowerCase();
  if (!query) return true;

  const haystacks = [
    row.clerkUserId,
    row.preferredName,
    row.phoneNumber,
    row.draftForDayKey,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.toLowerCase());

  return haystacks.some((value) => value.includes(query));
}

export function isTylerBlankedMorningDraftRow(row: {
  rowState: TylerTextOverviewRowState;
  editedByTyler: boolean;
  currentBodySource: string | null | undefined;
  currentBodyToSend: string | null | undefined;
}): boolean {
  if (row.rowState !== "draft_current") return false;
  const blank = !(row.currentBodyToSend?.trim() ?? "");
  if (!blank) return false;
  return row.editedByTyler === true || row.currentBodySource === "tyler_edit";
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
      return evening ? "No evening preview" : "Missing drafts";
    case "draftCurrent":
      if (weekly) return "Current weekly draft";
      return evening ? "Current evening preview" : "Current morning draft";
    case "draftCurrentReady":
      return evening || weekly ? "Ready nonblank" : "Ready nonblank (can send)";
    case "draftCurrentTylerBlanked":
      return "Tyler-blanked (blocked)";
    case "draftSent":
      if (weekly) return "Weekly marked sent (audience)";
      return evening ? "Evening marked sent (audience)" : "Sent (audience rows)";
    case "draftsMarkedSentDayTotal":
      return "Drafts marked sent (records)";
    case "twilioAcceptedDayTotal":
      return "Twilio-accepted send events";
    case "draftSkipped":
      if (weekly) return "Weekly skipped";
      return evening ? "Evening skipped / not sendable" : "Morning skipped";
    case "machineShouldSendTrue":
      if (weekly) return "Would send";
      return evening ? "Would send" : "machine_should_send true";
    case "machineShouldSendFalse":
      if (weekly) return "Would skip";
      return evening ? "Would skip" : "machine_should_send false";
    case "generationLinkageErrors":
      return "Generation linkage errors";
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
