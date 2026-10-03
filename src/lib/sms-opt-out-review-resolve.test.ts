import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const updateClerkPublicMetadata = vi.hoisted(() => vi.fn(async () => undefined));
const syncSmsAudience = vi.hoisted(() => vi.fn(async () => undefined));
const buildRecentExactThread72h = vi.hoisted(() => vi.fn());
const fetchV2UserSmsCommsPreferences = vi.hoisted(() => vi.fn());
const getClerkPublicMetadata = vi.hoisted(() =>
  vi.fn(async () => ({ timezone: "America/New_York" }))
);

type Job = {
  message_sid: string;
  clerk_user_id: string;
  from_phone: string;
  raw_body: string;
  status: string;
  created_at: string;
};

type Identity = {
  phone_number: string;
  sms_enabled: boolean;
  stopped_at: string | null;
};

type Audience = {
  clerk_user_id: string;
  sms_enabled: boolean;
  stopped_at: string | null;
};

const db = vi.hoisted(() => ({
  jobs: [] as Job[],
  profiles: [] as Array<{ clerk_user_id: string; preferred_name: string | null }>,
  identities: [] as Identity[],
  audience: [] as Audience[],
  tables: [] as string[],
  jobCloseError: null as { message: string } | null,
  identityUpdateError: null as { message: string } | null,
  order: [] as string[],
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/clerk-public-metadata", () => ({
  updateClerkPublicMetadata,
}));

vi.mock("@/lib/sms-audience-sync", () => ({
  syncSmsAudience,
}));

vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata,
}));

vi.mock("@/lib/sms-recent-exact-thread-72h", () => ({
  buildRecentExactThread72h,
}));

vi.mock("@/lib/v2-sms-comms-preferences", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-sms-comms-preferences")>();
  return {
    ...actual,
    fetchV2UserSmsCommsPreferences,
  };
});

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      db.tables.push(table);
      const state: {
        op: "select" | "update";
        patch: Record<string, unknown> | null;
        filters: Record<string, unknown>;
        inIds: string[] | null;
      } = { op: "select", patch: null, filters: {}, inIds: null };

      const rowsFor = () => {
        if (table === "sms_inbound_coach_jobs") return db.jobs;
        if (table === "sms_identities") return db.identities;
        if (table === "sms_audience") return db.audience;
        if (table === "user_profiles") {
          return db.profiles.filter(
            (p) => !state.inIds || state.inIds.includes(p.clerk_user_id)
          );
        }
        throw new Error(`unexpected table ${table}`);
      };

      const matches = (row: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(state.filters)) {
          if (row[key] !== value) return false;
        }
        return true;
      };

      const execute = (single: boolean) => {
        if (table === "sms_daily_drafts") {
          throw new Error("review queue must not read drafts");
        }
        if (state.op === "update") {
          if (table === "sms_identities" && db.identityUpdateError) {
            return { data: null, error: db.identityUpdateError };
          }
          if (table === "sms_inbound_coach_jobs" && db.jobCloseError && state.patch?.status) {
            return { data: null, error: db.jobCloseError };
          }
          const list = rowsFor() as Array<Record<string, unknown>>;
          const matched = list.filter((row) => matches(row));
          for (const row of matched) Object.assign(row, state.patch);
          if (table === "sms_identities") db.order.push("identity");
          if (table === "sms_inbound_coach_jobs" && state.patch?.status) db.order.push("close");
          const data = single ? matched[0] ?? null : matched;
          return { data, error: null };
        }
        const list = (rowsFor() as Array<Record<string, unknown>>).filter((row) => matches(row));
        if (table === "sms_inbound_coach_jobs") {
          list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        }
        return { data: single ? list[0] ?? null : list, error: null };
      };

      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (patch: Record<string, unknown>) => {
          state.op = "update";
          state.patch = patch;
          return builder;
        },
        eq: (key: string, value: unknown) => {
          state.filters[key] = value;
          return builder;
        },
        in: (_key: string, ids: string[]) => {
          state.inIds = ids;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => execute(true),
        then: (
          resolve: (value: { data: unknown; error: { message: string } | null }) => void,
          reject?: (reason: unknown) => void
        ) => Promise.resolve()
          .then(() => execute(false))
          .then(resolve, reject),
      };
      return builder;
    },
  },
}));

