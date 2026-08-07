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
  resolveSiblingLinkDraftForDayKey,
  resolveTylerTextOverviewRootRedirectPath,
  rowStateLabel,
  shouldShowEveningNonTodayWarning,
  ttoBulkSaveEndpoint,
  ttoGenerateAllButtonLabel,
  ttoGenerateAllEndpoint,
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
  const eveningNow = new Date("2026-07-10T01:00:00.000Z"); // 9 PM ET July 9
  const todayEt = "2026-07-09";
  const tomorrowEt = "2026-07-10";

  it("admin local day key is Eastern calendar day", () => {
    expect(getTylerTextOverviewAdminLocalDayKey(eveningNow)).toBe(todayEt);
  });

  it("Evening with no draft_for_day_key defaults to admin-local today", () => {
    expect(
      resolveEveningTtoInitialSelectedDayKey({
        searchParamDayKey: null,
        now: eveningNow,
      })
    ).toBe(todayEt);
    expect(
      resolveEveningTtoInitialSelectedDayKey({
        searchParamDayKey: "",
        now: eveningNow,
      })
    ).toBe(todayEt);
  });

  it("Evening with explicit draft_for_day_key respects it", () => {
    expect(
      resolveEveningTtoInitialSelectedDayKey({
        searchParamDayKey: tomorrowEt,
        now: eveningNow,
      })
    ).toBe(tomorrowEt);
  });

  it("non-today warning when selected day is not admin-local today", () => {
    expect(shouldShowEveningNonTodayWarning(tomorrowEt, eveningNow)).toBe(true);
    expect(shouldShowEveningNonTodayWarning(todayEt, eveningNow)).toBe(false);
    expect(shouldShowEveningNonTodayWarning("", eveningNow)).toBe(true);
  });

  it("Morning → Evening sibling link drops tomorrow morning day", () => {
    expect(
      resolveSiblingLinkDraftForDayKey({
        page: "evening",
        draftForDayKey: tomorrowEt,
        now: eveningNow,
      })
    ).toBeUndefined();
    expect(
      buildSiblingTylerTextOverviewPageHref({
        page: "evening",
        draftForDayKey: tomorrowEt,
        now: eveningNow,
      })
    ).toBe("/admin/tyler-text-overview/evening");
  });

  it("Morning → Evening sibling link keeps same-day key", () => {
    expect(
      buildSiblingTylerTextOverviewPageHref({
        page: "evening",
        draftForDayKey: todayEt,
        now: eveningNow,
      })
    ).toBe(`/admin/tyler-text-overview/evening?draft_for_day_key=${todayEt}`);
  });

  it("Evening → Morning sibling link still preserves day", () => {
    expect(
      buildSiblingTylerTextOverviewPageHref({
        page: "morning",
        draftForDayKey: tomorrowEt,
        now: eveningNow,
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

  it("evening defaults selected day to admin-local today and warns on non-today", () => {
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
      generated: 31,
      protectedTylerAuthority: 5,
      skippedAlreadySent: 2,
      skippedNonCurrent: 1,
      failed: [{ clerkUserId: "user_x", preferredName: "Pat", error: "sol_failed" }],
    });
    expect(msg).toContain("31 Morning drafts generated.");
    expect(msg).toContain("5 Tyler-protected");
    expect(msg).toContain("2 already-sent skipped.");
    expect(msg).toContain("1 non-current skipped.");
    expect(msg).toContain("1 failed.");
    expect(msg).toContain("40 targeted.");
    expect(msg).toContain("Pat: sol_failed");
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
  it("defaults Morning selected day to Eastern today when URL has no day", () => {
    const now = new Date("2026-08-05T14:00:00.000Z");
    expect(
      resolveMorningTtoInitialSelectedDayKey({ searchParamDayKey: null, now })
    ).toBe(getTylerTextOverviewAdminLocalDayKey(now));
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
