import { redirect } from "next/navigation";

import { resolveTylerTextOverviewRootRedirectPath } from "@/lib/tyler-text-overview-dashboard-copy";

export default async function AdminTylerTextOverviewRootPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = searchParams ? await searchParams : {};
  redirect(resolveTylerTextOverviewRootRedirectPath(resolved));
}
