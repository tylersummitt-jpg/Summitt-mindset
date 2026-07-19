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
  createFixedClerkDeletionAdapter,
  type ClerkDeletionAdapter,
} from "./clerk-deletion-adapter";
import {
  ACCOUNT_DELETION_MAX_LEASE_MS,
  ACCOUNT_DELETION_MIN_LEASE_MS,
  createTrustedAccountDeletionReconcilerDependencies,
  reconcileAccountDeletionRequest,
  type AccountDeletionReconcileStage,
  type AccountDeletionReconcilerDependencies,
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
import type { SuppressSmsForDeletionValue } from "./suppress-sms";
import type { CancelStripeSubscriptionsForDeletionValue } from "./cancel-subscription";
import type { OrchestrateAppDataPurgeValue } from "./orchestrate-app-data-purge";
import type { OrchestrateClerkDeletionValue } from "./orchestrate-clerk-deletion";
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
  lastSms?: unknown;
  lastStripe?: unknown;
  lastPurge?: unknown;
  lastClerk?: unknown;
  adapterCalls: number;
};

function emptyLog(): CallLog {
  return { sms: 0, stripe: 0, purge: 0, clerk: 0, adapterCalls: 0 };
}

async function seedToStatus(
  clerkUserId: string,
  key: string,
  target: AccountDeletionStatus,
  opts?: { failRetryableAt?: AccountDeletionStatus }
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
    if (opts?.failRetryableAt && to === opts.failRetryableAt) {
      // Leave at processing step then fail — actually fail from processing.
      // If failRetryableAt is suppressing_sms, transition to it then fail.
    }
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

async function seedFailedRetryable(
  clerkUserId: string,
  key: string,
  processingStep: AccountDeletionStatus
): Promise<string> {
  const id = await seedToStatus(clerkUserId, key, processingStep);
  const owner = "seed-fail";
  const lease = await acquireAccountDeletionLease({
    requestId: id,
    lockOwner: owner,
  });
  expect(lease.ok).toBe(true);
  const { recordAccountDeletionFailure } = await import("./repository");
  const fail = await recordAccountDeletionFailure({
    requestId: id,
    fromStatus: processingStep,
    terminal: false,
    errorCode: "test_retryable",
    lockOwner: owner,
  });
  expect(fail.ok).toBe(true);
  await releaseAccountDeletionLease({ requestId: id, lockOwner: owner });
  return id;
}

function buildStages(log: CallLog, overrides?: {
  sms?: SuppressSmsStageFn;
  stripe?: CancelStripeStageFn;
  purge?: PurgeAppDataStageFn;
  clerk?: DeleteClerkStageFn;
}): {
  suppressSms: SuppressSmsStageFn;
  cancelStripe: CancelStripeStageFn;
  purgeAppData: PurgeAppDataStageFn;
  deleteClerk: DeleteClerkStageFn;
} {
  const suppressSms: SuppressSmsStageFn =
    overrides?.sms ??
    (async (input) => {
      log.sms += 1;
      log.lastSms = input;
      const row = await getAccountDeletionRequestById(input.requestId);
      if (!row) return { ok: false, code: "not_found", message: "missing" };
      return {
        ok: true,
        value: {
          row: { ...row, status: "sms_suppressed", current_step: "sms_suppressed", sms_result: "ok" },
          suppressResult: "removed",
          clerkMetadataWarning: false,
        } satisfies SuppressSmsForDeletionValue,
      };
    });

  const cancelStripe: CancelStripeStageFn =
    overrides?.stripe ??
    (async (input) => {
      log.stripe += 1;
      log.lastStripe = input;
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
        } satisfies CancelStripeSubscriptionsForDeletionValue,
      };
    });

  const purgeAppData: PurgeAppDataStageFn =
    overrides?.purge ??
    (async (input) => {
      log.purge += 1;
      log.lastPurge = input;
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
        } satisfies OrchestrateAppDataPurgeValue,
      };
    });

  const deleteClerk: DeleteClerkStageFn =
    overrides?.clerk ??
    (async (input) => {
      log.clerk += 1;
      log.lastClerk = input;
      // Prove adapter is only reached via deleteClerk dependency
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
            completed_at: new Date().toISOString(),
          },
          outcome: "completed",
          clerkResult: "ok",
        } satisfies OrchestrateClerkDeletionValue,
      };
    });

  return { suppressSms, cancelStripe, purgeAppData, deleteClerk };
}