import {
  SMS_OPT_OUT_REVIEW_KEPT_STATUS,
  SMS_OPT_OUT_REVIEW_MEMBER_STARTED_STATUS,
  SMS_OPT_OUT_REVIEW_STOPPED_STATUS,
  closeOpenSmsOptOutReviewsAfterMemberStart,
  closeOpenSmsOptOutReviewsAfterMemberStop,
  keepSmsOptOutReviewTextsOn,
  listOpenSmsOptOutReviews,
  stopSmsOptOutReviewTexts,
} from "@/lib/sms-opt-out-review-resolve";

const RESOLVE_SRC = fs.readFileSync(
  path.join(process.cwd(), "src/lib/sms-opt-out-review-resolve.ts"),
  "utf8"
);
const CANONICAL_SRC = fs.readFileSync(
  path.join(process.cwd(), "src/lib/sms-canonical-stop.ts"),
  "utf8"
);
const ROUTE_SRC = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts"),
  "utf8"
);
const TWILIO_SRC = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/twilio/inbound/route.ts"),
  "utf8"
);

function seedOpenReview() {
  db.jobs.push({
    message_sid: "SMreview",
    clerk_user_id: "user_1",
    from_phone: "+15555550100",
    raw_body: "Please stop texting me.",
    status: "awaiting_sms_opt_out_review",
    created_at: "2026-10-03T12:00:00.000Z",
  });
  db.profiles.push({ clerk_user_id: "user_1", preferred_name: "Susie Smith" });
  db.identities.push({
    phone_number: "+15555550100",
    sms_enabled: true,
    stopped_at: null,
  });
  db.audience.push({
    clerk_user_id: "user_1",
    sms_enabled: true,
    stopped_at: null,
  });
}

