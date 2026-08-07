import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const requireTylerAdminMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => {
  function chain(): Record<string, unknown> {
    const api: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve, reject),
    };
    for (const m of [
      "select",
      "in",
      "not",
      "neq",
      "eq",
      "gte",
      "lte",
      "order",
      "range",
    ]) {
      api[m] = (..._args: unknown[]) => api;
    }
    return api;
  }
  return {
    supabaseServer: {
      from: () => chain(),
    },
  };
});

vi.mock("@/lib/auth/require-tyler-admin", () => ({
  requireTylerAdmin: (...args: unknown[]) => requireTylerAdminMock(...args),
}));

import {
  aggregateAttributedReplyReport,
  attributeMorningEveningReplies,
  buildSlotStats,
  formatRepliesOverSent,
  formatReplyLatencyMs,
  formatReplyRate,
  hasNonblankTwilioMessageSid,
  normalizeInboundForReplyReport,
  normalizeMorningEveningOutbound,
  normalizeWeeklyBoundary,
  parseTtoReplyReportRange,
  previewSmsBody,
  resolveSendEventSentAtMs,
  TTO_REPLY_REPORT_MAX_ATTRIBUTION_MS,
  type TtoReplyReportBoundary,
  type TtoReplyReportInbound,
  type TtoReplyReportOutbound,
} from "@/lib/tyler-text-overview-reply-report";

const USER = "user_john";

function outbound(args: {
  id: string;
  slot: "morning" | "evening_checkin";
  sentAt: string;
  dayKey: string;
  body?: string;
}): TtoReplyReportOutbound {
  const sentAtMs = Date.parse(args.sentAt);
  return {
    id: args.id,
    clerkUserId: USER,
    dayKey: args.dayKey,
    slot: args.slot,
    sentAtMs,
    sentAtIso: new Date(sentAtMs).toISOString(),
    body: args.body ?? `${args.slot} body`,
  };
}

function inbound(at: string, body: string): TtoReplyReportInbound {
  const receivedAtMs = Date.parse(at);
  return {
    clerkUserId: USER,
    receivedAtMs,
    receivedAtIso: new Date(receivedAtMs).toISOString(),
    rawBody: body,
  };
}

function boundary(
  at: string,
  kind: TtoReplyReportBoundary["kind"]
): TtoReplyReportBoundary {
  return { clerkUserId: USER, sentAtMs: Date.parse(at), kind };
}

describe("tto reply report sent filter", () => {
  it("includes SID-backed Morning and Evening; excludes reserved/skipped/failed without SID", () => {
    expect(
      normalizeMorningEveningOutbound({
        id: "1",
        clerk_user_id: USER,
        day_key: "2026-08-01",
        send_slot: "morning",
        message_sid: "SM1",
        sms_body: "Hi",
        metadata: { sent_at: "2026-08-01T12:00:00.000Z" },
        created_at: "2026-08-01T11:59:00.000Z",
      })?.slot
    ).toBe("morning");

    expect(
      normalizeMorningEveningOutbound({
        id: "2",
        clerk_user_id: USER,
        day_key: "2026-08-01",
        send_slot: "evening_checkin",
        message_sid: "SM2",
        metadata: { sent_at: "2026-08-01T23:00:00.000Z", final_body_sent: "Eve" },
        created_at: "2026-08-01T22:59:00.000Z",
      })?.body
    ).toBe("Eve");

    expect(
      normalizeMorningEveningOutbound({
        id: "3",
        clerk_user_id: USER,
        day_key: "2026-08-01",
        send_slot: "morning",
        message_sid: null,
        status: "reserved",
        created_at: "2026-08-01T12:00:00.000Z",
      })
    ).toBeNull();

    expect(
      normalizeMorningEveningOutbound({
        id: "4",
        clerk_user_id: USER,
        day_key: "2026-08-01",
        send_slot: "morning",
        message_sid: "",
        status: "skipped_user_pause",
        created_at: "2026-08-01T12:00:00.000Z",
      })
    ).toBeNull();

    expect(
      normalizeMorningEveningOutbound({
        id: "5",
        clerk_user_id: USER,
        day_key: "2026-08-01",
        send_slot: "morning",
        message_sid: null,
        status: "send_failed",
        created_at: "2026-08-01T12:00:00.000Z",
      })
    ).toBeNull();

    // Twilio status naming differs but SID present → included
    expect(
      hasNonblankTwilioMessageSid({
        message_sid: "SMqueued",
        metadata: {},
      })
    ).toBe(true);
  });

  it("sent time prefers metadata.sent_at over created_at", () => {
    expect(
      resolveSendEventSentAtMs({
        created_at: "2026-08-01T11:00:00.000Z",
        metadata: { sent_at: "2026-08-01T12:05:00.000Z" },
      })
    ).toBe(Date.parse("2026-08-01T12:05:00.000Z"));
  });
});

