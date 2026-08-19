import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: fromMock },
}));

import {
  loadWeeklyAccountabilityEventsReadOnly,
  weeklyAccountabilityWeekUtcRange,
  WEEKLY_ACCOUNTABILITY_IN_WEEK_EVENT_CAP,
} from "@/lib/weekly-tto-accountability-events";

type EventRow = {
  id: string;
  commitment_id: string;
  clerk_user_id: string;
  event_type: string;
  occurred_at: string;
  source: string | null;
  payload_json: unknown;
};

type CapturedQuery = {
  eqs: Record<string, unknown>;
  inVals: unknown[] | null;
  gte: { col: string; val: string } | null;
  lt: { col: string; val: string } | null;
  orders: Array<{ col: string; ascending?: boolean }>;
  limit: number | null;
};

function ev(
  over: Partial<EventRow> & { occurred_at: string; event_type: string }
): EventRow {
  return {
    id: over.id ?? over.occurred_at,
    commitment_id: "cmt_1",
    clerk_user_id: "user_1",
    source: "sms_v2",
    payload_json: {},
    ...over,
  };
}

function makeEventTable(allRows: EventRow[]): { api: Record<string, unknown>; captured: CapturedQuery } {
  const captured: CapturedQuery = {
    eqs: {},
    inVals: null,
    gte: null,
    lt: null,
    orders: [],
    limit: null,
  };

  const execute = async () => {
    let rows = allRows.slice();
    if (captured.eqs.commitment_id != null) {
      rows = rows.filter((r) => r.commitment_id === captured.eqs.commitment_id);
    }
    if (captured.eqs.clerk_user_id != null) {
      rows = rows.filter((r) => r.clerk_user_id === captured.eqs.clerk_user_id);
    }
    if (captured.inVals) {
      rows = rows.filter((r) => captured.inVals!.includes(r.event_type));
    }
    if (captured.gte?.col === "occurred_at") {
      rows = rows.filter((r) => r.occurred_at >= captured.gte!.val);
    }
    if (captured.lt?.col === "occurred_at") {
      rows = rows.filter((r) => r.occurred_at < captured.lt!.val);
    }
    rows.sort((a, b) => {
      for (const ord of captured.orders) {
        const av = String((a as Record<string, unknown>)[ord.col] ?? "");
        const bv = String((b as Record<string, unknown>)[ord.col] ?? "");
        if (av === bv) continue;
        const cmp = av < bv ? -1 : 1;
        return ord.ascending === false ? -cmp : cmp;
      }
      return 0;
    });
    if (captured.limit != null) {
      rows = rows.slice(0, captured.limit);
    }
    return {
      data: rows.map(({ commitment_id: _c, clerk_user_id: _u, ...rest }) => rest),
      error: null,
    };
  };

  const api: Record<string, unknown> = {};
  api.select = () => api;
  api.eq = (col: string, val: unknown) => {
    captured.eqs[col] = val;
    return api;
  };
  api.in = (_col: string, vals: unknown[]) => {
    captured.inVals = vals;
    return api;
  };
  api.gte = (col: string, val: string) => {
    captured.gte = { col, val };
    return api;
  };
  api.lt = (col: string, val: string) => {
    captured.lt = { col, val };
    return api;
  };
  api.order = (col: string, opts?: { ascending?: boolean }) => {
    captured.orders.push({ col, ascending: opts?.ascending });
    return api;
  };
  api.limit = (n: number) => {
    captured.limit = n;
    return api;
  };
  api.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => execute().then(onFulfilled, onRejected);

  return { api, captured };
}

const WEEK_NY = {
  commitmentId: "cmt_1",
  clerkUserId: "user_1",
  timezone: "America/New_York",
  weekStartLocalDate: "2026-07-06",
  weekEndLocalDate: "2026-07-12",
} as const;

