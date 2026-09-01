import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import { loadSubscriberGrowthDashboard } from "@/lib/admin-subscriber-growth";

import SubscriberGrowthDashboard from "./subscriber-growth-dashboard";

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

  return <SubscriberGrowthDashboard data={data} />;
}