describe("tto reply report attribution cases", () => {
  it("CASE A: Morning reply before Evening → Morning credit", () => {
    const rows = attributeMorningEveningReplies({
      outbounds: [
        outbound({
          id: "m",
          slot: "morning",
          sentAt: "2026-08-07T12:00:00.000Z",
          dayKey: "2026-08-07",
        }),
        outbound({
          id: "e",
          slot: "evening_checkin",
          sentAt: "2026-08-07T23:00:00.000Z",
          dayKey: "2026-08-07",
        }),
      ],
      boundaries: [
        boundary("2026-08-07T12:00:00.000Z", "morning"),
        boundary("2026-08-07T23:00:00.000Z", "evening"),
      ],
      inbounds: [inbound("2026-08-07T14:00:00.000Z", "Did it")],
    });
    expect(rows.find((r) => r.id === "m")?.replied).toBe(true);
    expect(rows.find((r) => r.id === "e")?.replied).toBe(false);
  });

  it("CASE B: Morning no reply / Evening reply", () => {
    const rows = attributeMorningEveningReplies({
      outbounds: [
        outbound({
          id: "m",
          slot: "morning",
          sentAt: "2026-08-07T12:00:00.000Z",
          dayKey: "2026-08-07",
        }),
        outbound({
          id: "e",
          slot: "evening_checkin",
          sentAt: "2026-08-07T23:00:00.000Z",
          dayKey: "2026-08-07",
        }),
      ],
      boundaries: [
        boundary("2026-08-07T12:00:00.000Z", "morning"),
        boundary("2026-08-07T23:00:00.000Z", "evening"),
      ],
      inbounds: [inbound("2026-08-08T00:00:00.000Z", "Evening reply")],
    });
    expect(rows.find((r) => r.id === "m")?.replied).toBe(false);
    expect(rows.find((r) => r.id === "e")?.replied).toBe(true);
  });

  it("CASE C: both slots replied", () => {
    const rows = attributeMorningEveningReplies({
      outbounds: [
        outbound({
          id: "m",
          slot: "morning",
          sentAt: "2026-08-07T12:00:00.000Z",
          dayKey: "2026-08-07",
        }),
        outbound({
          id: "e",
          slot: "evening_checkin",
          sentAt: "2026-08-07T23:00:00.000Z",
          dayKey: "2026-08-07",
        }),
      ],
      boundaries: [
        boundary("2026-08-07T12:00:00.000Z", "morning"),
        boundary("2026-08-07T23:00:00.000Z", "evening"),
      ],
      inbounds: [
        inbound("2026-08-07T14:00:00.000Z", "Morning reply"),
        inbound("2026-08-08T00:30:00.000Z", "Evening reply"),
      ],
    });
    expect(rows.every((r) => r.replied)).toBe(true);
  });

  it("CASE D: inbound after Evening only credits Evening", () => {
    const rows = attributeMorningEveningReplies({
      outbounds: [
        outbound({
          id: "m",
          slot: "morning",
          sentAt: "2026-08-07T12:00:00.000Z",
          dayKey: "2026-08-07",
        }),
        outbound({
          id: "e",
          slot: "evening_checkin",
          sentAt: "2026-08-07T23:00:00.000Z",
          dayKey: "2026-08-07",
        }),
      ],
      boundaries: [
        boundary("2026-08-07T12:00:00.000Z", "morning"),
        boundary("2026-08-07T23:00:00.000Z", "evening"),
      ],
      inbounds: [inbound("2026-08-08T02:00:00.000Z", "Late")],
    });
    expect(rows.find((r) => r.id === "m")?.replied).toBe(false);
    expect(rows.find((r) => r.id === "e")?.replied).toBe(true);
  });

  it("multiple inbound → first only", () => {
    const rows = attributeMorningEveningReplies({
      outbounds: [
        outbound({
          id: "e",
          slot: "evening_checkin",
          sentAt: "2026-08-07T23:00:00.000Z",
          dayKey: "2026-08-07",
        }),
      ],
      boundaries: [boundary("2026-08-07T23:00:00.000Z", "evening")],
      inbounds: [
        inbound("2026-08-07T23:20:00.000Z", "first"),
        inbound("2026-08-07T23:23:00.000Z", "second"),
        inbound("2026-08-07T23:40:00.000Z", "third"),
      ],
    });
    expect(rows[0]?.replyBody).toBe("first");
    expect(rows[0]?.replyLatencyMs).toBe(20 * 60 * 1000);
  });

  it("inbound before outbound ignored; same timestamp not attributed", () => {
    const sent = "2026-08-07T12:00:00.000Z";
    const rows = attributeMorningEveningReplies({
      outbounds: [
        outbound({ id: "m", slot: "morning", sentAt: sent, dayKey: "2026-08-07" }),
      ],
      boundaries: [boundary(sent, "morning")],
      inbounds: [
        inbound("2026-08-07T11:59:00.000Z", "before"),
        inbound(sent, "same instant"),
      ],
    });
    expect(rows[0]?.replied).toBe(false);
  });

  it("Weekly boundary closes prior Morning", () => {
    const rows = attributeMorningEveningReplies({
      outbounds: [
        outbound({
          id: "m",
          slot: "morning",
          sentAt: "2026-08-08T12:00:00.000Z",
          dayKey: "2026-08-08",
        }),
      ],
      boundaries: [
        boundary("2026-08-08T12:00:00.000Z", "morning"),
        boundary("2026-08-09T13:00:00.000Z", "weekly"),
      ],
      inbounds: [inbound("2026-08-09T16:00:00.000Z", "after weekly")],
    });
    expect(rows[0]?.replied).toBe(false);
    expect(normalizeWeeklyBoundary({
      clerk_user_id: USER,
      message_sid: "SMw",
      metadata: { sent_at: "2026-08-09T13:00:00.000Z" },
      created_at: "2026-08-09T12:59:00.000Z",
    })?.kind).toBe("weekly");
  });

  it("36h cap blocks late inbound", () => {
    const sentAt = "2026-08-07T23:30:00.000Z";
    const late = new Date(
      Date.parse(sentAt) + TTO_REPLY_REPORT_MAX_ATTRIBUTION_MS + 60_000
    ).toISOString();
    const rows = attributeMorningEveningReplies({
      outbounds: [
        outbound({
          id: "e",
          slot: "evening_checkin",
          sentAt,
          dayKey: "2026-08-07",
        }),
      ],
      boundaries: [boundary(sentAt, "evening")],
      inbounds: [inbound(late, "too late")],
    });
    expect(rows[0]?.replied).toBe(false);
  });

  it("inbound after next Morning ignored for prior Evening", () => {
    const rows = attributeMorningEveningReplies({
      outbounds: [
        outbound({
          id: "e",
          slot: "evening_checkin",
          sentAt: "2026-08-07T23:00:00.000Z",
          dayKey: "2026-08-07",
        }),
      ],
      boundaries: [
        boundary("2026-08-07T23:00:00.000Z", "evening"),
        boundary("2026-08-08T12:00:00.000Z", "morning"),
      ],
      inbounds: [inbound("2026-08-08T14:00:00.000Z", "next day")],
    });
    expect(rows[0]?.replied).toBe(false);
  });
});

