import "server-only";

import { listAccountDeletionRequestsForAdmin } from "@/lib/account-deletion/list-account-deletion-admin";
import { loadSubscriberGrowthDashboard } from "@/lib/admin-subscriber-growth";
import { buildOperatingSnapshot, type OperatingSnapshot } from "@/lib/admin-operating-snapshot";
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

  return buildOperatingSnapshot({
    growth,
    challengeAttention,
    deletions: deletions.ok ? deletions.value.summary : null,
    deletionsAvailable: deletions.ok,
  });
}
