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
  BRIEF_THREAD_MAX_MESSAGES,
  capThreadMessagesForBrief,
  capThreadMessagesForBriefWithTelemetry,
  createdAtFirstTimestampFromSendEventRow,
  deriveBriefThreadWindowTelemetry,
  formatAtLocal,
  isSendEventTrulySent,
  RECENT_EXACT_THREAD_WINDOW_HOURS,
  timestampFromInboundMessageRow,
  timestampFromSendEventRow,
  type RecentExactThread72hMessage,
} from "@/lib/sms-recent-exact-thread-72h";
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
  it("accepts sent status and rejects reserved/skipped", () => {
    expect(isSendEventTrulySent({ status: "sent", sms_body: "Hi" })).toBe(true);
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

  it("floor plus extension stays within cap and includes extension when room", () => {
    const nowMs = new Date("2026-06-22T12:00:00.000Z").getTime();
    const floorMs = nowMs - 24 * 60 * 60 * 1000;
    const extensionMs = nowMs - 5 * 24 * 60 * 60 * 1000;
    const messages = [
      msg({
        at: new Date(extensionMs).toISOString(),
        role: "coach",
        body: "Thursday CTA extension",
      }),
      msg({
        at: new Date(floorMs).toISOString(),
        role: "user",
        body: "Recent user reply",
      }),
    ];
    const capped = capThreadMessagesForBriefWithTelemetry(messages, nowMs);
    expect(capped.messages.length).toBeLessThanOrEqual(BRIEF_THREAD_MAX_MESSAGES);
    expect(capped.extension_message_count).toBeGreaterThan(0);
    expect(capped.messages.some((m) => /Thursday CTA/i.test(m.body))).toBe(true);
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
});
