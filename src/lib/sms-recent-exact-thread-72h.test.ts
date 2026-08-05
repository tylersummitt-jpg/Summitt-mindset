import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFrom = vi.hoisted(() => vi.fn());
const getRecentV2EventsForAi = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: supabaseFrom },
}));

vi.mock("@/lib/v2-commitment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-commitment")>();
  return {
    ...actual,
    getRecentV2EventsForAi,
  };
});

import {
  bodyFromSendEventRow,
  bodyFromWeeklySendEventRow,
  buildRecentExactThread72h,
  buildRecentExactThreadForBrief,
  BRIEF_THREAD_MAX_CHARS,
  BRIEF_THREAD_MAX_MESSAGES,
  capThreadMessagesForBrief,
  capThreadMessagesForBriefWithTelemetry,
  createdAtFirstTimestampFromSendEventRow,
  deriveBriefThreadWindowTelemetry,
  filterWriterFacingExactThreadMessages,
  formatAtLocal,
  isSendEventTrulySent,
  isWriterFacingExactThreadMessage,
  RECENT_EXACT_THREAD_WINDOW_HOURS,
  SCHEMA_ADAPTIVE_FALLBACK_LIMIT,
  EXACT_THREAD_SOURCE_ORDER_BY,
  SMS_SEND_EVENTS_THREAD_SELECT,
  SMS_WEEKLY_SEND_EVENTS_THREAD_SELECT,
  timestampFromInboundMessageRow,
  timestampFromSendEventRow,
  type RecentExactThread72hMessage,
} from "@/lib/sms-recent-exact-thread-72h";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractCoachBodiesFromBriefThread } from "@/lib/sms-recent-coach-body-anti-repeat";
import { deriveFreshnessAvoidPhrasesForBrief } from "@/lib/sms-daily-fresh-move";

const NOW = new Date("2026-05-18T12:00:00.000Z");
const TZ = "America/Chicago";

function chain(rows: unknown[] | unknown | null) {
  const result = { data: rows, error: null };
  const builder = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    not: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve(Array.isArray(rows) ? { data: rows[0] ?? null, error: null } : result),
    then: (resolve: (v: typeof result) => void) => resolve(result),
  };
  return builder;
}

type SchemaAdaptiveTableConfig = {
  /** @deprecated Primary path uses select("*") first; kept for safety-net fallback tests. */
  failPreferredWith42703?: boolean;
  /** All select("*") queries fail. */
  failAll?: boolean;
  /** First select("*") fails with unexpected error; second succeeds (safety net). */
  failPrimaryOnce?: boolean;
  fallbackRows?: unknown[];
  preferredRows?: unknown[];
};

function adaptiveChain(
  config: SchemaAdaptiveTableConfig,
  opts?: { starCallCountRef?: { count: number } }
) {
  let selectCols = "";
  const err42703 = { data: null, error: { code: "42703", message: "column does not exist" } };
  const errUnexpected = { data: null, error: { code: "500", message: "unexpected primary failure" } };
  const builder = {
    select: (cols: string) => {
      selectCols = cols;
      return builder;
    },
    eq: () => builder,
    gte: () => builder,
    not: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => {
      if (config.failAll) return Promise.resolve(err42703);
      if (selectCols === "*") {
        if (opts?.starCallCountRef) opts.starCallCountRef.count += 1;
        const starCallCount = opts?.starCallCountRef?.count ?? 1;
        if (config.failPrimaryOnce && starCallCount === 1) {
          return Promise.resolve(errUnexpected);
        }
        const row = config.fallbackRows?.[0] ?? null;
        return Promise.resolve({ data: row, error: null });
      }
      if (config.failPreferredWith42703) return Promise.resolve(err42703);
      const row = config.preferredRows?.[0] ?? config.fallbackRows?.[0] ?? null;
      return Promise.resolve({ data: row, error: null });
    },
    then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
      if (config.failAll) {
        resolve(err42703);
        return;
      }
      if (selectCols === "*") {
        if (opts?.starCallCountRef) opts.starCallCountRef.count += 1;
        const starCallCount = opts?.starCallCountRef?.count ?? 1;
        if (config.failPrimaryOnce && starCallCount === 1) {
          resolve(errUnexpected);
          return;
        }
        resolve({ data: config.fallbackRows ?? [], error: null });
        return;
      }
      if (config.failPreferredWith42703) {
        resolve(err42703);
        return;
      }
      resolve({ data: config.preferredRows ?? config.fallbackRows ?? [], error: null });
    },
  };
  return builder;
}

function setupSchemaAdaptiveSupabase(tables: Record<string, SchemaAdaptiveTableConfig | undefined>) {
  const starCallCounts = new Map<string, { count: number }>();
  supabaseFrom.mockImplementation((table: string) => {
    const cfg = tables[table];
    if (cfg) {
      if (!starCallCounts.has(table)) {
        starCallCounts.set(table, { count: 0 });
      }
      return adaptiveChain(cfg, { starCallCountRef: starCallCounts.get(table)! });
    }
    return chain([]);
  });
}

function setupSupabaseTables(args: {
  sendRows?: unknown[];
  weeklyRows?: unknown[];
  jobRows?: unknown[];
  inboundMsgRows?: unknown[];
  lastCtx?: unknown | null;
}) {
  supabaseFrom.mockImplementation((table: string) => {
    switch (table) {
      case "sms_send_events":
        return chain(args.sendRows ?? []);
      case "sms_weekly_send_events":
        return chain(args.weeklyRows ?? []);
      case "sms_inbound_coach_jobs":
        return chain(args.jobRows ?? []);
      case "sms_inbound_messages":
        return chain(args.inboundMsgRows ?? []);
      case "sms_last_outbound_context":
        return chain(args.lastCtx ?? null);
      default:
        return chain([]);
    }
  });
}

describe("isSendEventTrulySent", () => {
  it("accepts strong delivery evidence and rejects reserved/skipped", () => {
    expect(
      isSendEventTrulySent({ status: "sent", sent_at: "2026-06-21T10:00:00.000Z", sms_body: "Hi" })
    ).toBe(true);
    expect(isSendEventTrulySent({ status: "sent", message_sid: "SM1", sms_body: "Hi" })).toBe(true);
    expect(isSendEventTrulySent({ status: "sent", sms_body: "Hi" })).toBe(false);
    expect(isSendEventTrulySent({ status: "reserved", sms_body: "Hi" })).toBe(false);
    expect(isSendEventTrulySent({ status: "skipped_no_safe_v3_voice", sms_body: "Hi" })).toBe(false);
    expect(isSendEventTrulySent({ status: "reserved", message_sid: "SM1", sms_body: "Hi" })).toBe(false);
  });

  it("accepts accepted rows with message_sid and metadata-only body paths", () => {
    expect(
      isSendEventTrulySent({
        status: "accepted",
        message_sid: "SM_ACCEPTED",
        metadata: { daily_v3_lane: { final_body: "Visible coach body" } },
      })
    ).toBe(true);
    expect(
      bodyFromSendEventRow({
        status: "accepted",
        metadata: { voice_send_decision: { body_preview: "Legacy preview body" } },
      })
    ).toBe("Legacy preview body");
    expect(
      bodyFromSendEventRow({
        status: "accepted",
        message_sid: "SM_NS",
        metadata: { north_star_gate: { final_body: "North star final body for thread." } },
      })
    ).toBe("North star final body for thread.");
  });

  it("rejects queued/accepted/sending/twilio_send_attempted without SID", () => {
    expect(isSendEventTrulySent({ status: "queued", sms_body: "Hi" })).toBe(false);
    expect(isSendEventTrulySent({ status: "accepted", sms_body: "Hi" })).toBe(false);
    expect(isSendEventTrulySent({ status: "sending", sms_body: "Hi" })).toBe(false);
    expect(
      isSendEventTrulySent({
        status: "reserved",
        sms_body: "Hi",
        metadata: { twilio_send_attempted: true },
      })
    ).toBe(false);
    expect(
      isSendEventTrulySent({
        sms_body: "Hi",
        metadata: { twilio_send_attempted: true },
      })
    ).toBe(false);
  });

  it("rejects explicit no-send and cancelled rows", () => {
    expect(
      isSendEventTrulySent({
        status: "sent",
        sms_body: "Hi",
        metadata: { note: "daily_v3_lane_no_send" },
      })
    ).toBe(false);
    expect(isSendEventTrulySent({ status: "cancelled", sms_body: "Hi" })).toBe(false);
  });

  it("rejects dry_run and preview statuses", () => {
    expect(isSendEventTrulySent({ status: "dry_run", sms_body: "Hi", message_sid: "SM1" })).toBe(
      false
    );
    expect(isSendEventTrulySent({ status: "preview", sms_body: "Hi" })).toBe(false);
  });
});

