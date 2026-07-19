import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import {
  type ClerkDeletionAdapter,
} from "./clerk-deletion-adapter";
import {
  STAGE_INVALID_RESULT_CODES,
  STAGE_THREW_CODES,
  createTrustedAccountDeletionReconcilerDependencies,
  executeTrustedAccountDeletionReconcile,
  reconcileAccountDeletionRequest,
  type CancelStripeStageFn,
  type DeleteClerkStageFn,
  type PurgeAppDataStageFn,
  type SuppressSmsStageFn,
} from "./reconcile-account-deletion";
import {
  acquireAccountDeletionLease,
  createAccountDeletionRequest,
  getAccountDeletionRequestById,
  releaseAccountDeletionLease,
  transitionAccountDeletionRequest,
  useInMemoryAccountDeletionStoreForTests,
} from "./repository";
import type { AccountDeletionStatus } from "./types";

const WORKER = join(
  process.cwd(),
  "src/lib/account-deletion/reconcile-account-deletion.ts"
);
const APP_DIR = join(process.cwd(), "src/app");
const COMPONENTS_DIR = join(process.cwd(), "src/components");

type CallLog = {
  sms: number;
  stripe: number;
  purge: number;
  clerk: number;
  adapterCalls: number;
};

function emptyLog(): CallLog {
  return { sms: 0, stripe: 0, purge: 0, clerk: 0, adapterCalls: 0 };
}

async function seedToStatus(
  clerkUserId: string,
  key: string,
  target: AccountDeletionStatus
): Promise<string> {
  const created = await createAccountDeletionRequest({
    clerkUserId,
    idempotencyKey: key,
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("create failed");
  const id = created.value.row.id;
  if (target === "requested") return id;

  const owner = "seed-worker";
  const lease = await acquireAccountDeletionLease({
    requestId: id,
    lockOwner: owner,
  });
  expect(lease.ok).toBe(true);

  const path: AccountDeletionStatus[] = [
    "suppressing_sms",
    "sms_suppressed",
    "canceling_subscription",
    "subscription_canceled",
    "purging_app_data",
    "app_data_purged",
    "deleting_clerk",
    "completed",
  ];

  let from: AccountDeletionStatus = "requested";
  for (const to of path) {
    const t = await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: from,
      toStatus: to,
      lockOwner: owner,
      ...(to === "sms_suppressed" ? { smsResult: "ok" as const } : {}),
      ...(to === "subscription_canceled"
        ? { stripeResult: "ok" as const }
        : {}),
      ...(to === "app_data_purged" ? { purgeResult: "ok" as const } : {}),
      ...(to === "completed" ? { clerkResult: "ok" as const } : {}),
    });
    expect(t.ok).toBe(true);
    from = to;
    if (to === target) break;
  }

  await releaseAccountDeletionLease({ requestId: id, lockOwner: owner });
  return id;
}

function noopStages(log: CallLog) {
  const suppressSms: SuppressSmsStageFn = async () => {
    log.sms += 1;
    throw new Error("sms should not run");
  };
  const cancelStripe: CancelStripeStageFn = async () => {
    log.stripe += 1;
    throw new Error("stripe should not run");
  };
  const purgeAppData: PurgeAppDataStageFn = async () => {
    log.purge += 1;
    throw new Error("purge should not run");
  };
  const deleteClerk: DeleteClerkStageFn = async () => {
    log.clerk += 1;
    throw new Error("clerk should not run");
  };
  return { suppressSms, cancelStripe, purgeAppData, deleteClerk };
}

function okSms(log: CallLog): SuppressSmsStageFn {
  return async (input) => {
    log.sms += 1;
    const row = await getAccountDeletionRequestById(input.requestId);
    if (!row) return { ok: false, code: "not_found", message: "missing" };
    return {
      ok: true,
      value: {
        row: {
          ...row,
          status: "sms_suppressed",
          current_step: "sms_suppressed",
          sms_result: "ok",
        },
        suppressResult: "removed",
        clerkMetadataWarning: false,
      },
    };
  };
}