describe("tto reply report compliance", () => {
  it("STOP/START/HELP excluded; later real reply counts", () => {
    expect(
      normalizeInboundForReplyReport({
        clerk_user_id: USER,
        received_at: "2026-08-07T12:05:00.000Z",
        raw_body: " STOP ",
      })
    ).toBeNull();
    expect(
      normalizeInboundForReplyReport({
        clerk_user_id: USER,
        received_at: "2026-08-07T12:05:00.000Z",
        raw_body: "help",
      })
    ).toBeNull();
    expect(
      normalizeInboundForReplyReport({
        clerk_user_id: USER,
        received_at: "2026-08-07T12:05:00.000Z",
        raw_body: "START",
      })
    ).toBeNull();

    const rows = attributeMorningEveningReplies({
      outbounds: [
        outbound({
          id: "m",
          slot: "morning",
          sentAt: "2026-08-07T12:00:00.000Z",
          dayKey: "2026-08-07",
        }),
      ],
      boundaries: [boundary("2026-08-07T12:00:00.000Z", "morning")],
      inbounds: [
        // compliance already filtered before attribution
        inbound("2026-08-07T12:30:00.000Z", "Real coaching reply"),
      ],
    });
    expect(rows[0]?.replied).toBe(true);
    expect(rows[0]?.replyBody).toBe("Real coaching reply");
  });
});

