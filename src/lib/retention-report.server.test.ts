import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const orFilters: string[] = [];
const claimPayloads: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        claimPayloads.push(payload);
        return {
          eq: () => ({
            or: (filter: string) => {
              orFilters.push(filter);
              return {
                select: () => Promise.resolve({ data: [{ id: 1 }], error: null }),
              };
            },
          }),
        };
      },
    }),
  },
}));

import { RETENTION_REPORT_CLAIM_STALE_MS } from "@/lib/retention-report";
import { claimRetentionReport } from "@/lib/retention-report.server";

const NOW = Date.parse("2026-11-01T16:00:00.000Z");

beforeEach(() => {
  orFilters.length = 0;
  claimPayloads.length = 0;
});

describe("claimRetentionReport PostgREST filter", () => {
  it("quotes the cutoff timestamp inside the or filter", async () => {
    const result = await claimRetentionReport("11111111-1111-4111-8111-111111111111", NOW);
    const cutoff = new Date(NOW - RETENTION_REPORT_CLAIM_STALE_MS)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");
    expect(cutoff).toMatch(/T\d{2}:\d{2}:\d{2}Z/);
    expect(orFilters).toEqual([
      `state.neq.running,started_at.is.null,started_at.lt."${cutoff}"`,
    ]);
    expect(orFilters[0]).not.toContain(`started_at.lt.${cutoff}`);
    expect(result).toBe("claimed");
    expect(claimPayloads[0]).toMatchObject({
      state: "running",
      run_token: "11111111-1111-4111-8111-111111111111",
      error: null,
    });
    expect(claimPayloads[0]).not.toHaveProperty("report");
  });
});