function okStripe(log: CallLog): CancelStripeStageFn {
  return async (input) => {
    log.stripe += 1;
    const row = await getAccountDeletionRequestById(input.requestId);
    if (!row) return { ok: false, code: "not_found", message: "missing" };
    return {
      ok: true,
      value: {
        row: {
          ...row,
          status: "subscription_canceled",
          current_step: "subscription_canceled",
          stripe_result: "ok",
        },
        stripeResult: "ok",
        canceledCount: 0,
        alreadyTerminalCount: 0,
        consideredCount: 0,
      },
    };
  };
}

function okPurge(log: CallLog): PurgeAppDataStageFn {
  return async (input) => {
    log.purge += 1;
    const row = await getAccountDeletionRequestById(input.requestId);
    if (!row) return { ok: false, code: "not_found", message: "missing" };
    return {
      ok: true,
      value: {
        row: {
          ...row,
          status: "app_data_purged",
          current_step: "app_data_purged",
          purge_result: "ok",
        },
        outcome: "app_data_purged",
        purgeResult: "ok",
        counts: {},
      },
    };
  };
}

function okClerk(log: CallLog): DeleteClerkStageFn {
  return async (input) => {
    log.clerk += 1;
    await input.adapter.deleteUser({ clerkUserId: input.clerkUserId });
    log.adapterCalls += 1;
    const row = await getAccountDeletionRequestById(input.requestId);
    if (!row) return { ok: false, code: "not_found", message: "missing" };
    return {
      ok: true,
      value: {
        row: {
          ...row,
          status: "completed",
          current_step: "completed",
          clerk_result: "ok",
        },
        outcome: "completed",
        clerkResult: "ok",
      },
    };
  };
}

function trackingAdapter(log: CallLog): ClerkDeletionAdapter {
  return {
    async deleteUser() {
      log.adapterCalls += 1;
      return { outcome: "deleted" };
    },
  };
}

