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
  createAccountDeletionRequest,
  acquireAccountDeletionLease,
  releaseAccountDeletionLease,
  transitionAccountDeletionRequest,
  getAccountDeletionRequestById,
  patchAccountDeletionRequestWhileLeased,
  recordAccountDeletionFailure,
  useInMemoryAccountDeletionStoreForTests,
  type AccountDeletionRepoResult,
} from "./repository";
import type { AccountDeletionRequestRow } from "./types";
import {
  APP_DATA_PURGE_RPC_MARKER_DETAIL_MAX,
  APP_DATA_PURGE_RPC_STEP,
  encodeAppDataPurgeRpcMarkerDetail,
  formatPurgeCountsDetail,
  isEligibleSmsAndStripeForPurge,
  orchestrateAppDataPurge,
  parseAppDataPurgeRpcMarkerDetail,
  readAppDataPurgeRpcMarker,
  stepsLookNonPii,
  summarizePurgeCounts,
} from "./orchestrate-app-data-purge";
import type {
  PurgeAppDataForDeletionInput,
  PurgeAppDataForDeletionValue,
} from "./purge-app-data";
import * as repository from "./repository";
import { sanitizeAccountDeletionErrorDetail } from "./sanitize";

const ORCHESTRATOR = join(
  process.cwd(),
  "src/lib/account-deletion/orchestrate-app-data-purge.ts"
);
const API_DIR = join(process.cwd(), "src/app/api");

/** Realistic C2-sized count map (≥40 keys) including one 9+ digit count. */
function buildLargeC2CountMap(): Record<string, number> {
  const keys = [
    "sms_identities",
    "sms_audience",
    "sms_inbound_coach_jobs",
    "sms_last_outbound_context",
    "sms_delivery_state",
    "sms_send_events",
    "sms_weekly_send_events",
    "sms_audience_pref_backup",
    "sms_daily_drafts",
    "sms_daily_draft_generations",
    "sms_opt_out_tombstones_inserted",
    "sms_inbound_messages",
    "journal_entries",
    "daily_summaries",
    "weekly_summaries",
    "recent_summary",
    "pattern_insights",
    "ask_pat_questions",
    "ask_pat_usage",
    "coach_conversations",
    "coach_pat_daily_notes",
    "coach_pat_daily_usage",
    "coach_reply_usage",
    "daily_prompt_versions",
    "daily_prompts",
    "weekly_sms_reflections",
    "daily_completion_events",
    "feedback_events",
    "winback_queue",
    "retention_signals",
    "achievements_unlocked",
    "v2_sms_meaning_interpretation_shadow",
    "v2_sms_pattern_correction",
    "v2_user_sms_comms_preferences",
    "v2_user_send_time_profile",
    "v2_user_rollout",
    "v2_event",
    "goal_coherence_log",
    "v2_victory_season_summary_snapshot",
    "v2_victory_pat_read_snapshot",
    "v2_commitment_sms_thread_memory",
    "v2_commitment_event",
    "v2_commitment",
    "important_people",
    "user_profiles",
    "testimonials",
    "challenge_rows_deleted",
  ];
  const counts: Record<string, number> = {};
  for (let i = 0; i < keys.length; i += 1) {
    counts[keys[i]!] = i === 0 ? 123456789 : i % 5;
  }
  return counts;
}

async function seedSubscriptionCanceled(
  clerkUserId: string,
  key: string,
  opts?: {
    smsResult?: AccountDeletionRequestRow["sms_result"];
    stripeResult?: AccountDeletionRequestRow["stripe_result"];
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
  ];

  for (const s of steps) {
    const t = await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: s.from,
      toStatus: s.to,
      lockOwner: owner,
      ...(s.sms !== undefined ? { smsResult: s.sms } : {}),
      ...(s.stripe !== undefined ? { stripeResult: s.stripe } : {}),
    });
    expect(t.ok).toBe(true);
  }

  await releaseAccountDeletionLease({ requestId: id, lockOwner: owner });
  return id;
}

function mockPurge(
  impl: (
    input: PurgeAppDataForDeletionInput
  ) => Promise<AccountDeletionRepoResult<PurgeAppDataForDeletionValue>>
) {
  return vi.fn(impl);
}

