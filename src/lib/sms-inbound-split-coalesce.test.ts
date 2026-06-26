import { beforeEach, describe, expect, it, vi } from "vitest";

type JobRow = {
  message_sid: string;
  clerk_user_id: string;
  raw_body: string;
  status: string;
  created_at: string;
  last_error?: string;
  next_retry_at?: string;
};

const { jobsStore, mockFrom } = vi.hoisted(() => {
  const jobsStore: JobRow[] = [];
  const mockFrom = vi.fn();
  return { jobsStore, mockFrom };
});

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: mockFrom },
}));

import { coalesceOlderPendingSplitJobsForClaimedJob } from "@/lib/sms-inbound-split-coalesce";

function chainBuilder(table: string) {
  if (table !== "sms_inbound_coach_jobs") throw new Error(table);

  let filters: Array<(row: JobRow) => boolean> = [];
  let op: "select" | "update" = "select";
  let updatePatch: Partial<JobRow> | null = null;
  let orderAsc = true;

  const applyFilters = () => jobsStore.filter((row) => filters.every((f) => f(row)));

  const execute = async () => {
    let rows = applyFilters();
    if (op === "select") {
      rows = [...rows].sort((a, b) =>
        orderAsc ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)
      );
      return { data: rows, error: null };
    }
    if (op === "update" && updatePatch) {
      for (const row of rows) Object.assign(row, updatePatch);
      return { data: null, error: null };
    }
    return { data: rows, error: null };
  };

  const api = {
    select: () => api,
    update: (patch: Partial<JobRow>) => {
      op = "update";
      updatePatch = patch;
      return api;
    },
    eq: (col: keyof JobRow, val: unknown) => {
      filters.push((r) => r[col] === val);
      return api;
    },
    lt: (col: keyof JobRow, val: unknown) => {
      filters.push((r) => {
        const a = r[col];
        return typeof a === "string" && typeof val === "string" ? a < val : false;
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
    order: (_col: keyof JobRow, opts?: { ascending?: boolean }) => {
      orderAsc = opts?.ascending !== false;
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

describe("coalesceOlderPendingSplitJobsForClaimedJob", () => {
  const baseCreated = "2026-06-25T12:00:30.000Z";

  it("merges older pending fragments and cancels elders", async () => {
    jobsStore.push(
      {
        message_sid: "SM1",
        clerk_user_id: "user_a",
        raw_body: "part one",
        status: "pending",
        created_at: "2026-06-25T12:00:10.000Z",
      },
      {
        message_sid: "SM2",
        clerk_user_id: "user_a",
        raw_body: "part two",
        status: "pending",
        created_at: "2026-06-25T12:00:20.000Z",
      },
      {
        message_sid: "SM3",
        clerk_user_id: "user_a",
        raw_body: "part three",
        status: "processing",
        created_at: baseCreated,
      }
    );

    const result = await coalesceOlderPendingSplitJobsForClaimedJob({
      message_sid: "SM3",
      clerk_user_id: "user_a",
      created_at: baseCreated,
      raw_body: "part three",
    });

    expect(result.cancelledMessageSids).toEqual(["SM1", "SM2"]);
    expect(result.mergedRawBody).toBe("part one\npart two\npart three");
    expect(jobsStore.find((j) => j.message_sid === "SM1")!.status).toBe("cancelled");
    expect(jobsStore.find((j) => j.message_sid === "SM1")!.last_error).toBe(
      "split_inbound_coalesced_into_newer_job"
    );
    expect(jobsStore.find((j) => j.message_sid === "SM3")!.last_error).toContain(
      "inbound_burst_coalesced_count=2"
    );
  });

  it("three fragments inside burst window leave one processing job with two cancelled", async () => {
    jobsStore.push(
      {
        message_sid: "SMa",
        clerk_user_id: "user_a",
        raw_body: "a",
        status: "pending",
        created_at: "2026-06-25T12:00:05.000Z",
      },
      {
        message_sid: "SMb",
        clerk_user_id: "user_a",
        raw_body: "b",
        status: "pending",
        created_at: "2026-06-25T12:00:15.000Z",
      },
      {
        message_sid: "SMc",
        clerk_user_id: "user_a",
        raw_body: "c",
        status: "processing",
        created_at: "2026-06-25T12:00:25.000Z",
      }
    );

    const result = await coalesceOlderPendingSplitJobsForClaimedJob({
      message_sid: "SMc",
      clerk_user_id: "user_a",
      created_at: "2026-06-25T12:00:25.000Z",
      raw_body: "c",
    });

    expect(result.cancelledMessageSids).toHaveLength(2);
    expect(jobsStore.filter((j) => j.status === "cancelled")).toHaveLength(2);
    expect(jobsStore.filter((j) => j.status === "processing")).toHaveLength(1);
    expect(result.mergedRawBody).toBe("a\nb\nc");
  });

  it("returns claimed body unchanged when no elders", async () => {
    const result = await coalesceOlderPendingSplitJobsForClaimedJob({
      message_sid: "SMsolo",
      clerk_user_id: "user_a",
      created_at: baseCreated,
      raw_body: "solo",
    });
    expect(result.mergedRawBody).toBe("solo");
    expect(result.cancelledMessageSids).toEqual([]);
  });
});
