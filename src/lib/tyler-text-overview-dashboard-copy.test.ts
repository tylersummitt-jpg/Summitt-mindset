import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  adminCountLabel,
  buildSiblingTylerTextOverviewPageHref,
  eveningGenerateButtonLabel,
  eveningSendButtonLabel,
  EVENING_PROACTIVE_SEND_DISABLED_UI_COPY,
  EVENING_TTO_NON_TODAY_WARNING,
  EVENING_TTO_NO_BODY_GENERATED_COPY,
  EVENING_TTO_NO_PREVIEW_COPY,
  EVENING_TTO_NOT_SENDABLE_LABEL,
  EVENING_TTO_REGENERATE_OVERWRITE_COPY,
  EVENING_TTO_SAVE_BEFORE_SEND_COPY,
  EVENING_TTO_SAVE_ONLY_COPY,
  TTO_BODY_SOFT_LENGTH_WARNING,
  TTO_COACH_PAT_STYLE_SOFT_WARN_CHARS,
  TWILIO_SMS_BODY_MAX_CHARS,
  formatTtoBodyCharCount,
  formatTtoBodyOverTransportMaxCopy,
  ttoDraftBodyExceedsTransportMax,
  ttoDraftBodyShouldSoftWarnLength,
  ttoDraftBodyTransportLength,
  formatEveningEmptyBodyPanelCopy,
  formatEveningPreviewGenerateSuccessToast,
  getTylerTextOverviewAdminLocalDayKey,
  isEveningSendBusy,
  MORNING_TTO_AUTHORITY_BANNER,
  MORNING_TTO_BLANK_BODY_COPY,
  MORNING_TTO_MACHINE_BLOCKED_NO_TYLER_SAVE_COPY,
  MORNING_TTO_MACHINE_BLOCKED_TYLER_APPROVED_COPY,
  MORNING_TTO_SAVE_TOAST_APPROVED,
  MORNING_TTO_SAVE_TOAST_BLANK,
  MORNING_TTO_TYLER_APPROVED_COPY,
  formatMorningBulkApplyConfirm,
  formatMorningBulkBlankConfirm,
  formatMorningBulkResultMessage,
  formatEveningBulkApplyConfirm,
  formatEveningBulkBlankConfirm,
  formatEveningBulkResultMessage,
  formatMorningTtoSaveToast,
  formatMorningTtoSendabilityCopy,
  resolveEveningTtoInitialSelectedDayKey,
  resolveMorningTtoInitialSelectedDayKey,
  resolveDefaultTtoAdminDraftDayKey,
  resolveSiblingLinkDraftForDayKey,
  resolveTylerTextOverviewRootRedirectPath,
  rowStateLabel,
  shouldShowEveningNonTodayWarning,
  ttoBulkSaveEndpoint,
  ttoGenerateAllButtonLabel,
  ttoGenerateAllEndpoint,
  ttoGenerateAllSessionStorageKey,
  formatTtoGenerateAllConfirm,
  formatTtoGenerateAllDayLabel,
  formatTtoGenerateAllResultMessage,
  TTO_GENERATE_ALL_SEARCH_WARNING,
  TTO_GENERATE_ALL_SELECT_DAY_HINT,
  MORNING_BULK_ACTIONS_HEADING,
  MORNING_BULK_SEARCH_WARNING,
  EVENING_BULK_ACTIONS_HEADING,
  EVENING_BULK_SEARCH_WARNING,
  MORNING_MISSING_DRAFT_BANNER,
  MORNING_UNSAVED_COPY,
  TTO_MANIFEST_INCOMPLETE_BANNER,
} from "@/lib/tyler-text-overview-dashboard-copy";
import {
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";

describe("tyler-text-overview-dashboard-copy rowStateLabel", () => {
  it("uses morning labels", () => {
    expect(rowStateLabel("no_draft_yet", SMS_DAILY_PRODUCTION_SEND_SLOT)).toBe(
      "MISSING DRAFT — GENERATION INCOMPLETE"
    );
    expect(rowStateLabel("draft_current", SMS_DAILY_PRODUCTION_SEND_SLOT)).toBe(
      "Current morning draft"
    );
    expect(rowStateLabel("draft_sent", SMS_DAILY_PRODUCTION_SEND_SLOT)).toBe("Morning sent");
    expect(rowStateLabel("draft_skipped", SMS_DAILY_PRODUCTION_SEND_SLOT)).toBe("Morning skipped");
    expect(rowStateLabel("draft_other", SMS_DAILY_PRODUCTION_SEND_SLOT)).toBe(
      "Other morning state"
    );
  });

  it("uses evening labels", () => {
    expect(rowStateLabel("no_draft_yet", SMS_DAILY_EVENING_PREVIEW_SEND_SLOT)).toBe(
      "No evening preview"
    );
    expect(rowStateLabel("draft_current", SMS_DAILY_EVENING_PREVIEW_SEND_SLOT)).toBe(
      "Current evening preview"
    );
    expect(rowStateLabel("draft_sent", SMS_DAILY_EVENING_PREVIEW_SEND_SLOT)).toBe(
      "Evening check-in sent"
    );
    expect(rowStateLabel("draft_skipped", SMS_DAILY_EVENING_PREVIEW_SEND_SLOT)).toBe(
      "Evening skipped / not sendable"
    );
    expect(rowStateLabel("draft_other", SMS_DAILY_EVENING_PREVIEW_SEND_SLOT)).toBe(
      "Other evening state"
    );
  });
});

describe("tyler-text-overview-dashboard-copy adminCountLabel", () => {
  it("uses morning count labels", () => {
    expect(adminCountLabel("sendableUsers", SMS_DAILY_PRODUCTION_SEND_SLOT)).toBe("Sendable users");
    expect(adminCountLabel("noDraftYet", SMS_DAILY_PRODUCTION_SEND_SLOT)).toBe("Missing drafts");
    expect(adminCountLabel("draftsMarkedSentDayTotal", SMS_DAILY_PRODUCTION_SEND_SLOT)).toBe(
      "Drafts marked sent (records)"
    );
    expect(adminCountLabel("twilioAcceptedDayTotal", SMS_DAILY_PRODUCTION_SEND_SLOT)).toBe(
      "Twilio-accepted send events"
    );
    expect(adminCountLabel("machineShouldSendTrue", SMS_DAILY_PRODUCTION_SEND_SLOT)).toBe(
      "machine_should_send true"
    );
    expect(adminCountLabel("machineShouldSendFalse", SMS_DAILY_PRODUCTION_SEND_SLOT)).toBe(
      "machine_should_send false"
    );
  });

  it("uses evening count labels", () => {
    expect(adminCountLabel("noDraftYet", SMS_DAILY_EVENING_PREVIEW_SEND_SLOT)).toBe(
      "No evening preview"
    );
    expect(adminCountLabel("machineShouldSendTrue", SMS_DAILY_EVENING_PREVIEW_SEND_SLOT)).toBe(
      "Would send"
    );
    expect(adminCountLabel("machineShouldSendFalse", SMS_DAILY_EVENING_PREVIEW_SEND_SLOT)).toBe(
      "Would skip"
    );
  });
});

describe("tyler-text-overview-dashboard-copy evening send/generate UI helpers", () => {
  it("isEveningSendBusy is false when draftId is null even if sendingDraftId is null", () => {
    expect(
      isEveningSendBusy({ draftId: null, sendingDraftId: null })
    ).toBe(false);
    expect(
      isEveningSendBusy({ draftId: undefined, sendingDraftId: null })
    ).toBe(false);
    expect(
      isEveningSendBusy({ draftId: "", sendingDraftId: null })
    ).toBe(false);
  });

  it("isEveningSendBusy is true only when real draftId matches sendingDraftId", () => {
    expect(
      isEveningSendBusy({ draftId: "draft-1", sendingDraftId: "draft-1" })
    ).toBe(true);
    expect(
      isEveningSendBusy({ draftId: "draft-1", sendingDraftId: "draft-2" })
    ).toBe(false);
    expect(
      isEveningSendBusy({ draftId: "draft-1", sendingDraftId: null })
    ).toBe(false);
  });

  it("eveningSendButtonLabel stays visible while send remains disabled", () => {
    expect(eveningSendButtonLabel(false)).toBe("Send Evening Text");
    expect(eveningSendButtonLabel(true)).toBe("Send Evening Text");
    expect(EVENING_PROACTIVE_SEND_DISABLED_UI_COPY).toBe(
      "Evening drafts auto-send between 7–9 PM in the member's local time."
    );
  });

  it("eveningGenerateButtonLabel covers generate/regenerate loading", () => {
    expect(eveningGenerateButtonLabel({ isGenerating: false, hasPreview: false })).toBe(
      "Generate Evening Preview"
    );
    expect(eveningGenerateButtonLabel({ isGenerating: true, hasPreview: false })).toBe(
      "Generating…"
    );
    expect(eveningGenerateButtonLabel({ isGenerating: false, hasPreview: true })).toBe(
      "Regenerate Evening Preview"
    );
    expect(eveningGenerateButtonLabel({ isGenerating: true, hasPreview: true })).toBe(
      "Regenerating…"
    );
  });

  it("formatEveningPreviewGenerateSuccessToast explains no-send and null body", () => {
    expect(
      formatEveningPreviewGenerateSuccessToast({
        machineShouldSend: false,
        machineDraftBody: null,
        machineNoSendReason: "already_user_yes_today",
      })
    ).toContain("not sendable");
    expect(
      formatEveningPreviewGenerateSuccessToast({
        machineShouldSend: false,
        machineDraftBody: null,
        machineNoSendReason: "already_user_yes_today",
      })
    ).toContain("Reason: already_user_yes_today");
    expect(
      formatEveningPreviewGenerateSuccessToast({
        machineShouldSend: false,
        machineDraftBody: null,
        machineNoSendReason: "already_user_yes_today",
      })
    ).toContain("No text body was generated");
    expect(
      formatEveningPreviewGenerateSuccessToast({
        machineShouldSend: true,
        machineDraftBody: "How did the walk go?",
      })
    ).toBe("Evening preview generated.");
  });

  it("formatEveningEmptyBodyPanelCopy avoids misleading dash body", () => {
    expect(
      formatEveningEmptyBodyPanelCopy({
        machineShouldSend: false,
        machineNoSendReason: "paused",
      })
    ).toEqual({
      primary: EVENING_TTO_NOT_SENDABLE_LABEL,
      secondary: "Reason: paused",
    });
    expect(
      formatEveningEmptyBodyPanelCopy({
        machineShouldSend: null,
        machineNoSendReason: null,
      })
    ).toEqual({
      primary: EVENING_TTO_NO_BODY_GENERATED_COPY,
      secondary: null,
    });
    expect(EVENING_TTO_NO_BODY_GENERATED_COPY).not.toBe("—");
    expect(EVENING_TTO_NO_BODY_GENERATED_COPY).not.toBe("-");
  });
});

describe("tyler-text-overview-dashboard-copy evening day defaults", () => {
  // 9:00 PM ET July 9 2026 (EDT) — at/after Evening default cutoff → tomorrow
  const eveningAtCutoff = new Date("2026-07-10T01:00:00.000Z");
  // 6:00 PM ET July 9 2026 — before cutoff → today
  const eveningBeforeCutoff = new Date("2026-07-09T22:00:00.000Z");
  const todayEt = "2026-07-09";
  const tomorrowEt = "2026-07-10";

  it("admin local day key is Eastern calendar day", () => {
    expect(getTylerTextOverviewAdminLocalDayKey(eveningAtCutoff)).toBe(todayEt);
  });

  it("Evening with no draft_for_day_key defaults to tomorrow at/after 21:00 ET", () => {
    expect(
      resolveEveningTtoInitialSelectedDayKey({
        searchParamDayKey: null,
        now: eveningAtCutoff,
      })
    ).toBe(tomorrowEt);
    expect(
      resolveEveningTtoInitialSelectedDayKey({
        searchParamDayKey: "",
        now: eveningAtCutoff,
      })
    ).toBe(tomorrowEt);
  });

  it("Evening with no draft_for_day_key defaults to today before 21:00 ET", () => {
    expect(
      resolveEveningTtoInitialSelectedDayKey({
        searchParamDayKey: null,
        now: eveningBeforeCutoff,
      })
    ).toBe(todayEt);
  });

  it("Evening with explicit draft_for_day_key respects it", () => {
    expect(
      resolveEveningTtoInitialSelectedDayKey({
        searchParamDayKey: tomorrowEt,
        now: eveningAtCutoff,
      })
    ).toBe(tomorrowEt);
    expect(
      resolveEveningTtoInitialSelectedDayKey({
        searchParamDayKey: todayEt,
        now: eveningAtCutoff,
      })
    ).toBe(todayEt);
  });

  it("non-today warning when selected day is not admin-local today", () => {
    expect(shouldShowEveningNonTodayWarning(tomorrowEt, eveningAtCutoff)).toBe(true);
    expect(shouldShowEveningNonTodayWarning(todayEt, eveningAtCutoff)).toBe(false);
    expect(shouldShowEveningNonTodayWarning("", eveningAtCutoff)).toBe(true);
  });

  it("Morning → Evening sibling link drops tomorrow morning day", () => {
    expect(
      resolveSiblingLinkDraftForDayKey({
        page: "evening",
        draftForDayKey: tomorrowEt,
        now: eveningAtCutoff,
      })
    ).toBeUndefined();
    expect(
      buildSiblingTylerTextOverviewPageHref({
        page: "evening",
        draftForDayKey: tomorrowEt,
        now: eveningAtCutoff,
      })
    ).toBe("/admin/tyler-text-overview/evening");
  });

  it("Morning → Evening sibling link keeps same-day key", () => {
    expect(
      buildSiblingTylerTextOverviewPageHref({
        page: "evening",
        draftForDayKey: todayEt,
        now: eveningAtCutoff,
      })
    ).toBe(`/admin/tyler-text-overview/evening?draft_for_day_key=${todayEt}`);
  });

  it("Evening → Morning sibling link still preserves day", () => {
    expect(
      buildSiblingTylerTextOverviewPageHref({
        page: "morning",
        draftForDayKey: tomorrowEt,
        now: eveningAtCutoff,
      })
    ).toBe(`/admin/tyler-text-overview/morning?draft_for_day_key=${tomorrowEt}`);
  });
});

describe("tyler-text-overview-dashboard-copy routing helpers", () => {
  it("buildSiblingTylerTextOverviewPageHref preserves draft_for_day_key only", () => {
    expect(
      buildSiblingTylerTextOverviewPageHref({
        page: "evening",
        draftForDayKey: "2026-07-09",
        now: new Date("2026-07-10T01:00:00.000Z"),
      })
    ).toBe("/admin/tyler-text-overview/evening?draft_for_day_key=2026-07-09");
    expect(buildSiblingTylerTextOverviewPageHref({ page: "morning" })).toBe(
      "/admin/tyler-text-overview/morning"
    );
  });

  it("root redirect defaults to morning", () => {
    expect(resolveTylerTextOverviewRootRedirectPath({})).toBe("/admin/tyler-text-overview/morning");
  });

  it("root redirect with evening send_slot goes to evening", () => {
    expect(
      resolveTylerTextOverviewRootRedirectPath({ send_slot: "evening_checkin" })
    ).toBe("/admin/tyler-text-overview/evening");
  });

  it("root redirect preserves draft_for_day_key and q", () => {
    expect(
      resolveTylerTextOverviewRootRedirectPath({
        draft_for_day_key: "2026-07-09",
        q: "tyler",
      })
    ).toBe("/admin/tyler-text-overview/morning?draft_for_day_key=2026-07-09&q=tyler");
    expect(
      resolveTylerTextOverviewRootRedirectPath(
        {
          send_slot: "evening_checkin",
          draft_for_day_key: "2026-07-09",
          search: "alice",
        },
        new Date("2026-07-10T01:00:00.000Z")
      )
    ).toBe("/admin/tyler-text-overview/evening?draft_for_day_key=2026-07-09&q=alice");
  });

  it("root redirect to evening drops non-today draft_for_day_key", () => {
    expect(
      resolveTylerTextOverviewRootRedirectPath(
        {
          send_slot: "evening_checkin",
          draft_for_day_key: "2026-07-10",
          q: "dennis",
        },
        new Date("2026-07-10T01:00:00.000Z")
      )
    ).toBe("/admin/tyler-text-overview/evening?q=dennis");
  });

  it("unknown send_slot defaults to morning", () => {
    expect(resolveTylerTextOverviewRootRedirectPath({ send_slot: "bogus" })).toBe(
      "/admin/tyler-text-overview/morning"
    );
  });
});

describe("tyler-text-overview two-page UI wiring", () => {
  const rootPage = readFileSync(
    join(process.cwd(), "src/app/admin/tyler-text-overview/page.tsx"),
    "utf8"
  );
  const morningPage = readFileSync(
    join(process.cwd(), "src/app/admin/tyler-text-overview/morning/page.tsx"),
    "utf8"
  );
  const eveningPage = readFileSync(
    join(process.cwd(), "src/app/admin/tyler-text-overview/evening/page.tsx"),
    "utf8"
  );
  const dashboard = readFileSync(
    join(process.cwd(), "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx"),
    "utf8"
  );

  it("root page redirects only", () => {
    expect(rootPage).toContain("redirect(");
    expect(rootPage).toContain("resolveTylerTextOverviewRootRedirectPath");
    expect(rootPage).not.toContain("TylerTextOverviewDashboard");
  });

  it("morning page passes sendSlot morning", () => {
    expect(morningPage).toContain("Morning Text Overview");
    expect(morningPage).toContain('sendSlot={SMS_DAILY_PRODUCTION_SEND_SLOT}');
    expect(morningPage).toContain("requireTylerAdmin");
  });

  it("evening page passes sendSlot evening_checkin", () => {
    expect(eveningPage).toContain("Evening Text Overview");
    expect(eveningPage).toContain('sendSlot={SMS_DAILY_EVENING_PREVIEW_SEND_SLOT}');
    expect(eveningPage).toContain("requireTylerAdmin");
  });

  it("labels INTENTIONAL SPACE and REQUIRED TOUCH without silence-cadence copy", () => {
    expect(dashboard).toContain("INTENTIONAL SPACE");
    expect(dashboard).toContain("REQUIRED TOUCH");
    expect(dashboard).toContain("required_touch");
  });

  it("dashboard uses fixed sendSlot prop not URL send_slot", () => {
    expect(dashboard).toContain("sendSlot }: TylerTextOverviewDashboardProps");
    expect(dashboard).not.toContain('searchParams.get("send_slot")');
    expect(dashboard).not.toContain("role=\"tablist\"");
    expect(dashboard).not.toContain("resolveSendSlotTab");
    expect(dashboard).not.toContain("buildTabHref");
  });

  it("morning dashboard shows authority banner and evening cross-link", () => {
    expect(dashboard).toContain("MORNING_TTO_AUTHORITY_BANNER");
    expect(MORNING_TTO_AUTHORITY_BANNER).toContain("draft-authoritative");
    expect(MORNING_TTO_AUTHORITY_BANNER).toContain("Tyler approval");
    expect(dashboard).toContain("formatMorningTtoSendabilityCopy");
    expect(dashboard).toContain("formatMorningTtoSaveToast");
    expect(dashboard).toContain("Evening Text Overview →");
  });

  it("formatMorningTtoSendabilityCopy covers Tyler-approved and machine-blocked states", () => {
    expect(
      formatMorningTtoSendabilityCopy({
        editedByTyler: true,
        currentBodySource: "tyler_edit",
        currentBodyToSend: "Hello",
        machineShouldSend: true,
      })
    ).toBe(MORNING_TTO_TYLER_APPROVED_COPY);

    expect(
      formatMorningTtoSendabilityCopy({
        editedByTyler: true,
        currentBodySource: "tyler_edit",
        currentBodyToSend: "Hello",
        machineShouldSend: false,
      })
    ).toBe(MORNING_TTO_MACHINE_BLOCKED_TYLER_APPROVED_COPY);

    expect(
      formatMorningTtoSendabilityCopy({
        editedByTyler: false,
        currentBodySource: "machine",
        currentBodyToSend: "Hello",
        machineShouldSend: false,
      })
    ).toBe(MORNING_TTO_MACHINE_BLOCKED_NO_TYLER_SAVE_COPY);

    expect(
      formatMorningTtoSendabilityCopy({
        editedByTyler: true,
        currentBodySource: "tyler_edit",
        currentBodyToSend: "  ",
        machineShouldSend: false,
      })
    ).toBe(MORNING_TTO_BLANK_BODY_COPY);

    expect(
      formatMorningTtoSendabilityCopy({
        editedByTyler: false,
        currentBodySource: "machine",
        currentBodyToSend: null,
        machineShouldSend: false,
      })
    ).toBe(MORNING_TTO_MACHINE_BLOCKED_NO_TYLER_SAVE_COPY);
  });

  it("formatMorningTtoSaveToast reflects sendability", () => {
    expect(formatMorningTtoSaveToast("Body text")).toBe(MORNING_TTO_SAVE_TOAST_APPROVED);
    expect(formatMorningTtoSaveToast("   ")).toBe(MORNING_TTO_SAVE_TOAST_BLANK);
    expect(formatMorningTtoSaveToast(null)).toBe(MORNING_TTO_SAVE_TOAST_BLANK);
  });

  it("evening dashboard keeps manual send controls and cross-link", () => {
    expect(dashboard).toContain("EVENING_TTO_MANUAL_BANNER");
    expect(dashboard).toContain("eveningGenerateButtonLabel");
    expect(dashboard).toContain("eveningSendButtonLabel");
    expect(eveningGenerateButtonLabel({ isGenerating: false, hasPreview: false })).toBe(
      "Generate Evening Preview"
    );
    expect(eveningGenerateButtonLabel({ isGenerating: false, hasPreview: true })).toBe(
      "Regenerate Evening Preview"
    );
    expect(eveningSendButtonLabel(false)).toBe("Send Evening Text");
    expect(dashboard).toContain("Morning Text Overview →");
    expect(dashboard).toContain("EVENING_TTO_NO_PREVIEW_COPY");
  });

  it("morning page hides evening-only row controls via isEveningPage gate", () => {
    expect(dashboard).toContain("isEveningPage &&");
    expect(dashboard).not.toMatch(/!isEveningPage && row\.clerkUserId.*Generate Evening Preview/s);
  });

  it("evening preview navigation uses /evening path without send_slot query", () => {
    expect(dashboard).toContain("buildTylerTextOverviewEveningPageHref");
    expect(dashboard).not.toMatch(/router\.push\([^)]*send_slot/);
  });

  it("evening Generate/Regenerate prefers selectedDayKey and omits stale row day when blank", () => {
    expect(dashboard).toContain("isEveningPage");
    expect(dashboard).toMatch(
      /const dayKey = isEveningPage\s*\?\s*selectedDayKey\.trim\(\) \|\| undefined/
    );
    expect(dashboard).not.toMatch(
      /const dayKey = row\.draftForDayKey\?\.trim\(\) \|\| selectedDayKey\.trim\(\) \|\| undefined/
    );
  });

  it("evening defaults selected day via slot-aware resolver and warns on non-today", () => {
    expect(dashboard).toContain("resolveEveningTtoInitialSelectedDayKey");
    expect(dashboard).toContain("shouldShowEveningNonTodayWarning");
    expect(dashboard).toContain("EVENING_TTO_NON_TODAY_WARNING");
    expect(EVENING_TTO_NON_TODAY_WARNING).toContain("non-today date");
    expect(EVENING_TTO_NO_PREVIEW_COPY).toContain("No evening preview");
  });

  it("evening page supports Save Evening Text with dirty-send guard", () => {
    expect(dashboard).toContain("canEditEveningDraft");
    expect(dashboard).toContain("Save Evening Text");
    expect(dashboard).toContain("EVENING_TTO_SAVE_ONLY_COPY");
    expect(dashboard).toContain("EVENING_TTO_SAVE_BEFORE_SEND_COPY");
    expect(dashboard).toContain("EVENING_TTO_REGENERATE_OVERWRITE_COPY");
    expect(dashboard).toContain("isEveningDraftDirty");
    expect(dashboard).toContain("EVENING_PROACTIVE_SEND_DISABLED_UI_COPY");
    expect(dashboard).toContain("eveningSendButtonLabel(false)");
    expect(EVENING_TTO_SAVE_ONLY_COPY).toContain("does not send");
    expect(EVENING_TTO_SAVE_BEFORE_SEND_COPY).toContain("Save changes");
    expect(EVENING_TTO_REGENERATE_OVERWRITE_COPY).toContain("keeps your saved edit/blank");
    expect(EVENING_TTO_REGENERATE_OVERWRITE_COPY).not.toContain("replace saved edits");
    expect(dashboard).not.toContain("showReadOnlyBody =\n              isEveningPage ||");
  });

  it("Morning/Evening TTO live character count: 300/320 is not a hard cap; >1600 is blocked; no maxLength truncation", () => {
    expect(TWILIO_SMS_BODY_MAX_CHARS).toBe(1600);
    expect(TTO_COACH_PAT_STYLE_SOFT_WARN_CHARS).toBe(300);
    expect(ttoDraftBodyTransportLength("x".repeat(320))).toBe(320);
    expect(ttoDraftBodyExceedsTransportMax("x".repeat(300))).toBe(false);
    expect(ttoDraftBodyExceedsTransportMax("x".repeat(320))).toBe(false);
    expect(ttoDraftBodyExceedsTransportMax("x".repeat(1600))).toBe(false);
    expect(ttoDraftBodyExceedsTransportMax("x".repeat(1601))).toBe(true);
    expect(ttoDraftBodyShouldSoftWarnLength("x".repeat(300))).toBe(false);
    expect(ttoDraftBodyShouldSoftWarnLength("x".repeat(301))).toBe(true);
    expect(ttoDraftBodyShouldSoftWarnLength("x".repeat(320))).toBe(true);
    expect(ttoDraftBodyShouldSoftWarnLength("x".repeat(1600))).toBe(true);
    expect(ttoDraftBodyShouldSoftWarnLength("x".repeat(1601))).toBe(false);
    expect(formatTtoBodyCharCount(435)).toContain("435");
    expect(formatTtoBodyCharCount(435)).toContain("1600");
    expect(TTO_BODY_SOFT_LENGTH_WARNING).toMatch(/still send/i);
    expect(formatTtoBodyOverTransportMaxCopy(1601)).toContain("1600");
    expect(dashboard).toContain("formatTtoBodyCharCount");
    expect(dashboard).toContain("TTO_BODY_SOFT_LENGTH_WARNING");
    expect(dashboard).toContain("formatTtoBodyOverTransportMaxCopy");
    expect(dashboard).toContain("ttoDraftBodyExceedsTransportMax");
    expect(dashboard).toContain("editorOverTransportMax");
    expect(dashboard).toContain("bulkApplyOverTransportMax");
    expect(dashboard).not.toMatch(/maxLength=\{?1600/);
    expect(dashboard).not.toMatch(/maxLength=\{TWILIO_SMS_BODY_MAX_CHARS\}/);
    expect(dashboard).toContain("submittedTransportBody");
    expect(MORNING_TTO_BLANK_BODY_COPY).toMatch(/no text/i);
  });

  it("evening Send busy state never treats null draftId as sending", () => {
    expect(dashboard).toContain("isEveningSendBusy");
    expect(dashboard).toContain("eveningSendButtonLabel");
    expect(dashboard).toContain("isSendingThisEvening");
    expect(dashboard).not.toMatch(
      /\{sendingDraftId === row\.draftId \? "Sending…" : "Send Evening Text"\}/
    );
    expect(dashboard).not.toMatch(/sendingDraftId !== row\.draftId/);
  });

  it("evening Generate loading is independent of Send Sending label", () => {
    expect(dashboard).toContain("generatingUserId");
    expect(dashboard).toContain("eveningGenerateButtonLabel");
    expect(dashboard).toContain("isGeneratingThisEvening");
    expect(dashboard).toContain("formatEveningPreviewGenerateSuccessToast");
    expect(dashboard).toContain("formatEveningEmptyBodyPanelCopy");
    expect(dashboard).toContain("machine_no_send_reason");
  });

  it("Morning and Evening bulk actions are slot-aware; Weekly has none", () => {
    expect(dashboard).toContain("ttoBulkActionsHeading");
    expect(dashboard).toContain("ttoBulkSaveEndpoint");
    expect(dashboard).toContain("Blank all texts");
    expect(dashboard).toContain("Apply text to all");
    expect(dashboard).toContain("ttoBulkSaveEndpoint(bulkUiSlot)");
    expect(dashboard).toContain('operation: "blank_all"');
    expect(dashboard).toContain('operation: "apply_all"');
    expect(dashboard).toContain("formatTtoBulkBlankConfirm");
    expect(dashboard).toContain("formatTtoBulkApplyConfirm");
    expect(dashboard).toContain("ttoBulkSearchWarning");
    expect(dashboard).toContain("forceOverwrite: true");
    expect(dashboard).toContain('bulkUiSlot = isEveningPage ? ("evening_checkin" as const)');
    expect(dashboard).toContain("7–9 PM local window");
    expect(dashboard).not.toContain("weekly-bulk-save");
    expect(dashboard).not.toContain("{!isEveningPage ? (");
    expect(ttoBulkSaveEndpoint("morning")).toBe(
      "/api/admin/tyler-text-overview/morning-bulk-save"
    );
    expect(ttoBulkSaveEndpoint("evening_checkin")).toBe(
      "/api/admin/tyler-text-overview/evening-bulk-save"
    );
  });

  it("Generate All UI: exact selected date, confirm, busy, refetch; Evening per-user Generate retained", () => {
    expect(dashboard).toContain("ttoGenerateAllButtonLabel");
    expect(dashboard).toContain("ttoGenerateAllEndpoint");
    expect(dashboard).toContain("formatTtoGenerateAllConfirm");
    expect(dashboard).toContain("formatTtoGenerateAllResultMessage");
    expect(dashboard).toContain("runGenerateAll");
    expect(dashboard).toContain("generateAllBusy");
    expect(dashboard).toContain("pageBatchBusy");
    expect(dashboard).toContain("TTO_GENERATE_ALL_SEARCH_WARNING");
    expect(dashboard).toContain("forceOverwrite: true");
    expect(dashboard).toContain("7–9 AM Morning window");
    expect(dashboard).toContain("7–9 PM Evening window");
    expect(dashboard).toContain("generateEveningPreview");
    expect(dashboard).toContain("eveningGenerateButtonLabel");
    expect(dashboard).not.toContain("/api/cron/tyler-text-overview-generate");
    expect(ttoGenerateAllEndpoint("morning")).toBe(
      "/api/admin/tyler-text-overview/morning-generate-all"
    );
    expect(ttoGenerateAllEndpoint("evening_checkin")).toBe(
      "/api/admin/tyler-text-overview/evening-generate-all"
    );
  });
});

describe("TTO Generate All confirmation copy", () => {
  it("Morning button and confirm use exact selected date + 7–9 AM + protections", () => {
    expect(
      ttoGenerateAllButtonLabel({
        slot: "morning",
        draftForDayKey: "2026-08-07",
        isBusy: false,
      })
    ).toBe(`Generate Morning for ${formatTtoGenerateAllDayLabel("2026-08-07")}`);
    expect(
      ttoGenerateAllButtonLabel({
        slot: "morning",
        draftForDayKey: "2026-08-07",
        isBusy: true,
      })
    ).toBe("Generating…");

    const copy = formatTtoGenerateAllConfirm({
      slot: "morning",
      draftForDayKey: "2026-08-07",
      audienceCount: 42,
      searchActive: true,
    });
    expect(copy).toContain("2026-08-07");
    expect(copy).toContain("Morning");
    expect(copy).toContain("42");
    expect(copy).toContain("Active search does not narrow");
    expect(copy).toContain("Tyler-saved edits and intentional blanks remain protected");
    expect(copy).toContain("Already-sent / non-current");
    expect(copy).toContain("Successful current machine drafts are not regenerated");
    expect(copy).toContain("resumable chunks");
    expect(copy).toContain("does not send texts now");
    expect(copy).toContain("7–9 AM Morning window");
    expect(copy).toContain("selected date exactly");
  });

  it("Evening button and confirm use exact selected date + 7–9 PM", () => {
    expect(
      ttoGenerateAllButtonLabel({
        slot: "evening_checkin",
        draftForDayKey: "2026-08-07",
        isBusy: false,
      })
    ).toBe(`Generate Evening for ${formatTtoGenerateAllDayLabel("2026-08-07")}`);

    const copy = formatTtoGenerateAllConfirm({
      slot: "evening_checkin",
      draftForDayKey: "2026-08-07",
      audienceCount: 12,
      searchActive: false,
    });
    expect(copy).toContain("Evening");
    expect(copy).toContain("7–9 PM Evening window");
    expect(copy).not.toContain("Active search does not narrow");
    expect(TTO_GENERATE_ALL_SEARCH_WARNING).toContain("full selected-day sendable audience");
    expect(TTO_GENERATE_ALL_SELECT_DAY_HINT).toContain("Select a Draft day");
  });

  it("result message reports counts truthfully", () => {
    const msg = formatTtoGenerateAllResultMessage({
      slot: "morning",
      targeted: 40,
      generated_complete: 31,
      protected_complete: 5,
      already_sent: 2,
      noncurrent: 1,
      failed: 1,
      pending: 0,
      remaining: 1,
      failures: [{ clerkUserId: "user_x", preferredName: "Pat", error: "sol_failed" }],
    });
    expect(msg).toContain("31 / 40 generated · 1 failed · 1 remaining");
    expect(msg).toContain("5 Tyler-protected");
    expect(msg).toContain("2 already-sent skipped.");
    expect(msg).toContain("1 non-current skipped.");
    expect(msg).toContain("Morning Generate All targeted 40.");
    expect(msg).toContain("Pat: sol_failed");
  });

  it("Resume button label and confirm when resumeAvailable", () => {
    expect(
      ttoGenerateAllButtonLabel({
        slot: "morning",
        draftForDayKey: "2026-08-07",
        isBusy: false,
        resumeAvailable: true,
      })
    ).toBe(`Resume Morning Generation for ${formatTtoGenerateAllDayLabel("2026-08-07")}`);
    expect(
      ttoGenerateAllButtonLabel({
        slot: "evening_checkin",
        draftForDayKey: "2026-08-07",
        isBusy: false,
        resumeAvailable: true,
      })
    ).toBe(`Resume Evening Generation for ${formatTtoGenerateAllDayLabel("2026-08-07")}`);
    const copy = formatTtoGenerateAllConfirm({
      slot: "morning",
      draftForDayKey: "2026-08-07",
      audienceCount: 40,
      searchActive: false,
      resumeAvailable: true,
    });
    expect(copy).toContain("Resume Morning generation");
    expect(copy).toContain("Already-completed machine drafts");
    expect(ttoGenerateAllSessionStorageKey({ sendSlot: "morning", draftForDayKey: "2026-08-07" })).toBe(
      "tto-generate-all:morning:2026-08-07"
    );
  });
});

describe("morning bulk confirmation copy", () => {
  it("blank confirm states day, count, overwrite, and no-send", () => {
    const copy = formatMorningBulkBlankConfirm({
      draftForDayKey: "2026-07-04",
      currentDraftCount: 38,
    });
    expect(copy).toContain("38");
    expect(copy).toContain("2026-07-04");
    expect(copy).toContain("No Morning text will send");
    expect(copy).toContain("overwrites existing Tyler edits");
    expect(copy).toContain("Already-sent drafts are skipped");
    expect(copy).toContain("does not send");
  });

  it("apply confirm includes exact body and overwrite warning", () => {
    const body = "Happy Fourth of July! 🇺🇸";
    const copy = formatMorningBulkApplyConfirm({
      draftForDayKey: "2026-07-04",
      currentDraftCount: 38,
      body,
    });
    expect(copy).toContain("38");
    expect(copy).toContain("2026-07-04");
    expect(copy).toContain(body);
    expect(copy).toContain("overwrites existing Tyler edits");
    expect(copy).toContain("does not send it now");
  });

  it("result message reports partial failure truthfully", () => {
    const msg = formatMorningBulkResultMessage({
      updated: 31,
      skippedNonCurrent: 2,
      skippedMissing: 1,
      failed: [{ clerkUserId: "user_x", preferredName: "Pat", error: "draft_update_failed" }],
      textsSentByThisAction: 0,
    });
    expect(msg).toContain("31 Morning drafts updated.");
    expect(msg).toContain("2 already sent/skipped.");
    expect(msg).toContain("1 failed.");
    expect(msg).toContain("0 texts sent by this action.");
    expect(msg).toContain("Pat: draft_update_failed");
    expect(MORNING_BULK_ACTIONS_HEADING).toBe("Bulk Morning actions");
    expect(MORNING_BULK_SEARCH_WARNING).toContain("full selected-day Morning batch");
  });
});

describe("evening bulk confirmation copy", () => {
  it("blank confirm states day, overwrite, search, and no-send", () => {
    const copy = formatEveningBulkBlankConfirm({
      draftForDayKey: "2026-07-04",
      currentDraftCount: 12,
    });
    expect(copy).toContain("12");
    expect(copy).toContain("2026-07-04");
    expect(copy).toContain("Evening");
    expect(copy).toContain("Active search does not narrow");
    expect(copy).toContain("overwrites existing Tyler edits");
    expect(copy).toContain("does not send anything now");
  });

  it("apply confirm includes auto-send window and no-immediate-send", () => {
    const body = "Have a good evening.";
    const copy = formatEveningBulkApplyConfirm({
      draftForDayKey: "2026-07-04",
      currentDraftCount: 12,
      body,
    });
    expect(copy).toContain("12");
    expect(copy).toContain("2026-07-04");
    expect(copy).toContain(body);
    expect(copy).toContain("overwrites existing Tyler edits");
    expect(copy).toContain("does not send it now");
    expect(copy).toContain("7–9 PM local Evening window");
    expect(copy).toContain("Active search does not narrow");
  });

  it("result message and helpers are Evening-labeled", () => {
    const msg = formatEveningBulkResultMessage({
      updated: 10,
      skippedNonCurrent: 1,
      skippedMissing: 2,
      failed: [],
      textsSentByThisAction: 0,
    });
    expect(msg).toContain("10 Evening drafts updated.");
    expect(msg).toContain("0 texts sent by this action.");
    expect(EVENING_BULK_ACTIONS_HEADING).toBe("Bulk Evening actions");
    expect(EVENING_BULK_SEARCH_WARNING).toContain("full selected-day Evening batch");
    expect(ttoBulkSaveEndpoint("evening_checkin")).toBe(
      "/api/admin/tyler-text-overview/evening-bulk-save"
    );
    expect(ttoBulkSaveEndpoint("morning")).toBe(
      "/api/admin/tyler-text-overview/morning-bulk-save"
    );
  });
});

describe("morning TTO manifest freshness defaults", () => {
  it("defaults Morning selected day to Eastern tomorrow after 09:00 ET when URL has no day", () => {
    // 10:00 AM EDT Aug 5 2026
    const now = new Date("2026-08-05T14:00:00.000Z");
    expect(getTylerTextOverviewAdminLocalDayKey(now)).toBe("2026-08-05");
    expect(
      resolveMorningTtoInitialSelectedDayKey({ searchParamDayKey: null, now })
    ).toBe("2026-08-06");
    expect(
      resolveMorningTtoInitialSelectedDayKey({
        searchParamDayKey: "2026-08-01",
        now,
      })
    ).toBe("2026-08-01");
  });

  it("exports missing-draft and incomplete-manifest copy", () => {
    expect(MORNING_MISSING_DRAFT_BANNER).toContain("GENERATION INCOMPLETE");
    expect(MORNING_UNSAVED_COPY).toContain("not protecting the send yet");
    expect(TTO_MANIFEST_INCOMPLETE_BANNER).toContain("DO NOT TRUST THIS PAGE");
  });
});

describe("TTO admin default draft day (slot-aware ET)", () => {
  // Aug 7 2026 is EDT (UTC-4)
  const morningBefore = new Date("2026-08-07T12:59:59.000Z"); // 08:59:59 ET
  const morningAt = new Date("2026-08-07T13:00:00.000Z"); // 09:00:00 ET
  const morningLate = new Date("2026-08-07T15:36:00.000Z"); // 11:36 ET
  // July 9 2026 is EDT
  const eveningBefore = new Date("2026-07-10T00:59:59.000Z"); // 20:59:59 ET July 9
  const eveningAt = new Date("2026-07-10T01:00:00.000Z"); // 21:00:00 ET July 9
  const eveningLate = new Date("2026-07-10T03:00:00.000Z"); // 23:00 ET July 9
  // EST winter DST-safe representative (UTC-5)
  const morningBeforeEst = new Date("2026-01-15T13:59:59.000Z"); // 08:59:59 EST
  const morningAtEst = new Date("2026-01-15T14:00:00.000Z"); // 09:00:00 EST

  it("Morning 08:59:59 ET + no explicit day → today", () => {
    expect(resolveDefaultTtoAdminDraftDayKey({ slot: "morning", now: morningBefore })).toBe(
      "2026-08-07"
    );
    expect(
      resolveMorningTtoInitialSelectedDayKey({ searchParamDayKey: null, now: morningBefore })
    ).toBe("2026-08-07");
  });

  it("Morning 09:00:00 ET + no explicit day → tomorrow", () => {
    expect(resolveDefaultTtoAdminDraftDayKey({ slot: "morning", now: morningAt })).toBe(
      "2026-08-08"
    );
  });

  it("Morning 11:36 ET + no explicit day → tomorrow", () => {
    expect(resolveDefaultTtoAdminDraftDayKey({ slot: "morning", now: morningLate })).toBe(
      "2026-08-08"
    );
  });

  it("Evening 20:59:59 ET + no explicit day → today", () => {
    expect(
      resolveDefaultTtoAdminDraftDayKey({ slot: "evening_checkin", now: eveningBefore })
    ).toBe("2026-07-09");
  });

  it("Evening 21:00:00 ET + no explicit day → tomorrow", () => {
    expect(resolveDefaultTtoAdminDraftDayKey({ slot: "evening_checkin", now: eveningAt })).toBe(
      "2026-07-10"
    );
  });

  it("Evening 23:00 ET + no explicit day → tomorrow", () => {
    expect(
      resolveDefaultTtoAdminDraftDayKey({ slot: "evening_checkin", now: eveningLate })
    ).toBe("2026-07-10");
  });

  it("Morning 11:36 ET + explicit today → today", () => {
    expect(
      resolveMorningTtoInitialSelectedDayKey({
        searchParamDayKey: "2026-08-07",
        now: morningLate,
      })
    ).toBe("2026-08-07");
  });

  it("Evening 21:30 ET + explicit today → today", () => {
    const eveningExplicit = new Date("2026-07-10T01:30:00.000Z"); // 21:30 ET July 9
    expect(
      resolveEveningTtoInitialSelectedDayKey({
        searchParamDayKey: "2026-07-09",
        now: eveningExplicit,
      })
    ).toBe("2026-07-09");
  });

  it("explicit tomorrow remains tomorrow", () => {
    expect(
      resolveMorningTtoInitialSelectedDayKey({
        searchParamDayKey: "2026-08-08",
        now: morningBefore,
      })
    ).toBe("2026-08-08");
    expect(
      resolveEveningTtoInitialSelectedDayKey({
        searchParamDayKey: "2026-07-10",
        now: eveningBefore,
      })
    ).toBe("2026-07-10");
  });

  it("explicit historical day remains explicit historical day", () => {
    expect(
      resolveMorningTtoInitialSelectedDayKey({
        searchParamDayKey: "2026-08-01",
        now: morningLate,
      })
    ).toBe("2026-08-01");
    expect(
      resolveEveningTtoInitialSelectedDayKey({
        searchParamDayKey: "2026-07-01",
        now: eveningAt,
      })
    ).toBe("2026-07-01");
  });

  it("Morning button reflects tomorrow after 9 AM ET when no explicit day", () => {
    const day = resolveMorningTtoInitialSelectedDayKey({
      searchParamDayKey: null,
      now: morningLate,
    });
    expect(
      ttoGenerateAllButtonLabel({ slot: "morning", draftForDayKey: day, isBusy: false })
    ).toBe(`Generate Morning for ${formatTtoGenerateAllDayLabel("2026-08-08")}`);
  });

  it("Evening button reflects tomorrow after 9 PM ET when no explicit day", () => {
    const day = resolveEveningTtoInitialSelectedDayKey({
      searchParamDayKey: null,
      now: eveningAt,
    });
    expect(
      ttoGenerateAllButtonLabel({
        slot: "evening_checkin",
        draftForDayKey: day,
        isBusy: false,
      })
    ).toBe(`Generate Evening for ${formatTtoGenerateAllDayLabel("2026-07-10")}`);
  });

  it("Morning before 9 AM still shows today on Generate All button", () => {
    const day = resolveMorningTtoInitialSelectedDayKey({
      searchParamDayKey: null,
      now: morningBefore,
    });
    expect(
      ttoGenerateAllButtonLabel({ slot: "morning", draftForDayKey: day, isBusy: false })
    ).toBe(`Generate Morning for ${formatTtoGenerateAllDayLabel("2026-08-07")}`);
  });

  it("Evening before 9 PM still shows today on Generate All button", () => {
    const day = resolveEveningTtoInitialSelectedDayKey({
      searchParamDayKey: null,
      now: eveningBefore,
    });
    expect(
      ttoGenerateAllButtonLabel({
        slot: "evening_checkin",
        draftForDayKey: day,
        isBusy: false,
      })
    ).toBe(`Generate Evening for ${formatTtoGenerateAllDayLabel("2026-07-09")}`);
  });

  it("DST-safe: EST winter Morning boundary uses Eastern wall clock", () => {
    expect(getTylerTextOverviewAdminLocalDayKey(morningBeforeEst)).toBe("2026-01-15");
    expect(resolveDefaultTtoAdminDraftDayKey({ slot: "morning", now: morningBeforeEst })).toBe(
      "2026-01-15"
    );
    expect(resolveDefaultTtoAdminDraftDayKey({ slot: "morning", now: morningAtEst })).toBe(
      "2026-01-16"
    );
  });

  it("dashboard initializes selected day once; refresh/search do not recompute default", () => {
    const dashboard = readFileSync(
      join(process.cwd(), "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx"),
      "utf8"
    );
    expect(dashboard).toMatch(
      /useState<string>\(\(\) => \{\s*const fromUrl = searchParams\.get\("draft_for_day_key"\)/
    );
    expect(dashboard).toContain("resolveMorningTtoInitialSelectedDayKey");
    expect(dashboard).toContain("resolveEveningTtoInitialSelectedDayKey");
    // Refresh paths consume selectedDayKey state — not a fresh clock default.
    expect(dashboard).toContain("void load(selectedDayKey, sendSlot, { forceOverwrite: true })");
    expect(dashboard).toContain("void load(selectedDayKey, sendSlot, { preserveUnsaved: true })");
    expect(dashboard).toContain("await load(selectedDayKey, sendSlot, { forceOverwrite: true })");
    // Search is independent of selected day.
    expect(dashboard).toContain('onChange={(e) => setSearchQuery(e.target.value)}');
    expect(dashboard).not.toMatch(/setSelectedDayKey\([^)]*resolveDefault/);
    expect(dashboard).not.toMatch(/setSelectedDayKey\([^)]*resolveMorningTtoInitial/);
    expect(dashboard).not.toMatch(/setSelectedDayKey\([^)]*resolveEveningTtoInitial/);
    // Manual day change is the only selected-day setter besides initializer.
    expect(dashboard).toContain("setSelectedDayKey(nextDay)");
  });
});
