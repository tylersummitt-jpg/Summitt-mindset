import "server-only";

import { listAccountDeletionRequestsForAdmin } from "@/lib/account-deletion/list-account-deletion-admin";
import { loadSubscriberGrowthDashboard } from "@/lib/admin-subscriber-growth";
import { buildOperatingSnapshot, type OperatingSnapshot } from "@/lib/admin-operating-snapshot";
import { loadCheckoutMeasurement } from "@/lib/checkout-tracking-load.server";
import { unavailableCheckoutMeasurement } from "@/lib/checkout-tracking";
import { loadNonmemberCensus } from "@/lib/nonmember-census.server";
import { failedNonmemberCensus } from "@/lib/nonmember-census";
import { createSupabaseChallengeStore } from "@/lib/challenge-supabase-store";

export async function loadOperatingSnapshot(args: {
  searchParams?: Record<string, string | string[] | undefined>;
  now?: Date;
}): Promise<OperatingSnapshot> {
  const growth = await loadSubscriberGrowthDashboard(args);

  let challengeAttention: number | null = null;
  try {
    const count = await createSupabaseChallengeStore().countNeedsAttention();
    challengeAttention = count < 0 ? null : count;
  } catch (err) {
    console.warn("[operating] challenge attention count failed", {
      reason: err instanceof Error ? err.message : "challenge_count_failed",
    });
    challengeAttention = null;
  }

  const deletions = await listAccountDeletionRequestsForAdmin({
    status: "all",
  });

  let checkout = unavailableCheckoutMeasurement();
  try {
    checkout = await loadCheckoutMeasurement(args);
  } catch (err) {
    console.warn("[operating] checkout measurement failed", {
      reason: err instanceof Error ? err.message : "checkout_measurement_failed",
    });
  }

  let census = failedNonmemberCensus();
  try {
    census = await loadNonmemberCensus(args.now ?? new Date());
  } catch (err) {
    console.warn("[operating] nonmember census failed", {
      reason: err instanceof Error ? err.message : "nonmember_census_failed",
    });
  }

  return buildOperatingSnapshot({
    growth,
    challengeAttention,
    deletions: deletions.ok ? deletions.value.summary : null,
    deletionsAvailable: deletions.ok,
    checkout,
    census,
  });
}
