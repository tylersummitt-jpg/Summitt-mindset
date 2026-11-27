import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { scheduledDailyBodyAuthorization } from "@/lib/tto-scheduled-generate";
import {
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";

const sendSms = vi.hoisted(() => vi.fn());
const query = vi.hoisted(() => {
  function week(friday: number | null) {
    return {
      monday: null,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday,
      saturday: null,
      sunday: null,
    };
  }
  const preferences = [
    {
      clerk_user_id: "user_pacific",
      weekly_schedule: week(420),
      schedule_timezone: "America/Los_Angeles",
      pause_indefinite: false,
      pause_until: null,
      cadence_override: null,
      weekend_send_policy: null,
    },
    {
      clerk_user_id: "user_eastern",
      weekly_schedule: week(420),
      schedule_timezone: "America/New_York",
      pause_indefinite: false,
      pause_until: null,
      cadence_override: null,
      weekend_send_policy: null,
    },
  ];
  function payload(table: string, filters: Record<string, unknown>) {
    if (table === "v2_user_sms_comms_preferences") {
      const ids = filters.clerk_user_id;
      const rows = preferences.filter((row) =>
        Array.isArray(ids) ? ids.includes(row.clerk_user_id) : row.clerk_user_id === ids
      );
      return Array.isArray(ids)
        ? { data: rows, error: null }
        : { data: rows[0] ?? null, error: null };
    }
    if (table === "sms_identities") {
      return {
        data: {
          clerk_user_id: filters.clerk_user_id,
          phone_number: "+15555550100",
          sms_enabled: true,
          stopped_at: null,
        },
        error: null,
      };
    }
    if (table === "sms_audience") {
      return {
        data: {
          phone_number: "+15555550100",
          sms_enabled: true,
          stopped_at: null,
          timezone: "America/Los_Angeles",
          summitt_subscribed: true,
        },
        error: null,
      };
    }
    return { data: null, error: null };
  }
  return function query(table: string) {
    const filters: Record<string, unknown> = {};
    const self = {
      select() {
        return self;
      },
      eq(column: string, value: unknown) {
        filters[column] = value;
        return self;
      },
      in(column: string, value: unknown) {
        filters[column] = value;
        return self;
      },
      maybeSingle() {
        return self;
      },
      order() {
        return self;
      },
      limit() {
        return self;
      },
      then(
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown
      ) {
        return Promise.resolve(payload(table, filters)).then(resolve, reject);
      },
    };
    return self;
  };
});

vi.mock("@/lib/twilio", () => ({
  isTwilioReady: () => false,
  sendSMS: sendSms,
}));

vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  evaluateOutboundSmsForAccountDeletion: async () => ({ decision: "allowed" }),
  isAccountDeletionOutboundSmsError: () => false,
}));

vi.mock("@/lib/has-awaiting-manual-pat-answer", () => ({
  hasAwaitingManualPatAnswer: async () => false,
}));

vi.mock("@/lib/sms-opt-out-review-hold", () => ({
  hasAwaitingSmsOptOutReview: async () => false,
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => query(table),
  },
}));

const TEN_AM_EASTERN = new Date("2026-11-27T15:00:00.000Z");
const SEVEN_AM_EASTERN = new Date("2026-11-27T12:00:00.000Z");
const LIVE = {
  utcInstant: "2026-11-27T15:00:00.000Z",
  effectiveLocalMinute: 420,
  timeZone: "America/Los_Angeles",
  memberLocalDate: "2026-11-27",
  owner: "evening",
};

function authorizedMetadata(utc = LIVE.utcInstant) {
  return {
    scheduled_generation_convention: "member_local_delivery_v1",
    tto_owner: "evening",
    input_evidence: {
      goal_text: "Keep the promise",
      delivery: {
        utc_instant: utc,
        member_local_date: "2026-11-27",
        effective_local_minute: 420,
        time_zone: "America/Los_Angeles",
      },
    },
  };
}

