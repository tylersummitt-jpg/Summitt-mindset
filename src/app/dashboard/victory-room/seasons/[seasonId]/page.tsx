import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { VictorySeasonEmptyState } from "@/components/VictorySeasonEmptyState";
import { VictorySeasonHeader } from "@/components/VictorySeasonHeader";
import { VictorySeasonProofList } from "@/components/VictorySeasonProofList";
import { VictorySeasonSummaryBlock } from "@/components/VictorySeasonSummaryBlock";
import { VictorySeasonWinsSection } from "@/components/VictorySeasonWinsSection";
import { vrAccentLink, vrPageGlow, vrPageInner, vrPageOuter } from "@/components/victory-room-visual";
import { resolveUserTimezone } from "@/lib/timezone";
import { loadVictorySeasonProofView } from "@/lib/v2-victory-season-proof-view";
import { loadActiveWinsForSeasonCommitment } from "@/lib/v2-victory-season-wins";

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

  // Authoritative Season commitment only (already ownership-checked by proof view).
  const seasonWins = await loadActiveWinsForSeasonCommitment({
    clerkUserId: user.id,
    commitmentId: view.commitmentId,
  });

  const showSummary =
    view.summary?.summaryText &&
    (view.summary.confidence === "medium" || view.summary.confidence === "high");

  return (
    <div className={`victory-room-route-canvas ${vrPageOuter}`}>
      <div className={vrPageGlow} aria-hidden />
      <main className={vrPageInner}>
        <p className="mb-8">
          <Link href="/dashboard/victory-room" className={vrAccentLink}>
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

        <p className="mb-10 -mt-4">
          <Link
            href={`/dashboard/victory-room/add-win?seasonId=${encodeURIComponent(view.seasonId)}`}
            className={vrAccentLink}
          >
            Add a Win
          </Link>
        </p>

        <VictorySeasonWinsSection wins={seasonWins} timeZone={timeZone} />

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
    </div>
  );
}
