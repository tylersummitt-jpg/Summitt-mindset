import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  adminCountLabel,
  buildSiblingTylerTextOverviewPageHref,
  EVENING_TTO_NO_PREVIEW_COPY,
  MORNING_TTO_AUTHORITY_BANNER,
  resolveTylerTextOverviewRootRedirectPath,
  rowStateLabel,
} from "@/lib/tyler-text-overview-dashboard-copy";
import {
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";

describe("tyler-text-overview-dashboard-copy rowStateLabel", () => {
  it("uses morning labels", () => {
    expect(rowStateLabel("no_draft_yet", SMS_DAILY_PRODUCTION_SEND_SLOT)).toBe("No morning draft");
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
    expect(adminCountLabel("noDraftYet", SMS_DAILY_PRODUCTION_SEND_SLOT)).toBe("No morning draft");
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

describe("tyler-text-overview-dashboard-copy routing helpers", () => {
  it("buildSiblingTylerTextOverviewPageHref preserves draft_for_day_key only", () => {
    expect(
      buildSiblingTylerTextOverviewPageHref({
        page: "evening",
        draftForDayKey: "2026-07-09",
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
      resolveTylerTextOverviewRootRedirectPath({
        send_slot: "evening_checkin",
        draft_for_day_key: "2026-07-09",
        search: "alice",
      })
    ).toBe("/admin/tyler-text-overview/evening?draft_for_day_key=2026-07-09&q=alice");
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
    expect(dashboard).toContain("Evening Text Overview →");
  });

  it("evening dashboard keeps manual send controls and cross-link", () => {
    expect(dashboard).toContain("EVENING_TTO_MANUAL_BANNER");
    expect(dashboard).toContain("Generate Evening Preview");
    expect(dashboard).toContain("Regenerate Evening Preview");
    expect(dashboard).toContain("Send Evening Text");
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
});
