import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

type FailureRow = {
  checkout_intent_id: string;
  step: string;
  error_code: string;
  failed_at: string;
};

let rows: FailureRow[] = [];
let failInserts = false;

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      insert(row: FailureRow) {
        if (failInserts) throw new Error("database down");
        const duplicate = rows.some(
          (existing) =>
            existing.checkout_intent_id === row.checkout_intent_id &&
            existing.step === row.step &&
            existing.error_code === row.error_code
        );
        if (duplicate) return Promise.resolve({ error: { code: "23505" } });
        rows.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

import { recordSignupFailure } from "@/lib/stripe-first-checkout/signup-failures";

beforeEach(() => {
  rows = [];
  failInserts = false;
});

describe("signup failure recorder", () => {
  it("stores one known code and keeps a later distinct code", async () => {
    await recordSignupFailure({
      intentId: "intent_1",
      step: "prepare",
      error: new Error("clerk_create_failed"),
    });
    await recordSignupFailure({
      intentId: "intent_1",
      step: "prepare",
      error: new Error("clerk_lookup_failed"),
    });
    expect(rows.map((row) => row.error_code)).toEqual([
      "clerk_create_failed",
      "clerk_lookup_failed",
    ]);
    expect(rows[0]?.failed_at).toBeTruthy();
  });

  it("does not add a duplicate for the same intent, step, and code", async () => {
    await recordSignupFailure({
      intentId: "intent_1",
      step: "activate",
      error: new Error("clerk_ticket_failed"),
    });
    await recordSignupFailure({
      intentId: "intent_1",
      step: "activate",
      error: new Error("clerk_ticket_failed"),
    });
    expect(rows).toHaveLength(1);
  });

  it("records a known code once when two handlers see the same error", async () => {
    const error = new Error("stripe_clear_hold_failed");
    await recordSignupFailure({ intentId: "intent_1", step: "hold", error });
    await recordSignupFailure({ intentId: "intent_1", step: "activate", error });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.step).toBe("hold");
  });

  it("ignores unknown messages, inactivity, and a normal sign-in result", async () => {
    await recordSignupFailure({
      intentId: "intent_1",
      step: "activate",
      error: new Error("No such customer: cus_secret"),
    });
    await recordSignupFailure({
      intentId: "intent_1",
      step: "link",
      error: new Error("sign_in_required"),
    });
    await recordSignupFailure({
      intentId: " ",
      step: "confirm",
      error: new Error("intent_update_failed"),
    });
    await recordSignupFailure({
      intentId: "intent_1",
      step: "prepare",
      error: "missing_stripe",
    });
    expect(rows).toHaveLength(0);
  });

  it("contains an insert failure", async () => {
    failInserts = true;
    await expect(
      recordSignupFailure({
        intentId: "intent_1",
        step: "hold",
        error: new Error("missing_stripe"),
      })
    ).resolves.toBeUndefined();
  });

  it("wires the five handlers and leaves recovery untouched", () => {
    const activate = readFileSync("src/lib/stripe-first-checkout/activate.ts", "utf8");
    const pass = readFileSync("src/lib/stripe-first-checkout/prepare-confirmed-pass.ts", "utf8");
    const reconcile = readFileSync("src/lib/stripe-first-checkout/reconcile.ts", "utf8");
    const migration = readFileSync(
      "supabase/migrations/20261112180000_checkout_signup_failures.sql",
      "utf8"
    );
    const recovery = activate.slice(activate.indexOf("export async function resumeExistingAccountActivation"));
    expect(activate).toContain('step: "prepare"');
    expect(activate).toContain('step: "activate"');
    expect(activate).toContain('step: "confirm"');
    expect(activate).toContain('step: "link"');
    expect(activate).toContain('step: "hold"');
    expect(pass).toContain('step: "prepare"');
    expect(pass).toContain('step: "hold"');
    expect(reconcile).toContain('step: "hold"');
    expect(recovery).not.toContain("recordSignupFailure");
    expect(migration).toContain("UNIQUE (checkout_intent_id, step, error_code)");
    expect(migration).toContain("ON DELETE CASCADE");
    expect(migration).not.toContain("error_message");
    expect(migration).not.toContain("sign_in_required");
  });
});