describe("tto reply report metrics and formatting", () => {
  it("person aggregation + rates + latency + zero sent/replied safety", () => {
    const attributed = attributeMorningEveningReplies({
      outbounds: [
        outbound({
          id: "m1",
          slot: "morning",
          sentAt: "2026-08-04T12:00:00.000Z",
          dayKey: "2026-08-04",
          body: "Morning one",
        }),
        outbound({
          id: "m2",
          slot: "morning",
          sentAt: "2026-08-05T12:00:00.000Z",
          dayKey: "2026-08-05",
          body: "Morning two",
        }),
        outbound({
          id: "e1",
          slot: "evening_checkin",
          sentAt: "2026-08-04T23:00:00.000Z",
          dayKey: "2026-08-04",
          body: "Evening one",
        }),
      ],
      boundaries: [
        boundary("2026-08-04T12:00:00.000Z", "morning"),
        boundary("2026-08-04T23:00:00.000Z", "evening"),
        boundary("2026-08-05T12:00:00.000Z", "morning"),
      ],
      inbounds: [
        inbound("2026-08-04T14:00:00.000Z", "m reply"),
        inbound("2026-08-04T23:30:00.000Z", "e reply"),
      ],
    });

    const report = aggregateAttributedReplyReport({
      range: "30",
      generatedAt: new Date("2026-08-07T12:00:00.000Z"),
      attributed,
      displayNameByUserId: new Map([[USER, "John Smith"]]),
    });

    expect(report.members).toHaveLength(1);
    expect(report.members[0]?.displayName).toBe("John Smith");
    expect(report.members[0]?.morning.sentCount).toBe(2);
    expect(report.members[0]?.morning.repliedCount).toBe(1);
    expect(report.members[0]?.morning.replyRate).toBeCloseTo(0.5);
    expect(report.members[0]?.evening.sentCount).toBe(1);
    expect(report.members[0]?.evening.repliedCount).toBe(1);
    expect(report.overall.morning.sentCount).toBe(2);
    expect(report.weekdays.some((w) => w.weekday === "Tuesday")).toBe(true);
    expect(report.details.some((d) => d.outboundBodyPreview === "Morning one")).toBe(true);
    expect(report.details.some((d) => d.replied === false)).toBe(true);

    expect(buildSlotStats({ sentCount: 0, latenciesMs: [] }).replyRate).toBeNull();
    expect(buildSlotStats({ sentCount: 3, latenciesMs: [] }).replyRate).toBe(0);
    expect(formatReplyRate(null)).toBe("—");
    expect(formatReplyLatencyMs(null)).toBe("—");
    expect(formatReplyLatencyMs(48 * 60 * 1000)).toBe("48m");
    expect(formatReplyLatencyMs(72 * 60 * 1000)).toBe("1h 12m");
    expect(formatRepliesOverSent(2, 23)).toBe("2 replies / 23 texts");
    expect(previewSmsBody("a".repeat(200)).endsWith("…")).toBe(true);
  });

  it("default range is 30; parses 7 and all", () => {
    expect(parseTtoReplyReportRange(undefined)).toBe("30");
    expect(parseTtoReplyReportRange("7")).toBe("7");
    expect(parseTtoReplyReportRange("all")).toBe("all");
  });
});