describe("APP-041C3 orchestrateAppDataPurge", () => {
  beforeEach(() => {
    useInMemoryAccountDeletionStoreForTests();
    vi.restoreAllMocks();
  });

  it("1. eligible subscription_canceled begins purge and reaches app_data_purged", async () => {
    const id = await seedSubscriptionCanceled("user_c3_1", "k1");
    const purgeFn = mockPurge(async () => ({
      ok: true,
      value: {
        outcome: "purged",
        counts: { journal_entries: 2, testimonials: 1 },
        limitations: [],
      },
    }));

    const result = await orchestrateAppDataPurge({
      requestId: id,
      clerkUserId: "user_c3_1",
      lockOwner: "worker-c3",
      purgeFn,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe("app_data_purged");
    expect(result.value.purgeResult).toBe("ok");
    expect(result.value.row.status).toBe("app_data_purged");
    expect(result.value.row.purge_result).toBe("ok");
    expect(result.value.row.sms_result).toBe("ok");
    expect(result.value.row.stripe_result).toBe("ok");
    expect(result.value.row.last_error_code).toBeNull();
    expect(purgeFn).toHaveBeenCalledTimes(1);
    const args = purgeFn.mock.calls[0]?.[0];
    expect(args?.requestId).toBe(id);
    expect(args?.clerkUserId).toBe("user_c3_1");
    expect(args?.lockOwner).toBe("worker-c3");
    expect(args?.expectedOrchestrationVersion).toBe(1);
    expect(stepsLookNonPii(result.value.row.steps)).toBe(true);
    expect(result.value.row.steps[APP_DATA_PURGE_RPC_STEP]?.ok).toBe(true);
    expect(result.value.row.steps[APP_DATA_PURGE_RPC_STEP]?.code).toBe(
      "purged"
    );
  });

  it("2–4. wrong status / Stripe failed → not eligible, purge not called", async () => {
    const purgeFn = mockPurge(async () => ({
      ok: true,
      value: { outcome: "purged", counts: {}, limitations: [] },
    }));

    useInMemoryAccountDeletionStoreForTests();
    const c2 = await createAccountDeletionRequest({
      clerkUserId: "user_c3_req",
      idempotencyKey: "k-req",
    });
    if (!c2.ok) throw new Error("c2");
    const badStatus = await orchestrateAppDataPurge({
      requestId: c2.value.row.id,
      clerkUserId: "user_c3_req",
      lockOwner: "w",
      purgeFn,
    });
    expect(badStatus.ok).toBe(false);
    if (!badStatus.ok) expect(badStatus.code).toBe("illegal_transition");
    expect(purgeFn).not.toHaveBeenCalled();

    useInMemoryAccountDeletionStoreForTests();
    const idStripe = await seedSubscriptionCanceled("user_c3_st", "kst", {
      stripeResult: "failed",
    });
    const badStripe = await orchestrateAppDataPurge({
      requestId: idStripe,
      clerkUserId: "user_c3_st",
      lockOwner: "w",
      purgeFn,
    });
    expect(badStripe.ok).toBe(false);
    if (!badStripe.ok) expect(badStripe.code).toBe("illegal_transition");
    expect(purgeFn).not.toHaveBeenCalled();
  });

  it("2b. SMS failed → not eligible", async () => {
    const id = await seedSubscriptionCanceled("user_c3_smsfail", "ksf", {
      smsResult: "failed",
    });
    const purgeFn = mockPurge(async () => ({
      ok: true,
      value: { outcome: "purged", counts: {}, limitations: [] },
    }));
    const result = await orchestrateAppDataPurge({
      requestId: id,
      clerkUserId: "user_c3_smsfail",
      lockOwner: "w",
      purgeFn,
    });
    expect(result.ok).toBe(false);
    expect(purgeFn).not.toHaveBeenCalled();
  });

  it("5–6. missing/wrong Clerk → no purge", async () => {
    const id = await seedSubscriptionCanceled("user_c3_own", "kown");
    const purgeFn = mockPurge(async () => ({
      ok: true,
      value: { outcome: "purged", counts: {}, limitations: [] },
    }));

    const wrong = await orchestrateAppDataPurge({
      requestId: id,
      clerkUserId: "user_other",
      lockOwner: "w",
      purgeFn,
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.code).toBe("invalid_argument");
    expect(purgeFn).not.toHaveBeenCalled();

    const empty = await orchestrateAppDataPurge({
      requestId: id,
      clerkUserId: "   ",
      lockOwner: "w",
      purgeFn,
    });
    expect(empty.ok).toBe(false);
    expect(purgeFn).not.toHaveBeenCalled();
  });

  it("7–12. first CAS to purging_app_data pending; version/owner passed; CAS conflict skips purge", async () => {
    const id = await seedSubscriptionCanceled("user_c3_cas", "kcas");
    const versions: number[] = [];
    const purgeFn = mockPurge(async (input) => {
      versions.push(input.expectedOrchestrationVersion);
      return {
        ok: true,
        value: {
          outcome: "purged",
          counts: { sms_identities: 1 },
          limitations: [],
        },
      };
    });

    const ok = await orchestrateAppDataPurge({
      requestId: id,
      clerkUserId: "user_c3_cas",
      lockOwner: "worker-a",
      purgeFn,
    });
    expect(ok.ok).toBe(true);
    expect(versions).toEqual([1]);
    expect(purgeFn.mock.calls[0]?.[0].lockOwner).toBe("worker-a");
    expect(purgeFn.mock.calls[0]?.[0].requestId).toBe(id);

    useInMemoryAccountDeletionStoreForTests();
    const id2 = await seedSubscriptionCanceled("user_c3_cas2", "kcas2");
    const purgeFn2 = mockPurge(async () => ({
      ok: true,
      value: { outcome: "purged", counts: {}, limitations: [] },
    }));
    const conflict = await orchestrateAppDataPurge({
      requestId: id2,
      clerkUserId: "user_c3_cas2",
      lockOwner: "worker-b",
      expectedOrchestrationVersion: 999,
      purgeFn: purgeFn2,
    });
    expect(conflict.ok).toBe(false);
    expect(purgeFn2).not.toHaveBeenCalled();
  });

  it("13–17. purged/already_absent success; marker + counts only; errors cleared", async () => {
    const id = await seedSubscriptionCanceled("user_c3_ok", "kok");
    const purgeFn = mockPurge(async () => ({
      ok: true,
      value: {
        outcome: "purged",
        counts: { journal_entries: 3 },
        limitations: [],
      },
    }));
    const purged = await orchestrateAppDataPurge({
      requestId: id,
      clerkUserId: "user_c3_ok",
      lockOwner: "w",
      purgeFn,
    });
    expect(purged.ok).toBe(true);
    if (!purged.ok) return;
    expect(purged.value.row.steps.app_data_purged?.detail).toBe(
      "limitations:0;categories:1;deleted_total:3"
    );
    expect(purged.value.row.steps.app_data_purged?.detail).not.toMatch(
      /user_|@|\+\d|journal_entries/
    );
    const marker = purged.value.row.steps[APP_DATA_PURGE_RPC_STEP];
    expect(marker?.code).toBe("purged");
    expect(marker?.detail).toBe(
      "limitations:0;categories:1;deleted_total:3"
    );
    expect(marker?.detail!.length).toBeLessThanOrEqual(
      APP_DATA_PURGE_RPC_MARKER_DETAIL_MAX
    );
    expect(marker?.detail).not.toMatch(/user_|@|\+\d|supabase|SELECT/i);

    useInMemoryAccountDeletionStoreForTests();
    const id2 = await seedSubscriptionCanceled("user_c3_abs", "kabs");
    const purgeFn2 = mockPurge(async () => ({
      ok: true,
      value: { outcome: "already_absent", counts: {}, limitations: [] },
    }));
    const absent = await orchestrateAppDataPurge({
      requestId: id2,
      clerkUserId: "user_c3_abs",
      lockOwner: "w",
      purgeFn: purgeFn2,
    });
    expect(absent.ok).toBe(true);
    if (!absent.ok) return;
    expect(absent.value.outcome).toBe("already_done");
    expect(absent.value.purgeResult).toBe("already_done");
    expect(absent.value.row.status).toBe("app_data_purged");
    expect(absent.value.row.purge_result).toBe("already_done");
    expect(absent.value.row.steps[APP_DATA_PURGE_RPC_STEP]?.code).toBe(
      "already_absent"
    );
  });

  it("18–24. incomplete/internal_error never advance; sanitized; retryable", async () => {
    const id = await seedSubscriptionCanceled("user_c3_inc", "kinc");
    const purgeFn = mockPurge(async () => ({
      ok: true,
      value: {
        outcome: "incomplete",
        counts: { journal_entries: 1 },
        limitations: ["some_store_deferred"],
      },
    }));
    const incomplete = await orchestrateAppDataPurge({
      requestId: id,
      clerkUserId: "user_c3_inc",
      lockOwner: "w",
      purgeFn,
    });
    expect(incomplete.ok).toBe(false);
    const row = await getAccountDeletionRequestById(id);
    expect(row?.status).toBe("failed_retryable");
    expect(row?.current_step).toBe("purging_app_data");
    expect(row?.purge_result).toBe("failed");
    expect(row?.last_error_code).toBe("app_data_purge_incomplete");
    expect(row?.last_error_detail).not.toMatch(/supabase|stack|SELECT/i);
    expect(row?.steps[APP_DATA_PURGE_RPC_STEP]).toBeUndefined();

    useInMemoryAccountDeletionStoreForTests();
    const id2 = await seedSubscriptionCanceled("user_c3_err", "kerr");
    const purgeFn2 = mockPurge(async () => ({
      ok: false,
      code: "internal_error",
      message: "relation does not exist user_xyz@evil.com +15551234567",
    }));
    const failed = await orchestrateAppDataPurge({
      requestId: id2,
      clerkUserId: "user_c3_err",
      lockOwner: "w",
      purgeFn: purgeFn2,
    });
    expect(failed.ok).toBe(false);
    const row2 = await getAccountDeletionRequestById(id2);
    expect(row2?.status).toBe("failed_retryable");
    expect(row2?.purge_result).toBe("failed");
    expect(row2?.last_error_detail).not.toContain("user_xyz");
    expect(row2?.last_error_detail).not.toContain("@evil.com");
  });

  it("25. app_data_purged → already_done without purge or lease", async () => {
    const id = await seedSubscriptionCanceled("user_c3_done", "kdone");
    const purgeFn = mockPurge(async () => ({
      ok: true,
      value: { outcome: "purged", counts: { a: 1 }, limitations: [] },
    }));
    const first = await orchestrateAppDataPurge({
      requestId: id,
      clerkUserId: "user_c3_done",
      lockOwner: "w",
      purgeFn,
    });
    expect(first.ok).toBe(true);
    const afterFirst = await getAccountDeletionRequestById(id);
    const attemptsAfterFirst = afterFirst?.attempt_count ?? 0;
    purgeFn.mockClear();

    const second = await orchestrateAppDataPurge({
      requestId: id,
      clerkUserId: "user_c3_done",
      lockOwner: "w",
      purgeFn,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.outcome).toBe("already_done");
    expect(purgeFn).not.toHaveBeenCalled();
    const afterSecond = await getAccountDeletionRequestById(id);
    expect(afterSecond?.attempt_count).toBe(attemptsAfterFirst);
    expect(afterSecond?.lock_owner).toBeNull();
  });

  it("26–27. purging pending/failed retries safely when marker absent", async () => {
    const id = await seedSubscriptionCanceled("user_c3_retry", "kretry");
    let calls = 0;
    const purgeFn = mockPurge(
      async (): Promise<
        AccountDeletionRepoResult<PurgeAppDataForDeletionValue>
      > => {
        calls += 1;
        if (calls === 1) {
          return {
            ok: true,
            value: {
              outcome: "incomplete",
              counts: {},
              limitations: ["x"],
            },
          };
        }
        return {
          ok: true,
          value: {
            outcome: "purged",
            counts: { journal_entries: 1 },
            limitations: [],
          },
        };
      }
    );

    const first = await orchestrateAppDataPurge({
      requestId: id,
      clerkUserId: "user_c3_retry",
      lockOwner: "w",
      purgeFn,
    });
    expect(first.ok).toBe(false);
    expect(calls).toBe(1);

    const second = await orchestrateAppDataPurge({
      requestId: id,
      clerkUserId: "user_c3_retry",
      lockOwner: "w",
      purgeFn,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.row.status).toBe("app_data_purged");
    expect(calls).toBe(2);
  });

  it("28–30. already app_data_purged short-circuits before purge", async () => {
    const id = await seedSubscriptionCanceled("user_c3_recon", "krecon");
    const purgeFn = mockPurge(async () => ({
      ok: true,
      value: { outcome: "purged", counts: { x: 1 }, limitations: [] },
    }));

    const ok = await orchestrateAppDataPurge({
      requestId: id,
      clerkUserId: "user_c3_recon",
      lockOwner: "w",
      purgeFn,
    });
    expect(ok.ok).toBe(true);

    const conflictPurge = mockPurge(async () => ({
      ok: false as const,
      code: "cas_conflict" as const,
      message: "purge_conflict_or_lease",
    }));
    const again = await orchestrateAppDataPurge({
      requestId: id,
      clerkUserId: "user_c3_recon",
      lockOwner: "w",
      purgeFn: conflictPurge,
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.outcome).toBe("already_done");
    expect(conflictPurge).not.toHaveBeenCalled();
  });

  it("32. already_absent is successful recovery", async () => {
    const id = await seedSubscriptionCanceled("user_c3_aa", "kaa");
    const purgeFn = mockPurge(async () => ({
      ok: true,
      value: { outcome: "already_absent", counts: {}, limitations: [] },
    }));
    const result = await orchestrateAppDataPurge({
      requestId: id,
      clerkUserId: "user_c3_aa",
      lockOwner: "w",
      purgeFn,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe("already_done");
    expect(result.value.row.purge_result).toBe("already_done");
  });

  it("33–35. never calls purge for another clerk; no Clerk/Stripe imports", async () => {
    const src = readFileSync(ORCHESTRATOR, "utf8");
    expect(src).toContain('import "server-only"');
    expect(src).not.toMatch(
      /from ["']@clerk\/|from ["']stripe["']|from ["']twilio["']/i
    );
    expect(src).not.toMatch(/deleteUser|customers\.del|subscriptions\.cancel/);

    const id = await seedSubscriptionCanceled("user_c3_iso", "kiso");
    const seen: string[] = [];
    const purgeFn = mockPurge(async (input) => {
      seen.push(input.clerkUserId);
      return {
        ok: true,
        value: { outcome: "purged", counts: {}, limitations: [] },
      };
    });
    await orchestrateAppDataPurge({
      requestId: id,
      clerkUserId: "user_c3_iso",
      lockOwner: "w",
      purgeFn,
    });
    expect(seen).toEqual(["user_c3_iso"]);
  });

  it("36–38. no route imports; helper utilities", () => {
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
    const hits = walk(API_DIR).filter((p) => {
      const text = readFileSync(p, "utf8");
      return /orchestrateAppDataPurge|orchestrate-app-data-purge/.test(text);
    });
    expect(hits).toEqual([]);

    expect(
      isEligibleSmsAndStripeForPurge({ sms_result: "ok", stripe_result: "ok" })
    ).toBe(true);
    expect(
      isEligibleSmsAndStripeForPurge({
        sms_result: "pending",
        stripe_result: "ok",
      })
    ).toBe(false);
    expect(formatPurgeCountsDetail({ b: 2, a: 1 })).toBe(
      "categories:2;deleted_total:3"
    );
  });

  describe("post-purge durable compact marker + final-CAS reconciliation", () => {
    it("large C2 count map: compact marker round-trips; final CAS exhaust then CAS-only finalize", async () => {
      const FINAL_CAS_BLOCK_COUNT = 3;
      const largeCounts = buildLargeC2CountMap();
      expect(Object.keys(largeCounts).length).toBeGreaterThanOrEqual(40);
      expect(largeCounts.sms_identities).toBe(123456789);
      const expectedAgg = summarizePurgeCounts(largeCounts);
      expect(expectedAgg).not.toBeNull();
      if (!expectedAgg) return;

      const encoded = encodeAppDataPurgeRpcMarkerDetail(expectedAgg);
      expect(encoded).not.toBeNull();
      expect(encoded!.length).toBeLessThanOrEqual(
        APP_DATA_PURGE_RPC_MARKER_DETAIL_MAX
      );
      expect(encoded).toBe(
        `limitations:0;categories:${expectedAgg.categoryCount};deleted_total:${expectedAgg.deletedTotal}`
      );
      // Must not go through generic error sanitizer (would truncate/redact).
      const sanitizedWouldBreak = sanitizeAccountDeletionErrorDetail(
        // Simulate old per-table encoding size:
        `categories:40;${Object.keys(largeCounts)
          .slice(0, 40)
          .map((k) => `${k}:${largeCounts[k]}`)
          .join(",")};limitations:0`
      );
      expect((sanitizedWouldBreak ?? "").length).toBeLessThanOrEqual(500);
      expect(encoded).not.toEqual(sanitizedWouldBreak);
      expect(parseAppDataPurgeRpcMarkerDetail(encoded!)).toEqual(expectedAgg);

      const id = await seedSubscriptionCanceled("user_c3_large", "klarge");
      const purgeFn = mockPurge(async () => ({
        ok: true,
        value: {
          outcome: "purged",
          counts: largeCounts,
          limitations: [],
        },
      }));

      const realTransition = transitionAccountDeletionRequest;
      let finalCasAttempts = 0;
      const transitionSpy = vi
        .spyOn(repository, "transitionAccountDeletionRequest")
        .mockImplementation(async (input) => {
          if (input.toStatus === "app_data_purged") {
            finalCasAttempts += 1;
            if (finalCasAttempts <= FINAL_CAS_BLOCK_COUNT) {
              return {
                ok: false,
                code: "cas_conflict",
                message: "forced_final_cas_conflict",
              };
            }
          }
          return realTransition(input);
        });

      const first = await orchestrateAppDataPurge({
        requestId: id,
        clerkUserId: "user_c3_large",
        lockOwner: "w1",
        purgeFn,
      });
      expect(first.ok).toBe(false);
      if (first.ok) return;
      expect(first.code).toBe("cas_conflict");
      expect(purgeFn).toHaveBeenCalledTimes(1);
      expect(finalCasAttempts).toBe(3);

      const mid = await getAccountDeletionRequestById(id);
      expect(mid?.status).toBe("purging_app_data");
      expect(mid?.purge_result).toBe("pending");
      const marker = mid!.steps[APP_DATA_PURGE_RPC_STEP];
      expect(marker?.detail).toBe(encoded);
      expect(marker?.detail!.length).toBeLessThanOrEqual(
        APP_DATA_PURGE_RPC_MARKER_DETAIL_MAX
      );
      expect(marker?.detail).not.toMatch(/sms_identities|journal_entries/);
      const markerRead = readAppDataPurgeRpcMarker(mid!);
      expect(markerRead.kind).toBe("valid");
      if (markerRead.kind !== "valid") return;
      expect(markerRead.marker.outcome).toBe("purged");
      expect(markerRead.marker.categoryCount).toBe(expectedAgg.categoryCount);
      expect(markerRead.marker.deletedTotal).toBe(expectedAgg.deletedTotal);
      expect(stepsLookNonPii(mid!.steps)).toBe(true);

      const second = await orchestrateAppDataPurge({
        requestId: id,
        clerkUserId: "user_c3_large",
        lockOwner: "w2",
        expectedOrchestrationVersion: 999,
        purgeFn,
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value.row.status).toBe("app_data_purged");
      expect(second.value.purgeResult).toBe("ok");
      expect(purgeFn).toHaveBeenCalledTimes(1);
      expect(second.value.row.steps[APP_DATA_PURGE_RPC_STEP]?.detail).toBe(
        encoded
      );

      const finalCasCalls = transitionSpy.mock.calls.filter(
        (c) => c[0]?.toStatus === "app_data_purged"
      );
      expect(
        finalCasCalls.some((c) => c[0]?.expectedOrchestrationVersion === 1)
      ).toBe(true);
      expect(
        finalCasCalls.every(
          (c) => c[0]?.expectedOrchestrationVersion !== 999
        )
      ).toBe(true);
    });

    it("already_absent compact marker maps to purge_result=already_done on CAS-only retry", async () => {
      const id = await seedSubscriptionCanceled("user_c3_mark_abs", "kmarkabs");
      const purgeFn = mockPurge(async () => ({
        ok: true,
        value: { outcome: "already_absent", counts: {}, limitations: [] },
      }));

      const realTransition = transitionAccountDeletionRequest;
      let block = 3;
      vi.spyOn(repository, "transitionAccountDeletionRequest").mockImplementation(
        async (input) => {
          if (input.toStatus === "app_data_purged" && block > 0) {
            block -= 1;
            return {
              ok: false,
              code: "cas_conflict",
              message: "forced",
            };
          }
          return realTransition(input);
        }
      );

      const first = await orchestrateAppDataPurge({
        requestId: id,
        clerkUserId: "user_c3_mark_abs",
        lockOwner: "w",
        purgeFn,
      });
      expect(first.ok).toBe(false);
      const mid = await getAccountDeletionRequestById(id);
      expect(mid?.steps[APP_DATA_PURGE_RPC_STEP]?.code).toBe("already_absent");
      expect(mid?.steps[APP_DATA_PURGE_RPC_STEP]?.detail).toBe(
        "limitations:0;categories:0;deleted_total:0"
      );

      const second = await orchestrateAppDataPurge({
        requestId: id,
        clerkUserId: "user_c3_mark_abs",
        lockOwner: "w",
        purgeFn,
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value.outcome).toBe("already_done");
      expect(second.value.row.purge_result).toBe("already_done");
      expect(purgeFn).toHaveBeenCalledTimes(1);
    });

    it("count validation fail-closed: negative / decimal / unsafe / overflow / nonnumeric", async () => {
      expect(summarizePurgeCounts({ a: -1 })).toBeNull();
      expect(summarizePurgeCounts({ a: 1.5 })).toBeNull();
      expect(summarizePurgeCounts({ a: Number.MAX_SAFE_INTEGER + 1 })).toBeNull();
      expect(summarizePurgeCounts({ a: "1" as unknown as number })).toBeNull();
      expect(
        summarizePurgeCounts({
          a: Number.MAX_SAFE_INTEGER,
          b: 1,
        })
      ).toBeNull();

      const id = await seedSubscriptionCanceled("user_c3_badcounts", "kbadc");
      const purgeFn = mockPurge(async () => ({
        ok: true,
        value: {
          outcome: "purged",
          counts: { journal_entries: -1 },
          limitations: [],
        },
      }));
      const result = await orchestrateAppDataPurge({
        requestId: id,
        clerkUserId: "user_c3_badcounts",
        lockOwner: "w",
        purgeFn,
      });
      expect(result.ok).toBe(false);
      const row = await getAccountDeletionRequestById(id);
      expect(row?.steps[APP_DATA_PURGE_RPC_STEP]).toBeUndefined();
      expect(row?.status).toBe("purging_app_data");
    });

    it("parser rejects missing at, invalid timestamp, missing limitations, duplicates, unknown, oversized", () => {
      expect(
        parseAppDataPurgeRpcMarkerDetail("categories:1;deleted_total:1")
      ).toBeNull();
      expect(
        parseAppDataPurgeRpcMarkerDetail(
          "limitations:0;categories:1;deleted_total:1;extra:0"
        )
      ).toBeNull();
      expect(
        parseAppDataPurgeRpcMarkerDetail(
          "limitations:0;limitations:0;categories:1;deleted_total:1"
        )
      ).toBeNull();
      expect(
        parseAppDataPurgeRpcMarkerDetail(
          "limitations:0;categories:1;deleted_total:1;unknown:2"
        )
      ).toBeNull();
      expect(
        parseAppDataPurgeRpcMarkerDetail(`limitations:0;${"x".repeat(200)}`)
      ).toBeNull();
      expect(parseAppDataPurgeRpcMarkerDetail("limitations:1;categories:0;deleted_total:0")).toBeNull();
      expect(parseAppDataPurgeRpcMarkerDetail("limitations:0; categories:1;deleted_total:1")).toBeNull();

      expect(
        readAppDataPurgeRpcMarker({
          steps: {
            [APP_DATA_PURGE_RPC_STEP]: {
              ok: true,
              code: "purged",
              detail: "limitations:0;categories:0;deleted_total:0",
            },
          },
        }).kind
      ).toBe("malformed");

      expect(
        readAppDataPurgeRpcMarker({
          steps: {
            [APP_DATA_PURGE_RPC_STEP]: {
              at: "not-a-timestamp",
              ok: true,
              code: "purged",
              detail: "limitations:0;categories:0;deleted_total:0",
            },
          },
        }).kind
      ).toBe("malformed");

      expect(
        readAppDataPurgeRpcMarker({
          steps: {
            [APP_DATA_PURGE_RPC_STEP]: {
              at: new Date().toISOString(),
              ok: true,
              code: "purged",
              detail: "limitations:0",
            },
          },
        }).kind
      ).toBe("valid");
    });

    it("reload already app_data_purged during final CAS returns success", async () => {
      const id = await seedSubscriptionCanceled("user_c3_race", "krace");
      const purgeFn = mockPurge(async () => ({
        ok: true,
        value: {
          outcome: "purged",
          counts: { journal_entries: 1 },
          limitations: [],
        },
      }));

      const realTransition = transitionAccountDeletionRequest;
      vi.spyOn(repository, "transitionAccountDeletionRequest").mockImplementation(
        async (input) => {
          if (input.toStatus === "app_data_purged") {
            const forced = await realTransition(input);
            expect(forced.ok).toBe(true);
            return {
              ok: false,
              code: "cas_conflict",
              message: "lost_race_after_peer_success",
            };
          }
          return realTransition(input);
        }
      );

      const result = await orchestrateAppDataPurge({
        requestId: id,
        clerkUserId: "user_c3_race",
        lockOwner: "w",
        purgeFn,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.row.status).toBe("app_data_purged");
    });

    it("unexpected status after purge returns conflict; no false success", async () => {
      const id = await seedSubscriptionCanceled("user_c3_unexp", "kunexp");
      const purgeFn = mockPurge(async () => ({
        ok: true,
        value: {
          outcome: "purged",
          counts: { journal_entries: 1 },
          limitations: [],
        },
      }));

      const realGet = getAccountDeletionRequestById;
      const realPatch = patchAccountDeletionRequestWhileLeased;
      let afterMarker = false;

      vi.spyOn(
        repository,
        "patchAccountDeletionRequestWhileLeased"
      ).mockImplementation(async (input) => {
        const result = await realPatch(input);
        afterMarker = true;
        return result;
      });

      vi.spyOn(repository, "getAccountDeletionRequestById").mockImplementation(
        async (requestId) => {
          const row = await realGet(requestId);
          if (
            afterMarker &&
            row &&
            row.status === "purging_app_data" &&
            row.steps[APP_DATA_PURGE_RPC_STEP]
          ) {
            return { ...row, status: "canceling_subscription" };
          }
          return row;
        }
      );

      const result = await orchestrateAppDataPurge({
        requestId: id,
        clerkUserId: "user_c3_unexp",
        lockOwner: "w",
        purgeFn,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("cas_conflict");
      const durable = await realGet(id);
      expect(durable?.status).toBe("purging_app_data");
      expect(durable?.steps[APP_DATA_PURGE_RPC_STEP]?.code).toBe("purged");
    });

    it("marker persistence failure after purge success → retryable; next may re-purge to already_absent", async () => {
      const id = await seedSubscriptionCanceled("user_c3_markfail", "kmarkfail");
      let purgeCalls = 0;
      const purgeFn = mockPurge(
        async (): Promise<
          AccountDeletionRepoResult<PurgeAppDataForDeletionValue>
        > => {
          purgeCalls += 1;
          if (purgeCalls === 1) {
            return {
              ok: true,
              value: {
                outcome: "purged",
                counts: { journal_entries: 2 },
                limitations: [],
              },
            };
          }
          return {
            ok: true,
            value: {
              outcome: "already_absent",
              counts: {},
              limitations: [],
            },
          };
        }
      );

      vi.spyOn(
        repository,
        "patchAccountDeletionRequestWhileLeased"
      ).mockResolvedValueOnce({
        ok: false,
        code: "cas_conflict",
        message: "marker_write_failed",
      });

      const first = await orchestrateAppDataPurge({
        requestId: id,
        clerkUserId: "user_c3_markfail",
        lockOwner: "w",
        purgeFn,
      });
      expect(first.ok).toBe(false);
      if (!first.ok) expect(first.code).toBe("cas_conflict");
      expect(purgeCalls).toBe(1);
      const mid = await getAccountDeletionRequestById(id);
      expect(mid?.steps[APP_DATA_PURGE_RPC_STEP]).toBeUndefined();
      expect(mid?.status).toBe("purging_app_data");

      const second = await orchestrateAppDataPurge({
        requestId: id,
        clerkUserId: "user_c3_markfail",
        lockOwner: "w",
        purgeFn,
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(purgeCalls).toBe(2);
      expect(second.value.row.purge_result).toBe("already_done");
      expect(second.value.row.status).toBe("app_data_purged");
    });

    it("malformed marker fails closed; nonempty limitations / wrong grammar preserved", async () => {
      const id = await seedSubscriptionCanceled("user_c3_badmark", "kbadmark");
      const owner = "seed-bad";
      await acquireAccountDeletionLease({ requestId: id, lockOwner: owner });
      await transitionAccountDeletionRequest({
        requestId: id,
        fromStatus: "subscription_canceled",
        toStatus: "purging_app_data",
        lockOwner: owner,
        purgeResult: "pending",
      });
      await patchAccountDeletionRequestWhileLeased({
        requestId: id,
        expectedStatus: "purging_app_data",
        lockOwner: owner,
        steps: {
          ...(await getAccountDeletionRequestById(id))!.steps,
          [APP_DATA_PURGE_RPC_STEP]: {
            at: new Date().toISOString(),
            ok: true,
            code: "purged",
            detail: "limitations:3;categories:1;deleted_total:1",
          },
        },
      });
      await releaseAccountDeletionLease({ requestId: id, lockOwner: owner });

      const purgeFn = mockPurge(async () => ({
        ok: true,
        value: { outcome: "purged", counts: {}, limitations: [] },
      }));
      const badLim = await orchestrateAppDataPurge({
        requestId: id,
        clerkUserId: "user_c3_badmark",
        lockOwner: "w",
        purgeFn,
      });
      expect(badLim.ok).toBe(false);
      if (!badLim.ok) expect(badLim.code).toBe("cas_conflict");
      expect(purgeFn).not.toHaveBeenCalled();
      const still = await getAccountDeletionRequestById(id);
      expect(still?.steps[APP_DATA_PURGE_RPC_STEP]?.detail).toContain(
        "limitations:3"
      );

      useInMemoryAccountDeletionStoreForTests();
      const id2 = await seedSubscriptionCanceled("user_c3_badmark2", "kbadmark2");
      await acquireAccountDeletionLease({ requestId: id2, lockOwner: owner });
      await transitionAccountDeletionRequest({
        requestId: id2,
        fromStatus: "subscription_canceled",
        toStatus: "purging_app_data",
        lockOwner: owner,
        purgeResult: "pending",
      });
      await patchAccountDeletionRequestWhileLeased({
        requestId: id2,
        expectedStatus: "purging_app_data",
        lockOwner: owner,
        steps: {
          ...(await getAccountDeletionRequestById(id2))!.steps,
          [APP_DATA_PURGE_RPC_STEP]: {
            at: new Date().toISOString(),
            ok: true,
            code: "weird_outcome",
            detail: "limitations:0;categories:0;deleted_total:0",
          },
        },
      });
      await releaseAccountDeletionLease({ requestId: id2, lockOwner: owner });

      const badCode = await orchestrateAppDataPurge({
        requestId: id2,
        clerkUserId: "user_c3_badmark2",
        lockOwner: "w",
        purgeFn,
      });
      expect(badCode.ok).toBe(false);
      expect(purgeFn).not.toHaveBeenCalled();
    });

    it("failure recorder preserves valid compact success marker", async () => {
      const id = await seedSubscriptionCanceled("user_c3_pres", "kpres");
      const owner = "seed-pres";
      await acquireAccountDeletionLease({ requestId: id, lockOwner: owner });
      await transitionAccountDeletionRequest({
        requestId: id,
        fromStatus: "subscription_canceled",
        toStatus: "purging_app_data",
        lockOwner: owner,
        purgeResult: "pending",
      });
      const marked = await patchAccountDeletionRequestWhileLeased({
        requestId: id,
        expectedStatus: "purging_app_data",
        lockOwner: owner,
        steps: {
          ...(await getAccountDeletionRequestById(id))!.steps,
          [APP_DATA_PURGE_RPC_STEP]: {
            at: new Date().toISOString(),
            ok: true,
            code: "purged",
            detail: "limitations:0;categories:1;deleted_total:2",
          },
        },
      });
      expect(marked.ok).toBe(true);

      const failed = await recordAccountDeletionFailure({
        requestId: id,
        fromStatus: "purging_app_data",
        terminal: false,
        errorCode: "simulated_post_marker_noise",
        errorDetail: "noise",
        lockOwner: owner,
        purgeResult: "failed",
      });
      expect(failed.ok).toBe(true);
      if (!failed.ok) return;
      expect(failed.value.steps[APP_DATA_PURGE_RPC_STEP]?.code).toBe("purged");
      expect(failed.value.steps[APP_DATA_PURGE_RPC_STEP]?.detail).toBe(
        "limitations:0;categories:1;deleted_total:2"
      );
      expect(failed.value.purge_result).toBe("failed");

      const purgeFn = mockPurge(async () => ({
        ok: true,
        value: { outcome: "purged", counts: {}, limitations: [] },
      }));
      const resumed = await orchestrateAppDataPurge({
        requestId: id,
        clerkUserId: "user_c3_pres",
        lockOwner: "w",
        purgeFn,
      });
      expect(resumed.ok).toBe(true);
      if (!resumed.ok) return;
      expect(purgeFn).not.toHaveBeenCalled();
      expect(resumed.value.row.status).toBe("app_data_purged");
      expect(resumed.value.row.purge_result).toBe("ok");
    });
  });
});
