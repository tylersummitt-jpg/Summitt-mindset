import { beforeEach, describe, expect, it, vi } from "vitest";

type StoredIntent = Record<string, string | null>;

const calls: Array<{ method: string; args: unknown[] }> = [];
let table: StoredIntent[] = [];

function query(rows: StoredIntent[]) {
  let current = rows.slice();
  let patch: StoredIntent | null = null;
  const api = {
    select() {
      calls.push({ method: "select", args: [] });
      if (!patch) return api;
      const matched = current.slice();
      for (const row of rows) {
        if (matched.some((item) => item.id === row.id)) Object.assign(row, patch);
      }
      patch = null;
      return Promise.resolve({
        data: matched.map((row) => ({ id: row.id })),
        error: null,
      });
    },
    update(value: StoredIntent) {
      calls.push({ method: "update", args: [value] });
      patch = value;
      return api;
    },
    eq(column: string, value: string) {
      calls.push({ method: "eq", args: [column, value] });
      current = current.filter((row) => row[column] === value);
      return api;
    },
    gt(column: string, value: string) {
      calls.push({ method: "gt", args: [column, value] });
      current = current.filter((row) => {
        const cell = row[column];
        return typeof cell === "string" && cell > value;
      });
      return api;
    },
    not(column: string, operator: string, value: unknown) {
      calls.push({ method: "not", args: [column, operator, value] });
      if (operator === "is" && value === null) {
        current = current.filter((row) => row[column] != null);
      }
      return api;
    },
    is(column: string, value: unknown) {
      calls.push({ method: "is", args: [column, value] });
      if (value === null) current = current.filter((row) => row[column] == null);
      return api;
    },
    order(column: string) {
      calls.push({ method: "order", args: [column] });
      current = current
        .slice()
        .sort((left, right) => String(left[column]).localeCompare(String(right[column])));
      return api;
    },
    limit(count: number) {
      calls.push({ method: "limit", args: [count] });
      return Promise.resolve({ data: current.slice(0, count), error: null });
    },
  };
  return api;
}

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => query(table),
  },
}));

import { readFileSync } from "node:fs";

import {
  loadPrepareEligibleIntents,
  markPrepareClosed,
} from "@/lib/stripe-first-checkout/intent-store";
import {
  confirmedTrialIsAfterPrepareCutoff,
  readPrepareAfterCutoff,
} from "@/lib/stripe-first-checkout/prepare-cutoff";

const CUTOFF = "2026-12-01T00:00:00.000Z";
const NOW = "2026-12-01T12:00:00.000Z";

function row(confirmedAt: string, overrides: StoredIntent = {}): StoredIntent {
  return {
    id: `intent_${confirmedAt}`,
    stripe_trial_confirmed_at: confirmedAt,
    stripe_trial_end_at: "2026-12-20T00:00:00.000Z",
    stripe_subscription_id: "sub_1",
    stripe_checkout_session_id: "cs_1",
    clerk_user_provisioned_at: null,
    sign_in_required_at: null,
    session_started_at: null,
    hold_released_at: null,
    prepare_closed_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  calls.length = 0;
  table = [];
});