describe("weekly accountability event tape", () => {
  let captured: CapturedQuery | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    captured = null;
  });

  function install(rows: EventRow[]) {
    const table = makeEventTable(rows);
    captured = table.captured;
    fromMock.mockReturnValue(table.api);
    return table.captured;
  }

  it("returns current-week yes even when more than 80 historical events exist", async () => {
    const old: EventRow[] = [];
    for (let i = 0; i < 100; i++) {
      const day = String(1 + (i % 28)).padStart(2, "0");
      old.push(
        ev({
          id: `old-${String(i).padStart(3, "0")}`,
          event_type: "user_yes",
          occurred_at: `2026-05-${day}T16:00:00.000Z`,
        })
      );
    }
    const currentWeekYes = ev({
      id: "week-yes",
      event_type: "user_yes",
      occurred_at: "2026-07-10T16:00:00.000Z",
      payload_json: { user_visible_proof_line: "You named the walk honestly." },
    });
    const q = install([...old, currentWeekYes]);

    const events = await loadWeeklyAccountabilityEventsReadOnly(WEEK_NY);

    expect(q.gte).toEqual(
      expect.objectContaining({ col: "occurred_at", val: "2026-07-06T04:00:00.000Z" })
    );
    expect(q.lt).toEqual(
      expect.objectContaining({ col: "occurred_at", val: "2026-07-13T04:00:00.000Z" })
    );
    expect(q.limit).toBe(WEEKLY_ACCOUNTABILITY_IN_WEEK_EVENT_CAP);
    expect(events.map((e) => e.event_type)).toEqual(["user_yes"]);
    expect(events[0]?.occurred_at).toBe("2026-07-10T16:00:00.000Z");
    expect(events[0]?.user_visible_proof_line).toBe("You named the walk honestly.");
  });

  it("keeps Mon no / Tue partial / Fri yes in chronological order", async () => {
    install([
      ev({
        id: "fri",
        event_type: "user_yes",
        occurred_at: "2026-07-10T16:00:00.000Z",
      }),
      ev({
        id: "mon",
        event_type: "user_no",
        occurred_at: "2026-07-06T16:00:00.000Z",
      }),
      ev({
        id: "tue",
        event_type: "user_partial",
        occurred_at: "2026-07-07T16:00:00.000Z",
      }),
    ]);

    const events = await loadWeeklyAccountabilityEventsReadOnly(WEEK_NY);
    expect(events.map((e) => e.event_type)).toEqual(["user_no", "user_partial", "user_yes"]);
    expect(events.map((e) => e.local_day_key)).toEqual([
      "2026-07-06",
      "2026-07-07",
      "2026-07-10",
    ]);
  });

  it("includes Sunday 11:59 PM member-local", async () => {
    install([
      ev({
        id: "sun-late",
        event_type: "user_yes",
        occurred_at: "2026-07-13T03:59:00.000Z",
      }),
    ]);
    const events = await loadWeeklyAccountabilityEventsReadOnly(WEEK_NY);
    expect(events).toHaveLength(1);
    expect(events[0]?.local_day_key).toBe("2026-07-12");
    expect(events[0]?.event_type).toBe("user_yes");
  });

  it("excludes next Monday 12:00 AM member-local", async () => {
    install([
      ev({
        id: "next-mon",
        event_type: "user_yes",
        occurred_at: "2026-07-13T04:00:00.000Z",
      }),
    ]);
    const events = await loadWeeklyAccountabilityEventsReadOnly(WEEK_NY);
    expect(events).toEqual([]);
  });

  it("uses member-local week bounds when UTC date differs from local date", async () => {
    const range = weeklyAccountabilityWeekUtcRange(WEEK_NY);
    expect(range?.weekStartUtcIso).toBe("2026-07-06T04:00:00.000Z");
    expect(range?.nextWeekStartUtcIso).toBe("2026-07-13T04:00:00.000Z");

    install([
      ev({
        id: "utc-next-calendar-still-sunday-local",
        event_type: "user_no",
        occurred_at: "2026-07-13T03:59:59.000Z",
      }),
    ]);
    const events = await loadWeeklyAccountabilityEventsReadOnly(WEEK_NY);
    expect(events).toHaveLength(1);
    expect(events[0]?.local_day_key).toBe("2026-07-12");
    expect(new Date(events[0]!.occurred_at).toISOString().slice(0, 10)).toBe("2026-07-13");
  });

  it("excludes another commitment's current-week events", async () => {
    install([
      ev({
        id: "other-cmt",
        commitment_id: "cmt_other",
        event_type: "user_yes",
        occurred_at: "2026-07-10T16:00:00.000Z",
      }),
      ev({
        id: "mine",
        event_type: "user_no",
        occurred_at: "2026-07-09T16:00:00.000Z",
      }),
    ]);
    const events = await loadWeeklyAccountabilityEventsReadOnly(WEEK_NY);
    expect(captured?.eqs.commitment_id).toBe("cmt_1");
    expect(events.map((e) => e.event_type)).toEqual(["user_no"]);
  });

  it("excludes another user's current-week events", async () => {
    install([
      ev({
        id: "other-user",
        clerk_user_id: "user_other",
        event_type: "user_yes",
        occurred_at: "2026-07-10T16:00:00.000Z",
      }),
      ev({
        id: "mine",
        event_type: "user_partial",
        occurred_at: "2026-07-08T16:00:00.000Z",
      }),
    ]);
    const events = await loadWeeklyAccountabilityEventsReadOnly(WEEK_NY);
    expect(captured?.eqs.clerk_user_id).toBe("user_1");
    expect(events.map((e) => e.event_type)).toEqual(["user_partial"]);
  });

  it("preserves proof line only from returned canonical events", async () => {
    install([
      ev({
        id: "no-proof",
        event_type: "user_no",
        occurred_at: "2026-07-06T16:00:00.000Z",
        payload_json: {},
      }),
      ev({
        id: "yes-proof",
        event_type: "user_yes",
        occurred_at: "2026-07-09T16:00:00.000Z",
        payload_json: { user_visible_proof_line: "You named the walk honestly." },
      }),
      ev({
        id: "outside",
        event_type: "user_yes",
        occurred_at: "2026-07-13T16:00:00.000Z",
        payload_json: { user_visible_proof_line: "Next-week proof must not leak." },
      }),
    ]);
    const events = await loadWeeklyAccountabilityEventsReadOnly(WEEK_NY);
    expect(events.map((e) => e.event_type)).toEqual(["user_no", "user_yes"]);
    expect(events[1]?.user_visible_proof_line).toBe("You named the walk honestly.");
    expect(JSON.stringify(events)).not.toContain("Next-week proof must not leak");
    expect(JSON.stringify(events)).not.toMatch(/strong_week|rough_week|win_hint/);
  });

  it("returns an empty list when there are no current-week events", async () => {
    install([]);
    const events = await loadWeeklyAccountabilityEventsReadOnly(WEEK_NY);
    expect(events).toEqual([]);
  });

  it("caps more than 50 in-week events deterministically to the oldest 50", async () => {
    const inWeek: EventRow[] = [];
    for (let i = 0; i < 51; i++) {
      const hour = String(10 + Math.floor(i / 10)).padStart(2, "0");
      const minute = String((i % 10) * 6).padStart(2, "0");
      inWeek.push(
        ev({
          id: `cap-${String(i).padStart(2, "0")}`,
          event_type: "user_yes",
          occurred_at: `2026-07-08T${hour}:${minute}:00.000Z`,
        })
      );
    }
    install(inWeek);
    const events = await loadWeeklyAccountabilityEventsReadOnly(WEEK_NY);
    expect(events).toHaveLength(50);
    expect(events[0]?.occurred_at).toBe(inWeek[0]?.occurred_at);
    expect(events[49]?.occurred_at).toBe(inWeek[49]?.occurred_at);
    expect(events.some((e) => e.occurred_at === inWeek[50]?.occurred_at)).toBe(false);
    expect(captured?.limit).toBe(50);
    expect(captured?.orders.map((o) => o.col)).toEqual(["occurred_at", "id"]);
  });
});