function trackingAdapter(log: CallLog): ClerkDeletionAdapter {
  return {
    async deleteUser() {
      log.adapterCalls += 1;
      return { outcome: "deleted" };
    },
  };
}


function buildDeps(
  log: CallLog,
  overrides?: {
    sms?: SuppressSmsStageFn;
    stripe?: CancelStripeStageFn;
    purge?: PurgeAppDataStageFn;
    clerk?: DeleteClerkStageFn;
  },
  clerkAdapter?: ClerkDeletionAdapter
): AccountDeletionReconcilerDependencies {
  const stages = buildStages(log, overrides);
  return createTrustedAccountDeletionReconcilerDependencies({
    ...stages,
    clerkAdapter: clerkAdapter ?? trackingAdapter(log),
  });
}


describe("APP-041E1 reconcileAccountDeletionRequest", () => {
  beforeEach(() => {
    useInMemoryAccountDeletionStoreForTests();
  });

  describe("routing", () => {
    const cases: Array<{
      name: string;
      status: AccountDeletionStatus;
      expectStage: AccountDeletionReconcileStage | null;
      outcome: string;
    }> = [
      { name: "1 requested → SMS", status: "requested", expectStage: "sms", outcome: "advanced" },
      {
        name: "2 suppressing_sms → SMS",
        status: "suppressing_sms",
        expectStage: "sms",
        outcome: "advanced",
      },
      {
        name: "3 sms_suppressed → Stripe",
        status: "sms_suppressed",
        expectStage: "stripe",
        outcome: "advanced",
      },
      {
        name: "4 canceling_subscription → Stripe",
        status: "canceling_subscription",
        expectStage: "stripe",
        outcome: "advanced",
      },
      {
        name: "5 subscription_canceled → purge",
        status: "subscription_canceled",
        expectStage: "purge",
        outcome: "advanced",
      },
      {
        name: "6 purging_app_data → purge",
        status: "purging_app_data",
        expectStage: "purge",
        outcome: "advanced",
      },
      {
        name: "7 app_data_purged → Clerk",
        status: "app_data_purged",
        expectStage: "clerk",
        outcome: "advanced",
      },
      {
        name: "8 deleting_clerk → Clerk",
        status: "deleting_clerk",
        expectStage: "clerk",
        outcome: "advanced",
      },
      {
        name: "9 completed → already_done",
        status: "completed",
        expectStage: null,
        outcome: "already_done",
      },
      {
        name: "10 failed_terminal → no_action",
        status: "failed_terminal",
        expectStage: null,
        outcome: "no_action",
      },
    ];

    for (const c of cases) {
      it(c.name, async () => {
        const log = emptyLog();
        let id: string;
        if (c.status === "failed_terminal") {
          id = await seedToStatus("user_ft", `k-${c.status}`, "suppressing_sms");
          const owner = "seed-term";
          await acquireAccountDeletionLease({ requestId: id, lockOwner: owner });
          const { recordAccountDeletionFailure } = await import("./repository");
          await recordAccountDeletionFailure({
            requestId: id,
            fromStatus: "suppressing_sms",
            terminal: true,
            errorCode: "terminal_test",
            lockOwner: owner,
          });
          await releaseAccountDeletionLease({ requestId: id, lockOwner: owner });
        } else {
          id = await seedToStatus("user_route", `k-${c.status}`, c.status);
        }

        const result = await reconcileAccountDeletionRequest({
          requestId: id,
          lockOwner: "worker-e1",
          dependencies: buildDeps(log),
        });

        expect(result.outcome).toBe(c.outcome);
        if (c.expectStage === "sms") {
          expect(log.sms).toBe(1);
          expect(log.stripe + log.purge + log.clerk).toBe(0);
        } else if (c.expectStage === "stripe") {
          expect(log.stripe).toBe(1);
          expect(log.sms + log.purge + log.clerk).toBe(0);
        } else if (c.expectStage === "purge") {
          expect(log.purge).toBe(1);
          expect(log.sms + log.stripe + log.clerk).toBe(0);
        } else if (c.expectStage === "clerk") {
          expect(log.clerk).toBe(1);
          expect(log.sms + log.stripe + log.purge).toBe(0);
        } else {
          expect(log.sms + log.stripe + log.purge + log.clerk).toBe(0);
        }
      });
    }
  });

  describe("failed_retryable routing", () => {
    const cases: Array<{
      step: AccountDeletionStatus;
      expectStage: AccountDeletionReconcileStage;
    }> = [
      { step: "suppressing_sms", expectStage: "sms" },
      { step: "canceling_subscription", expectStage: "stripe" },
      { step: "purging_app_data", expectStage: "purge" },
      { step: "deleting_clerk", expectStage: "clerk" },
    ];

    for (const [i, c] of cases.entries()) {
      it(`${11 + i}. failed_retryable + ${c.step} → ${c.expectStage}`, async () => {
        const log = emptyLog();
        const id = await seedFailedRetryable(
          "user_fr",
          `fr-${c.step}`,
          c.step
        );
        const result = await reconcileAccountDeletionRequest({
          requestId: id,
          lockOwner: "worker-e1",
          dependencies: buildDeps(log),
        });
        expect(result.outcome).toBe("advanced");
        if (c.expectStage === "sms") expect(log.sms).toBe(1);
        if (c.expectStage === "stripe") expect(log.stripe).toBe(1);
        if (c.expectStage === "purge") expect(log.purge).toBe(1);
        if (c.expectStage === "clerk") expect(log.clerk).toBe(1);
        const total = log.sms + log.stripe + log.purge + log.clerk;
        expect(total).toBe(1);
      });
    }

    it("15. failed_retryable + illegal current_step → fail closed", async () => {
      const log = emptyLog();
      const id = await seedFailedRetryable(
        "user_fr_bad",
        "fr-bad",
        "suppressing_sms"
      );
      const real = await getAccountDeletionRequestById(id);
      expect(real).toBeTruthy();
      const repo = await import("./repository");
      const spy = vi
        .spyOn(repo, "getAccountDeletionRequestById")
        .mockResolvedValue({
          ...real!,
          status: "failed_retryable",
          // Milestone step is illegal for failed_retryable resume routing.
          current_step: "sms_suppressed",
        });

      const result = await reconcileAccountDeletionRequest({
          requestId: id,
          lockOwner: "worker-e1",
          dependencies: buildDeps(log),
        });
      spy.mockRestore();
      expect(result.outcome).toBe("no_action");
      expect(log.sms + log.stripe + log.purge + log.clerk).toBe(0);
    });
  });

  describe("identity / arguments", () => {
    it("16–22. forwards durable clerk id, requestId, lockOwner, leaseMs, version; adapter only via clerk stage", async () => {
      const log = emptyLog();
      const stages = buildStages(log);
      const id = await seedToStatus("user_identity_e1", "id-key", "app_data_purged");
      const row = await getAccountDeletionRequestById(id);
      expect(row?.orchestration_version).toBe(1);

      const adapter: ClerkDeletionAdapter = {
        async deleteUser({ clerkUserId }) {
          expect(clerkUserId).toBe("user_identity_e1");
          log.adapterCalls += 1;
          return { outcome: "deleted" };
        },
      };

      // deleteClerk in buildStages also calls adapter — use override that only
      // records and uses injected adapter once.
      const deleteClerk: DeleteClerkStageFn = async (input) => {
        log.clerk += 1;
        log.lastClerk = input;
        await input.adapter.deleteUser({ clerkUserId: input.clerkUserId });
        const current = await getAccountDeletionRequestById(input.requestId);
        if (!current) return { ok: false, code: "not_found", message: "x" };
        return {
          ok: true,
          value: {
            row: {
              ...current,
              status: "completed",
              current_step: "completed",
              clerk_result: "ok",
            },
            outcome: "completed",
            clerkResult: "ok",
          },
        };
      };

      const result = await reconcileAccountDeletionRequest({
        requestId: id,
        lockOwner: "lock-owner-exact",
        leaseMs: 45_000,
        dependencies: createTrustedAccountDeletionReconcilerDependencies({
          suppressSms: stages.suppressSms,
          cancelStripe: stages.cancelStripe,
          purgeAppData: stages.purgeAppData,
          deleteClerk,
          clerkAdapter: adapter,
        }),
      });

      expect(result.outcome).toBe("advanced");
      expect(log.clerk).toBe(1);
      expect(log.sms + log.stripe + log.purge).toBe(0);
      expect(log.adapterCalls).toBe(1);
      const args = log.lastClerk as {
        requestId: string;
        clerkUserId: string;
        lockOwner: string;
        leaseMs: number;
        expectedOrchestrationVersion: number;
        adapter: ClerkDeletionAdapter;
      };
      expect(args.requestId).toBe(id);
      expect(args.clerkUserId).toBe("user_identity_e1");
      expect(args.lockOwner).toBe("lock-owner-exact");
      expect(args.leaseMs).toBe(45_000);
      expect(args.expectedOrchestrationVersion).toBe(1);
      // E3a: trusted bundle copies/freezes adapter; still invokes captured deleteUser.
      expect(args.adapter).not.toBe(adapter);
      expect(Object.isFrozen(args.adapter)).toBe(true);
      // No alternate clerk id on worker input type / call site
      expect(result).not.toHaveProperty("clerkUserId");
    });
  });

  describe("one-stage boundary", () => {
    it("23–27. successful SMS does not call Stripe/purge/Clerk; exactly one max", async () => {
      const log = emptyLog();
      const id = await seedToStatus("user_one", "one-sms", "requested");
      await reconcileAccountDeletionRequest({
          requestId: id,
          lockOwner: "w",
          dependencies: buildDeps(log),
        });
      expect(log.sms).toBe(1);
      expect(log.stripe).toBe(0);
      expect(log.purge).toBe(0);
      expect(log.clerk).toBe(0);
    });

    it("24. successful Stripe does not call purge/Clerk", async () => {
      const log = emptyLog();
      const id = await seedToStatus("user_one", "one-stripe", "sms_suppressed");
      await reconcileAccountDeletionRequest({
          requestId: id,
          lockOwner: "w",
          dependencies: buildDeps(log),
        });
      expect(log.stripe).toBe(1);
      expect(log.sms + log.purge + log.clerk).toBe(0);
    });

    it("25. successful purge does not call Clerk", async () => {
      const log = emptyLog();
      const id = await seedToStatus(
        "user_one",
        "one-purge",
        "subscription_canceled"
      );
      await reconcileAccountDeletionRequest({
          requestId: id,
          lockOwner: "w",
          dependencies: buildDeps(log),
        });
      expect(log.purge).toBe(1);
      expect(log.clerk).toBe(0);
    });
  });

  describe("result mapping", () => {
    it("28. stage success → advanced with exact stage", async () => {
      const log = emptyLog();
      const id = await seedToStatus("u", "map-adv", "sms_suppressed");
      const result = await reconcileAccountDeletionRequest({
        requestId: id,
        lockOwner: "w",
        dependencies: buildDeps(log, undefined, createFixedClerkDeletionAdapter({ outcome: "deleted" })),
      });
      expect(result).toEqual(
        expect.objectContaining({ outcome: "advanced", stage: "stripe" })
      );
    });

    it("29. stage already_done at nonterminal → advanced", async () => {
      const log = emptyLog();
      const id = await seedToStatus("u", "map-ad", "subscription_canceled");
      const purge: PurgeAppDataStageFn = async (input) => {
        log.purge += 1;
        const row = await getAccountDeletionRequestById(input.requestId);
        if (!row) return { ok: false, code: "not_found", message: "x" };
        return {
          ok: true,
          value: {
            row: {
              ...row,
              status: "app_data_purged",
              current_step: "app_data_purged",
              purge_result: "already_done",
            },
            outcome: "already_done",
            purgeResult: "already_done",
            counts: {},
          },
        };
      };
      const result = await reconcileAccountDeletionRequest({
        requestId: id,
        lockOwner: "w",
        dependencies: buildDeps(log, { purge }, createFixedClerkDeletionAdapter({ outcome: "deleted" })),
      });
      expect(result.outcome).toBe("advanced");
      if (result.outcome === "advanced") {
        expect(result.stage).toBe("purge");
        expect(result.request.status).toBe("app_data_purged");
      }
    });

    it("30. completed durable row → already_done", async () => {
      const log = emptyLog();
      const id = await seedToStatus("u", "map-done", "completed");
      const result = await reconcileAccountDeletionRequest({
        requestId: id,
        lockOwner: "w",
        dependencies: buildDeps(log, undefined, createFixedClerkDeletionAdapter({ outcome: "deleted" })),
      });
      expect(result.outcome).toBe("already_done");
      expect(log.sms + log.stripe + log.purge + log.clerk).toBe(0);
    });

    it("31. cas_conflict → conflict", async () => {
      const log = emptyLog();
      const id = await seedToStatus("u", "map-cas", "requested");
      const sms: SuppressSmsStageFn = async () => ({
        ok: false,
        code: "cas_conflict",
        message: "cas",
      });
      const result = await reconcileAccountDeletionRequest({
        requestId: id,
        lockOwner: "w",
        dependencies: buildDeps(log, { sms }, createFixedClerkDeletionAdapter({ outcome: "deleted" })),
      });
      expect(result).toEqual({
        outcome: "conflict",
        stage: "sms",
        code: "cas_conflict",
      });
    });

    it("32. lease_held → conflict", async () => {
      const log = emptyLog();
      const id = await seedToStatus("u", "map-lease", "sms_suppressed");
      const stripe: CancelStripeStageFn = async () => ({
        ok: false,
        code: "lease_held",
        message: "held",
      });
      const result = await reconcileAccountDeletionRequest({
        requestId: id,
        lockOwner: "w",
        dependencies: buildDeps(log, { stripe }, createFixedClerkDeletionAdapter({ outcome: "deleted" })),
      });
      expect(result).toEqual({
        outcome: "conflict",
        stage: "stripe",
        code: "lease_held",
      });
    });

    it("33. internal_error → retryable_failure", async () => {
      const log = emptyLog();
      const id = await seedToStatus("u", "map-int", "subscription_canceled");
      const purge: PurgeAppDataStageFn = async () => ({
        ok: false,
        code: "internal_error",
        message: "boom",
      });
      const result = await reconcileAccountDeletionRequest({
        requestId: id,
        lockOwner: "w",
        dependencies: buildDeps(log, { purge }, createFixedClerkDeletionAdapter({ outcome: "deleted" })),
      });
      expect(result).toEqual({
        outcome: "retryable_failure",
        stage: "purge",
        code: "internal_error",
      });
    });

    it("34. illegal_transition → conflict", async () => {
      const log = emptyLog();
      const id = await seedToStatus("u", "map-ill", "app_data_purged");
      const clerk: DeleteClerkStageFn = async () => ({
        ok: false,
        code: "illegal_transition",
        message: "no",
      });
      const result = await reconcileAccountDeletionRequest({
        requestId: id,
        lockOwner: "w",
        dependencies: buildDeps(log, { clerk }, createFixedClerkDeletionAdapter({ outcome: "deleted" })),
      });
      expect(result).toEqual({
        outcome: "conflict",
        stage: "clerk",
        code: "illegal_transition",
      });
    });

    it("35. not_found → not_found", async () => {
      const log = emptyLog();
      const result = await reconcileAccountDeletionRequest({
        requestId: "00000000-0000-4000-8000-000000000099",
        lockOwner: "w",
        dependencies: buildDeps(log, undefined, createFixedClerkDeletionAdapter({ outcome: "deleted" })),
      });
      expect(result).toEqual({ outcome: "not_found" });
      expect(log.sms + log.stripe + log.purge + log.clerk).toBe(0);
    });

    it("36. no raw provider object returned", async () => {
      const log = emptyLog();
      const id = await seedToStatus("u", "map-priv", "requested");
      const result = await reconcileAccountDeletionRequest({
        requestId: id,
        lockOwner: "w",
        dependencies: buildDeps(log, undefined, createFixedClerkDeletionAdapter({ outcome: "deleted" })),
      });
      const json = JSON.stringify(result);
      expect(json).not.toMatch(/stripe\.|twilio|Bearer |sk_live|phone|email@/i);
      expect(result).not.toHaveProperty("raw");
      if ("request" in result && result.request) {
        expect(result.request).not.toHaveProperty("clerk_user_id");
        expect(result.request).not.toHaveProperty("lock_owner");
        expect(result.request).not.toHaveProperty("steps");
        expect(result.request).not.toHaveProperty("last_error_detail");
      }
    });
  });

  describe("safety", () => {
    it("37. invalid requestId blocks all orchestrators", async () => {
      const log = emptyLog();
      const result = await reconcileAccountDeletionRequest({
        requestId: "   ",
        lockOwner: "w",
        dependencies: buildDeps(log, undefined, createFixedClerkDeletionAdapter({ outcome: "deleted" })),
      });
      expect(result.outcome).toBe("conflict");
      expect(log.sms + log.stripe + log.purge + log.clerk).toBe(0);
    });

    it("38. empty lockOwner blocks all orchestrators", async () => {
      const log = emptyLog();
      const id = await seedToStatus("u", "safe-lock", "requested");
      const result = await reconcileAccountDeletionRequest({
        requestId: id,
        lockOwner: "  ",
        dependencies: buildDeps(log, undefined, createFixedClerkDeletionAdapter({ outcome: "deleted" })),
      });
      expect(result.outcome).toBe("conflict");
      expect(log.sms + log.stripe + log.purge + log.clerk).toBe(0);
    });

    it("39. invalid leaseMs blocks all orchestrators", async () => {
      const log = emptyLog();
      const id = await seedToStatus("u", "safe-lease", "requested");
      for (const leaseMs of [
        0,
        999,
        ACCOUNT_DELETION_MIN_LEASE_MS - 1,
        ACCOUNT_DELETION_MAX_LEASE_MS + 1,
        1.5,
        Number.NaN,
      ]) {
        log.sms = log.stripe = log.purge = log.clerk = 0;
        const result = await reconcileAccountDeletionRequest({
          requestId: id,
          lockOwner: "w",
          leaseMs,
          dependencies: buildDeps(log, undefined, createFixedClerkDeletionAdapter({ outcome: "deleted" })),
        });
        expect(result.outcome).toBe("conflict");
        expect(log.sms + log.stripe + log.purge + log.clerk).toBe(0);
      }
    });

    it("40. missing row → not_found", async () => {
      const log = emptyLog();
      const result = await reconcileAccountDeletionRequest({
        requestId: "11111111-1111-4111-8111-111111111111",
        lockOwner: "w",
        dependencies: buildDeps(log, undefined, createFixedClerkDeletionAdapter({ outcome: "deleted" })),
      });
      expect(result).toEqual({ outcome: "not_found" });
    });

    it("41. illegal status/current_step combination blocks orchestrators", async () => {
      const log = emptyLog();
      const id = await seedToStatus("u", "safe-combo", "sms_suppressed");
      const real = await getAccountDeletionRequestById(id);
      expect(real).toBeTruthy();
      const repo = await import("./repository");
      const spy = vi
        .spyOn(repo, "getAccountDeletionRequestById")
        .mockResolvedValue({
          ...real!,
          status: "sms_suppressed",
          current_step: "requested",
        });

      const result = await reconcileAccountDeletionRequest({
        requestId: id,
        lockOwner: "w",
        dependencies: buildDeps(log, undefined, createFixedClerkDeletionAdapter({ outcome: "deleted" })),
      });
      spy.mockRestore();
      expect(result.outcome).toBe("no_action");
      expect(log.sms + log.stripe + log.purge + log.clerk).toBe(0);
    });

    it("42–46. source safety: server-only, no public imports, no real SDK", () => {
      const src = readFileSync(WORKER, "utf8");
      expect(src).toContain('import "server-only"');
      expect(src).not.toMatch(/from ["']@clerk/);
      expect(src).not.toMatch(/from ["']stripe["']/);
      expect(src).not.toMatch(/from ["']twilio/i);
      expect(src).not.toContain("suppressSmsForDeletion(");
      expect(src).not.toContain("cancelStripeSubscriptionsForDeletion(");
      expect(src).not.toContain("orchestrateAppDataPurge(");
      expect(src).not.toContain("orchestrateClerkDeletion(");
      expect(src).not.toContain("createProductionStripeClient");
      expect(src).not.toMatch(/vercel\.json/);
      expect(src).not.toMatch(/export\s+(async\s+)?function\s+GET|POST|PUT|DELETE/);
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
          text.includes("reconcile-account-deletion") ||
          text.includes("reconcileAccountDeletionRequest")
        ) {
          hits.push(file);
        }
      }
      // E4b disabled cron imports the trusted boundary module path only.
      expect(hits).toEqual([
        join(APP_DIR, "api/cron/account-deletions/route.ts"),
      ]);
      const cronSrc = readFileSync(hits[0], "utf8");
      expect(cronSrc).toContain("executeTrustedAccountDeletionReconcile");
      expect(cronSrc).not.toContain("reconcileAccountDeletionRequest(");
    });
  });

  describe("stateful multi-invocation", () => {
    it("purge → clerk → already_done across three invocations; one stage each", async () => {
      const log = emptyLog();
      const id = await seedToStatus(
        "user_stateful",
        "stateful-key",
        "subscription_canceled"
      );

      // Stateful stages that actually mutate durable in-memory rows.
      const suppressSms: SuppressSmsStageFn = async () => {
        log.sms += 1;
        throw new Error("sms should not run");
      };
      const cancelStripe: CancelStripeStageFn = async () => {
        log.stripe += 1;
        throw new Error("stripe should not run");
      };

      const purgeAppData: PurgeAppDataStageFn = async (input) => {
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
            counts: { journal_entries: 1 },
          },
        };
      };

      const deleteClerk: DeleteClerkStageFn = async (input) => {
        log.clerk += 1;
        await input.adapter.deleteUser({ clerkUserId: input.clerkUserId });
        log.adapterCalls += 1;
        const owner = input.lockOwner;
        const lease = await acquireAccountDeletionLease({
          requestId: input.requestId,
          lockOwner: owner,
          leaseMs: input.leaseMs,
        });
        if (!lease.ok) return lease;
        const t1 = await transitionAccountDeletionRequest({
          requestId: input.requestId,
          fromStatus: "app_data_purged",
          toStatus: "deleting_clerk",
          lockOwner: owner,
          leaseMs: input.leaseMs,
          expectedOrchestrationVersion: input.expectedOrchestrationVersion,
          clerkResult: "pending",
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
          fromStatus: "deleting_clerk",
          toStatus: "completed",
          lockOwner: owner,
          leaseMs: input.leaseMs,
          clerkResult: "ok",
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
            outcome: "completed",
            clerkResult: "ok",
          },
        };
      };

      const dependencies = createTrustedAccountDeletionReconcilerDependencies({
        suppressSms,
        cancelStripe,
        purgeAppData,
        deleteClerk,
        clerkAdapter: createFixedClerkDeletionAdapter({ outcome: "deleted" }),
      });

      const inv1 = await reconcileAccountDeletionRequest({
        requestId: id,
        lockOwner: "worker-1",
        dependencies,
      });
      expect(inv1.outcome).toBe("advanced");
      if (inv1.outcome === "advanced") {
        expect(inv1.stage).toBe("purge");
        expect(inv1.request.status).toBe("app_data_purged");
      }
      expect(log).toMatchObject({ purge: 1, clerk: 0, sms: 0, stripe: 0 });
      expect((await getAccountDeletionRequestById(id))?.status).toBe(
        "app_data_purged"
      );

      const inv2 = await reconcileAccountDeletionRequest({
        requestId: id,
        lockOwner: "worker-2",
        dependencies,
      });
      expect(inv2.outcome).toBe("advanced");
      if (inv2.outcome === "advanced") {
        expect(inv2.stage).toBe("clerk");
        expect(inv2.request.status).toBe("completed");
      }
      expect(log).toMatchObject({ purge: 1, clerk: 1, sms: 0, stripe: 0 });
      expect((await getAccountDeletionRequestById(id))?.status).toBe(
        "completed"
      );

      const inv3 = await reconcileAccountDeletionRequest({
        requestId: id,
        lockOwner: "worker-3",
        dependencies,
      });
      expect(inv3.outcome).toBe("already_done");
      expect(log).toMatchObject({ purge: 1, clerk: 1, sms: 0, stripe: 0 });
    });
  });
});
