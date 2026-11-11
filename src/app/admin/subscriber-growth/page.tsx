import { Suspense } from "react";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import { loadSubscriberGrowthDashboard } from "@/lib/admin-subscriber-growth";
import type { GrowthDateRange } from "@/lib/admin-subscriber-growth-pure";
import { loadMetaAdLabInsights } from "@/lib/meta-ad-lab-insights";
import { metaAdLabRangeFromQuery } from "@/lib/meta-ad-lab-insights-pure";

import SubscriberGrowthDashboard from "./subscriber-growth-dashboard";
import { SubscriberGrowthMetaInsights } from "./subscriber-growth-meta-insights";

function firstQueryValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || null;
}

async function MetaAdDelivery({ range }: { range: GrowthDateRange }) {
  const report = await loadMetaAdLabInsights({ range });
  return <SubscriberGrowthMetaInsights report={report} />;
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
