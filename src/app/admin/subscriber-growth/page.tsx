import { Suspense } from "react";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import { loadSubscriberGrowthDashboard } from "@/lib/admin-subscriber-growth";
import type { GrowthDateRange } from "@/lib/admin-subscriber-growth-pure";
import { loadAdLabSummary } from "@/lib/ad-lab-read";
import { loadMetaAdLabInsights } from "@/lib/meta-ad-lab-insights";
import { metaAdLabRangeFromQuery } from "@/lib/meta-ad-lab-insights-pure";

import SubscriberGrowthDashboard from "./subscriber-growth-dashboard";
import { SubscriberGrowthAdLab } from "./subscriber-growth-ad-lab";
import { SubscriberGrowthMetaInsights } from "./subscriber-growth-meta-insights";

function firstQueryValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || null;
}

async function MetaAdDelivery({ range }: { range: GrowthDateRange }) {
  const report = await loadMetaAdLabInsights({ range });
  return <SubscriberGrowthMetaInsights report={report} />;
}

async function AdLabSummary({
  range,
  subscriptions,
}: {
  range: GrowthDateRange;
  subscriptions?: { complete: boolean; subs: import("@/lib/admin-subscriber-growth-pure").GrowthStripeSubscription[] };
}) {
  const view = await loadAdLabSummary({ range, subscriptions });
  return <SubscriberGrowthAdLab view={view} />;
}

/** Never cache admin growth aggregates across sessions. */
export const dynamic = "force-dynamic";

export default async function AdminSubscriberGrowthPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireTylerAdmin();

  const resolved = searchParams ? await searchParams : {};
  const data = await loadSubscriberGrowthDashboard({ searchParams: resolved });
  const range = metaAdLabRangeFromQuery(firstQueryValue(resolved.range));

  return (
    <SubscriberGrowthDashboard
      data={data}
      adLab={
        <Suspense
          fallback={
            <p className="mt-3 text-[11px] text-gray-500">
              Reading stored Meta delivery. The figures above are unchanged.
            </p>
          }
        >
          <AdLabSummary range={range} subscriptions={data.adLabSubscriptions} />
        </Suspense>
      }
      metaInsights={
        <Suspense
          fallback={
            <p className="mt-3 text-[11px] text-gray-500">
              Reading Meta ad delivery. The figures above are unchanged.
            </p>
          }
        >
          <MetaAdDelivery range={range} />
        </Suspense>
      }
    />
  );
}
