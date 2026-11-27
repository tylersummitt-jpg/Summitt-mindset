import { beforeEach, describe, expect, it, vi } from "vitest";

const inserts: Array<Record<string, unknown>> = [];
let rateCount = 0;
let insertError: { code?: string } | null = null;
let throwOnFrom = false;
let insertGate: Promise<void> | null = null;

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => {
      if (throwOnFrom) throw new Error("db down");
      return {
        select: () => ({
          eq: () => ({
            gte: async () => ({ count: rateCount, error: null }),
            eq: async () => ({ count: 0, error: null }),
          }),
        }),
        insert: async (row: Record<string, unknown>) => {
          if (insertGate) await insertGate;
          inserts.push(row);
          return { error: insertError };
        },
      };
    },
  },
}));

import {
  recordOnboardingDiagnostic,
  scheduleOnboardingDiagnostic,
} from "@/lib/onboarding-journey-diagnostics.server";

const base = {
  clerkUserId: "user_1",
  step: "identity" as const,
  journeyId: "journey_1",
  userAgent: "Mozilla/5.0 (iPhone) Version/17.0 Mobile/15E148 Safari/604.1",
  source: "server" as const,
};

describe("recordOnboardingDiagnostic", () => {
  beforeEach(() => {
    inserts.length = 0;
    rateCount = 0;
    insertError = null;
    throwOnFrom = false;
    insertGate = null;
  });

  it("stores a bounded row and keeps a second attempt", async () => {
    await recordOnboardingDiagnostic({
      ...base,
      outcome: "request_received",
      attemptId: "attempt_a",
    });
    await recordOnboardingDiagnostic({
      ...base,
      outcome: "save_failed",
      errorCode: "persistence",
      attemptId: "attempt_a",
    });
    await recordOnboardingDiagnostic({
      ...base,
      outcome: "request_received",
      attemptId: "attempt_b",
    });
    expect(inserts).toHaveLength(3);
    expect(inserts[0]).toMatchObject({
      clerk_user_id: "user_1",
      step: "identity",
      outcome: "request_received",
      error_code: "none",
      client_shell: "browser",
      device_class: "phone",
      browser_family: "safari",
      source: "server",
    });
    expect(inserts[0]?.idempotency_key).toBe(inserts[0]?.idempotency_key);
    expect(inserts[2]?.idempotency_key).not.toBe(inserts[0]?.idempotency_key);
    expect(JSON.stringify(inserts)).not.toMatch(/identity text|password|\+1/);
  });

  it("treats a duplicate delivery as success", async () => {
    insertError = { code: "23505" };
    await expect(
      recordOnboardingDiagnostic({
        ...base,
        outcome: "submission_attempted",
        attemptId: "attempt_a",
        source: "client",
      })
    ).resolves.toBeUndefined();
  });

  it("drops events over the per-minute cap", async () => {
    rateCount = 30;
    await recordOnboardingDiagnostic({
      ...base,
      outcome: "step_reached",
      attemptId: "attempt_a",
    });
    expect(inserts).toHaveLength(0);
  });

  it("schedules a slow write without waiting for it", async () => {
    let release: () => void = () => undefined;
    insertGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = performance.now();
    scheduleOnboardingDiagnostic({
      ...base,
      outcome: "step_reached",
      attemptId: "attempt_slow",
    });
    expect(performance.now() - started).toBeLessThan(50);
    expect(inserts).toHaveLength(0);
    release();
    await vi.waitFor(() => expect(inserts).toHaveLength(1));
  });

  it("fails open when the database throws", async () => {
    throwOnFrom = true;
    await expect(
      recordOnboardingDiagnostic({
        ...base,
        outcome: "step_reached",
        attemptId: "attempt_a",
      })
    ).resolves.toBeUndefined();
  });
});