describe("SMS opt-out review resolution", () => {
  beforeEach(() => {
    db.jobs = [];
    db.profiles = [];
    db.identities = [];
    db.audience = [];
    db.tables = [];
    db.jobCloseError = null;
    db.identityUpdateError = null;
    db.order = [];
    updateClerkPublicMetadata.mockReset();
    updateClerkPublicMetadata.mockImplementation(async () => {
      db.order.push("clerk");
    });
    syncSmsAudience.mockReset();
    syncSmsAudience.mockImplementation(async () => {
      db.order.push("sync");
      const row = db.audience[0];
      if (row) {
        row.sms_enabled = false;
        row.stopped_at = "2026-10-03T12:05:00.000Z";
      }
    });
    fetchV2UserSmsCommsPreferences.mockReset();
    fetchV2UserSmsCommsPreferences.mockResolvedValue({
      pause_until: "2026-10-06T12:00:00.000Z",
      cadence_override: "weekdays",
    });
    buildRecentExactThread72h.mockReset();
    buildRecentExactThread72h.mockResolvedValue({
      messages: [
        {
          role: "user",
          body: "Please stop texting me.",
          at: "2026-10-03T12:00:00.000Z",
          at_local: "8:00 AM",
        },
        {
          role: "user",
          body: "I meant the workout reminders.",
          at: "2026-10-03T12:10:00.000Z",
          at_local: "8:10 AM",
        },
      ],
    });
    seedOpenReview();
  });

  it("lists an open review with the live thread and no draft lookup", async () => {
    const rows = await listOpenSmsOptOutReviews();
    expect(db.tables).not.toContain("sms_daily_drafts");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.memberName).toBe("Susie Smith");
    expect(rows[0]?.triggeringText).toBe("Please stop texting me.");
    expect(rows[0]?.thread.map((line) => line.body)).toEqual([
      "Please stop texting me.",
      "I meant the workout reminders.",
    ]);
    expect(rows[0]?.laterInbound).toBe(true);
    expect(rows[0]?.textsAlreadyStopped).toBe(false);
    expect(rows[0]?.pauseStillActive).toBe(true);
    expect(rows[0]?.cadenceStillSet).toBe(true);
    expect(rows[0]?.latestInboundAt).toBe("2026-10-03T12:10:00.000Z");
  });

  it("shows canonical stop and a later exact STOP in the thread", async () => {
    db.identities[0]!.sms_enabled = false;
    db.identities[0]!.stopped_at = "2026-10-03T12:20:00.000Z";
    db.audience[0]!.sms_enabled = false;
    db.audience[0]!.stopped_at = "2026-10-03T12:20:00.000Z";
    buildRecentExactThread72h.mockResolvedValue({
      messages: [
        {
          role: "user",
          body: "Please stop texting me.",
          at: "2026-10-03T12:00:00.000Z",
          at_local: "8:00 AM",
        },
        {
          role: "user",
          body: "STOP",
          at: "2026-10-03T12:20:00.000Z",
          at_local: "8:20 AM",
        },
      ],
    });
    const rows = await listOpenSmsOptOutReviews();
    expect(rows[0]?.textsAlreadyStopped).toBe(true);
    expect(rows[0]?.exactStopAfterRequest).toBe(true);
  });

  it("KEEP closes the review and does not touch consent, pause, or cadence", async () => {
    const beforeIdentity = { ...db.identities[0]! };
    const beforeAudience = { ...db.audience[0]! };
    const result = await keepSmsOptOutReviewTextsOn({
      messageSid: "SMreview",
      latestInboundAt: "2026-10-03T12:10:00.000Z",
    });
    expect(result).toEqual({ ok: true, outcome: "kept" });
    expect(db.jobs[0]?.status).toBe(SMS_OPT_OUT_REVIEW_KEPT_STATUS);
    expect(db.identities[0]).toEqual(beforeIdentity);
    expect(db.audience[0]).toEqual(beforeAudience);
    expect(syncSmsAudience).not.toHaveBeenCalled();
    expect(updateClerkPublicMetadata).not.toHaveBeenCalled();
    expect(RESOLVE_SRC).not.toContain("runStartFlow");
    expect(RESOLVE_SRC).not.toContain("clearCommsPreferencesOnSmsResume");
    expect(RESOLVE_SRC).not.toContain("pause_until");
    expect(RESOLVE_SRC).not.toContain("sms_enabled: true");
  });

  it("KEEP a second time does nothing", async () => {
    await keepSmsOptOutReviewTextsOn({
      messageSid: "SMreview",
      latestInboundAt: "2026-10-03T12:10:00.000Z",
    });
    const result = await keepSmsOptOutReviewTextsOn({
      messageSid: "SMreview",
      latestInboundAt: "2026-10-03T12:10:00.000Z",
    });
    expect(result).toEqual({ ok: true, outcome: "already_resolved" });
    expect(db.jobs[0]?.status).toBe(SMS_OPT_OUT_REVIEW_KEPT_STATUS);
    expect(syncSmsAudience).not.toHaveBeenCalled();
  });

  it("KEEP after a real STOP does not turn texts back on", async () => {
    db.identities[0]!.sms_enabled = false;
    db.identities[0]!.stopped_at = "2026-10-03T12:20:00.000Z";
    db.audience[0]!.sms_enabled = false;
    db.audience[0]!.stopped_at = "2026-10-03T12:20:00.000Z";
    const result = await keepSmsOptOutReviewTextsOn({
      messageSid: "SMreview",
      latestInboundAt: "2026-10-03T12:10:00.000Z",
    });
    expect(result).toEqual({ ok: true, outcome: "texts_already_stopped" });
    expect(db.jobs[0]?.status).toBe(SMS_OPT_OUT_REVIEW_STOPPED_STATUS);
    expect(db.identities[0]?.sms_enabled).toBe(false);
    expect(db.identities[0]?.stopped_at).toBe("2026-10-03T12:20:00.000Z");
    expect(db.audience[0]?.sms_enabled).toBe(false);
    expect(syncSmsAudience).not.toHaveBeenCalled();
    expect(updateClerkPublicMetadata).not.toHaveBeenCalled();
  });

  it("STOP TEXTS uses canonical stop, verifies, then closes", async () => {
    const result = await stopSmsOptOutReviewTexts({
      messageSid: "SMreview",
      latestInboundAt: "2026-10-03T12:10:00.000Z",
    });
    expect(result).toEqual({ ok: true, outcome: "stopped" });
    expect(db.order).toEqual(["identity", "clerk", "sync", "close"]);
    expect(db.jobs[0]?.status).toBe(SMS_OPT_OUT_REVIEW_STOPPED_STATUS);
    expect(db.identities[0]?.sms_enabled).toBe(false);
    expect(typeof db.identities[0]?.stopped_at).toBe("string");
    expect(db.audience[0]?.sms_enabled).toBe(false);
    expect(CANONICAL_SRC).toContain('from("sms_identities")');
    expect(CANONICAL_SRC).toContain("updateClerkPublicMetadata");
    expect(CANONICAL_SRC).toContain("syncSmsAudience");
    expect(TWILIO_SRC).toContain("applyCanonicalSmsStop");
  });

  it("leaves the review open when stop verification fails", async () => {
    syncSmsAudience.mockImplementation(async () => {
      db.order.push("sync");
    });
    const result = await stopSmsOptOutReviewTexts({
      messageSid: "SMreview",
      latestInboundAt: "2026-10-03T12:10:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.outcome).toBe("stop_not_verified");
    expect(db.jobs[0]?.status).toBe("awaiting_sms_opt_out_review");
    expect(db.order).not.toContain("close");
  });

  it("leaves texts stopped when the review close fails after a real stop", async () => {
    db.jobCloseError = { message: "close failed" };
    const result = await stopSmsOptOutReviewTexts({
      messageSid: "SMreview",
      latestInboundAt: "2026-10-03T12:10:00.000Z",
    });
    expect(result).toEqual({ ok: true, outcome: "stopped" });
    expect(db.jobs[0]?.status).toBe("awaiting_sms_opt_out_review");
    expect(db.identities[0]?.sms_enabled).toBe(false);
    expect(db.audience[0]?.sms_enabled).toBe(false);
  });

  it("a second STOP click does not stop again", async () => {
    await stopSmsOptOutReviewTexts({
      messageSid: "SMreview",
      latestInboundAt: "2026-10-03T12:10:00.000Z",
    });
    syncSmsAudience.mockClear();
    const result = await stopSmsOptOutReviewTexts({
      messageSid: "SMreview",
      latestInboundAt: "2026-10-03T12:10:00.000Z",
    });
    expect(result).toEqual({ ok: true, outcome: "already_resolved" });
    expect(syncSmsAudience).not.toHaveBeenCalled();
  });

  it("refuses a stale thread before changing anything", async () => {
    const result = await stopSmsOptOutReviewTexts({
      messageSid: "SMreview",
      latestInboundAt: "2026-10-03T12:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.outcome).toBe("stale_thread");
    expect(result.card?.thread[1]?.body).toBe("I meant the workout reminders.");
    expect(db.jobs[0]?.status).toBe("awaiting_sms_opt_out_review");
    expect(syncSmsAudience).not.toHaveBeenCalled();
  });

  it("exact STOP closes open reviews without living inside runStopFlow", async () => {
    await closeOpenSmsOptOutReviewsAfterMemberStop("user_1");
    expect(db.jobs[0]?.status).toBe(SMS_OPT_OUT_REVIEW_STOPPED_STATUS);
    const stopFn = TWILIO_SRC.slice(
      TWILIO_SRC.indexOf("async function runStopFlow"),
      TWILIO_SRC.indexOf("async function runStartFlow")
    );
    expect(stopFn).not.toContain("closeOpenSmsOptOutReviewsAfterMemberStop");
    expect(TWILIO_SRC).toContain(
      'return twiml("You have been unsubscribed. Reply START to rejoin.")'
    );
  });

  it("exact START cleanup is separate and does not add consent writes", async () => {
    await closeOpenSmsOptOutReviewsAfterMemberStart("user_1");
    expect(db.jobs[0]?.status).toBe(SMS_OPT_OUT_REVIEW_MEMBER_STARTED_STATUS);
    expect(db.identities[0]?.sms_enabled).toBe(true);
    expect(db.identities[0]?.stopped_at).toBeNull();
    const startFn = TWILIO_SRC.slice(
      TWILIO_SRC.indexOf("async function runStartFlow"),
      TWILIO_SRC.indexOf("export async function POST")
    );
    expect(startFn).toContain("clearCommsPreferencesOnSmsResume");
    expect(startFn).not.toContain("closeOpenSmsOptOutReviewsAfterMemberStart");
    expect(RESOLVE_SRC).not.toContain("clearCommsPreferencesOnSmsResume");
  });

  it("resolved statuses are not worker-claimable", () => {
    const claim = ROUTE_SRC.slice(
      ROUTE_SRC.indexOf('.in("status", ["pending", "failed", "reply_ready"])'),
      ROUTE_SRC.indexOf('.in("status", ["pending", "failed", "reply_ready"])') + 80
    );
    expect(claim).not.toContain("sms_opt_out_review_kept");
    expect(claim).not.toContain("sms_opt_out_review_stopped");
    expect(claim).not.toContain("sms_opt_out_review_member_started");
    expect(ROUTE_SRC).not.toContain('from "resend"');
    const notify = ROUTE_SRC.indexOf("await notifySmsOptOutReviewNeeded");
    const acknowledged = ROUTE_SRC.indexOf('ack.outcome === "acknowledged"');
    expect(notify).toBeGreaterThan(acknowledged);
  });
});
