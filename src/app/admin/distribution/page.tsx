import { loadDistributionCommand } from "@/lib/acquisition/distribution-command.server";
import { loadEmailRepresentativeReport } from "@/lib/acquisition/email-representative-metrics.server";
import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import { loadOperatingSnapshot } from "@/lib/admin-operating-snapshot.server";

import { OperatingScreen } from "../operating-screen";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || null;
}

export default async function AdminDistributionPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireTylerAdmin();
  const resolved = searchParams ? await searchParams : {};
  const [snapshot, emailRepresentative, command] = await Promise.all([
    loadOperatingSnapshot({ searchParams: resolved }),
    loadEmailRepresentativeReport(),
    loadDistributionCommand({ searchParams: resolved }),
  ]);
  const selected = first(resolved.emailCampaign);
  return (
    <OperatingScreen
      focus="distribution"
      snapshot={snapshot}
      emailRepresentative={emailRepresentative}
      command={command}
      selectedCampaignId={selected && /^[A-Za-z0-9_-]{1,80}$/.test(selected) ? selected : null}
    />
  );
}