describe("evening owner versus evening_checkin slot", () => {
  beforeEach(() => {
    sendSms.mockClear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TEN_AM_EASTERN);
  });

  it("includes a 7 AM Pacific member in the Evening due list at 10 AM Eastern and excludes that member from Morning", async () => {
    const { orderPotentiallyDueMembers, deliverScheduledDailyCoaching } = await import(
      "@/lib/tyler-text-overview-send"
    );
    const members = [
      { clerkUserId: "user_pacific", audienceTimezone: "America/Los_Angeles" },
      { clerkUserId: "user_eastern", audienceTimezone: "America/New_York" },
    ];
    const eveningDue = await orderPotentiallyDueMembers({
      members,
      sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      now: TEN_AM_EASTERN,
    });
    const morningDue = await orderPotentiallyDueMembers({
      members,
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      now: TEN_AM_EASTERN,
    });
    expect(eveningDue).toContain("user_pacific");
    expect(eveningDue).not.toContain("user_eastern");
    expect(morningDue).not.toContain("user_pacific");

    const morningAtSeven = await orderPotentiallyDueMembers({
      members,
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      now: SEVEN_AM_EASTERN,
    });
    const eveningAtSeven = await orderPotentiallyDueMembers({
      members,
      sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      now: SEVEN_AM_EASTERN,
    });
    expect(morningAtSeven).toContain("user_eastern");
    expect(eveningAtSeven).not.toContain("user_eastern");
    expect(eveningAtSeven).not.toContain("user_pacific");

    const eveningPrepared = await deliverScheduledDailyCoaching({
      clerkUserId: "user_pacific",
      sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
    });
    const morningPrepared = await deliverScheduledDailyCoaching({
      clerkUserId: "user_pacific",
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
    });
    const crossOwner = await deliverScheduledDailyCoaching({
      clerkUserId: "user_eastern",
      sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
    });
    expect(eveningPrepared).toMatchObject({ outcome: "deferred", reason: "missing_draft" });
    expect(morningPrepared).toMatchObject({ outcome: "not_this_owner", reason: "evening" });
    expect(crossOwner).toMatchObject({ outcome: "not_this_owner", reason: "morning" });
    expect(sendSms).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("sends an authorized nonblank evening body and keeps intentional space silent", () => {
    const shared = {
      now: new Date("2026-11-27T15:05:00.000Z"),
      live: LIVE,
      messageRequiredToday: false,
      currentGoal: "Keep the promise",
      goalReadOk: true,
      conversation: "same" as const,
      retrievalOk: true,
    };
    expect(scheduledDailyBodyAuthorization({
      ...shared,
      occurrenceState: "generated",
      draft: {
        generationId: "gen-cari",
        body: "Cari text",
        bodyHash: "hash-cari",
        bodySource: "machine",
        editedByTyler: false,
        editedAt: null,
      },
      machineShouldSend: true,
      machineNoSendReason: null,
      metadata: authorizedMetadata(),
    })).toEqual({ action: "send", body: "Cari text" });
    expect(scheduledDailyBodyAuthorization({
      ...shared,
      occurrenceState: "intentional_space",
      draft: {
        generationId: "gen-klinester",
        body: null,
        bodyHash: null,
        bodySource: "machine",
        editedByTyler: false,
        editedAt: null,
      },
      machineShouldSend: false,
      machineNoSendReason: "intentional_space",
      metadata: authorizedMetadata(),
    })).toEqual({ action: "silence", reason: "intentional_space" });
    expect(scheduledDailyBodyAuthorization({
      ...shared,
      occurrenceState: "generated",
      draft: {
        generationId: "gen-stale",
        body: "Old text",
        bodyHash: "hash-old",
        bodySource: "machine",
        editedByTyler: false,
        editedAt: null,
      },
      machineShouldSend: true,
      machineNoSendReason: null,
      metadata: authorizedMetadata("2026-11-26T15:00:00.000Z"),
    })).toEqual({ action: "hold", reason: "body_not_authorized" });
    expect(scheduledDailyBodyAuthorization({
      ...shared,
      occurrenceState: "generated",
      draft: {
        generationId: null,
        body: "Cari text",
        bodyHash: "hash-cari",
        bodySource: "machine",
        editedByTyler: false,
        editedAt: null,
      },
      machineShouldSend: true,
      machineNoSendReason: null,
      metadata: authorizedMetadata(),
    })).toEqual({ action: "hold", reason: "missing_draft" });
  });

  it("compares administrative owners with send slots in the delivery and dashboard paths", () => {
    const admin = readFileSync(join(process.cwd(), "src/lib/tyler-text-overview-admin.ts"), "utf8");
    const scheduler = readFileSync(join(process.cwd(), "src/lib/tto-scheduled-generate.ts"), "utf8");
    const send = readFileSync(join(process.cwd(), "src/lib/tyler-text-overview-send.ts"), "utf8");
    const match = admin.slice(
      admin.indexOf("export function scheduledDraftMatchesOccurrence"),
      admin.indexOf("export function scheduledDraftBelongsToAnotherBatch")
    );
    const preview = scheduler.slice(
      scheduler.indexOf("export async function readCompletedScheduledPreview"),
      scheduler.indexOf("function productionDeps")
    );
    const prepare = send.slice(
      send.indexOf("async function prepareScheduledDailyDelivery"),
      send.indexOf("export async function orderPotentiallyDueMembers")
    );
    const due = send.slice(
      send.indexOf("export async function orderPotentiallyDueMembers"),
      send.indexOf("export async function deliverScheduledDailyCoaching")
    );
    const recovery = scheduler.slice(
      scheduler.indexOf("const movedOrClosed = batches.some"),
      scheduler.indexOf("if (!movedOrClosed) continue")
    );
    for (const body of [match, preview, prepare, due]) {
      expect(body).toContain("proactiveOwnerForSendSlot");
    }
    expect(match).not.toContain("metadata.tto_owner !== args.sendSlot");
    expect(preview).not.toContain("metadata.tto_owner !== args.sendSlot");
    expect(prepare).not.toContain("resolved.owner !== args.sendSlot");
    expect(due).not.toContain("resolved.owner !== args.sendSlot");
    expect(recovery).toContain("proactiveSendSlotForOwner(resolved.owner)");
    expect(recovery).not.toContain("batch.sendSlot !== resolved.owner");
    expect(scheduler).toContain("function reconsiderationRecoveryAction");
  });
});
