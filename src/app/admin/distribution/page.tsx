import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import { loadOperatingSnapshot } from "@/lib/admin-operating-snapshot.server";

import { OperatingScreen } from "../operating-screen";

export const dynamic = "force-dynamic";

export default async function AdminDistributionPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireTylerAdmin();
  const resolved = searchParams ? await searchParams : {};
  const snapshot = await loadOperatingSnapshot({ searchParams: resolved });
  return <OperatingScreen focus="distribution" snapshot={snapshot} />;
}
