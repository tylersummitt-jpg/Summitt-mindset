import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { resolveTylerTextOverviewWeeklyPeriod } from "@/lib/tyler-text-overview-weekly-period";
import { getWeekKey } from "@/lib/weekly-sms-week-key";
import {
  WEEKLY_TTO_AUTHORITY_BANNER,
  WEEKLY_TTO_NEXT_CUTOVER_COPY,
  formatWeeklyGenerateSuccessToast,
  weeklyGenerateButtonLabel,
  resolveTylerTextOverviewRootRedirectPath,
  rowStateLabel,
} from "@/lib/tyler-text-overview-dashboard-copy";
import {
  parseSmsDailySendSlot,
  SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
  SMS_DAILY_SEND_SLOTS,
} from "@/lib/tyler-text-overview-types";
import {
  WEEKLY_TTO_DRAFT_EXCLUDES_COMPLIANCE_FOOTER,
  WEEKLY_TTO_WRITER_PROMPT_PATH,
} from "@/lib/tyler-text-overview-weekly-period";

const REPO = process.cwd();

describe("weekly_review send_slot types", () => {
  it("includes weekly_review in SMS_DAILY_SEND_SLOTS", () => {
    expect(SMS_DAILY_SEND_SLOTS).toContain("weekly_review");
  });

  it("parseSmsDailySendSlot preserves weekly_review and rejects unknown", () => {
    expect(parseSmsDailySendSlot("weekly_review")).toBe("weekly_review");
    expect(parseSmsDailySendSlot("morning")).toBe("morning");
    expect(parseSmsDailySendSlot("evening_checkin")).toBe("evening_checkin");
    expect(parseSmsDailySendSlot("bogus")).toBeNull();
    expect(parseSmsDailySendSlot(undefined)).toBeNull();
  });

  it("admin list resolve preserves weekly_review in source", () => {
    const adminSrc = readFileSync(join(REPO, "src/lib/tyler-text-overview-admin.ts"), "utf8");
    expect(adminSrc).toContain("parseSmsDailySendSlot");
    expect(adminSrc).toContain("mapDbSendSlotToAdminDto");
    expect(adminSrc).toMatch(/function resolveAdminListSendSlot/);
  });
});

describe("weekly period / week_key", () => {
  it("uses getWeekKey and Sunday week_end as draft_for_day_key", () => {
    const now = new Date("2026-07-12T19:00:00.000Z");
    const period = resolveTylerTextOverviewWeeklyPeriod({
      now,
      timezone: "America/New_York",
    });
    const localNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    expect(period.weekKey).toBe(getWeekKey(localNow));
    expect(period.draftForDayKey).toBe(period.weekEnd);
    expect(period.weekAnchorRule).toBe("user_local_sunday_week_end");
    expect(period.weekStart).toBe("2026-07-06");
    expect(period.weekEnd).toBe("2026-07-12");
  });
});