describe("prepare cutoff", () => {
  it("selects nothing when the cutoff is missing, empty, or not strict UTC", () => {
    expect(readPrepareAfterCutoff(undefined)).toBeNull();
    expect(readPrepareAfterCutoff(null)).toBeNull();
    expect(readPrepareAfterCutoff("")).toBeNull();
    expect(readPrepareAfterCutoff("   ")).toBeNull();
    expect(readPrepareAfterCutoff("2026-12-01")).toBeNull();
    expect(readPrepareAfterCutoff("2026-12-01T00:00:00")).toBeNull();
    expect(readPrepareAfterCutoff("2026-12-01T00:00:00-05:00")).toBeNull();
    expect(readPrepareAfterCutoff("2026-12-01T00:00:00+00:00")).toBeNull();
    expect(readPrepareAfterCutoff("2026-13-01T00:00:00Z")).toBeNull();
  });

  it("accepts an explicit UTC instant and excludes the exact cutoff", async () => {
    expect(readPrepareAfterCutoff("2026-12-01T00:00:00Z")).toBe(CUTOFF);
    table = [
      row(CUTOFF, { id: "exact" }),
      row("2026-12-01T00:00:00.001Z", { id: "after" }),
    ];
    const selected = await loadPrepareEligibleIntents(CUTOFF, 10, NOW);
    expect(selected.map((intent) => intent.id)).toEqual(["after"]);
  });

  it("applies the cutoff before ordering and the page limit", async () => {
    table = Array.from({ length: 40 }, (_, index) =>
      row(`2026-11-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`, {
        id: `old_${index}`,
      })
    );
    table.push(row("2026-12-02T00:00:00.000Z", { id: "new_customer" }));
    table.push(
      row("2026-12-03T00:00:00.000Z", {
        id: "expired",
        stripe_trial_end_at: "2026-12-01T00:00:00.000Z",
      })
    );
    table.push(
      row("2026-12-04T00:00:00.000Z", {
        id: "prepared",
        clerk_user_provisioned_at: "2026-12-04T01:00:00.000Z",
      })
    );

    const selected = await loadPrepareEligibleIntents(CUTOFF, 10, NOW);
    expect(selected.map((intent) => intent.id)).toEqual(["new_customer"]);

    const methods = calls.map((call) => call.method);
    const cutoffFilter = calls.findIndex(
      (call) => call.method === "gt" && call.args[0] === "stripe_trial_confirmed_at"
    );
    const ordered = methods.indexOf("order");
    const limited = methods.indexOf("limit");
    const closedFilter = calls.findIndex(
      (call) => call.method === "is" && call.args[0] === "prepare_closed_at"
    );
    expect(cutoffFilter).toBeGreaterThanOrEqual(0);
    expect(closedFilter).toBeGreaterThanOrEqual(0);
    expect(cutoffFilter).toBeLessThan(ordered);
    expect(closedFilter).toBeLessThan(ordered);
    expect(ordered).toBeLessThan(limited);
    expect(calls[limited]?.args).toEqual([10]);
  });

  it("uses one strict-after comparison for the webhook and the hourly pass", () => {
    expect(confirmedTrialIsAfterPrepareCutoff("2026-12-01T00:00:00.000Z", CUTOFF)).toBe(false);
    expect(confirmedTrialIsAfterPrepareCutoff("2026-12-01T00:00:00.001Z", CUTOFF)).toBe(true);
    expect(confirmedTrialIsAfterPrepareCutoff("2026-11-09T15:52:37.000Z", CUTOFF)).toBe(false);
    expect(confirmedTrialIsAfterPrepareCutoff("2026-12-02T00:00:00.000Z", undefined)).toBe(false);
    expect(confirmedTrialIsAfterPrepareCutoff("2026-12-02T00:00:00.000Z", "   ")).toBe(false);
    expect(
      confirmedTrialIsAfterPrepareCutoff("2026-12-02T00:00:00.000Z", "2026-12-01T00:00:00-05:00")
    ).toBe(false);
    expect(confirmedTrialIsAfterPrepareCutoff(null, CUTOFF)).toBe(false);

    const webhook = readFileSync("src/lib/stripe-first-checkout/reconcile.ts", "utf8");
    const pass = readFileSync(
      "src/lib/stripe-first-checkout/prepare-confirmed-pass.ts",
      "utf8"
    );
    const query = readFileSync("src/lib/stripe-first-checkout/intent-store.ts", "utf8");
    expect(webhook).toContain("confirmedTrialIsAfterPrepareCutoff");
    expect(webhook).toContain("stripe_trial_confirmed_at");
    expect(pass).toContain("readPrepareAfterCutoff");
    expect(pass).toContain("confirmedMs <= cutoffMs");
    expect(query).toContain('.gt("stripe_trial_confirmed_at", cutoff)');
    expect(query).toContain('.is("prepare_closed_at", null)');
    const closedAt = query.indexOf('.is("prepare_closed_at", null)');
    const orderedAt = query.indexOf('.order("stripe_trial_confirmed_at"');
    expect(closedAt).toBeGreaterThan(0);
    expect(closedAt).toBeLessThan(orderedAt);
  });

  it("drops a closed intent before the page limit and does not close a provisioned row", async () => {
    table = [
      row("2026-12-02T00:00:00.000Z", {
        id: "closed",
        prepare_closed_at: "2026-12-02T01:00:00.000Z",
      }),
      row("2026-12-02T00:00:01.000Z", { id: "open" }),
    ];
    const selected = await loadPrepareEligibleIntents(CUTOFF, 10, NOW);
    expect(selected.map((intent) => intent.id)).toEqual(["open"]);

    table = [
      row("2026-12-02T00:00:01.000Z", {
        id: "provisioned",
        clerk_user_id: "user_ready",
        clerk_user_provisioned_at: "2026-12-02T01:00:00.000Z",
      }),
    ];
    await expect(markPrepareClosed("provisioned")).resolves.toBe(false);
    expect(table[0]?.prepare_closed_at).toBeNull();
    expect(table[0]?.clerk_user_id).toBe("user_ready");

    table = [row("2026-12-02T00:00:01.000Z", { id: "terminal" })];
    const [first, second] = await Promise.all([
      markPrepareClosed("terminal"),
      markPrepareClosed("terminal"),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(table[0]?.prepare_closed_at).toBeTruthy();
    expect(table[0]?.clerk_user_id ?? null).toBeNull();
  });

  it("does not query when the cutoff is blank", async () => {
    table = [row("2026-12-02T00:00:00.000Z", { id: "new_customer" })];
    await expect(loadPrepareEligibleIntents("  ", 10, NOW)).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });
});
