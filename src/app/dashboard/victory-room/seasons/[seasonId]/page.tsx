import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { VictorySeasonHeader } from "@/components/VictorySeasonHeader";
import { VictorySeasonWinsSection } from "@/components/VictorySeasonWinsSection";
import { vrAccentLink, vrPageGlow, vrPageInner, vrPageOuter } from "@/components/victory-room-visual";
import { resolveUserTimezone } from "@/lib/timezone";
import { loadVictorySeasonProofView } from "@/lib/v2-victory-season-proof-view";
import { loadActiveWinsForSeasonCommitment } from "@/lib/v2-victory-season-wins";

type PageProps = {
  params: Promise<{ seasonId: string }>;
};

export default async function VictorySeasonDetailPage({ params }: PageProps) {
  const user = await currentUser();
  if (!user?.id) {
    notFound();
  }

  const { seasonId } = await params;
  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  const timeZone = resolveUserTimezone(md?.timezone);

  // Kept for ownership + Season metadata + authoritative commitmentId (slim loader later).
  const view = await loadVictorySeasonProofView({
    clerkUserId: user.id,
    seasonId,
  });

  if (!view) {
    notFound();
  }

  const seasonWins = await loadActiveWinsForSeasonCommitment({
    clerkUserId: user.id,
    commitmentId: view.commitmentId,
  });

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

        <VictorySeasonWinsSection
          wins={seasonWins}
          timeZone={timeZone}
          seasonId={view.seasonId}
        />
      </main>
    </div>
  );
}