describe("weekly generate isolation (static)", () => {
  const weeklyGenerate = readFileSync(
    join(REPO, "src/lib/tyler-text-overview-weekly-generate.ts"),
    "utf8"
  );
  const weeklyRoute = readFileSync(
    join(REPO, "src/app/api/admin/tyler-text-overview/weekly-generate/route.ts"),
    "utf8"
  );
  const weeklyDash = readFileSync(
    join(REPO, "src/app/admin/tyler-text-overview/tyler-text-overview-weekly-dashboard.tsx"),
    "utf8"
  );
  const weeklyPage = readFileSync(
    join(REPO, "src/app/admin/tyler-text-overview/weekly/page.tsx"),
    "utf8"
  );

  it("does not call sendSMS or Twilio", () => {
    for (const src of [weeklyGenerate, weeklyRoute, weeklyDash, weeklyPage]) {
      expect(src).not.toMatch(/\bsendSMS\b/);
      expect(src).not.toMatch(/from ["']@\/lib\/twilio["']/);
    }
  });

  it("does not write sms_weekly_send_events or sms_send_events", () => {
    for (const src of [weeklyGenerate, weeklyRoute]) {
      expect(src).not.toContain("sms_weekly_send_events");
      expect(src).not.toContain('from("sms_send_events")');
    }
  });

  it("does not write check_sent / v2 commitment events", () => {
    for (const src of [weeklyGenerate, weeklyRoute]) {
      expect(src).not.toContain("check_sent");
      expect(src).not.toContain("v2_commitment_event");
      expect(src).not.toContain("onV2StandardCheckSent");
    }
  });

  it("excludes compliance footer from draft body by design", () => {
    expect(WEEKLY_TTO_DRAFT_EXCLUDES_COMPLIANCE_FOOTER).toBe(true);
    expect(weeklyGenerate).toContain("draft_excludes_compliance_footer");
  });

  it("stores weekly writer prompt path constant", () => {
    expect(WEEKLY_TTO_WRITER_PROMPT_PATH).toBe("v3_weekly_relationship_lane");
  });
});

describe("weekly page / copy", () => {
  it("weekly page exists", () => {
    expect(
      existsSync(join(REPO, "src/app/admin/tyler-text-overview/weekly/page.tsx"))
    ).toBe(true);
  });

  it("banner and next-cutover copy required", () => {
    expect(WEEKLY_TTO_AUTHORITY_BANNER).toContain("does not send yet");
    expect(WEEKLY_TTO_AUTHORITY_BANNER).toContain("/api/cron/weekly-sms");
    expect(WEEKLY_TTO_NEXT_CUTOVER_COPY).toContain("manual one-row weekly send");
    const dash = readFileSync(
      join(REPO, "src/app/admin/tyler-text-overview/tyler-text-overview-weekly-dashboard.tsx"),
      "utf8"
    );
    expect(dash).toContain("WEEKLY_TTO_AUTHORITY_BANNER");
    expect(dash).toContain("WEEKLY_TTO_NEXT_CUTOVER_COPY");
  });

  it("has no Send Weekly Text button", () => {
    const dash = readFileSync(
      join(REPO, "src/app/admin/tyler-text-overview/tyler-text-overview-weekly-dashboard.tsx"),
      "utf8"
    );
    expect(dash).not.toContain("Send Weekly Text");
    expect(dash).not.toContain("weekly-send");
  });

  it("weekly generate labels are weekly-specific", () => {
    expect(weeklyGenerateButtonLabel({ isGenerating: false, hasDraft: false })).toBe(
      "Generate Weekly Draft"
    );
    expect(weeklyGenerateButtonLabel({ isGenerating: false, hasDraft: true })).toBe(
      "Regenerate Weekly Draft"
    );
    expect(
      formatWeeklyGenerateSuccessToast({
        machineShouldSend: true,
        machineDraftBody: "hello",
        weekKey: "2026-W28",
      })
    ).toContain("2026-W28");
  });

  it("row labels for weekly_review", () => {
    expect(rowStateLabel("no_draft_yet", SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT)).toBe(
      "No weekly draft"
    );
    expect(rowStateLabel("draft_current", SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT)).toBe(
      "Current weekly draft"
    );
  });

  it("root redirect accepts weekly_review", () => {
    expect(
      resolveTylerTextOverviewRootRedirectPath({ send_slot: "weekly_review" })
    ).toBe("/admin/tyler-text-overview/weekly");
  });
});

describe("weekly slice does not touch forbidden paths", () => {
  it("weekly-sms cron route unchanged by this feature (still exists, no TTO import)", () => {
    const src = readFileSync(join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    expect(src).not.toContain("tyler-text-overview-weekly");
    expect(src).not.toContain("weekly_review");
    expect(src).toContain("produceWeeklyV3RelationshipSms");
  });

  it("vercel.json still schedules weekly-sms and was not rewritten for TTO send", () => {
    const vercel = readFileSync(join(REPO, "vercel.json"), "utf8");
    expect(vercel).toContain("/api/cron/weekly-sms");
    expect(vercel).not.toContain("weekly-tto-send");
  });
});