describe("timestampFromSendEventRow", () => {
  it("uses sent_at when created_at is missing", () => {
    const ts = timestampFromSendEventRow({ sent_at: "2026-06-21T10:00:00.000Z" });
    expect(ts).toBe(new Date("2026-06-21T10:00:00.000Z").getTime());
  });

  it("prefers sent_at over stale created_at when both exist", () => {
    const row = {
      created_at: "2026-06-10T10:00:00.000Z",
      sent_at: "2026-06-21T14:00:00.000Z",
    };
    expect(timestampFromSendEventRow(row)).toBe(new Date("2026-06-21T14:00:00.000Z").getTime());
    expect(createdAtFirstTimestampFromSendEventRow(row)).toBe(
      new Date("2026-06-10T10:00:00.000Z").getTime()
    );
  });

  it("prefers updated_at over stale created_at for sent-like rows without sent_at", () => {
    const row = {
      status: "accepted",
      message_sid: "SM_UPDATED",
      metadata: { note: "sent_to_twilio" },
      created_at: "2026-06-10T08:00:00.000Z",
      updated_at: "2026-06-21T14:00:00.000Z",
    };
    expect(timestampFromSendEventRow(row)).toBe(new Date("2026-06-21T14:00:00.000Z").getTime());
  });

  it("does not prefer updated_at for non-sent reserved rows", () => {
    const row = {
      status: "reserved",
      created_at: "2026-06-10T08:00:00.000Z",
      updated_at: "2026-06-21T14:00:00.000Z",
    };
    expect(timestampFromSendEventRow(row)).toBe(new Date("2026-06-10T08:00:00.000Z").getTime());
  });

  it("processed_at wins over created_at when sent_at is missing", () => {
    const row = {
      processed_at: "2026-06-21T12:00:00.000Z",
      created_at: "2026-06-10T08:00:00.000Z",
      status: "accepted",
      message_sid: "SM_PROC",
    };
    expect(timestampFromSendEventRow(row)).toBe(new Date("2026-06-21T12:00:00.000Z").getTime());
  });
});

describe("timestampFromInboundMessageRow", () => {
  it("prefers received_at over created_at", () => {
    const ts = timestampFromInboundMessageRow({
      received_at: "2026-06-22T09:00:00.000Z",
      created_at: "2026-06-20T09:00:00.000Z",
    });
    expect(ts).toBe(new Date("2026-06-22T09:00:00.000Z").getTime());
  });
});

describe("isWriterFacingExactThreadMessage / filterWriterFacingExactThreadMessages", () => {
  function msg(
    partial: Partial<RecentExactThread72hMessage> &
      Pick<RecentExactThread72hMessage, "role" | "body" | "source_table" | "delivery_status">
  ): RecentExactThread72hMessage {
    return {
      at: "2026-05-18T11:00:00.000Z",
      at_local: "May 18, 6:00 AM",
      at_local_timezone: TZ,
      local_day_key: "2026-05-18",
      message_kind: null,
      message_sid: null,
      is_exact_body: true,
      ...partial,
    };
  }

  it("A: excludes sms_last_outbound_context / is_fallback_context from writer-facing projection", () => {
    const fallback = msg({
      role: "coach",
      body: "Fallback last outbound pretending to be thread",
      source_table: "sms_last_outbound_context",
      delivery_status: "sent",
      is_fallback_context: true,
      message_sid: "SM_FALLBACK",
    });
    const flagged = msg({
      role: "coach",
      body: "Flagged fallback without last_outbound table",
      source_table: "sms_send_events",
      delivery_status: "sent",
      is_fallback_context: true,
      message_sid: "SM_FLAG",
    });
    expect(isWriterFacingExactThreadMessage(fallback)).toBe(false);
    expect(isWriterFacingExactThreadMessage(flagged)).toBe(false);
    expect(filterWriterFacingExactThreadMessages([fallback, flagged])).toEqual([]);
  });

  it("B: excludes delivery_status preview / check_sent preview from writer-facing projection", () => {
    const preview = msg({
      role: "coach",
      body: "ORPHAN_PREVIEW_ONLY",
      source_table: "v2_events",
      delivery_status: "preview",
      is_exact_body: false,
    });
    expect(isWriterFacingExactThreadMessage(preview)).toBe(false);
    expect(filterWriterFacingExactThreadMessages([preview])).toEqual([]);
  });

  it("keeps strongly evidenced coach sent + user inbound", () => {
    const coach = msg({
      role: "coach",
      body: "Real sent coach SMS",
      source_table: "sms_send_events",
      delivery_status: "sent",
      message_sid: "SM_REAL",
      delivery_evidence: "message_sid_present",
    });
    const user = msg({
      role: "user",
      body: "Real user SMS",
      source_table: "sms_inbound_messages",
      delivery_status: "sent",
      message_sid: "SM_USER",
      delivery_evidence: "inbound_received",
    });
    expect(filterWriterFacingExactThreadMessages([coach, user])).toEqual([coach, user]);
  });
});