describe("APP-041E2 trusted execution safety", () => {
  beforeEach(() => {
    useInMemoryAccountDeletionStoreForTests();
  });

  describe("exception normalization", () => {
    it("1–4. SMS stage throws Error with email/token-like text → sms_stage_threw; raw absent; no other stage", async () => {
      const log = emptyLog();
      const base = noopStages(log);
      const suppressSms: SuppressSmsStageFn = async () => {
        log.sms += 1;
        throw new Error("user@example.com Bearer sk_live_abc123 leaked");
      };
      const dependencies = createTrustedAccountDeletionReconcilerDependencies({
        ...base,
        suppressSms,
        clerkAdapter: trackingAdapter(log),
      });
      const id = await seedToStatus("user_e2", "throw-sms", "requested");
      const before = await getAccountDeletionRequestById(id);

      const result = await executeTrustedAccountDeletionReconcile({
        requestId: id,
        lockOwner: "worker-e2",
        dependencies,
      });

      expect(result).toEqual({
        outcome: "retryable_failure",
        stage: "sms",
        code: STAGE_THREW_CODES.sms,
      });
      const json = JSON.stringify(result);
      expect(json).not.toContain("user@example.com");
      expect(json).not.toContain("sk_live");
      expect(json).not.toContain("Bearer");
      expect(log.sms).toBe(1);
      expect(log.stripe + log.purge + log.clerk).toBe(0);
      expect(await getAccountDeletionRequestById(id)).toEqual(before);
    });

    it("5–7. Stripe stage throws raw object → stripe_stage_threw; raw not returned", async () => {
      const log = emptyLog();
      const base = noopStages(log);
      const cancelStripe: CancelStripeStageFn = async () => {
        log.stripe += 1;
        throw { provider: "stripe", secret: "rk_test_xyz", body: { email: "a@b.c" } };
      };
      const dependencies = createTrustedAccountDeletionReconcilerDependencies({
        ...base,
        cancelStripe,
        clerkAdapter: trackingAdapter(log),
      });
      const id = await seedToStatus("user_e2", "throw-stripe", "sms_suppressed");
      const result = await executeTrustedAccountDeletionReconcile({
        requestId: id,
        lockOwner: "w",
        dependencies,
      });
      expect(result).toEqual({
        outcome: "retryable_failure",
        stage: "stripe",
        code: STAGE_THREW_CODES.stripe,
      });
      const json = JSON.stringify(result);
      expect(json).not.toContain("rk_test");
      expect(json).not.toContain("a@b.c");
      expect(log.stripe).toBe(1);
      expect(log.sms + log.purge + log.clerk).toBe(0);
    });

    it("8–9. Purge stage throws string → purge_stage_threw", async () => {
      const log = emptyLog();
      const base = noopStages(log);
      const purgeAppData: PurgeAppDataStageFn = async () => {
        log.purge += 1;
        throw "purge exploded with phone +15551212";
      };
      const dependencies = createTrustedAccountDeletionReconcilerDependencies({
        ...base,
        purgeAppData,
        clerkAdapter: trackingAdapter(log),
      });
      const id = await seedToStatus(
        "user_e2",
        "throw-purge",
        "subscription_canceled"
      );
      const result = await executeTrustedAccountDeletionReconcile({
        requestId: id,
        lockOwner: "w",
        dependencies,
      });
      expect(result).toEqual({
        outcome: "retryable_failure",
        stage: "purge",
        code: STAGE_THREW_CODES.purge,
      });
      expect(JSON.stringify(result)).not.toContain("+15551212");
      expect(log.purge).toBe(1);
      expect(log.sms + log.stripe + log.clerk).toBe(0);
    });

    it("10–12. Clerk stage throws provider-shaped error → clerk_stage_threw; adapter not invoked by worker", async () => {
      const log = emptyLog();
      const base = noopStages(log);
      const deleteClerk: DeleteClerkStageFn = async () => {
        log.clerk += 1;
        throw Object.assign(new Error("Clerk API 500"), {
          clerkError: { clerkUserId: "user_should_not_leak", errors: [] },
        });
      };
      const adapter = trackingAdapter(log);
      const dependencies = createTrustedAccountDeletionReconcilerDependencies({
        ...base,
        deleteClerk,
        clerkAdapter: adapter,
      });
      const id = await seedToStatus("user_e2", "throw-clerk", "app_data_purged");
      const result = await executeTrustedAccountDeletionReconcile({
        requestId: id,
        lockOwner: "w",
        dependencies,
      });
      expect(result).toEqual({
        outcome: "retryable_failure",
        stage: "clerk",
        code: STAGE_THREW_CODES.clerk,
      });
      expect(JSON.stringify(result)).not.toContain("user_should_not_leak");
      expect(log.clerk).toBe(1);
      expect(log.adapterCalls).toBe(0);
      expect(log.sms + log.stripe + log.purge).toBe(0);
    });
  });

  describe("malformed results", () => {
    it("13–14. SMS null / arbitrary object → sms_stage_invalid_result; not advanced", async () => {
      const log = emptyLog();
      for (const [label, ret] of [
        ["null", null],
        ["arbitrary", { provider: "twilio", phone: "+1" }],
      ] as const) {
        log.sms = log.stripe = log.purge = log.clerk = 0;
        const base = noopStages(log);
        const suppressSms: SuppressSmsStageFn = async () => {
          log.sms += 1;
          return ret as never;
        };
        const dependencies = createTrustedAccountDeletionReconcilerDependencies({
          ...base,
          suppressSms,
          clerkAdapter: trackingAdapter(log),
        });
        const id = await seedToStatus(
          `user_e2_mal_sms_${label}`,
          `mal-sms-${label}`,
          "requested"
        );
        const result = await executeTrustedAccountDeletionReconcile({
          requestId: id,
          lockOwner: "w",
          dependencies,
        });
        expect(result).toEqual({
          outcome: "retryable_failure",
          stage: "sms",
          code: STAGE_INVALID_RESULT_CODES.sms,
        });
        expect(result.outcome).not.toBe("advanced");
        expect(log.sms).toBe(1);
        expect(log.stripe + log.purge + log.clerk).toBe(0);
      }
    });

    it("15. Stripe undefined → stripe_stage_invalid_result", async () => {
      const log = emptyLog();
      const base = noopStages(log);
      const cancelStripe: CancelStripeStageFn = async () => {
        log.stripe += 1;
        return undefined as never;
      };
      const dependencies = createTrustedAccountDeletionReconcilerDependencies({
        ...base,
        cancelStripe,
        clerkAdapter: trackingAdapter(log),
      });
      const id = await seedToStatus("user_e2", "mal-stripe", "sms_suppressed");
      const result = await executeTrustedAccountDeletionReconcile({
        requestId: id,
        lockOwner: "w",
        dependencies,
      });
      expect(result).toEqual({
        outcome: "retryable_failure",
        stage: "stripe",
        code: STAGE_INVALID_RESULT_CODES.stripe,
      });
      expect(log.stripe).toBe(1);
      expect(log.sms + log.purge + log.clerk).toBe(0);
    });

    it("16. Purge ok:true without value → purge_stage_invalid_result", async () => {
      const log = emptyLog();
      const base = noopStages(log);
      const purgeAppData: PurgeAppDataStageFn = async () => {
        log.purge += 1;
        return { ok: true } as never;
      };
      const dependencies = createTrustedAccountDeletionReconcilerDependencies({
        ...base,
        purgeAppData,
        clerkAdapter: trackingAdapter(log),
      });
      const id = await seedToStatus(
        "user_e2",
        "mal-purge",
        "subscription_canceled"
      );
      const result = await executeTrustedAccountDeletionReconcile({
        requestId: id,
        lockOwner: "w",
        dependencies,
      });
      expect(result).toEqual({
        outcome: "retryable_failure",
        stage: "purge",
        code: STAGE_INVALID_RESULT_CODES.purge,
      });
      expect(log.purge).toBe(1);
      expect(log.clerk).toBe(0);
    });

    it("17–20. Clerk unknown code → clerk_stage_invalid_result; not advanced; no second stage", async () => {
      const log = emptyLog();
      const base = noopStages(log);
      const deleteClerk: DeleteClerkStageFn = async () => {
        log.clerk += 1;
        return { ok: false, code: "mystery_provider_code", message: "x" } as never;
      };
      const dependencies = createTrustedAccountDeletionReconcilerDependencies({
        ...base,
        deleteClerk,
        clerkAdapter: trackingAdapter(log),
      });
      const id = await seedToStatus("user_e2", "mal-clerk", "app_data_purged");
      const result = await executeTrustedAccountDeletionReconcile({
        requestId: id,
        lockOwner: "w",
        dependencies,
      });
      expect(result).toEqual({
        outcome: "retryable_failure",
        stage: "clerk",
        code: STAGE_INVALID_RESULT_CODES.clerk,
      });
      expect(result.outcome).not.toBe("advanced");
      expect(log.clerk).toBe(1);
      expect(log.sms + log.stripe + log.purge).toBe(0);
    });
  });

  describe("valid dependency bundle", () => {
    it("21–22. all dependencies valid → frozen bundle", () => {
      const log = emptyLog();
      const stages = {
        suppressSms: okSms(log),
        cancelStripe: okStripe(log),
        purgeAppData: okPurge(log),
        deleteClerk: okClerk(log),
        clerkAdapter: trackingAdapter(log),
      };
      const bundle = createTrustedAccountDeletionReconcilerDependencies(stages);
      expect(Object.isFrozen(bundle)).toBe(true);
      expect(bundle.suppressSms).toBe(stages.suppressSms);
      expect(() => {
        (bundle as { suppressSms: SuppressSmsStageFn }).suppressSms = okSms(log);
      }).toThrow();
    });

    it("23–28. missing/invalid deps rejected; no fallback installed", () => {
      const log = emptyLog();
      const good = {
        suppressSms: okSms(log),
        cancelStripe: okStripe(log),
        purgeAppData: okPurge(log),
        deleteClerk: okClerk(log),
        clerkAdapter: trackingAdapter(log),
      };
      for (const key of [
        "suppressSms",
        "cancelStripe",
        "purgeAppData",
        "deleteClerk",
      ] as const) {
        expect(() =>
          createTrustedAccountDeletionReconcilerDependencies({
            ...good,
            [key]: null as never,
          })
        ).toThrow("invalid_reconciler_dependencies");
      }
      expect(() =>
        createTrustedAccountDeletionReconcilerDependencies({
          ...good,
          clerkAdapter: null as never,
        })
      ).toThrow("invalid_reconciler_dependencies");
      expect(() =>
        createTrustedAccountDeletionReconcilerDependencies({
          ...good,
          clerkAdapter: {} as never,
        })
      ).toThrow("invalid_reconciler_dependencies");
    });

    it("29–30. no default live stages; repeated construction does not mutate inputs", () => {
      const log = emptyLog();
      const stages = {
        suppressSms: okSms(log),
        cancelStripe: okStripe(log),
        purgeAppData: okPurge(log),
        deleteClerk: okClerk(log),
        clerkAdapter: trackingAdapter(log),
      };
      const a = createTrustedAccountDeletionReconcilerDependencies(stages);
      const b = createTrustedAccountDeletionReconcilerDependencies(stages);
      expect(a).not.toBe(b);
      expect(a.suppressSms).toBe(stages.suppressSms);
      expect(b.cancelStripe).toBe(stages.cancelStripe);
      expect(Object.isFrozen(a)).toBe(true);
      expect(Object.isFrozen(b)).toBe(true);
    });
  });

  describe("execution boundary", () => {
    it("31–40. executeTrusted requires bundle; one stage; safe projection; completed/illegal", async () => {
      const log = emptyLog();
      const dependencies = createTrustedAccountDeletionReconcilerDependencies({
        suppressSms: okSms(log),
        cancelStripe: okStripe(log),
        purgeAppData: okPurge(log),
        deleteClerk: okClerk(log),
        clerkAdapter: trackingAdapter(log),
      });

      const id = await seedToStatus(
        "user_boundary_sms",
        "boundary-sms",
        "requested"
      );
      const r1 = await executeTrustedAccountDeletionReconcile({
        requestId: id,
        lockOwner: "boundary-owner",
        leaseMs: 30_000,
        dependencies,
      });
      expect(r1.outcome).toBe("advanced");
      if (r1.outcome === "advanced") {
        expect(r1.stage).toBe("sms");
        expect(r1.request).not.toHaveProperty("clerk_user_id");
        expect(r1.request).not.toHaveProperty("lock_owner");
        expect(r1.request).not.toHaveProperty("steps");
        expect(r1.request).not.toHaveProperty("last_error_detail");
      }
      expect(log.sms).toBe(1);
      expect(log.stripe + log.purge + log.clerk).toBe(0);

      const completedId = await seedToStatus(
        "user_boundary_done",
        "boundary-done",
        "completed"
      );
      const r2 = await executeTrustedAccountDeletionReconcile({
        requestId: completedId,
        lockOwner: "boundary-owner",
        dependencies,
      });
      expect(r2.outcome).toBe("already_done");

      await expect(
        executeTrustedAccountDeletionReconcile({
          requestId: id,
          lockOwner: "  ",
          dependencies,
        })
      ).resolves.toMatchObject({
        outcome: "conflict",
        code: "invalid_argument",
      });

      // Invalid bundle → conflict via reconcile (not throw from execute path when deps bad)
      await expect(
        reconcileAccountDeletionRequest({
          requestId: id,
          lockOwner: "w",
          dependencies: {
            suppressSms: null,
            cancelStripe: okStripe(log),
            purgeAppData: okPurge(log),
            deleteClerk: okClerk(log),
            clerkAdapter: trackingAdapter(log),
          } as never,
        })
      ).resolves.toMatchObject({
        outcome: "conflict",
        code: "invalid_argument",
      });
    });
  });

  describe("stateful crash/recovery", () => {
    it("throw leaves durable row unchanged; next valid stage can advance", async () => {
      const log = emptyLog();
      const id = await seedToStatus(
        "user_crash",
        "crash-key",
        "subscription_canceled"
      );
      const before = await getAccountDeletionRequestById(id);
      expect(before?.status).toBe("subscription_canceled");

      const throwingPurge: PurgeAppDataStageFn = async () => {
        log.purge += 1;
        throw new Error("token=secret_abc user_crash@mail.test");
      };
      const depsThrow = createTrustedAccountDeletionReconcilerDependencies({
        suppressSms: async () => {
          log.sms += 1;
          throw new Error("no");
        },
        cancelStripe: async () => {
          log.stripe += 1;
          throw new Error("no");
        },
        purgeAppData: throwingPurge,
        deleteClerk: async () => {
          log.clerk += 1;
          throw new Error("no");
        },
        clerkAdapter: trackingAdapter(log),
      });

      const inv1 = await executeTrustedAccountDeletionReconcile({
        requestId: id,
        lockOwner: "crash-1",
        dependencies: depsThrow,
      });
      expect(inv1).toEqual({
        outcome: "retryable_failure",
        stage: "purge",
        code: STAGE_THREW_CODES.purge,
      });
      expect(JSON.stringify(inv1)).not.toContain("secret_abc");
      expect(JSON.stringify(inv1)).not.toContain("user_crash@mail.test");
      expect(log).toMatchObject({ purge: 1, sms: 0, stripe: 0, clerk: 0 });
      const mid = await getAccountDeletionRequestById(id);
      expect(mid?.status).toBe("subscription_canceled");
      expect(mid?.updated_at).toBe(before?.updated_at);

      // Stateful advancing purge mutates durable store
      const advancingPurge: PurgeAppDataStageFn = async (input) => {
        log.purge += 1;
        const owner = input.lockOwner;
        const lease = await acquireAccountDeletionLease({
          requestId: input.requestId,
          lockOwner: owner,
          leaseMs: input.leaseMs,
        });
        if (!lease.ok) return lease;
        const t1 = await transitionAccountDeletionRequest({
          requestId: input.requestId,
          fromStatus: "subscription_canceled",
          toStatus: "purging_app_data",
          lockOwner: owner,
          leaseMs: input.leaseMs,
          expectedOrchestrationVersion: input.expectedOrchestrationVersion,
          purgeResult: "pending",
        });
        if (!t1.ok) {
          await releaseAccountDeletionLease({
            requestId: input.requestId,
            lockOwner: owner,
          });
          return t1;
        }
        const t2 = await transitionAccountDeletionRequest({
          requestId: input.requestId,
          fromStatus: "purging_app_data",
          toStatus: "app_data_purged",
          lockOwner: owner,
          leaseMs: input.leaseMs,
          purgeResult: "ok",
        });
        await releaseAccountDeletionLease({
          requestId: input.requestId,
          lockOwner: owner,
        });
        if (!t2.ok) return t2;
        return {
          ok: true,
          value: {
            row: t2.value,
            outcome: "app_data_purged",
            purgeResult: "ok",
            counts: {},
          },
        };
      };

      const depsOk = createTrustedAccountDeletionReconcilerDependencies({
        suppressSms: async () => {
          log.sms += 1;
          throw new Error("no");
        },
        cancelStripe: async () => {
          log.stripe += 1;
          throw new Error("no");
        },
        purgeAppData: advancingPurge,
        deleteClerk: async () => {
          log.clerk += 1;
          throw new Error("no");
        },
        clerkAdapter: trackingAdapter(log),
      });

      const inv2 = await executeTrustedAccountDeletionReconcile({
        requestId: id,
        lockOwner: "crash-2",
        dependencies: depsOk,
      });
      expect(inv2.outcome).toBe("advanced");
      if (inv2.outcome === "advanced") {
        expect(inv2.stage).toBe("purge");
        expect(inv2.request.status).toBe("app_data_purged");
      }
      expect(log).toMatchObject({ purge: 2, sms: 0, stripe: 0, clerk: 0 });
      expect((await getAccountDeletionRequestById(id))?.status).toBe(
        "app_data_purged"
      );
    });
  });

  describe("source safety", () => {
    it("41–50. no route/cron/scanner/provider factory; no live orchestrator imports", () => {
      const src = readFileSync(WORKER, "utf8");
      expect(src).toContain('import "server-only"');
      expect(src).toContain("createTrustedAccountDeletionReconcilerDependencies");
      expect(src).toContain("executeTrustedAccountDeletionReconcile");
      expect(src).not.toMatch(/from ["']@clerk/);
      expect(src).not.toMatch(/from ["']stripe["']/);
      expect(src).not.toMatch(/from ["']twilio/i);
      expect(src).not.toContain("createProductionStripeClient");
      expect(src).not.toContain("supabaseServer");
      // Allow `import type` only from stage modules; forbid value imports.
      expect(src).not.toMatch(
        /(?:^|\n)import\s+(?!type\b)[^;]*from ["']\.\/suppress-sms["']/
      );
      expect(src).not.toMatch(
        /(?:^|\n)import\s+(?!type\b)[^;]*from ["']\.\/cancel-subscription["']/
      );
      expect(src).not.toMatch(
        /(?:^|\n)import\s+(?!type\b)[^;]*from ["']\.\/orchestrate-app-data-purge["']/
      );
      expect(src).not.toMatch(
        /(?:^|\n)import\s+(?!type\b)[^;]*from ["']\.\/orchestrate-clerk-deletion["']/
      );
      // type-only imports are erased; ensure no value imports of live fns
      expect(src).not.toContain("suppressSmsForDeletion(");
      expect(src).not.toContain("cancelStripeSubscriptionsForDeletion(");
      expect(src).not.toContain("orchestrateAppDataPurge(");
      expect(src).not.toContain("orchestrateClerkDeletion(");
      expect(src).not.toMatch(/vercel\.json|pg_cron|setInterval|listPending/);
      expect(src).not.toMatch(/from ["']next\/server["']/);

      function walk(dir: string): string[] {
        const out: string[] = [];
        for (const ent of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, ent.name);
          if (ent.isDirectory()) out.push(...walk(p));
          else if (/\.(ts|tsx|js|jsx)$/.test(ent.name)) out.push(p);
        }
        return out;
      }
      const hits: string[] = [];
      for (const file of [...walk(APP_DIR), ...walk(COMPONENTS_DIR)]) {
        const text = readFileSync(file, "utf8");
        if (
          text.includes("executeTrustedAccountDeletionReconcile") ||
          text.includes("createTrustedAccountDeletionReconcilerDependencies") ||
          text.includes("reconcileAccountDeletionRequest")
        ) {
          hits.push(file);
        }
      }
      // E4b disabled cron may call executeTrusted; factory/lower entry stay out of app.
      expect(hits).toEqual([
        join(APP_DIR, "api/cron/account-deletions/route.ts"),
      ]);
      const cronSrc = readFileSync(hits[0], "utf8");
      expect(cronSrc).toContain("executeTrustedAccountDeletionReconcile");
      expect(cronSrc).not.toContain(
        "createTrustedAccountDeletionReconcilerDependencies"
      );
      expect(cronSrc).not.toContain("reconcileAccountDeletionRequest(");
    });
  });
});
