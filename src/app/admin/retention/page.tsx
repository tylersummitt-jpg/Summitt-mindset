import { requireTylerAdmin, isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";
import { loadCancellationComments, type CancellationCommentView } from "@/lib/cancellation-comments.server";
import { loadOperatingSnapshot } from "@/lib/admin-operating-snapshot.server";

import { OperatingScreen } from "../operating-screen";

export const dynamic = "force-dynamic";

export default async function AdminRetentionPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireTylerAdmin();
  const canGenerateReport = await isTylerOwnerSession();
  const resolved = searchParams ? await searchParams : {};
  const snapshot = await loadOperatingSnapshot({ searchParams: resolved });
  let cancellationComments: CancellationCommentView = { status: "unavailable" };
  try {
    cancellationComments = await loadCancellationComments();
  } catch {
    cancellationComments = { status: "unavailable" };
  }
  return (
    <OperatingScreen
      focus="retention"
      snapshot={snapshot}
      canGenerateReport={canGenerateReport}
      cancellationComments={cancellationComments}
    />
  );
}
