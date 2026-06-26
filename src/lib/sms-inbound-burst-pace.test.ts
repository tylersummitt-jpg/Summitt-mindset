import { beforeEach, describe, expect, it, vi } from "vitest";

type JobRow = {
  message_sid: string;
  clerk_user_id: string;
  from_phone?: string;
  raw_body?: string;
  status: string;
  next_retry_at?: string;
  last_error?: string;
  created_at?: string;
  updated_at?: string;
  sent_at?: string | null;
};

const { jobsStore, mockFrom } = vi.hoisted(() => {
  const jobsStore: JobRow[] = [];
  const mockFrom = vi.fn();
  return { jobsStore, mockFrom };
});

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: mockFrom },
}));

import {
  INBOUND_BURST_QUIET_MS,
  computeInboundBurstQuietRetryAt,
  deferCoachJobForUserInFlight,
  enqueueNormalCoachJobWithBurstQuiet,
  findUserInFlightCoachJobMessageSid,
  formatInboundBurstQuietDeferredLastError,
  slidePendingBurstJobsForUser,
} from "@/lib/sms-inbound-burst-pace";

function chainBuilder(table: string) {
  if (table !== "sms_inbound_coach_jobs") {
    throw new Error(`unexpected table ${table}`);
  }

  let filters: Array<(row: JobRow) => boolean> = [];
  let op: "select" | "insert" | "update" = "select";
  let insertRow: Partial<JobRow> | null = null;
  let updatePatch: Partial<JobRow> | null = null;
  let orderKey: keyof JobRow | null = null;
  let orderAsc = true;
  let limitN: number | null = null;
  let maybeSingle = false;

  const applyFilters = () => jobsStore.filter((row) => filters.every((f) => f(row)));

  const execute = async () => {
    if (op === "insert" && insertRow) {
      const sid = insertRow.message_sid;
      if (sid && jobsStore.some((j) => j.message_sid === sid)) {
        return { data: null, error: { code: "23505", message: "duplicate" } };
      }
      jobsStore.push({
        status: "pending",
        ...insertRow,
      } as JobRow);
      return { data: null, error: null };
    }

    let rows = applyFilters();
    if (orderKey) {
      rows = [...rows].sort((a, b) => {
        const av = a[orderKey!];
        const bv = b[orderKey!];
        if (typeof av === "string" && typeof bv === "string") {
          return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        return 0;
      });
    }
    if (limitN != null) rows = rows.slice(0, limitN);

    if (op === "update" && updatePatch) {
      const updated: JobRow[] = [];
      for (const row of rows) {
        Object.assign(row, updatePatch);
        updated.push(row);
      }
      return { data: maybeSingle ? updated[0] ?? null : updated, error: null };
    }

    return { data: maybeSingle ? rows[0] ?? null : rows, error: null };
  };

  const api = {
    select: () => api,
    insert: (row: Partial<JobRow>) => {
      op = "insert";
      insertRow = row;
      return api;
    },
    update: (patch: Partial<JobRow>) => {
      op = "update";
      updatePatch = patch;
      return api;
    },
    eq: (col: keyof JobRow, val: unknown) => {
      filters.push((r) => r[col] === val);
      return api;
    },
    neq: (col: keyof JobRow, val: unknown) => {
      filters.push((r) => r[col] !== val);
      return api;
    },
    in: (col: keyof JobRow, vals: unknown[]) => {
      filters.push((r) => vals.includes(r[col]));
      return api;
    },
    is: (col: keyof JobRow, val: unknown) => {
      filters.push((r) => r[col] === val);
      return api;
    },
    gt: (col: keyof JobRow, val: unknown) => {
      filters.push((r) => {
        const a = r[col];
        return typeof a === "string" && typeof val === "string" ? a > val : false;
      });
      return api;
    },
    gte: (col: keyof JobRow, val: unknown) => {
      filters.push((r) => {
        const a = r[col];
        return typeof a === "string" && typeof val === "string" ? a >= val : false;
      });
      return api;
    },
    lt: (col: keyof JobRow, val: unknown) => {
      filters.push((r) => {
        const a = r[col];
        return typeof a === "string" && typeof val === "string" ? a < val : false;
      });
      return api;
    },
    lte: (col: keyof JobRow, val: unknown) => {
      filters.push((r) => {
        const a = r[col];
        return typeof a === "string" && typeof val === "string" ? a <= val : false;
      });
      return api;
    },
    order: (col: keyof JobRow, opts?: { ascending?: boolean }) => {
      orderKey = col;
      orderAsc = opts?.ascending !== false;
      return api;
    },
    limit: (n: number) => {
      limitN = n;
      return api;
    },
    maybeSingle: () => {
      maybeSingle = true;
      return api;
    },
    then: (
      onFulfilled?: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown
    ) => Promise.resolve(execute()).then(onFulfilled, onRejected),
  };

  return api;
}

beforeEach(() => {
  jobsStore.length = 0;
  mockFrom.mockReset();
  mockFrom.mockImplementation((table: string) => chainBuilder(table));
});

describe("sms-inbound-burst-pace — quiet window helpers", () => {
  it("computeInboundBurstQuietRetryAt uses 45s window", () => {
    const nowMs = 1_700_000_000_000;
    expect(computeInboundBurstQuietRetryAt(nowMs)).toBe(
      new Date(nowMs + INBOUND_BURST_QUIET_MS).toISOString()
    );
    expect(INBOUND_BURST_QUIET_MS).toBe(45_000);
  });

  it("formatInboundBurstQuietDeferredLastError encodes window and deferrer", () => {
    const s = formatInboundBurstQuietDeferredLastError({
      windowMs: 45_000,
      deferredAt: "2026-06-25T12:00:00.000Z",
      deferredByMessageSid: "SMaaa",
    });
    expect(s).toContain("inbound_burst_quiet_deferred");
    expect(s).toContain("w=45000");
    expect(s).toContain("by=SMaaa");
  });
});

describe("sms-inbound-burst-pace — enqueue + slide", () => {
  const nowMs = Date.parse("2026-06-25T12:00:00.000Z");

  it("normal inbound job is enqueued with next_retry_at now + quiet window", async () => {
    await enqueueNormalCoachJobWithBurstQuiet({
      messageSid: "SM1",
      clerkUserId: "user_a",
      fromPhone: "+15551234567",
      rawBody: "fragment one",
      nowMs,
    });

    expect(jobsStore).toHaveLength(1);
    expect(jobsStore[0]!.next_retry_at).toBe(computeInboundBurstQuietRetryAt(nowMs));
    expect(jobsStore[0]!.last_error).toContain("inbound_burst_quiet_deferred");
  });

  it("duplicate webhook same MessageSid still produces one job", async () => {
    await enqueueNormalCoachJobWithBurstQuiet({
      messageSid: "SMdup",
      clerkUserId: "user_a",
      fromPhone: "+15551234567",
      rawBody: "same",
      nowMs,
    });
    await enqueueNormalCoachJobWithBurstQuiet({
      messageSid: "SMdup",
      clerkUserId: "user_a",
      fromPhone: "+15551234567",
      rawBody: "same",
      nowMs: nowMs + 1_000,
    });
    expect(jobsStore.filter((j) => j.message_sid === "SMdup")).toHaveLength(1);
  });

  it("second normal inbound slides pending sibling next_retry_at forward", async () => {
    jobsStore.push({
      message_sid: "SMold",
      clerk_user_id: "user_a",
      status: "pending",
      created_at: new Date(nowMs - 10_000).toISOString(),
      next_retry_at: computeInboundBurstQuietRetryAt(nowMs - 10_000),
      raw_body: "first",
    });

    const slid = await slidePendingBurstJobsForUser({
      clerkUserId: "user_a",
      deferredByMessageSid: "SMnew",
      nowMs,
    });

    expect(slid).toBe(1);
    expect(jobsStore[0]!.next_retry_at).toBe(computeInboundBurstQuietRetryAt(nowMs));
    expect(jobsStore[0]!.last_error).toContain("by=SMnew");
  });
});

describe("sms-inbound-burst-pace — per-user in-flight gate", () => {
  it("findUserInFlightCoachJobMessageSid returns blocking job for same user", async () => {
    jobsStore.push({
      message_sid: "SMflight",
      clerk_user_id: "user_a",
      status: "generating_reply",
      sent_at: null,
      updated_at: "2026-06-25T12:00:01.000Z",
    });
    jobsStore.push({
      message_sid: "SMpending",
      clerk_user_id: "user_a",
      status: "pending",
      sent_at: null,
    });

    const blocking = await findUserInFlightCoachJobMessageSid("user_a", "SMpending");
    expect(blocking).toBe("SMflight");
  });

  it("different users are unaffected by in-flight lookup", async () => {
    jobsStore.push({
      message_sid: "SMflight",
      clerk_user_id: "user_a",
      status: "processing",
      sent_at: null,
    });

    const blocking = await findUserInFlightCoachJobMessageSid("user_b", "SMother");
    expect(blocking).toBeNull();
  });

  it("deferCoachJobForUserInFlight sets quiet retry and marker", async () => {
    jobsStore.push({
      message_sid: "SMwait",
      clerk_user_id: "user_a",
      status: "pending",
      next_retry_at: "2026-06-25T12:00:00.000Z",
    });

    const nowMs = Date.parse("2026-06-25T12:00:30.000Z");
    await deferCoachJobForUserInFlight({
      messageSid: "SMwait",
      blockingMessageSid: "SMflight",
      nowMs,
    });

    expect(jobsStore[0]!.next_retry_at).toBe(computeInboundBurstQuietRetryAt(nowMs));
    expect(jobsStore[0]!.last_error).toContain("inbound_user_in_flight_deferred");
    expect(jobsStore[0]!.last_error).toContain("by=SMflight");
  });
});
