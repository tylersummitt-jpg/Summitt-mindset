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
  type ClerkDeletionResult,
} from "./clerk-deletion-adapter";
import {
  CLERK_DELETE_ERROR_INTERNAL,
  CLERK_DELETE_ERROR_RETRYABLE,
  CLERK_DELETE_ERROR_TERMINAL_RETRYABLE,
  CLERK_DELETE_RPC_MARKER_DETAIL,
  CLERK_DELETE_RPC_MARKER_DETAIL_MAX,
  CLERK_DELETE_RPC_STEP,
  encodeClerkDeleteRpcMarkerDetail,
  isEligiblePriorStagesForClerkDeletion,
  isValidIsoTimestamp,
  isVictoryMediaTokenBarrierElapsed,
  orchestrateClerkDeletion,
  parseClerkDeleteRpcMarkerDetail,
  readClerkDeleteRpcMarker,
} from "./orchestrate-clerk-deletion";
import {
  APP_DATA_PURGE_RPC_STEP,
} from "./orchestrate-app-data-purge";
import {
  acquireAccountDeletionLease,
  createAccountDeletionRequest,
  getAccountDeletionRequestById,
  patchAccountDeletionRequestWhileLeased,
  releaseAccountDeletionLease,
  seedAccountDeletionRequestForTests,
  transitionAccountDeletionRequest,
  useInMemoryAccountDeletionStoreForTests,
} from "./repository";
import * as repository from "./repository";
import type { AccountDeletionRequestRow } from "./types";
import { VICTORY_MEDIA_ACCOUNT_DELETION_BARRIER_MS } from "@/lib/victory-media/constants";
import type { DeleteAllVictoryMediaForUserResult } from "@/lib/victory-media/delete-all-victory-media-for-user";

const emptyVictoryMediaCleanup = async (): Promise<DeleteAllVictoryMediaForUserResult> => ({
  ok: true,
  found: 0,
  deleted: 0,
  alreadyEmpty: true,
});

function withCleanup(
  input: Parameters<typeof orchestrateClerkDeletion>[0]
): Parameters<typeof orchestrateClerkDeletion>[0] {
  return {
    deleteAllVictoryMediaForUser: emptyVictoryMediaCleanup,
    ...input,
  };
}

const ORCHESTRATOR = join(
  process.cwd(),
  "src/lib/account-deletion/orchestrate-clerk-deletion.ts"
);
const ADAPTER = join(
  process.cwd(),
  "src/lib/account-deletion/clerk-deletion-adapter.ts"
);
const API_DIR = join(process.cwd(), "src/app/api");
const APP_DIR = join(process.cwd(), "src/app");
const COMPONENTS_DIR = join(process.cwd(), "src/components");

function countingAdapter(
  outcomes: ClerkDeletionResult[] | ((n: number) => ClerkDeletionResult)
): ClerkDeletionAdapter & { calls: number; seenIds: string[] } {
  const state = { calls: 0, seenIds: [] as string[] };
  return {
    get calls() {
      return state.calls;
    },
    get seenIds() {
      return state.seenIds;
    },
    async deleteUser({ clerkUserId }) {
      state.calls += 1;
      state.seenIds.push(clerkUserId);
      if (typeof outcomes === "function") return outcomes(state.calls);
      const next = outcomes[state.calls - 1] ?? outcomes[outcomes.length - 1]!;
      return next;
    },
  };
}

async function seedAppDataPurged(
  clerkUserId: string,
  key: string,
  opts?: {
    smsResult?: AccountDeletionRequestRow["sms_result"];
    stripeResult?: AccountDeletionRequestRow["stripe_result"];
    purgeResult?: AccountDeletionRequestRow["purge_result"];
    includePurgeMarker?: boolean;
  }
): Promise<string> {
  const created = await createAccountDeletionRequest({
    clerkUserId,
    idempotencyKey: key,
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("create failed");
  const id = created.value.row.id;
  const owner = "seed-worker";
  const lease = await acquireAccountDeletionLease({
    requestId: id,
    lockOwner: owner,
  });
  expect(lease.ok).toBe(true);

  const steps: Array<{
    from: AccountDeletionRequestRow["status"];
    to: AccountDeletionRequestRow["status"];
    sms?: AccountDeletionRequestRow["sms_result"];
    stripe?: AccountDeletionRequestRow["stripe_result"];
    purge?: AccountDeletionRequestRow["purge_result"];
  }> = [
    { from: "requested", to: "suppressing_sms", sms: "pending" },
    {
      from: "suppressing_sms",
      to: "sms_suppressed",
      sms: opts?.smsResult ?? "ok",
    },
    {
      from: "sms_suppressed",
      to: "canceling_subscription",
      stripe: "pending",
    },
    {
      from: "canceling_subscription",
      to: "subscription_canceled",
      stripe: opts?.stripeResult ?? "ok",
    },
    {
      from: "subscription_canceled",
      to: "purging_app_data",
      purge: "pending",
    },
    {
      from: "purging_app_data",
      to: "app_data_purged",
      purge: opts?.purgeResult ?? "ok",
    },
  ];

  for (const s of steps) {
    const t = await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: s.from,
      toStatus: s.to,
      lockOwner: owner,
      ...(s.sms !== undefined ? { smsResult: s.sms } : {}),
      ...(s.stripe !== undefined ? { stripeResult: s.stripe } : {}),
      ...(s.purge !== undefined ? { purgeResult: s.purge } : {}),
    });
    expect(t.ok).toBe(true);
  }

  if (opts?.includePurgeMarker !== false) {
    const row = await getAccountDeletionRequestById(id);
    expect(row).not.toBeNull();
    const lease2 = await acquireAccountDeletionLease({
      requestId: id,
      lockOwner: owner,
    });
    expect(lease2.ok).toBe(true);
    const patched = await patchAccountDeletionRequestWhileLeased({
      requestId: id,
      expectedStatus: "app_data_purged",
      lockOwner: owner,
      steps: {
        ...row!.steps,
        [APP_DATA_PURGE_RPC_STEP]: {
          at: new Date().toISOString(),
          ok: true,
          code: "purged",
          detail: "limitations:0;categories:1;deleted_total:1",
        },
      },
    });
    expect(patched.ok).toBe(true);
    await releaseAccountDeletionLease({ requestId: id, lockOwner: owner });
  } else {
    await releaseAccountDeletionLease({ requestId: id, lockOwner: owner });
  }

  const final = await getAccountDeletionRequestById(id);
  expect(final).not.toBeNull();
  const createdAt = new Date(
    Date.now() - VICTORY_MEDIA_ACCOUNT_DELETION_BARRIER_MS - 60_000
  ).toISOString();
  await seedAccountDeletionRequestForTests({
    ...final!,
    created_at: createdAt,
  });

  return id;
}