describe("buildRecentExactThread72h", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecentV2EventsForAi.mockResolvedValue([]);
  });

  it("includes user inbound and coach outbound from last 72h with timestamps", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          sms_body: "Daily check: did you get your two hours in?",
          created_at: "2026-05-18T11:00:00.000Z",
          status: "sent",
          message_sid: "SM_OUT_1",
        },
      ],
      jobRows: [
        {
          raw_body: "Sunday School, farm, songs Mother sang",
          reply_body: "Beautiful memories — keep going.",
          status: "sent",
          sent_at: "2026-05-18T11:30:00.000Z",
          created_at: "2026-05-18T11:29:00.000Z",
          updated_at: "2026-05-18T11:31:00.000Z",
          message_sid: "SM_IN_1",
          outbound_message_sid: "SM_REPLY_1",
        },
      ],
    });

    const result = await buildRecentExactThread72h({
      clerkUserId: "user_1",
      timezone: TZ,
      now: NOW,
    });

    expect(result.window_hours).toBe(RECENT_EXACT_THREAD_WINDOW_HOURS);
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
    expect(result.messages[0]?.at).toBeTruthy();
    expect(result.messages[0]?.at_local).toBeTruthy();
    expect(result.messages[0]?.at_local_timezone).toBe(TZ);
    expect(result.messages.some((m) => m.role === "user" && m.body.includes("Sunday School"))).toBe(true);
    expect(result.messages.some((m) => m.role === "coach" && m.is_exact_body)).toBe(true);
    expect(result.messages.every((m, i, arr) => i === 0 || arr[i - 1]!.at <= m.at)).toBe(true);
  });

  it("excludes messages older than 7 days", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          sms_body: "Old daily",
          created_at: "2026-05-01T11:00:00.000Z",
          status: "sent",
          message_sid: "SM_OLD",
        },
        {
          sms_body: "Recent daily",
          created_at: "2026-05-18T11:00:00.000Z",
          status: "sent",
          message_sid: "SM_RECENT",
        },
      ],
    });

    const result = await buildRecentExactThread72h({
      clerkUserId: "user_1",
      timezone: TZ,
      now: NOW,
      path: "inbound",
    });

    expect(result.messages.some((m) => m.body.includes("Old daily"))).toBe(false);
    expect(result.messages.some((m) => m.body.includes("Recent daily"))).toBe(true);
    expect(result.window_hours).toBe(168);
  });

  it("A: daily/inbound path includes messages older than 72h within 7d", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          sms_body: "FOUR_DAY_OLD_WITHIN_7D",
          created_at: "2026-05-14T12:00:00.000Z",
          status: "sent",
          message_sid: "SM_4D",
          sent_at: "2026-05-14T12:00:00.000Z",
        },
      ],
    });

    const result = await buildRecentExactThread72h({
      clerkUserId: "user_1",
      timezone: TZ,
      now: NOW,
      path: "daily",
    });

    expect(result.window_hours).toBe(168);
    expect(result.messages.some((m) => m.body.includes("FOUR_DAY_OLD_WITHIN_7D"))).toBe(true);
  });

  it("C: weekly path includes messages older than 72h within 10d", async () => {
    setupSupabaseTables({
      weeklyRows: [
        {
          sms_body: "EIGHT_DAY_OLD_WEEKLY",
          created_at: "2026-05-10T12:00:00.000Z",
          status: "sent",
          message_sid: "SM_8D_WEEKLY",
          sent_at: "2026-05-10T12:00:00.000Z",
        },
      ],
    });

    const result = await buildRecentExactThread72h({
      clerkUserId: "user_1",
      timezone: TZ,
      now: NOW,
      path: "weekly",
    });

    expect(result.window_hours).toBe(240);
    expect(result.messages.some((m) => m.body.includes("EIGHT_DAY_OLD_WEEKLY"))).toBe(true);
  });

  it("prefers exact sent coach body over check_sent preview", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          sms_body: "FULL_DAILY_BODY_" + "x".repeat(80),
          created_at: "2026-05-18T10:00:00.000Z",
          status: "sent",
          message_sid: "SM_FULL",
        },
      ],
    });
    getRecentV2EventsForAi.mockResolvedValue([
      {
        event_type: "check_sent",
        occurred_at: "2026-05-18T10:00:01.000Z",
        payload_json: { body_preview: "SHORT_PREVIEW_ONLY" },
      },
    ]);

    const result = await buildRecentExactThread72h({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
      timezone: TZ,
      now: NOW,
    });

    expect(result.messages.some((m) => m.body.includes("FULL_DAILY_BODY"))).toBe(true);
    expect(result.messages.some((m) => m.body === "SHORT_PREVIEW_ONLY")).toBe(false);
  });

  it("excludes orphan check_sent preview from writer-facing 72h messages", async () => {
    setupSupabaseTables({});
    getRecentV2EventsForAi.mockResolvedValue([
      {
        event_type: "check_sent",
        occurred_at: "2026-05-18T10:00:00.000Z",
        payload_json: { body_preview: "ORPHAN_PREVIEW_ONLY" },
      },
    ]);

    const result = await buildRecentExactThread72h({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
      timezone: TZ,
      now: NOW,
    });

    expect(result.messages.some((m) => m.body.includes("ORPHAN_PREVIEW"))).toBe(false);
    expect(result.had_preview_messages).toBe(true);
  });

  it("C/D weekly packet path: excludes fallback/preview but keeps real sent weekly/daily/inbound", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          sms_body: "REAL_DAILY_SENT_BODY",
          created_at: "2026-05-18T10:00:00.000Z",
          status: "sent",
          message_sid: "SM_DAILY_REAL",
        },
      ],
      weeklyRows: [
        {
          sms_body: "REAL_WEEKLY_SENT_BODY",
          created_at: "2026-05-17T18:00:00.000Z",
          status: "sent",
          message_sid: "SM_WEEKLY_REAL",
        },
      ],
      inboundMsgRows: [
        {
          raw_body: "REAL_USER_INBOUND_BODY",
          received_at: "2026-05-18T11:00:00.000Z",
          message_sid: "SM_USER_REAL",
        },
      ],
      lastCtx: {
        full_body: "FALLBACK_LAST_OUTBOUND_BODY",
        sent_at: "2026-05-18T09:00:00.000Z",
        message_kind: "question",
      },
    });
    getRecentV2EventsForAi.mockResolvedValue([
      {
        event_type: "check_sent",
        occurred_at: "2026-05-18T10:30:00.000Z",
        payload_json: { body_preview: "CHECK_SENT_PREVIEW_ONLY" },
      },
    ]);

    const result = await buildRecentExactThread72h({
      clerkUserId: "user_weekly_align",
      commitmentId: "cmt_1",
      timezone: TZ,
      now: NOW,
    });

    expect(result.messages.some((m) => /FALLBACK_LAST_OUTBOUND|CHECK_SENT_PREVIEW/i.test(m.body))).toBe(
      false
    );
    expect(result.messages.some((m) => m.source_table === "sms_last_outbound_context")).toBe(false);
    expect(result.messages.some((m) => m.delivery_status === "preview")).toBe(false);
    expect(result.messages.some((m) => m.body.includes("REAL_DAILY_SENT_BODY"))).toBe(true);
    expect(result.messages.some((m) => m.body.includes("REAL_WEEKLY_SENT_BODY"))).toBe(true);
    expect(result.messages.some((m) => m.body.includes("REAL_USER_INBOUND_BODY"))).toBe(true);
  });

  it("I: draft tables are never queried for 72h writer-facing thread", async () => {
    const queried: string[] = [];
    supabaseFrom.mockImplementation((table: string) => {
      queried.push(table);
      return chain([]);
    });

    await buildRecentExactThread72h({
      clerkUserId: "user_no_drafts",
      timezone: TZ,
      now: NOW,
    });

    expect(queried).not.toContain("sms_daily_drafts");
    expect(queried).not.toContain("sms_daily_draft_generations");
    expect(queried.some((t) => /draft/i.test(t))).toBe(false);
  });

  it("does not include skipped/reserved sms_send_events as coach messages by default", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          sms_body: "Never sent draft",
          created_at: "2026-05-18T11:00:00.000Z",
          status: "skipped_no_safe_v3_voice",
        },
        {
          sms_body: "Reserved slot",
          created_at: "2026-05-18T11:05:00.000Z",
          status: "reserved",
        },
      ],
    });

    const result = await buildRecentExactThread72h({
      clerkUserId: "user_1",
      timezone: TZ,
      now: NOW,
      includeSystemNoSend: false,
    });

    expect(result.messages).toHaveLength(0);
    expect(result.had_system_no_send).toBe(false);
  });

  it("dedupes duplicate message_sid", async () => {
    setupSupabaseTables({
      inboundMsgRows: [
        {
          raw_body: "Same text",
          created_at: "2026-05-18T11:00:00.000Z",
          message_sid: "SM_DUP",
        },
        {
          raw_body: "Same text",
          created_at: "2026-05-18T11:00:01.000Z",
          message_sid: "SM_DUP",
        },
      ],
    });

    const result = await buildRecentExactThread72h({
      clerkUserId: "user_1",
      timezone: TZ,
      now: NOW,
    });

    expect(result.messages.filter((m) => m.message_sid === "SM_DUP")).toHaveLength(1);
  });

  it("dedupes duplicate user from coach jobs and inbound messages", async () => {
    setupSupabaseTables({
      jobRows: [
        {
          raw_body: "Duplicate user line here",
          created_at: "2026-05-18T11:00:00.000Z",
          updated_at: "2026-05-18T11:00:00.000Z",
          message_sid: "SM_JOB",
        },
      ],
      inboundMsgRows: [
        {
          raw_body: "Duplicate user line here",
          created_at: "2026-05-18T11:00:02.000Z",
          message_sid: "SM_ARCH",
        },
      ],
    });

    const result = await buildRecentExactThread72h({
      clerkUserId: "user_1",
      timezone: TZ,
      now: NOW,
    });

    expect(result.messages.filter((m) => m.role === "user" && /Duplicate user/i.test(m.body))).toHaveLength(1);
    expect(result.messages[0]?.source_table).toBe("sms_inbound_coach_jobs");
  });

  it("formats at_local using provided timezone", () => {
    const local = formatAtLocal(new Date("2026-05-18T15:00:00.000Z"), TZ);
    expect(local).toMatch(/May/);
    expect(local.length).toBeGreaterThan(5);
  });

  it("toOutputMessage includes local_day_key", async () => {
    const { buildRecentExactThread72h } = await import("@/lib/sms-recent-exact-thread-72h");
    const result = await buildRecentExactThread72h({
      clerkUserId: "user_tz",
      timezone: TZ,
      now: new Date("2026-06-02T12:00:00.000Z"),
    });
    for (const m of result.messages) {
      expect(m.local_day_key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("capThreadMessagesForBrief", () => {
  function msg(
    partial: Partial<RecentExactThread72hMessage> & Pick<RecentExactThread72hMessage, "at" | "role" | "body">
  ): RecentExactThread72hMessage {
    return {
      at_local: partial.at_local ?? "Sun Jun 20 9:00 AM",
      at_local_timezone: TZ,
      local_day_key: "2026-06-20",
      message_kind: null,
      source_table: "test",
      message_sid: null,
      delivery_status: partial.delivery_status ?? "sent",
      is_exact_body: partial.is_exact_body ?? true,
      ...partial,
    };
  }

  it("includes Thursday coach CTA on Sunday when in extension window", () => {
    const nowMs = new Date("2026-06-20T14:00:00.000Z").getTime();
    const thursday = new Date("2026-06-17T13:02:00.000Z").toISOString();
    const messages = [
      msg({
        at: thursday,
        at_local: "Thu Jun 17 8:02 AM",
        role: "coach",
        body: "Aim for one hour of distribution today.",
      }),
    ];
    const capped = capThreadMessagesForBrief(messages, nowMs);
    expect(capped.some((m) => /one hour of distribution/i.test(m.body))).toBe(true);
  });

  it("excludes preview and no-send from writer brief thread", () => {
    const nowMs = Date.now();
    const messages = [
      msg({
        at: new Date(nowMs - 3600_000).toISOString(),
        role: "coach",
        body: "Preview only",
        delivery_status: "preview",
        is_exact_body: false,
      }),
      msg({
        at: new Date(nowMs - 7200_000).toISOString(),
        role: "system_no_send" as never,
        body: "Skipped candidate",
        delivery_status: "skipped",
        is_exact_body: false,
      }),
      msg({
        at: new Date(nowMs - 1800_000).toISOString(),
        role: "user",
        body: "Yes got it done.",
      }),
    ];
    const capped = capThreadMessagesForBrief(messages, nowMs);
    expect(capped).toHaveLength(1);
    expect(capped[0]?.role).toBe("user");
  });

  it("floor over 25 returns exactly 25 newest floor messages in chronological order", () => {
    const nowMs = new Date("2026-06-22T12:00:00.000Z").getTime();
    const floorStart = nowMs - 60 * 60 * 1000;
    const messages: RecentExactThread72hMessage[] = [];
    for (let i = 0; i < 28; i++) {
      messages.push(
        msg({
          at: new Date(floorStart + i * 60_000).toISOString(),
          at_local: `Jun 22 ${i}`,
          role: i % 2 === 0 ? "coach" : "user",
          body: `Floor message ${i}`,
        })
      );
    }
    const capped = capThreadMessagesForBriefWithTelemetry(messages, nowMs);
    expect(capped.messages).toHaveLength(BRIEF_THREAD_MAX_MESSAGES);
    expect(capped.floor_message_count + capped.extension_message_count).toBe(BRIEF_THREAD_MAX_MESSAGES);
    expect(capped.messages[0]?.body).toBe("Floor message 3");
    expect(capped.messages[capped.messages.length - 1]?.body).toBe("Floor message 27");
  });

  it("7d floor includes older-than-72h messages and extension_message_count stays 0", () => {
    const nowMs = new Date("2026-06-22T12:00:00.000Z").getTime();
    const within7d = nowMs - 5 * 24 * 60 * 60 * 1000;
    const messages = [
      msg({
        at: new Date(within7d).toISOString(),
        role: "coach",
        body: "Thursday CTA within 7d",
        message_sid: "SM_THU",
      }),
      msg({
        at: new Date(nowMs - 24 * 60 * 60 * 1000).toISOString(),
        role: "user",
        body: "Recent user reply",
      }),
    ];
    const capped = capThreadMessagesForBriefWithTelemetry(messages, nowMs);
    expect(capped.messages.length).toBeLessThanOrEqual(BRIEF_THREAD_MAX_MESSAGES);
    expect(capped.extension_message_count).toBe(0);
    expect(capped.floor_message_count).toBe(2);
    expect(capped.messages.some((m) => /Thursday CTA/i.test(m.body))).toBe(true);
  });

  it("B/F: caps preserve newest messages when over message limit", () => {
    const nowMs = new Date("2026-06-22T12:00:00.000Z").getTime();
    const messages: RecentExactThread72hMessage[] = [];
    for (let i = 0; i < 30; i++) {
      messages.push(
        msg({
          at: new Date(nowMs - (30 - i) * 60_000).toISOString(),
          at_local: `msg ${i}`,
          role: i % 2 === 0 ? "coach" : "user",
          body: `Cap msg ${i}`,
          message_sid: i % 2 === 0 ? `SM_${i}` : null,
        })
      );
    }
    const capped = capThreadMessagesForBriefWithTelemetry(messages, nowMs);
    expect(capped.messages).toHaveLength(BRIEF_THREAD_MAX_MESSAGES);
    expect(capped.messages[0]?.body).toBe("Cap msg 5");
    expect(capped.messages.at(-1)?.body).toBe("Cap msg 29");
  });

  it("oldest/newest telemetry is monotonic and floor plus extension equals message count", () => {
    const nowMs = new Date("2026-06-22T12:00:00.000Z").getTime();
    const messages = [
      msg({
        at: new Date(nowMs - 5 * 24 * 60 * 60 * 1000).toISOString(),
        at_local: "Thu Jun 17 8:00 AM",
        role: "coach",
        body: "Older coach",
      }),
      msg({
        at: new Date(nowMs - 3600_000).toISOString(),
        at_local: "Sun Jun 22 7:00 AM",
        role: "user",
        body: "Newer user",
      }),
    ];
    const telemetry = deriveBriefThreadWindowTelemetry(messages, nowMs);
    const capped = capThreadMessagesForBriefWithTelemetry(messages, nowMs);
    expect(telemetry.daily_brief_thread_floor_message_count).toBe(capped.floor_message_count);
    expect(telemetry.daily_brief_thread_extension_message_count).toBe(capped.extension_message_count);
    expect(
      telemetry.daily_brief_thread_floor_message_count! +
        telemetry.daily_brief_thread_extension_message_count!
    ).toBe(capped.messages.length);
    expect(telemetry.daily_brief_thread_oldest_at_local).toBe("Thu Jun 17 8:00 AM");
    expect(telemetry.daily_brief_thread_newest_at_local).toBe("Sun Jun 22 7:00 AM");
  });
});

describe("buildRecentExactThreadForBrief visible send coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecentV2EventsForAi.mockResolvedValue([]);
  });

  it("includes accepted send with metadata-only body and sent_at without created_at", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          status: "accepted",
          message_sid: "SM_META_BODY",
          sent_at: "2026-06-21T14:00:00.000Z",
          metadata: { daily_v3_lane: { final_body: "June 21 distribution check-in body." } },
        },
      ],
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_june21",
      timezone: TZ,
      now: new Date("2026-06-22T12:00:00.000Z"),
    });

    expect(brief.message_count).toBeGreaterThanOrEqual(1);
    expect(brief.messages.some((m) => /June 21 distribution/i.test(m.body))).toBe(true);
    expect(brief.message_count).toBeLessThanOrEqual(BRIEF_THREAD_MAX_MESSAGES);
  });

  it("excludes preview check_sent and skipped no-send rows from writer thread", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          sms_body: "Skipped draft",
          created_at: "2026-06-22T11:00:00.000Z",
          status: "skipped_no_safe_v3_voice",
        },
      ],
    });
    getRecentV2EventsForAi.mockResolvedValue([
      {
        event_type: "check_sent",
        occurred_at: "2026-06-22T11:05:00.000Z",
        payload_json: { body_preview: "PREVIEW_ONLY_BODY" },
      },
    ]);

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_preview",
      commitmentId: "cmt_1",
      timezone: TZ,
      now: new Date("2026-06-22T12:00:00.000Z"),
    });

    expect(brief.messages.some((m) => /PREVIEW_ONLY/i.test(m.body))).toBe(false);
    expect(brief.timeline_7d.had_preview_messages).toBe(true);
  });

  it("includes row with stale created_at and recent sent_at in 7d brief thread", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          status: "sent",
          message_sid: "SM_STALE_CREATED",
          created_at: "2026-06-10T08:00:00.000Z",
          sent_at: "2026-06-21T14:00:00.000Z",
          sms_body: "Distribution check after delayed send reservation.",
        },
      ],
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_rescue",
      timezone: TZ,
      now: new Date("2026-06-22T12:00:00.000Z"),
    });

    expect(brief.message_count).toBeGreaterThanOrEqual(1);
    expect(brief.messages.some((m) => /Distribution check after delayed/i.test(m.body))).toBe(true);
    expect(brief.build_telemetry.daily_brief_thread_effective_timestamp_rescue_count).toBeGreaterThan(
      0
    );
    expect(brief.build_telemetry.daily_brief_thread_visible_send_candidate_count).toBeGreaterThan(0);
  });

  it("includes visible weekly row with metadata.north_star_gate.final_body", async () => {
    setupSupabaseTables({
      weeklyRows: [
        {
          status: "sent",
          message_sid: "SM_WEEKLY",
          sent_at: "2026-06-20T16:00:00.000Z",
          created_at: "2026-06-18T16:00:00.000Z",
          metadata: {
            north_star_gate: { final_body: "Weekly Pat Pause — take a breath this Sunday." },
          },
        },
      ],
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_weekly",
      timezone: TZ,
      now: new Date("2026-06-22T12:00:00.000Z"),
    });

    expect(brief.messages.some((m) => /Weekly Pat Pause/i.test(m.body))).toBe(true);
    expect(brief.build_telemetry.daily_brief_thread_weekly_candidate_count).toBe(1);
    expect(bodyFromWeeklySendEventRow({
      metadata: { north_star_gate: { final_body: "Weekly Pat Pause — take a breath this Sunday." } },
    })).toMatch(/Weekly Pat Pause/i);
  });

  it("excludes skipped weekly no-send row", async () => {
    setupSupabaseTables({
      weeklyRows: [
        {
          status: "skipped_no_safe_v3_voice",
          sent_at: "2026-06-20T16:00:00.000Z",
          metadata: { north_star_gate: { final_body: "Should not appear" } },
        },
      ],
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_weekly_skip",
      timezone: TZ,
      now: new Date("2026-06-22T12:00:00.000Z"),
    });

    expect(brief.messages.some((m) => /Should not appear/i.test(m.body))).toBe(false);
    expect(brief.build_telemetry.daily_brief_thread_filtered_out_count).toBeGreaterThan(0);
  });

  it("prefers received_at for inbound user message in brief thread", async () => {
    setupSupabaseTables({
      inboundMsgRows: [
        {
          raw_body: "Got the hour in last night.",
          created_at: "2026-06-14T10:00:00.000Z",
          received_at: "2026-06-21T22:00:00.000Z",
          message_sid: "SM_IN_REC",
        },
      ],
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_in_rec",
      timezone: TZ,
      now: new Date("2026-06-22T12:00:00.000Z"),
    });

    expect(brief.messages.some((m) => m.role === "user" && /Got the hour/i.test(m.body))).toBe(true);
    expect(brief.build_telemetry.daily_brief_thread_user_inbound_candidate_count).toBe(1);
  });

  it("freshness coach pool includes prior visible coach from brief thread", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          status: "sent",
          message_sid: "SM_CTA",
          sent_at: "2026-06-21T10:00:00.000Z",
          sms_body: "Aim for one hour of distribution work today before noon.",
        },
      ],
    });

    const now = new Date("2026-06-22T12:00:00.000Z");
    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_fresh",
      timezone: TZ,
      now,
    });
    const coachBodies = extractCoachBodiesFromBriefThread(brief, now.getTime());
    expect(coachBodies.length).toBeGreaterThan(0);
    const freshness = deriveFreshnessAvoidPhrasesForBrief(coachBodies, {
      effectiveAsk: "One hour of distribution",
    });
    expect(freshness.length).toBeGreaterThan(0);
  });

  it("includes sent-like row with stale created_at and recent updated_at when sent_at missing", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          status: "accepted",
          message_sid: "SM_HIST_UPDATED",
          created_at: "2026-06-10T08:00:00.000Z",
          updated_at: "2026-06-21T14:00:00.000Z",
          sms_body: "Historical daily body after Twilio send update.",
        },
      ],
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_hist_updated",
      timezone: TZ,
      now: new Date("2026-06-22T12:00:00.000Z"),
    });

    expect(brief.message_count).toBeGreaterThanOrEqual(1);
    expect(brief.messages.some((m) => /Historical daily body/i.test(m.body))).toBe(true);
  });

  it("excludes no-send row with north_star_gate body from writer thread", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          status: "skipped_no_safe_v3_voice",
          created_at: "2026-06-21T10:00:00.000Z",
          metadata: { north_star_gate: { final_body: "Should not appear in brief thread." } },
        },
      ],
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_ns_skip",
      timezone: TZ,
      now: new Date("2026-06-22T12:00:00.000Z"),
    });

    expect(brief.messages.some((m) => /Should not appear/i.test(m.body))).toBe(false);
    expect(brief.build_telemetry.daily_brief_thread_filtered_out_count).toBeGreaterThan(0);
  });

  it("includes sent row with body only at metadata.north_star_gate.final_body", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          status: "accepted",
          message_sid: "SM_NS_ONLY",
          sent_at: "2026-06-21T10:00:00.000Z",
          metadata: { north_star_gate: { final_body: "North star only body path for daily send." } },
        },
      ],
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_ns_only",
      timezone: TZ,
      now: new Date("2026-06-22T12:00:00.000Z"),
    });

    expect(brief.messages.some((m) => /North star only body/i.test(m.body))).toBe(true);
  });

  it("build telemetry includes counts without message bodies", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          status: "sent",
          message_sid: "SM_TEL",
          sent_at: "2026-06-21T10:00:00.000Z",
          sms_body: "Telemetry test coach body with enough chars.",
        },
      ],
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_tel",
      timezone: TZ,
      now: new Date("2026-06-22T12:00:00.000Z"),
    });

    const t = brief.build_telemetry;
    expect(typeof t.daily_brief_thread_source_candidate_count).toBe("number");
    expect(typeof t.daily_brief_thread_visible_send_candidate_count).toBe("number");
    expect(JSON.stringify(t)).not.toMatch(/Telemetry test coach body/i);
    expect(JSON.stringify(t)).not.toMatch(/recent_exact_thread/i);
  });

  it("uses schema-safe send select without top-level sent_at column", () => {
    expect(SMS_SEND_EVENTS_THREAD_SELECT).not.toMatch(/\bsent_at\b/);
    expect(SMS_SEND_EVENTS_THREAD_SELECT).not.toMatch(/\bprocessed_at\b/);
    expect(SMS_SEND_EVENTS_THREAD_SELECT).not.toMatch(/\bupdated_at\b/);
    expect(SMS_WEEKLY_SEND_EVENTS_THREAD_SELECT).not.toMatch(/\bsent_at\b/);
    const src = readFileSync(join(process.cwd(), "src/lib/sms-recent-exact-thread-72h.ts"), "utf8");
    expect(src).not.toMatch(/from\("sms_send_events"\)[\s\S]{0,500}\.gte\("sent_at"/);
  });

  it("builds multi-message thread from metadata.sent_at rows without top-level sent_at", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          status: "accepted",
          message_sid: "SM_META_1",
          created_at: "2026-06-10T10:00:00.000Z",
          metadata: {
            sent_at: "2026-06-20T09:00:00.000Z",
            daily_v3_lane: { final_body: "June 20 distribution check-in body." },
          },
        },
        {
          status: "accepted",
          message_sid: "SM_META_2",
          created_at: "2026-06-21T10:00:00.000Z",
          metadata: {
            sent_at: "2026-06-21T14:00:00.000Z",
            sms_body: "June 21 coach follow-up with enough body text.",
          },
        },
      ],
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_meta_ts",
      timezone: TZ,
      now: new Date("2026-06-22T12:00:00.000Z"),
    });

    expect(brief.build_telemetry.daily_brief_thread_source_candidate_count).toBeGreaterThan(1);
    expect(brief.message_count).toBeGreaterThan(1);
  });

  it("records fetch errors without raw thread text and still uses other sources", async () => {
    supabaseFrom.mockImplementation((table: string) => {
      if (table === "sms_send_events") {
        const builder = {
          select: () => builder,
          eq: () => builder,
          gte: () => builder,
          order: () => builder,
          limit: () =>
            Promise.resolve({
              data: null,
              error: { code: "42703", message: "column sent_at does not exist" },
            }),
        };
        return builder;
      }
      if (table === "sms_inbound_messages") {
        return chain([
          {
            raw_body: "User reply while send fetch failed.",
            created_at: "2026-06-21T10:00:00.000Z",
            received_at: "2026-06-21T10:00:00.000Z",
            message_sid: "SM_USER_ERR",
          },
        ]);
      }
      return chain([]);
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_fetch_err",
      timezone: TZ,
      now: new Date("2026-06-22T12:00:00.000Z"),
    });

    expect(brief.build_telemetry.daily_brief_thread_fetch_error_count).toBeGreaterThan(0);
    expect(brief.build_telemetry.daily_brief_thread_fetch_error_sources).toContain("sms_send_events");
    expect(brief.build_telemetry.daily_brief_thread_fetch_error_top).toBe("42703");
    expect(JSON.stringify(brief.build_telemetry)).not.toMatch(/column sent_at does not exist/);
    expect(brief.build_telemetry.daily_brief_thread_user_inbound_candidate_count).toBe(1);
  });

  it("marks fallback-only thread in telemetry", async () => {
    setupSupabaseTables({
      sendRows: [],
      lastCtx: {
        sent_at: "2026-06-21T14:00:00.000Z",
        full_body: "Last outbound context coach body for fallback only.",
        message_kind: "coach",
      },
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_fallback",
      timezone: TZ,
      now: new Date("2026-06-22T12:00:00.000Z"),
    });

    expect(brief.message_count).toBe(0);
    expect(brief.last_outbound_fallback_message_count).toBe(0);
    expect(brief.build_telemetry.daily_brief_thread_source_candidate_count).toBe(0);
    expect(brief.build_telemetry.daily_brief_thread_fallback_used).toBe(true);
    expect(brief.build_telemetry.daily_brief_thread_fallback_source_count).toBe(1);
    expect(brief.build_telemetry.daily_brief_thread_source_tables_present).toContain(
      "sms_last_outbound_context"
    );
    expect(
      brief.timeline_7d.messages.some((m) => m.source_table === "sms_last_outbound_context")
    ).toBe(true);
  });
});