describe("tto reply report wire / purity", () => {
  it("lib and routes are observe-only with no send/generate coupling", () => {
    const lib = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-reply-report.ts"),
      "utf8"
    );
    const route = readFileSync(
      join(process.cwd(), "src/app/api/admin/tyler-text-overview/reply-report/route.ts"),
      "utf8"
    );
    const page = readFileSync(
      join(process.cwd(), "src/app/admin/tyler-text-overview/reply-report/page.tsx"),
      "utf8"
    );
    for (const src of [lib, route, page]) {
      expect(src).not.toMatch(/from ["']openai["']/);
      expect(src).not.toMatch(/from ["']@\/lib\/twilio/);
      expect(src).not.toMatch(/sendSMS/);
      expect(src).not.toMatch(/daily-sms-scheduling/);
      expect(src).not.toMatch(/tyler-text-overview-evening-send/);
      expect(src).not.toMatch(/tyler-text-overview-generate["']/);
      expect(src).not.toMatch(/\.insert\(/);
      expect(src).not.toMatch(/\.update\(/);
      expect(src).not.toMatch(/\.delete\(/);
    }
    expect(route).toContain("requireTylerAdmin");
    expect(route).toContain("export async function GET");
    expect(route).not.toMatch(/export async function POST/);
    expect(page).toContain("Observe-only");
    expect(page).toContain("formatRepliesOverSent");
    expect(page).not.toMatch(/winner|best slot|preferred slot|Evening wins/i);
    expect(lib).toContain("isSmsComplianceOnlyInbound");
    expect(lib).toContain("sms_weekly_send_events");

    // Hard boundary: production send/generate must not import reply report
    for (const f of [
      "src/app/api/cron/daily-sms/route.ts",
      "src/lib/tyler-text-overview-evening-send.ts",
      "src/lib/tyler-text-overview-generate.ts",
      "src/lib/daily-sms-scheduling.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src).not.toContain("tyler-text-overview-reply-report");
    }
  });
});

describe("tto reply report API auth", () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
  });

  it("unauthorized rejected", async () => {
    const err = Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
    requireTylerAdminMock.mockRejectedValueOnce(err);
    const { GET } = await import(
      "@/app/api/admin/tyler-text-overview/reply-report/route"
    );
    const res = await GET(
      new Request("http://localhost/api/admin/tyler-text-overview/reply-report?range=30")
    );
    expect(res.status).toBe(401);
  });

  it("authorized report succeeds", async () => {
    requireTylerAdminMock.mockResolvedValue(undefined);
    const { GET } = await import(
      "@/app/api/admin/tyler-text-overview/reply-report/route"
    );
    const res = await GET(
      new Request("http://localhost/api/admin/tyler-text-overview/reply-report?range=7")
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.report.range).toBe("7");
    expect(json.report.members).toEqual([]);
  });
});