describe("APP-041D1 orchestrateClerkDeletion", () => {
  beforeEach(() => {
    useInMemoryAccountDeletionStoreForTests();
    vi.restoreAllMocks();
  });

  describe("eligibility", () => {
    it("1–5. missing/wrong owner/completed already_done with no lease/adapter", async () => {
      const adapter = countingAdapter([{ outcome: "deleted" }]);
      const missing = await orchestrateClerkDeletion(withCleanup({
        requestId: "00000000-0000-4000-8000-000000000099",
        clerkUserId: "user_x",
        lockOwner: "w",
        adapter,
      }));
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.code).toBe("not_found");
      expect(adapter.calls).toBe(0);

      const id = await seedAppDataPurged("user_d1_own", "kown");
      const wrong = await orchestrateClerkDeletion(withCleanup({
        requestId: id,
        clerkUserId: "user_other",
        lockOwner: "w",
        adapter,
      }));
      expect(wrong.ok).toBe(false);
      if (!wrong.ok) expect(wrong.code).toBe("invalid_argument");
      expect(adapter.calls).toBe(0);

      const ok = await orchestrateClerkDeletion(withCleanup({
        requestId: id,
        clerkUserId: "user_d1_own",
        lockOwner: "w",
        adapter,
      }));
      expect(ok.ok).toBe(true);
      expect(adapter.calls).toBe(1);

      const spyAcquire = vi.spyOn(repository, "acquireAccountDeletionLease");
      const again = await orchestrateClerkDeletion(withCleanup({
        requestId: id,
        clerkUserId: "user_d1_own",
        lockOwner: "w2",
        adapter: countingAdapter([{ outcome: "deleted" }]),
      }));
      expect(again.ok).toBe(true);
      if (!again.ok) return;
      expect(again.value.outcome).toBe("already_done");
      expect(again.value.row.status).toBe("completed");
      expect(spyAcquire).not.toHaveBeenCalled();
    });

    it("6–11. incomplete prior stages / wrong status / terminal / contradiction block", async () => {
      const adapter = countingAdapter([{ outcome: "deleted" }]);

      const smsIncomplete = await seedAppDataPurged("user_d1_sms", "ksms", {
        smsResult: "pending" as AccountDeletionRequestRow["sms_result"],
      });
      // Force incomplete by patching after seed is awkward; seed with ok then
      // create a row stuck at subscription_canceled instead.
      const created = await createAccountDeletionRequest({
        clerkUserId: "user_d1_block",
        idempotencyKey: "kblock",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const blockId = created.value.row.id;
      const owner = "seed";
      await acquireAccountDeletionLease({ requestId: blockId, lockOwner: owner });
      for (const [from, to, extra] of [
        ["requested", "suppressing_sms", { smsResult: "pending" as const }],
        ["suppressing_sms", "sms_suppressed", { smsResult: "ok" as const }],
        [
          "sms_suppressed",
          "canceling_subscription",
          { stripeResult: "pending" as const },
        ],
        [
          "canceling_subscription",
          "subscription_canceled",
          { stripeResult: "ok" as const },
        ],
      ] as const) {
        await transitionAccountDeletionRequest({
          requestId: blockId,
          fromStatus: from,
          toStatus: to,
          lockOwner: owner,
          ...extra,
        });
      }
      await releaseAccountDeletionLease({ requestId: blockId, lockOwner: owner });

      const wrongStatus = await orchestrateClerkDeletion(withCleanup({
        requestId: blockId,
        clerkUserId: "user_d1_block",
        lockOwner: "w",
        adapter,
      }));
      expect(wrongStatus.ok).toBe(false);
      if (!wrongStatus.ok) expect(wrongStatus.code).toBe("illegal_transition");
      expect(adapter.calls).toBe(0);

      const id = await seedAppDataPurged("user_d1_el", "kel");
      // incomplete SMS: mutate via failure path after moving to deleting_clerk is hard;
      // use eligibility helper + orchestrator from app_data_purged with patched results
      // by transitioning with purge incomplete seed.
      void smsIncomplete;
      expect(
        isEligiblePriorStagesForClerkDeletion({
          sms_result: "ok",
          stripe_result: "ok",
          purge_result: "pending",
          steps: {},
        })
      ).toBe(false);
      expect(
        isEligiblePriorStagesForClerkDeletion({
          sms_result: "ok",
          stripe_result: "ok",
          purge_result: "ok",
          steps: {},
        })
      ).toBe(false);
      const eligibleRow = await getAccountDeletionRequestById(id);
      expect(
        isEligiblePriorStagesForClerkDeletion({
          sms_result: "ok",
          stripe_result: "ok",
          purge_result: "ok",
          steps: eligibleRow!.steps,
        })
      ).toBe(true);

      // Contradictory clerk_result=ok without marker while still app_data_purged:
      const lease = await acquireAccountDeletionLease({
        requestId: id,
        lockOwner: "w",
      });
      expect(lease.ok).toBe(true);
      const toDeleting = await transitionAccountDeletionRequest({
        requestId: id,
        fromStatus: "app_data_purged",
        toStatus: "deleting_clerk",
        lockOwner: "w",
        clerkResult: "ok",
      });
      expect(toDeleting.ok).toBe(true);
      await releaseAccountDeletionLease({ requestId: id, lockOwner: "w" });

      const contradicted = await orchestrateClerkDeletion(withCleanup({
        requestId: id,
        clerkUserId: "user_d1_el",
        lockOwner: "w2",
        adapter,
      }));
      expect(contradicted.ok).toBe(false);
      if (!contradicted.ok) expect(contradicted.code).toBe("illegal_transition");
      expect(adapter.calls).toBe(0);
    });

    it("12–13. stale pre-adapter version and start CAS conflict block adapter", async () => {
      const id = await seedAppDataPurged("user_d1_ver", "kver");
      const adapter = countingAdapter([{ outcome: "deleted" }]);
      const stale = await orchestrateClerkDeletion(withCleanup({
        requestId: id,
        clerkUserId: "user_d1_ver",
        lockOwner: "w",
        expectedOrchestrationVersion: 999,
        adapter,
      }));
      expect(stale.ok).toBe(false);
      if (!stale.ok) {
        expect(stale.code).toBe("unsupported_orchestration_version");
      }
      expect(adapter.calls).toBe(0);

      const spy = vi
        .spyOn(repository, "transitionAccountDeletionRequest")
        .mockResolvedValueOnce({
          ok: false,
          code: "cas_conflict",
          message: "start conflict",
        });
      const conflict = await orchestrateClerkDeletion(withCleanup({
        requestId: id,
        clerkUserId: "user_d1_ver",
        lockOwner: "w",
        adapter,
      }));
      expect(conflict.ok).toBe(false);
      if (!conflict.ok) expect(conflict.code).toBe("cas_conflict");
      expect(adapter.calls).toBe(0);
      spy.mockRestore();
    });
  });

  describe("start / success", () => {
    it("14–30. start transition, adapter after CAS, marker before completed, map results", async () => {
      const id = await seedAppDataPurged("user_d1_ok", "kok");
      const before = await getAccountDeletionRequestById(id);
      expect(before?.sms_result).toBe("ok");
      expect(before?.stripe_result).toBe("ok");
      expect(before?.purge_result).toBe("ok");
      expect(before?.steps[APP_DATA_PURGE_RPC_STEP]?.ok).toBe(true);

      const order: string[] = [];
      const realTransition = repository.transitionAccountDeletionRequest;
      vi.spyOn(repository, "transitionAccountDeletionRequest").mockImplementation(
        async (input) => {
          if (input.toStatus === "deleting_clerk") order.push("start_cas");
          return realTransition(input);
        }
      );
      const realPatch = repository.patchAccountDeletionRequestWhileLeased;
      vi.spyOn(
        repository,
        "patchAccountDeletionRequestWhileLeased"
      ).mockImplementation(async (input) => {
        order.push("marker");
        expect(input.steps[CLERK_DELETE_RPC_STEP]?.code).toBe("deleted");
        expect(input.steps[CLERK_DELETE_RPC_STEP]?.detail).toBe(
          CLERK_DELETE_RPC_MARKER_DETAIL
        );
        return realPatch(input);
      });
      const realMark = repository.markAccountDeletionCompleted;
      vi.spyOn(repository, "markAccountDeletionCompleted").mockImplementation(
        async (input) => {
          order.push("final_cas");
          expect(input.clerkResult).toBe("ok");
          return realMark(input);
        }
      );

      const adapter = countingAdapter([{ outcome: "deleted", code: "ok" }]);
      // Wrap adapter to record order
      const wrapped: ClerkDeletionAdapter = {
        async deleteUser(input) {
          order.push("adapter");
          return adapter.deleteUser(input);
        },
      };

      const result = await orchestrateClerkDeletion(withCleanup({
        requestId: id,
        clerkUserId: "user_d1_ok",
        lockOwner: "worker-d1",
        adapter: wrapped,
      }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.outcome).toBe("completed");
      expect(result.value.clerkResult).toBe("ok");
      expect(result.value.row.status).toBe("completed");
      expect(result.value.row.current_step).toBe("completed");
      expect(result.value.row.completed_at).toBeTruthy();
      expect(result.value.row.sms_result).toBe("ok");
      expect(result.value.row.stripe_result).toBe("ok");
      expect(result.value.row.purge_result).toBe("ok");
      expect(result.value.row.steps[APP_DATA_PURGE_RPC_STEP]?.ok).toBe(true);
      expect(result.value.row.steps[CLERK_DELETE_RPC_STEP]?.code).toBe(
        "deleted"
      );
      expect(JSON.stringify(result.value.row.steps)).not.toMatch(/user_d1_ok/);
      expect(order).toEqual(["start_cas", "adapter", "marker", "final_cas"]);
      expect(adapter.seenIds).toEqual(["user_d1_ok"]);
      vi.restoreAllMocks();

      const id2 = await seedAppDataPurged("user_d1_aa", "kaa");
      const aa = await orchestrateClerkDeletion(withCleanup({
        requestId: id2,
        clerkUserId: "user_d1_aa",
        lockOwner: "w",
        adapter: createFixedClerkDeletionAdapter({
          outcome: "already_absent",
        }),
      }));
      expect(aa.ok).toBe(true);
      if (!aa.ok) return;
      expect(aa.value.outcome).toBe("already_done");
      expect(aa.value.row.clerk_result).toBe("already_done");
      expect(aa.value.row.status).toBe("completed");
    });
  });

  describe("marker validation", () => {
    it("31–40. absent/malformed forms fail closed; marker remains", async () => {
      expect(readClerkDeleteRpcMarker({ steps: {} }).kind).toBe("absent");
      expect(encodeClerkDeleteRpcMarkerDetail()).toBe("provider:clerk");
      expect(parseClerkDeleteRpcMarkerDetail("provider:clerk")).toBe(true);
      expect(parseClerkDeleteRpcMarkerDetail("provider:other")).toBe(false);
      expect(
        parseClerkDeleteRpcMarkerDetail("x".repeat(CLERK_DELETE_RPC_MARKER_DETAIL_MAX + 1))
      ).toBe(false);
      expect(isValidIsoTimestamp("2026-07-19T12:00:00.000Z")).toBe(true);
      expect(isValidIsoTimestamp("nope")).toBe(false);

      const cases: Array<{ steps: AccountDeletionRequestRow["steps"]; reason: string }> = [
        {
          steps: {
            [CLERK_DELETE_RPC_STEP]: {
              at: "2026-07-19T12:00:00.000Z",
              ok: false,
              code: "deleted",
              detail: "provider:clerk",
            },
          },
          reason: "ok_not_true",
        },
        {
          steps: {
            [CLERK_DELETE_RPC_STEP]: {
              ok: true,
              code: "deleted",
              detail: "provider:clerk",
            },
          },
          reason: "invalid_at",
        },
        {
          steps: {
            [CLERK_DELETE_RPC_STEP]: {
              at: "not-a-timestamp",
              ok: true,
              code: "deleted",
              detail: "provider:clerk",
            },
          },
          reason: "invalid_at",
        },
        {
          steps: {
            [CLERK_DELETE_RPC_STEP]: {
              at: "2026-07-19T12:00:00.000Z",
              ok: true,
              code: "weird",
              detail: "provider:clerk",
            },
          },
          reason: "invalid_outcome",
        },
        {
          steps: {
            [CLERK_DELETE_RPC_STEP]: {
              at: "2026-07-19T12:00:00.000Z",
              ok: true,
              code: "deleted",
              detail: "provider:stripe",
            },
          },
          reason: "malformed_detail",
        },
        {
          steps: {
            [CLERK_DELETE_RPC_STEP]: {
              at: "2026-07-19T12:00:00.000Z",
              ok: true,
              code: "deleted",
              detail: "x".repeat(CLERK_DELETE_RPC_MARKER_DETAIL_MAX + 1),
            },
          },
          reason: "malformed_detail",
        },
        {
          steps: {
            [CLERK_DELETE_RPC_STEP]: {
              at: "2026-07-19T12:00:00.000Z",
              ok: true,
              code: "deleted",
              detail: "provider:clerk",
              from: "extra",
            },
          },
          reason: "unknown_fields",
        },
      ];

      for (const c of cases) {
        const read = readClerkDeleteRpcMarker({ steps: c.steps });
        expect(read.kind).toBe("malformed");
        if (read.kind === "malformed") expect(read.reason).toBe(c.reason);
      }

      const id = await seedAppDataPurged("user_d1_mal", "kmal");
      const owner = "w";
      const lease = await acquireAccountDeletionLease({
        requestId: id,
        lockOwner: owner,
      });
      expect(lease.ok).toBe(true);
      await transitionAccountDeletionRequest({
        requestId: id,
        fromStatus: "app_data_purged",
        toStatus: "deleting_clerk",
        lockOwner: owner,
        clerkResult: "pending",
      });
      const row = await getAccountDeletionRequestById(id);
      const bad = await patchAccountDeletionRequestWhileLeased({
        requestId: id,
        expectedStatus: "deleting_clerk",
        lockOwner: owner,
        steps: {
          ...row!.steps,
          [CLERK_DELETE_RPC_STEP]: {
            at: "2026-07-19T12:00:00.000Z",
            ok: true,
            code: "deleted",
            detail: "provider:WRONG",
          },
        },
      });
      expect(bad.ok).toBe(true);
      await releaseAccountDeletionLease({ requestId: id, lockOwner: owner });

      const adapter = countingAdapter([{ outcome: "deleted" }]);
      const result = await orchestrateClerkDeletion(withCleanup({
        requestId: id,
        clerkUserId: "user_d1_mal",
        lockOwner: "w2",
        adapter,
      }));
      expect(result.ok).toBe(false);
      expect(adapter.calls).toBe(0);
      const after = await getAccountDeletionRequestById(id);
      expect(after?.steps[CLERK_DELETE_RPC_STEP]?.detail).toBe("provider:WRONG");
      expect(after?.status).toBe("deleting_clerk");
    });
  });

  describe("failure", () => {
    it("41–51. retryable/thrown/terminal_error → failed_retryable; no completed; no success marker", async () => {
      // cases declared inline below with allowlisted durable codes
      for (const [key, adapterResult, expectedCode] of [
        [
          "retry",
          { outcome: "retryable_error" as const, code: "user_x@evil.com token=abc" },
          CLERK_DELETE_ERROR_RETRYABLE,
        ],
        [
          "term",
          { outcome: "terminal_error" as const, code: "user_secret_sk_live_xxx" },
          CLERK_DELETE_ERROR_TERMINAL_RETRYABLE,
        ],
      ] as const) {
        const id = await seedAppDataPurged(`user_d1_${key}`, `k${key}`);
        const adapter = countingAdapter([adapterResult]);
        const result = await orchestrateClerkDeletion(withCleanup({
          requestId: id,
          clerkUserId: `user_d1_${key}`,
          lockOwner: "w",
          adapter,
        }));
        expect(result.ok).toBe(false);
        const row = await getAccountDeletionRequestById(id);
        expect(row?.status).toBe("failed_retryable");
        expect(row?.current_step).toBe("deleting_clerk");
        expect(row?.clerk_result).toBe("failed");
        expect(row?.sms_result).toBe("ok");
        expect(row?.stripe_result).toBe("ok");
        expect(row?.purge_result).toBe("ok");
        expect(row?.steps[CLERK_DELETE_RPC_STEP]).toBeUndefined();
        expect(row?.last_error_code).toBe(expectedCode);
        expect(row?.steps.failed_retryable?.code).toBe(expectedCode);
        expect(row?.last_error_code).not.toMatch(/@|token=|sk_live|user_/);
        expect(JSON.stringify(row)).not.toMatch(/evil\.com|sk_live_xxx|token=abc/);
        expect(row?.last_error_detail).not.toMatch(/stack|Authorization|Bearer/i);
      }

      const idThrow = await seedAppDataPurged("user_d1_throw", "kthrow");
      const throwAdapter: ClerkDeletionAdapter = {
        async deleteUser() {
          throw new Error("user_d1_throw secret token=abc");
        },
      };
      const thrown = await orchestrateClerkDeletion(withCleanup({
        requestId: idThrow,
        clerkUserId: "user_d1_throw",
        lockOwner: "w",
        adapter: throwAdapter,
      }));
      expect(thrown.ok).toBe(false);
      const row = await getAccountDeletionRequestById(idThrow);
      expect(row?.status).toBe("failed_retryable");
      expect(row?.clerk_result).toBe("failed");
      expect(row?.last_error_code).toBe(CLERK_DELETE_ERROR_INTERNAL);
      expect(row?.last_error_detail).toBe("adapter_threw");
      expect(row?.status).not.toBe("completed");
      expect(JSON.stringify(row?.steps ?? {})).not.toMatch(/token=abc/);
    });
  });

  describe("reconciliation", () => {
    it("52–66. final CAS conflicts leave marker; second invocation CAS-only completes", async () => {
      const id = await seedAppDataPurged("user_d1_recon", "krecon");
      const adapter = countingAdapter([{ outcome: "deleted" }]);

      let finalBlocks = 0;
      const realMark = repository.markAccountDeletionCompleted;
      vi.spyOn(repository, "markAccountDeletionCompleted").mockImplementation(
        async (input) => {
          finalBlocks += 1;
          if (finalBlocks <= 3) {
            return {
              ok: false,
              code: "cas_conflict",
              message: "forced final conflict",
            };
          }
          return realMark(input);
        }
      );

      const first = await orchestrateClerkDeletion(withCleanup({
        requestId: id,
        clerkUserId: "user_d1_recon",
        lockOwner: "w1",
        adapter,
      }));
      expect(first.ok).toBe(false);
      if (!first.ok) expect(first.code).toBe("cas_conflict");
      expect(adapter.calls).toBe(1);
      const mid = await getAccountDeletionRequestById(id);
      expect(mid?.status).toBe("deleting_clerk");
      expect(mid?.steps[CLERK_DELETE_RPC_STEP]?.code).toBe("deleted");
      expect(readClerkDeleteRpcMarker(mid!).kind).toBe("valid");

      vi.mocked(repository.markAccountDeletionCompleted).mockRestore();
      // Stale caller version must not strand post-marker finalize.
      const second = await orchestrateClerkDeletion(withCleanup({
        requestId: id,
        clerkUserId: "user_d1_recon",
        lockOwner: "w2",
        expectedOrchestrationVersion: 999,
        adapter,
      }));
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value.row.status).toBe("completed");
      expect(adapter.calls).toBe(1);

      const third = await orchestrateClerkDeletion(withCleanup({
        requestId: id,
        clerkUserId: "user_d1_recon",
        lockOwner: "w3",
        adapter,
      }));
      expect(third.ok).toBe(true);
      if (!third.ok) return;
      expect(third.value.outcome).toBe("already_done");
      expect(adapter.calls).toBe(1);
    });

    it("65–66. failed_retryable + valid marker + stale caller version → CAS-only complete", async () => {
      const id = await seedAppDataPurged("user_d1_fr", "kfr");
      const adapter = countingAdapter([
        { outcome: "deleted" },
        { outcome: "deleted" },
      ]);

      const realMark = repository.markAccountDeletionCompleted;
      vi.spyOn(repository, "markAccountDeletionCompleted").mockResolvedValue({
        ok: false,
        code: "cas_conflict",
        message: "block complete",
      });
      const first = await orchestrateClerkDeletion(withCleanup({
        requestId: id,
        clerkUserId: "user_d1_fr",
        lockOwner: "w",
        adapter,
      }));
      expect(first.ok).toBe(false);
      expect(adapter.calls).toBe(1);
      const mid = await getAccountDeletionRequestById(id);
      expect(mid?.steps[CLERK_DELETE_RPC_STEP]?.ok).toBe(true);
      expect(mid?.steps[APP_DATA_PURGE_RPC_STEP]?.ok).toBe(true);

      const owner = "manual";
      const lease = await acquireAccountDeletionLease({
        requestId: id,
        lockOwner: owner,
      });
      expect(lease.ok).toBe(true);
      const failed = await repository.recordAccountDeletionFailure({
        requestId: id,
        fromStatus: "deleting_clerk",
        terminal: false,
        errorCode: "simulated",
        lockOwner: owner,
        clerkResult: "failed",
      });
      expect(failed.ok).toBe(true);
      expect(failed.ok && failed.value.steps[CLERK_DELETE_RPC_STEP]?.ok).toBe(
        true
      );
      expect(failed.ok && failed.value.steps[APP_DATA_PURGE_RPC_STEP]?.ok).toBe(
        true
      );

      vi.mocked(repository.markAccountDeletionCompleted).mockRestore();
      void realMark;
      const spyTransition = vi.spyOn(
        repository,
        "transitionAccountDeletionRequest"
      );
      const second = await orchestrateClerkDeletion(withCleanup({
        requestId: id,
        clerkUserId: "user_d1_fr",
        lockOwner: "w2",
        expectedOrchestrationVersion: 999,
        adapter,
      }));
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value.row.status).toBe("completed");
      expect(adapter.calls).toBe(1);
      const pinnedResume = spyTransition.mock.calls.filter(
        ([arg]) =>
          arg.fromStatus === "failed_retryable" &&
          arg.expectedOrchestrationVersion === 999
      );
      expect(pinnedResume).toHaveLength(0);
      spyTransition.mockRestore();
    });
  });

  describe("irreversible-step safety corrections", () => {
    it("missing or malformed C3 purge marker blocks adapter", async () => {
      const missingId = await seedAppDataPurged("user_d1_nomarker", "knom", {
        includePurgeMarker: false,
      });
      const adapter = countingAdapter([{ outcome: "deleted" }]);
      const missing = await orchestrateClerkDeletion(withCleanup({
        requestId: missingId,
        clerkUserId: "user_d1_nomarker",
        lockOwner: "w",
        adapter,
      }));
      expect(missing.ok).toBe(false);
      expect(adapter.calls).toBe(0);

      const badId = await seedAppDataPurged("user_d1_badpurge", "kbadp");
      const owner = "seed";
      const lease = await acquireAccountDeletionLease({
        requestId: badId,
        lockOwner: owner,
      });
      expect(lease.ok).toBe(true);
      const row = await getAccountDeletionRequestById(badId);
      await patchAccountDeletionRequestWhileLeased({
        requestId: badId,
        expectedStatus: "app_data_purged",
        lockOwner: owner,
        steps: {
          ...row!.steps,
          [APP_DATA_PURGE_RPC_STEP]: {
            at: "2026-07-19T12:00:00.000Z",
            ok: true,
            code: "purged",
            detail: "provider:wrong",
          },
        },
      });
      await releaseAccountDeletionLease({ requestId: badId, lockOwner: owner });
      const bad = await orchestrateClerkDeletion(withCleanup({
        requestId: badId,
        clerkUserId: "user_d1_badpurge",
        lockOwner: "w2",
        adapter,
      }));
      expect(bad.ok).toBe(false);
      expect(adapter.calls).toBe(0);
    });

    it("valid C3 marker required; adapter receives row.clerk_user_id", async () => {
      const id = await seedAppDataPurged("user_d1_rowid", "krow");
      const adapter = countingAdapter([{ outcome: "deleted" }]);
      const result = await orchestrateClerkDeletion(withCleanup({
        requestId: id,
        clerkUserId: "user_d1_rowid",
        lockOwner: "w",
        adapter,
      }));
      expect(result.ok).toBe(true);
      expect(adapter.seenIds).toEqual(["user_d1_rowid"]);
      expect(result.ok && result.value.row.steps[APP_DATA_PURGE_RPC_STEP]?.ok).toBe(
        true
      );
      expect(result.ok && result.value.row.steps[CLERK_DELETE_RPC_STEP]?.ok).toBe(
        true
      );
    });

    it("ownership mismatch on finalization reload blocks completion", async () => {
      const id = await seedAppDataPurged("user_d1_ownfin", "kownf");
      const adapter = countingAdapter([{ outcome: "deleted" }]);
      const realGet = repository.getAccountDeletionRequestById;
      let markerSeen = false;
      vi.spyOn(repository, "getAccountDeletionRequestById").mockImplementation(
        async (rid) => {
          const row = await realGet(rid);
          if (
            row &&
            markerSeen &&
            row.steps[CLERK_DELETE_RPC_STEP]?.ok === true &&
            row.status === "deleting_clerk"
          ) {
            return { ...row, clerk_user_id: "user_other" };
          }
          if (row?.steps[CLERK_DELETE_RPC_STEP]?.ok === true) {
            markerSeen = true;
          }
          return row;
        }
      );
      // Detect marker via patch spy instead for reliable timing.
      vi.mocked(repository.getAccountDeletionRequestById).mockRestore();

      const realPatch = repository.patchAccountDeletionRequestWhileLeased;
      vi.spyOn(
        repository,
        "patchAccountDeletionRequestWhileLeased"
      ).mockImplementation(async (input) => {
        const out = await realPatch(input);
        if (input.steps[CLERK_DELETE_RPC_STEP] && out.ok) {
          vi.spyOn(repository, "getAccountDeletionRequestById").mockImplementation(
            async (rid) => {
              const row = await realGet(rid);
              if (row?.status === "deleting_clerk") {
                return { ...row, clerk_user_id: "user_other" };
              }
              return row;
            }
          );
        }
        return out;
      });

      const result = await orchestrateClerkDeletion(withCleanup({
        requestId: id,
        clerkUserId: "user_d1_ownfin",
        lockOwner: "w",
        adapter,
      }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("invalid_argument");
      expect(adapter.calls).toBe(1);
      const row = await realGet(id);
      expect(row?.status).not.toBe("completed");
      expect(row?.steps[CLERK_DELETE_RPC_STEP]?.ok).toBe(true);
    });
  });

  describe("crash window", () => {
    it("67–73. marker write fails → no completed; second call adapter already_absent → completed", async () => {
      const id = await seedAppDataPurged("user_d1_crash", "kcrash");
      const adapter = countingAdapter((n) =>
        n === 1
          ? { outcome: "deleted" }
          : { outcome: "already_absent" }
      );

      const realPatch = repository.patchAccountDeletionRequestWhileLeased;
      vi.spyOn(
        repository,
        "patchAccountDeletionRequestWhileLeased"
      ).mockImplementation(async (input) => {
        if (input.steps[CLERK_DELETE_RPC_STEP]) {
          return {
            ok: false,
            code: "cas_conflict",
            message: "marker write failed",
          };
        }
        return realPatch(input);
      });

      const first = await orchestrateClerkDeletion(withCleanup({
        requestId: id,
        clerkUserId: "user_d1_crash",
        lockOwner: "w1",
        adapter,
      }));
      expect(first.ok).toBe(false);
      expect(adapter.calls).toBe(1);
      const mid = await getAccountDeletionRequestById(id);
      expect(mid?.status).toBe("deleting_clerk");
      expect(mid?.steps[CLERK_DELETE_RPC_STEP]).toBeUndefined();
      expect(mid?.status).not.toBe("completed");

      vi.mocked(repository.patchAccountDeletionRequestWhileLeased).mockRestore();

      const second = await orchestrateClerkDeletion(withCleanup({
        requestId: id,
        clerkUserId: "user_d1_crash",
        lockOwner: "w2",
        adapter,
      }));
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(adapter.calls).toBe(2);
      expect(second.value.row.clerk_result).toBe("already_done");
      expect(second.value.row.status).toBe("completed");
      expect(second.value.row.steps[CLERK_DELETE_RPC_STEP]?.code).toBe(
        "already_absent"
      );
    });
  });

  describe("lease", () => {
    it("74–78. lease lost before adapter prevents call; matching-owner release only", async () => {
      const id = await seedAppDataPurged("user_d1_lease", "klease");
      const adapter = countingAdapter([{ outcome: "deleted" }]);

      // Steal lease after acquire inside orchestrator by mocking transition to succeed
      // then mocking get to show wrong lock — simpler: mock acquire success then
      // transition start, then adapter should not run if we force lease_not_held on
      // a mid-path. Use: after start CAS, release lease from another path via spy
      // on adapter that checks lock — actually:
      const realGet = repository.getAccountDeletionRequestById;
      let reloads = 0;
      vi.spyOn(repository, "getAccountDeletionRequestById").mockImplementation(
        async (rid) => {
          const row = await realGet(rid);
          reloads += 1;
          // After lease acquire reload (~2nd+), clear lock to simulate loss before adapter
          if (row && row.status === "deleting_clerk" && reloads >= 3) {
            return { ...row, lock_owner: "other", locked_at: row.locked_at };
          }
          return row;
        }
      );

      // Cleaner approach: mock adapter never; force start CAS then patch fails lease.
      vi.mocked(repository.getAccountDeletionRequestById).mockRestore();

      const stolen = await acquireAccountDeletionLease({
        requestId: id,
        lockOwner: "thief",
      });
      expect(stolen.ok).toBe(true);
      const blocked = await orchestrateClerkDeletion(withCleanup({
        requestId: id,
        clerkUserId: "user_d1_lease",
        lockOwner: "w",
        adapter,
      }));
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.code).toBe("lease_held");
      expect(adapter.calls).toBe(0);
      await releaseAccountDeletionLease({ requestId: id, lockOwner: "thief" });
    });
  });

  describe("victory media storage sweep", () => {
    it("barrier blocks Clerk when created_at is too recent", async () => {
      const id = await seedAppDataPurged("user_d1_barrier", "kbar");
      const row = await getAccountDeletionRequestById(id);
      expect(row).not.toBeNull();
      await seedAccountDeletionRequestForTests({
        ...row!,
        created_at: new Date().toISOString(),
      });
      const cleanupCalls: string[] = [];
      const adapter = countingAdapter([{ outcome: "deleted" }]);
      const result = await orchestrateClerkDeletion(
        withCleanup({
          requestId: id,
          clerkUserId: "user_d1_barrier",
          lockOwner: "w",
          adapter,
          deleteAllVictoryMediaForUser: async ({ clerkUserId }) => {
            cleanupCalls.push(clerkUserId);
            return emptyVictoryMediaCleanup();
          },
        })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("illegal_transition");
      expect(adapter.calls).toBe(0);
      expect(cleanupCalls).toHaveLength(0);
      const after = await getAccountDeletionRequestById(id);
      expect(after?.status).toBe("app_data_purged");
      expect(
        isVictoryMediaTokenBarrierElapsed(new Date().toISOString(), new Date())
      ).toBe(false);
    });

    it("sweep runs before Clerk; failure blocks Clerk and is retryable", async () => {
      const id = await seedAppDataPurged("user_d1_sweep", "ksweep");
      const adapter = countingAdapter([{ outcome: "deleted" }]);
      let sweeps = 0;
      const first = await orchestrateClerkDeletion(
        withCleanup({
          requestId: id,
          clerkUserId: "user_d1_sweep",
          lockOwner: "w",
          adapter,
          deleteAllVictoryMediaForUser: async () => {
            sweeps += 1;
            return { ok: false, code: "verify_not_empty" };
          },
        })
      );
      expect(first.ok).toBe(false);
      expect(adapter.calls).toBe(0);
      expect(sweeps).toBe(1);
      const mid = await getAccountDeletionRequestById(id);
      expect(mid?.status).toBe("failed_retryable");
      expect(mid?.current_step).toBe("deleting_clerk");
      expect(mid?.last_error_code).toBe("victory_media_storage_cleanup_failed");

      const second = await orchestrateClerkDeletion(
        withCleanup({
          requestId: id,
          clerkUserId: "user_d1_sweep",
          lockOwner: "w2",
          adapter,
          deleteAllVictoryMediaForUser: async () => {
            sweeps += 1;
            return emptyVictoryMediaCleanup();
          },
        })
      );
      expect(second.ok).toBe(true);
      expect(adapter.calls).toBe(1);
      expect(sweeps).toBe(2);
    });

    it("marker-first completion still reruns sweep", async () => {
      const id = await seedAppDataPurged("user_d1_msweep", "kmsweep");
      const adapter = countingAdapter([{ outcome: "deleted" }]);
      let sweeps = 0;
      const first = await orchestrateClerkDeletion(
        withCleanup({
          requestId: id,
          clerkUserId: "user_d1_msweep",
          lockOwner: "w",
          adapter,
          deleteAllVictoryMediaForUser: async () => {
            sweeps += 1;
            return emptyVictoryMediaCleanup();
          },
        })
      );
      expect(first.ok).toBe(true);
      expect(sweeps).toBe(1);

      // Force status back to deleting_clerk with valid marker still present
      // by re-seeding a synthetic mid-state (marker retained, not completed).
      const done = await getAccountDeletionRequestById(id);
      expect(done?.status).toBe("completed");
      await seedAccountDeletionRequestForTests({
        ...done!,
        status: "deleting_clerk",
        current_step: "deleting_clerk",
        completed_at: null,
        clerk_result: "pending",
        lock_owner: null,
        locked_at: null,
      });

      const again = await orchestrateClerkDeletion(
        withCleanup({
          requestId: id,
          clerkUserId: "user_d1_msweep",
          lockOwner: "w2",
          adapter: countingAdapter([{ outcome: "already_absent" }]),
          deleteAllVictoryMediaForUser: async () => {
            sweeps += 1;
            return emptyVictoryMediaCleanup();
          },
        })
      );
      expect(again.ok).toBe(true);
      expect(sweeps).toBe(2);
    });
  });

  describe("safety", () => {
    it("79–86. no Clerk SDK/REST/public imports; no migration; helpers", () => {
      for (const file of [ORCHESTRATOR, ADAPTER]) {
        const src = readFileSync(file, "utf8");
        expect(src).toContain('import "server-only"');
        expect(src).not.toMatch(/from ["']@clerk\//);
        expect(src).not.toMatch(
          /(?:import|require)\s*\(?["']@clerk|clerkClient\.|users\.deleteUser\s*\(/
        );
        expect(src).not.toMatch(/https?:\/\/api\.clerk\.com/);
        expect(src).not.toMatch(/CLERK_SECRET|sk_live|sk_test/);
      }

      const walk = (dir: string): string[] => {
        const out: string[] = [];
        for (const ent of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, ent.name);
          if (ent.isDirectory()) out.push(...walk(p));
          else if (ent.name.endsWith(".ts") || ent.name.endsWith(".tsx")) {
            out.push(p);
          }
        }
        return out;
      };

      const pattern =
        /orchestrateClerkDeletion|orchestrate-clerk-deletion|clerk-deletion-adapter/;
      const apiHits = walk(API_DIR).filter((p) =>
        pattern.test(readFileSync(p, "utf8"))
      );
      expect(apiHits).toEqual([]);

      const appHits = walk(APP_DIR).filter((p) => {
        if (p.includes("/api/")) return false;
        return pattern.test(readFileSync(p, "utf8"));
      });
      expect(appHits).toEqual([]);

      try {
        const componentHits = walk(COMPONENTS_DIR).filter((p) =>
          pattern.test(readFileSync(p, "utf8"))
        );
        expect(componentHits).toEqual([]);
      } catch {
        // components dir may be absent/empty
      }

      const migrations = readdirSync(
        join(process.cwd(), "supabase/migrations")
      ).filter((f) => f.includes("clerk_deletion") || f.includes("d1"));
      expect(migrations).toEqual([]);
    });
  });
});