describe("primary select(*) notebook fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecentV2EventsForAi.mockResolvedValue([]);
  });

  const NOW_BRIEF = new Date("2026-06-22T12:00:00.000Z");

  it("primary select(*) succeeds for sms_send_events with zero fetch errors", async () => {
    setupSchemaAdaptiveSupabase({
      sms_send_events: {
        fallbackRows: [
          {
            status: "sent",
            message_sid: "SM_PRIMARY_SEND",
            metadata: {
              sent_at: "2026-06-21T10:00:00.000Z",
              sms_body: "Daily coach body from primary select star fetch.",
            },
          },
        ],
      },
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_primary_send",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    expect(brief.build_telemetry.daily_brief_thread_fetch_error_count).toBe(0);
    expect(brief.build_telemetry.daily_brief_thread_schema_fallback_used).toBe(false);
    expect(brief.build_telemetry.daily_brief_thread_primary_fetch_strategy).toBe("select_star");
    expect(brief.build_telemetry.daily_brief_thread_primary_fetch_succeeded).toBe(true);
    expect(brief.build_telemetry.daily_brief_thread_source_candidate_count).toBeGreaterThan(0);
    expect(brief.messages.some((m) => /primary select star fetch/i.test(m.body))).toBe(true);
  });

  it("primary select(*) succeeds for sms_weekly_send_events, sms_inbound_messages, sms_inbound_coach_jobs", async () => {
    setupSchemaAdaptiveSupabase({
      sms_weekly_send_events: {
        fallbackRows: [
          {
            status: "sent",
            message_sid: "SM_WK",
            metadata: { sent_at: "2026-06-21T10:00:00.000Z", sms_body: "Weekly Pat Pause body." },
          },
        ],
      },
      sms_inbound_messages: {
        fallbackRows: [
          {
            raw_body: "User inbound on primary path.",
            metadata: { received_at: "2026-06-21T10:00:00.000Z" },
            message_sid: "SM_IN_PRIMARY",
          },
        ],
      },
      sms_inbound_coach_jobs: {
        fallbackRows: [
          {
            raw_body: "User asked coach.",
            reply_body: "Coach reply on primary path.",
            metadata: { sent_at: "2026-06-21T10:00:00.000Z" },
            status: "sent",
            outbound_message_sid: "SM_JOB_PRIMARY",
          },
        ],
      },
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_primary_all",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    expect(brief.build_telemetry.daily_brief_thread_fetch_error_count).toBe(0);
    expect(brief.build_telemetry.daily_brief_thread_schema_fallback_used).toBe(false);
    expect(brief.build_telemetry.daily_brief_thread_user_inbound_candidate_count).toBe(1);
    expect(brief.build_telemetry.daily_brief_thread_weekly_candidate_count).toBe(1);
    expect(brief.messages.some((m) => m.role === "user")).toBe(true);
  });

  it("unexpected primary failure uses schema fallback safety net", async () => {
    setupSchemaAdaptiveSupabase({
      sms_send_events: {
        failPrimaryOnce: true,
        fallbackRows: [
          {
            status: "sent",
            message_sid: "SM_SAFETY",
            metadata: {
              sent_at: "2026-06-21T09:00:00.000Z",
              sms_body: "Recovered after primary select(*) failed unexpectedly.",
            },
          },
        ],
      },
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_primary_fail_once",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    expect(brief.build_telemetry.daily_brief_thread_fetch_error_count).toBeGreaterThan(0);
    expect(brief.build_telemetry.daily_brief_thread_schema_fallback_used).toBe(true);
    expect(brief.build_telemetry.daily_brief_thread_source_candidate_count).toBeGreaterThan(0);
  });
});

describe("schema-adaptive notebook fetch safety net", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecentV2EventsForAi.mockResolvedValue([]);
  });

  const NOW_BRIEF = new Date("2026-06-22T12:00:00.000Z");

  it("sms_send_events: primary path succeeds without schema fallback", async () => {
    setupSchemaAdaptiveSupabase({
      sms_send_events: {
        fallbackRows: [
          {
            status: "sent",
            message_sid: "SM_FALLBACK_SEND",
            metadata: {
              sent_at: "2026-06-21T10:00:00.000Z",
              sms_body: "Daily coach body from schema fallback fetch.",
            },
          },
        ],
      },
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_schema_send",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    expect(brief.build_telemetry.daily_brief_thread_fetch_error_count).toBe(0);
    expect(brief.build_telemetry.daily_brief_thread_schema_fallback_used).toBe(false);
    expect(brief.build_telemetry.daily_brief_thread_source_candidate_count).toBeGreaterThan(0);
    expect(brief.messages.some((m) => /Daily coach body from schema fallback/i.test(m.body))).toBe(
      true
    );
  });

  it("sms_inbound_messages: primary select(*) includes user message without schema fallback", async () => {
    setupSchemaAdaptiveSupabase({
      sms_inbound_messages: {
        fallbackRows: [
          {
            raw_body: "User reply recovered via primary select star.",
            metadata: { received_at: "2026-06-21T10:00:00.000Z" },
            message_sid: "SM_IN_PRIMARY",
          },
        ],
      },
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_schema_inbound",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    expect(brief.build_telemetry.daily_brief_thread_schema_fallback_used).toBe(false);
    expect(brief.build_telemetry.daily_brief_thread_fetch_error_count).toBe(0);
    expect(brief.messages.some((m) => m.role === "user" && /primary select star/i.test(m.body))).toBe(
      true
    );
    expect(brief.build_telemetry.daily_brief_thread_user_inbound_candidate_count).toBe(1);
  });

  it("sms_inbound_coach_jobs: primary select(*) includes coach reply", async () => {
    setupSchemaAdaptiveSupabase({
      sms_inbound_coach_jobs: {
        fallbackRows: [
          {
            raw_body: "User asked about prayer.",
            reply_body: "Keep showing up — one day at a time.",
            status: "sent",
            outbound_message_sid: "SM_REPLY_PRIMARY",
            metadata: { processed_at: "2026-06-21T11:00:00.000Z" },
          },
        ],
      },
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_schema_job",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    expect(brief.build_telemetry.daily_brief_thread_schema_fallback_used).toBe(false);
    expect(brief.messages.some((m) => m.role === "coach" && /Keep showing up/i.test(m.body))).toBe(
      true
    );
    expect(brief.build_telemetry.daily_brief_thread_visible_send_candidate_count).toBeGreaterThan(0);
  });

  it("sms_weekly_send_events: primary select(*) includes weekly coach message", async () => {
    setupSchemaAdaptiveSupabase({
      sms_weekly_send_events: {
        fallbackRows: [
          {
            status: "sent",
            message_sid: "SM_WEEKLY_PRIMARY",
            metadata: {
              sent_at: "2026-06-20T16:00:00.000Z",
              north_star_gate: { final_body: "Weekly Pat Pause from primary select star." },
            },
          },
        ],
      },
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_schema_weekly",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    expect(brief.build_telemetry.daily_brief_thread_schema_fallback_used).toBe(false);
    expect(brief.messages.some((m) => /Weekly Pat Pause from primary select star/i.test(m.body))).toBe(
      true
    );
    expect(brief.build_telemetry.daily_brief_thread_weekly_candidate_count).toBe(1);
  });

  it("primary failure on one table uses schema fallback safety net and records fetch errors", async () => {
    setupSchemaAdaptiveSupabase({
      sms_send_events: {
        failPrimaryOnce: true,
        fallbackRows: [
          {
            status: "sent",
            message_sid: "SM_ALL_FB",
            metadata: {
              sent_at: "2026-06-21T09:00:00.000Z",
              sms_body: "Recovered after primary select(*) failed unexpectedly.",
            },
          },
        ],
      },
      sms_inbound_messages: { fallbackRows: [] },
      sms_inbound_coach_jobs: { fallbackRows: [] },
      sms_weekly_send_events: { fallbackRows: [] },
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_all_fb",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    expect(brief.build_telemetry.daily_brief_thread_fetch_error_count).toBeGreaterThan(0);
    expect(brief.build_telemetry.daily_brief_thread_schema_fallback_used).toBe(true);
    expect(brief.build_telemetry.daily_brief_thread_source_candidate_count).toBeGreaterThan(0);
  });

  it("all preferred and fallback fail: fetch errors, zero source candidates", async () => {
    setupSchemaAdaptiveSupabase({
      sms_send_events: { failAll: true },
      sms_inbound_messages: { failAll: true },
      sms_inbound_coach_jobs: { failAll: true },
      sms_weekly_send_events: { failAll: true },
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_all_fail",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    expect(brief.build_telemetry.daily_brief_thread_fetch_error_count).toBeGreaterThan(0);
    expect(brief.build_telemetry.daily_brief_thread_source_candidate_count).toBe(0);
    expect(brief.build_telemetry.daily_brief_thread_schema_fallback_used).toBe(false);
    expect(brief.message_count).toBe(0);
  });

  it("all sources fail but last_outbound_context fallback: fallback_used true, source_candidate_count 0", async () => {
    setupSchemaAdaptiveSupabase({
      sms_send_events: { failAll: true },
      sms_inbound_messages: { failAll: true },
      sms_inbound_coach_jobs: { failAll: true },
      sms_weekly_send_events: { failAll: true },
      sms_last_outbound_context: {
        failPreferredWith42703: true,
        fallbackRows: [
          {
            sent_at: "2026-06-21T14:00:00.000Z",
            full_body: "Last outbound only after all source fetches failed.",
            message_kind: "coach",
          },
        ],
      },
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_loc_only",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    expect(brief.build_telemetry.daily_brief_thread_source_candidate_count).toBe(0);
    expect(brief.build_telemetry.daily_brief_thread_fallback_used).toBe(true);
    expect(brief.message_count).toBe(0);
    expect(brief.last_outbound_fallback_message_count).toBe(0);
  });

  it("real source rows plus last_outbound: source_candidate_count > 0, last_outbound fallback not required", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          status: "sent",
          message_sid: "SM_REAL",
          sent_at: "2026-06-21T10:00:00.000Z",
          sms_body: "Real source row coach message.",
        },
      ],
      lastCtx: {
        sent_at: "2026-06-21T14:00:00.000Z",
        full_body: "Duplicate last outbound should dedupe.",
        message_kind: "coach",
      },
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_real_plus_loc",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    expect(brief.build_telemetry.daily_brief_thread_source_candidate_count).toBeGreaterThan(0);
    expect(brief.messages.some((m) => /Real source row coach/i.test(m.body))).toBe(true);
  });

  it("final thread cap stays <=25 messages and <=5000 chars", async () => {
    const manyRows = Array.from({ length: 40 }, (_, i) => ({
      status: "sent",
      message_sid: `SM_CAP_${i}`,
      metadata: {
        sent_at: new Date(NOW_BRIEF.getTime() - i * 3600_000).toISOString(),
        sms_body: `Coach cap message ${i} with enough body text for char accounting.`,
      },
    }));
    setupSchemaAdaptiveSupabase({
      sms_send_events: { failPreferredWith42703: true, fallbackRows: manyRows },
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_cap",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    expect(brief.message_count).toBeLessThanOrEqual(BRIEF_THREAD_MAX_MESSAGES);
    expect(brief.char_count).toBeLessThanOrEqual(BRIEF_THREAD_MAX_CHARS);
  });

  it("skipped/preview/dry_run rows do not enter writer thread", async () => {
    setupSchemaAdaptiveSupabase({
      sms_send_events: {
        failPreferredWith42703: true,
        fallbackRows: [
          {
            status: "skipped_no_safe_v3_voice",
            metadata: {
              sent_at: "2026-06-21T10:00:00.000Z",
              north_star_gate: { final_body: "Skipped no-send body must not appear." },
            },
          },
          {
            status: "preview",
            metadata: {
              sent_at: "2026-06-21T11:00:00.000Z",
              sms_body: "Preview body must not appear.",
            },
          },
          {
            status: "dry_run",
            message_sid: "SM_DRY",
            metadata: {
              sent_at: "2026-06-21T12:00:00.000Z",
              sms_body: "Dry run body must not appear.",
            },
          },
          {
            status: "sent",
            message_sid: "SM_GOOD",
            metadata: {
              sent_at: "2026-06-21T13:00:00.000Z",
              sms_body: "Visible sent body only in writer thread.",
            },
          },
        ],
      },
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_filter",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    expect(brief.messages).toHaveLength(1);
    expect(brief.messages[0]?.body).toMatch(/Visible sent body only/i);
    expect(brief.messages.some((m) => /Skipped|Preview|Dry run/i.test(m.body))).toBe(false);
  });

  it("schema fallback limit is bounded", () => {
    expect(SCHEMA_ADAPTIVE_FALLBACK_LIMIT).toBeLessThanOrEqual(300);
    expect(SCHEMA_ADAPTIVE_FALLBACK_LIMIT).toBeGreaterThan(0);
  });
});

describe("exact-thread source ORDER BY (P4B Step 2)", () => {
  type CapturedOrder = { column: string; ascending: boolean; nullsFirst?: boolean };
  type TableCapture = { orders: CapturedOrder[]; limit?: number };

  function capturingBuilder(table: string, rows: unknown[] | null, capture: TableCapture) {
    const arrayRows = Array.isArray(rows) ? rows : [];
    const single = Array.isArray(rows) ? null : rows;
    const builder = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      not: () => builder,
      order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => {
        capture.orders.push({
          column,
          ascending: options?.ascending ?? true,
          ...(options?.nullsFirst !== undefined ? { nullsFirst: options.nullsFirst } : {}),
        });
        return builder;
      },
      limit: (n: number) => {
        capture.limit = n;
        return builder;
      },
      maybeSingle: () => Promise.resolve({ data: single, error: null }),
      then: (resolve: (v: { data: unknown; error: null }) => void) =>
        resolve({ data: arrayRows, error: null }),
    };
    return builder;
  }

  const captures = new Map<string, TableCapture>();

  function resetCaptures() {
    captures.clear();
    for (const table of [
      "sms_send_events",
      "sms_weekly_send_events",
      "sms_inbound_messages",
      "sms_inbound_coach_jobs",
      "sms_last_outbound_context",
    ]) {
      captures.set(table, { orders: [] });
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getRecentV2EventsForAi.mockResolvedValue([]);
    resetCaptures();
    supabaseFrom.mockImplementation((table: string) => {
      const cap = captures.get(table) ?? { orders: [] };
      if (!captures.has(table)) captures.set(table, cap);
      if (table === "sms_last_outbound_context") {
        return capturingBuilder(table, null, cap);
      }
      return capturingBuilder(table, [], cap);
    });
  });

  it.each([
    ["sms_send_events", EXACT_THREAD_SOURCE_ORDER_BY.sms_send_events],
    ["sms_weekly_send_events", EXACT_THREAD_SOURCE_ORDER_BY.sms_weekly_send_events],
    ["sms_inbound_messages", EXACT_THREAD_SOURCE_ORDER_BY.sms_inbound_messages],
    ["sms_inbound_coach_jobs", EXACT_THREAD_SOURCE_ORDER_BY.sms_inbound_coach_jobs],
  ] as const)("queries %s with production ORDER BY", async (table, expected) => {
    await buildRecentExactThread72h({
      clerkUserId: "user_order",
      timezone: TZ,
      now: NOW,
    });
    expect(captures.get(table)?.orders).toEqual([...expected]);
  });

  it("preserves ROW_FETCH_LIMIT for inbound and coach jobs", async () => {
    await buildRecentExactThread72h({
      clerkUserId: "user_limits",
      timezone: TZ,
      now: NOW,
    });
    expect(captures.get("sms_inbound_messages")?.limit).toBe(120);
    expect(captures.get("sms_inbound_coach_jobs")?.limit).toBe(120);
    expect(captures.get("sms_send_events")?.limit).toBe(300);
    expect(captures.get("sms_weekly_send_events")?.limit).toBe(300);
  });

  it("still sorts merged thread chronologically after fetch", async () => {
    supabaseFrom.mockImplementation((table: string) => {
      switch (table) {
        case "sms_send_events":
          return chain([
            {
              sms_body: "Later daily coach.",
              created_at: "2026-05-18T11:00:00.000Z",
              status: "sent",
              message_sid: "SM_LATE",
            },
            {
              sms_body: "Earlier daily coach.",
              created_at: "2026-05-18T09:00:00.000Z",
              status: "sent",
              message_sid: "SM_EARLY",
            },
          ]);
        case "sms_inbound_coach_jobs":
          return chain([
            {
              raw_body: "User text",
              reply_body: "Mid coach reply.",
              status: "sent",
              sent_at: "2026-05-18T10:00:00.000Z",
              created_at: "2026-05-18T10:00:00.000Z",
              updated_at: "2026-05-18T10:00:00.000Z",
              message_sid: "SM_MID",
            },
          ]);
        default:
          return chain([]);
      }
    });

    const result = await buildRecentExactThread72h({
      clerkUserId: "user_chrono",
      timezone: TZ,
      now: NOW,
    });

    const coachBodies = result.messages.filter((m) => m.role === "coach").map((m) => m.body);
    const earlyIdx = coachBodies.findIndex((b) => /Earlier daily coach/i.test(b));
    const midIdx = coachBodies.findIndex((b) => /Mid coach reply/i.test(b));
    const lateIdx = coachBodies.findIndex((b) => /Later daily coach/i.test(b));
    expect(earlyIdx).toBeGreaterThanOrEqual(0);
    expect(midIdx).toBeGreaterThan(earlyIdx);
    expect(lateIdx).toBeGreaterThan(midIdx);
  });
});

describe("recent_exact_thread actual SMS provenance (writer-facing)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecentV2EventsForAi.mockResolvedValue([]);
  });

  const NOW_BRIEF = new Date("2026-06-22T12:00:00.000Z");

  it("A: inbound raw_body appears exactly once", async () => {
    setupSupabaseTables({
      inboundMsgRows: [
        {
          raw_body: "I'm going to play sports with the kids",
          received_at: "2026-06-21T15:00:00.000Z",
          message_sid: "SM_USER_A",
        },
      ],
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_a",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    const matches = brief.messages.filter(
      (m) => m.role === "user" && m.body === "I'm going to play sports with the kids"
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.source_table).toBe("sms_inbound_messages");
    expect(matches[0]?.delivery_evidence).toBe("inbound_received");
    expect(matches[0]?.message_sid).toBe("SM_USER_A");
  });

  it("B: sent daily outbound with SID appears exactly once", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          status: "sent",
          message_sid: "SM_DAILY_B",
          sent_at: "2026-06-21T14:00:00.000Z",
          sms_body: "Get your mind right! 10,000 steps!",
        },
      ],
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_b",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    const matches = brief.messages.filter(
      (m) => m.role === "coach" && /10,000 steps/i.test(m.body)
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.source_table).toBe("sms_send_events");
    expect(matches[0]?.delivery_evidence).toBe("message_sid_present");
    expect(matches[0]?.message_sid).toBe("SM_DAILY_B");
    expect(matches[0]?.is_fallback_context).toBeUndefined();
  });

  it("C: sent inbound coach reply with outbound_message_sid appears exactly once", async () => {
    setupSupabaseTables({
      jobRows: [
        {
          raw_body: "Yes",
          reply_body: "It's great to see your commitment to another win!",
          status: "sent",
          sent_at: "2026-06-21T16:00:00.000Z",
          created_at: "2026-06-21T15:59:00.000Z",
          message_sid: "SM_IN_C",
          outbound_message_sid: "SM_OUT_C",
        },
      ],
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_c",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    const coachMatches = brief.messages.filter(
      (m) => m.role === "coach" && /commitment to another win/i.test(m.body)
    );
    expect(coachMatches).toHaveLength(1);
    expect(coachMatches[0]?.source_table).toBe("sms_inbound_coach_jobs");
    expect(coachMatches[0]?.delivery_evidence).toBe("outbound_message_sid_present");
    expect(coachMatches[0]?.message_sid).toBe("SM_OUT_C");
  });

  it("D: queued/accepted/sending/twilio_send_attempted-only without SID do not appear", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          status: "queued",
          created_at: "2026-06-21T14:00:00.000Z",
          sms_body: "QUEUED_NO_SID_BODY",
        },
        {
          status: "accepted",
          created_at: "2026-06-21T14:01:00.000Z",
          sms_body: "ACCEPTED_NO_SID_BODY",
        },
        {
          status: "sending",
          created_at: "2026-06-21T14:02:00.000Z",
          sms_body: "SENDING_NO_SID_BODY",
        },
        {
          created_at: "2026-06-21T14:03:00.000Z",
          sms_body: "ATTEMPTED_ONLY_BODY",
          metadata: { twilio_send_attempted: true },
        },
      ],
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_d",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    expect(brief.messages.some((m) => /QUEUED_NO_SID|ACCEPTED_NO_SID|SENDING_NO_SID|ATTEMPTED_ONLY/i.test(m.body))).toBe(
      false
    );
  });

  it("E: draft tables are never queried for recent_exact_thread", async () => {
    const queried: string[] = [];
    supabaseFrom.mockImplementation((table: string) => {
      queried.push(table);
      return chain([]);
    });

    await buildRecentExactThreadForBrief({
      clerkUserId: "user_e",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    expect(queried).not.toContain("sms_daily_drafts");
    expect(queried).not.toContain("sms_daily_draft_generations");
    expect(queried.some((t) => /draft/i.test(t))).toBe(false);
  });

  it("G: recent_exact_thread messages preserve lean provenance", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          status: "sent",
          message_sid: "SM_PROV",
          sent_at: "2026-06-21T14:00:00.000Z",
          sms_body: "Provenance coach line.",
        },
      ],
      inboundMsgRows: [
        {
          raw_body: "Provenance user line.",
          received_at: "2026-06-21T15:00:00.000Z",
          message_sid: "SM_PROV_USER",
        },
      ],
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_g",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    expect(brief.messages.length).toBe(2);
    for (const m of brief.messages) {
      expect(m).toHaveProperty("at_local");
      expect(m).toHaveProperty("role");
      expect(m).toHaveProperty("body");
      expect(m).toHaveProperty("source_table");
      expect(m).toHaveProperty("delivery_evidence");
      expect(Object.keys(m).sort()).toEqual(
        expect.arrayContaining(["at_local", "role", "body", "source_table", "delivery_evidence", "message_sid"])
      );
      expect(m).not.toHaveProperty("is_fallback_context");
    }
  });

  it("H: sms_last_outbound_context fallback is excluded from writer-facing recent_exact_thread", async () => {
    setupSupabaseTables({
      lastCtx: {
        sent_at: "2026-06-21T14:00:00.000Z",
        full_body: "Fallback last outbound must not be writer-facing actual thread.",
        message_kind: "coach",
      },
    });

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_h",
      timezone: TZ,
      now: NOW_BRIEF,
    });

    expect(brief.messages).toHaveLength(0);
    expect(brief.last_outbound_fallback_message_count).toBe(0);
    expect(brief.messages.some((m) => m.is_fallback_context)).toBe(false);
    expect(brief.build_telemetry.daily_brief_thread_fallback_used).toBe(true);
  });
});

describe("Morning TTO exact thread caps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecentV2EventsForAi.mockResolvedValue([]);
  });

  const NOW_MORNING = new Date("2026-06-22T12:00:00.000Z");

  it("uses 21-day window via windowHours override without changing daily defaults", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          sms_body: "TWENTY_DAY_OLD_MORNING",
          created_at: "2026-06-02T12:00:00.000Z",
          status: "sent",
          message_sid: "SM_20D",
          sent_at: "2026-06-02T12:00:00.000Z",
        },
        {
          sms_body: "TWENTY_TWO_DAY_OLD_OUTSIDE",
          created_at: "2026-05-30T12:00:00.000Z",
          status: "sent",
          message_sid: "SM_22D",
          sent_at: "2026-05-30T12:00:00.000Z",
        },
      ],
    });

    const { buildMorningExactThreadForPacket, buildRecentExactThreadForBrief } = await import(
      "@/lib/sms-recent-exact-thread-72h"
    );

    const morning = await buildMorningExactThreadForPacket({
      clerkUserId: "user_morning_window",
      timezone: TZ,
      now: NOW_MORNING,
      messageForLocalDate: "2026-06-22",
    });

    expect(morning.window_days).toBe(21);
    expect(morning.messages.some((m) => m.body.includes("TWENTY_DAY_OLD_MORNING"))).toBe(true);
    expect(morning.messages.some((m) => m.body.includes("TWENTY_TWO_DAY_OLD_OUTSIDE"))).toBe(false);

    const brief = await buildRecentExactThreadForBrief({
      clerkUserId: "user_morning_window",
      timezone: TZ,
      now: NOW_MORNING,
    });
    expect(brief.window.floor_hours).toBe(168);
  });

  it("caps at 30 messages preserving newest", async () => {
    const { capMorningExactThreadMessages, MORNING_TTO_THREAD_MAX_MESSAGES } = await import(
      "@/lib/sms-recent-exact-thread-72h"
    );
    const nowMs = NOW_MORNING.getTime();
    const messages: RecentExactThread72hMessage[] = [];
    for (let i = 0; i < 35; i++) {
      messages.push({
        at: new Date(nowMs - (35 - i) * 60_000).toISOString(),
        at_local: `msg ${i}`,
        at_local_timezone: TZ,
        local_day_key: "2026-06-22",
        role: i % 2 === 0 ? "coach" : "user",
        body: `Morning cap message ${i}`,
        message_kind: null,
        source_table: "sms_send_events",
        message_sid: `SM_${i}`,
        delivery_status: "sent",
        is_exact_body: true,
      });
    }

    const capped = capMorningExactThreadMessages(messages, {
      timezone: TZ,
      nowMs,
      messageForLocalDate: "2026-06-22",
    });

    expect(capped).toHaveLength(MORNING_TTO_THREAD_MAX_MESSAGES);
    expect(capped[0]?.body).toBe("Morning cap message 5");
    expect(capped.at(-1)?.body).toBe("Morning cap message 34");
  });

  it("truncates per-message body to 480 chars and total to 12000", async () => {
    const {
      capMorningExactThreadMessages,
      MORNING_TTO_THREAD_MAX_CHARS_PER_MESSAGE,
      MORNING_TTO_THREAD_MAX_TOTAL_CHARS,
      morningExactThreadMessageCharCount,
    } = await import("@/lib/sms-recent-exact-thread-72h");

    const nowMs = NOW_MORNING.getTime();
    const longBody = "x".repeat(600);
    const messages: RecentExactThread72hMessage[] = [
      {
        at: new Date(nowMs - 60_000).toISOString(),
        at_local: "recent",
        at_local_timezone: TZ,
        local_day_key: "2026-06-22",
        role: "coach",
        body: longBody,
        message_kind: null,
        source_table: "sms_send_events",
        message_sid: "SM_LONG",
        delivery_status: "sent",
        is_exact_body: true,
      },
    ];

    const capped = capMorningExactThreadMessages(messages, {
      timezone: TZ,
      nowMs,
      messageForLocalDate: "2026-06-22",
    });
    expect(capped[0]?.body.length).toBeLessThanOrEqual(MORNING_TTO_THREAD_MAX_CHARS_PER_MESSAGE);
    expect(capped[0]?.body.endsWith("…")).toBe(true);

    const many: RecentExactThread72hMessage[] = [];
    for (let i = 0; i < 30; i++) {
      many.push({
        at: new Date(nowMs - (30 - i) * 60_000).toISOString(),
        at_local: `m${i}`,
        at_local_timezone: TZ,
        local_day_key: "2026-06-22",
        role: "coach",
        body: "C".repeat(450),
        message_kind: null,
        source_table: "sms_send_events",
        message_sid: `SM_CHAR_${i}`,
        delivery_status: "sent",
        is_exact_body: true,
      });
    }
    const charCapped = capMorningExactThreadMessages(many, {
      timezone: TZ,
      nowMs,
      messageForLocalDate: "2026-06-22",
    });
    expect(morningExactThreadMessageCharCount(charCapped)).toBeLessThanOrEqual(
      MORNING_TTO_THREAD_MAX_TOTAL_CHARS
    );
  });

  it("projects UTC/local/weekday and chronological order", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          sms_body: "Earlier coach line.",
          created_at: "2026-06-21T10:00:00.000Z",
          status: "sent",
          message_sid: "SM_EARLY",
          sent_at: "2026-06-21T10:00:00.000Z",
        },
      ],
      inboundMsgRows: [
        {
          raw_body: "Later user line.",
          received_at: "2026-06-21T16:00:00.000Z",
          message_sid: "SM_LATE_USER",
        },
      ],
    });

    const { buildMorningExactThreadForPacket } = await import("@/lib/sms-recent-exact-thread-72h");
    const morning = await buildMorningExactThreadForPacket({
      clerkUserId: "user_proj",
      timezone: TZ,
      now: NOW_MORNING,
      messageForLocalDate: "2026-06-22",
    });

    expect(morning.messages.length).toBeGreaterThanOrEqual(2);
    for (const m of morning.messages) {
      expect(m.sent_at_utc).toMatch(/Z$/);
      expect(m.sent_at_local.length).toBeGreaterThan(5);
      expect(m.local_weekday.length).toBeGreaterThan(3);
      expect(m.local_day_key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof m.day_relation_to_message).toBe("string");
      expect(["coach", "user"]).toContain(m.sender);
    }
    expect(morning.messages[0]?.sender).toBe("coach");
    expect(morning.messages[1]?.sender).toBe("user");
    expect(
      morning.messages.every(
        (m, i, arr) => i === 0 || arr[i - 1]!.sent_at_utc <= m.sent_at_utc
      )
    ).toBe(true);
  });

  it("excludes drafts, preview, skipped, and fallback from Morning thread", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          sms_body: "Skipped draft body",
          created_at: "2026-06-21T10:00:00.000Z",
          status: "skipped_no_safe_v3_voice",
        },
        {
          sms_body: "Visible sent only",
          created_at: "2026-06-21T11:00:00.000Z",
          status: "sent",
          message_sid: "SM_GOOD_M",
          sent_at: "2026-06-21T11:00:00.000Z",
        },
      ],
      lastCtx: {
        sent_at: "2026-06-21T12:00:00.000Z",
        full_body: "Fallback should not appear",
        message_kind: "coach",
      },
    });
    getRecentV2EventsForAi.mockResolvedValue([
      {
        event_type: "check_sent",
        occurred_at: "2026-06-21T11:30:00.000Z",
        payload_json: { body_preview: "PREVIEW_ONLY_MORNING" },
      },
    ]);

    const queried: string[] = [];
    const origImpl = supabaseFrom.getMockImplementation();
    supabaseFrom.mockImplementation((table: string) => {
      queried.push(table);
      return origImpl?.(table) ?? chain([]);
    });

    const { buildMorningExactThreadForPacket } = await import("@/lib/sms-recent-exact-thread-72h");
    const morning = await buildMorningExactThreadForPacket({
      clerkUserId: "user_filter_m",
      timezone: TZ,
      now: NOW_MORNING,
      messageForLocalDate: "2026-06-22",
    });

    expect(queried.some((t) => /draft/i.test(t))).toBe(false);
    expect(morning.messages).toHaveLength(1);
    expect(morning.messages[0]?.body).toMatch(/Visible sent only/i);
  });
});
