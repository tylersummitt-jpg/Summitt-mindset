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
  buildRecentExactThread72h,
  formatAtLocal,
  isSendEventTrulySent,
  RECENT_EXACT_THREAD_WINDOW_HOURS,
} from "@/lib/sms-recent-exact-thread-72h";

const NOW = new Date("2026-05-18T12:00:00.000Z");
const TZ = "America/Chicago";

function chain(rows: unknown[] | unknown | null) {
  const result = { data: rows, error: null };
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve(Array.isArray(rows) ? { data: rows[0] ?? null, error: null } : result),
    then: (resolve: (v: typeof result) => void) => resolve(result),
  };
  return builder;
}

function setupSupabaseTables(args: {
  sendRows?: unknown[];
  jobRows?: unknown[];
  inboundMsgRows?: unknown[];
  lastCtx?: unknown | null;
}) {
  supabaseFrom.mockImplementation((table: string) => {
    switch (table) {
      case "sms_send_events":
        return chain(args.sendRows ?? []);
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
  it("accepts sent status and rejects reserved/skipped", () => {
    expect(isSendEventTrulySent({ status: "sent", sms_body: "Hi" })).toBe(true);
    expect(isSendEventTrulySent({ status: "reserved", sms_body: "Hi" })).toBe(false);
    expect(isSendEventTrulySent({ status: "skipped_no_safe_v3_voice", sms_body: "Hi" })).toBe(false);
    expect(isSendEventTrulySent({ status: "reserved", message_sid: "SM1", sms_body: "Hi" })).toBe(false);
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

  it("excludes messages older than 72 hours", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          sms_body: "Old daily",
          created_at: "2026-05-10T11:00:00.000Z",
          status: "sent",
        },
        {
          sms_body: "Recent daily",
          created_at: "2026-05-18T11:00:00.000Z",
          status: "sent",
        },
      ],
    });

    const result = await buildRecentExactThread72h({
      clerkUserId: "user_1",
      timezone: TZ,
      now: NOW,
    });

    expect(result.messages.some((m) => m.body.includes("Old daily"))).toBe(false);
    expect(result.messages.some((m) => m.body.includes("Recent daily"))).toBe(true);
  });

  it("prefers exact sent coach body over check_sent preview", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          sms_body: "FULL_DAILY_BODY_" + "x".repeat(80),
          created_at: "2026-05-18T10:00:00.000Z",
          status: "sent",
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

  it("includes orphan preview only as delivery_status preview", async () => {
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

    const preview = result.messages.find((m) => m.body.includes("ORPHAN_PREVIEW"));
    expect(preview?.delivery_status).toBe("preview");
    expect(preview?.is_exact_body).toBe(false);
    expect(result.had_preview_messages).toBe(true);
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
