import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { VictorySeasonEmptyState } from "@/components/VictorySeasonEmptyState";
import { VictorySeasonHeader } from "@/components/VictorySeasonHeader";
import { VictorySeasonProofList } from "@/components/VictorySeasonProofList";
import { VictorySeasonSummaryBlock } from "@/components/VictorySeasonSummaryBlock";
import { resolveUserTimezone } from "@/lib/timezone";
import { loadVictorySeasonProofView } from "@/lib/v2-victory-season-proof-view";

type PageProps = {
  params: Promise<{ seasonId: string }>;
};

function emptyMessage(status: string, hasProof: boolean): string {
  if (status === "active" && !hasProof) {
    return "This season is still building.";
  }
  if ((status === "completed" || status === "archived") && !hasProof) {
    return "Little was captured in text for this season — that does not erase the work you did.";
  }
  if ((status === "completed" || status === "archived") && hasProof) {
    return "Coach Pat will summarize this season once there is enough proof.";
  }
  return "This season is still building.";
}

export default async function VictorySeasonDetailPage({ params }: PageProps) {
  const user = await currentUser();
  if (!user?.id) {
    notFound();
  }

  const { seasonId } = await params;
  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  const timeZone = resolveUserTimezone(md?.timezone);

  const view = await loadVictorySeasonProofView({
    clerkUserId: user.id,
    seasonId,
  });

  if (!view) {
    notFound();
  }

  const showSummary =
    view.summary?.summaryText &&
    (view.summary.confidence === "medium" || view.summary.confidence === "high");

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="mb-6 text-sm text-gray-500">
        <Link
          href="/dashboard/victory-room"
          className="font-medium text-gray-900 underline underline-offset-2"
        >
          ← Victory Room
        </Link>
      </p>

      <VictorySeasonHeader
        seasonName={view.seasonName}
        status={view.status}
        startedAt={view.startedAt}
        endedAt={view.endedAt}
        goalSnapshot={view.goalSnapshot}
        timeZone={timeZone}
      />

      {showSummary && view.summary ? <VictorySeasonSummaryBlock summary={view.summary} /> : null}

      {!view.hasProof ? (
        <VictorySeasonEmptyState message={emptyMessage(view.status, false)} />
      ) : (
        <>
          {view.proofMoments.length === 0 ? (
            <VictorySeasonEmptyState message={emptyMessage(view.status, true)} />
          ) : (
            <VictorySeasonProofList moments={view.proofMoments} timeZone={timeZone} />
          )}
        </>
      )}
    </main>
  );
}
