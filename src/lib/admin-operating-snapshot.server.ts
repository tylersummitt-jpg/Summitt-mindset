import "server-only";

import { listAccountDeletionRequestsForAdmin } from "@/lib/account-deletion/list-account-deletion-admin";
import { loadSubscriberGrowthDashboard } from "@/lib/admin-subscriber-growth";
import { buildOperatingSnapshot, type OperatingSnapshot } from "@/lib/admin-operating-snapshot";
import { loadCheckoutMeasurement } from "@/lib/checkout-tracking-load.server";
import { unavailableCheckoutMeasurement } from "@/lib/checkout-tracking";
import { loadNonmemberCensus } from "@/lib/nonmember-census.server";
import { failedNonmemberCensus } from "@/lib/nonmember-census";
import { createSupabaseChallengeStore } from "@/lib/challenge-supabase-store";
import { loadExperimentRegistry } from "@/lib/operating-experiments.server";
import type { ExperimentRegistry } from "@/lib/operating-experiments";
import { loadLandingPagePerformance } from "@/lib/landing-page-performance.server";
import type { LandingPagePerformance } from "@/lib/landing-page-performance";
import {
  EMPTY_PROUD_TEST_REPORT,
  type ProudTestReport,
} from "@/lib/landing-experiment";
import {
  ensureProudTestExperiment,
  loadLandingExperimentReports,
} from "@/lib/landing-experiment.server";

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

  let landingPages: LandingPagePerformance = {
    available: false,
    incomplete: false,
    billingConnected: false,
    journeyUnreadable: false,
    billingUnreadable: false,
    paymentsUnreadable: false,
    rows: [],
    note: "Landing-page analytics could not be read. Do not treat that as zero visitors.",
  };
  try {
    landingPages = await loadLandingPagePerformance({
      ...args,
      billing: growth.landingBilling ?? {
        subscriptionsReadable: false,
        paymentsReadable: false,
        trials: [],
        payments: [],
      },
    });
  } catch (err) {
    console.warn("[operating] landing page performance failed", {
      reason: err instanceof Error ? err.message : "landing_page_performance_failed",
    });
  }

  let experiments: ExperimentRegistry = { available: false, records: [] };
  try {
    await ensureProudTestExperiment();
  } catch (err) {
    console.warn("[operating] proud test registry seed failed", {
      reason: err instanceof Error ? err.message : "proud_test_seed_failed",
    });
  }
  try {
    experiments = await loadExperimentRegistry();
  } catch (err) {
    console.warn("[operating] experiment registry failed", {
      reason: err instanceof Error ? err.message : "experiment_registry_failed",
    });
  }

  let landingExperiments: ProudTestReport[] = [EMPTY_PROUD_TEST_REPORT];
  try {
    landingExperiments = await loadLandingExperimentReports({
      billing: growth.landingBilling ?? {
        subscriptionsReadable: false,
        paymentsReadable: false,
        trials: [],
        payments: [],
      },
      now: args.now,
    });
  } catch (err) {
    console.warn("[operating] landing experiment report failed", {
      reason: err instanceof Error ? err.message : "landing_experiment_failed",
    });
    landingExperiments = [
      {
        ...EMPTY_PROUD_TEST_REPORT,
        loaded: true,
        exposuresUnreadable: true,
        note: "The controlled landing test could not be read. Do not treat that as zero visitors.",
        coverage: "Exposures could not be read. Do not treat that as zero visitors.",
      },
    ];
  }

  return buildOperatingSnapshot({
    growth,
    challengeAttention,
    deletions: deletions.ok ? deletions.value.summary : null,
    deletionsAvailable: deletions.ok,
    checkout,
    census,
    experiments,
    landingPages,
    landingExperiments,
  });
}
