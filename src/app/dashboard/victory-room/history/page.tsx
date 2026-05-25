import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { VictoryEarlierHistoryIndexSection } from "@/components/VictoryEarlierHistoryIndexSection";
import { loadVictorySeasonListForRoom } from "@/lib/v2-victory-season-list";
import { loadVictoryEarlierChapterIndex } from "@/lib/v2-victory-earlier-chapter-index";
import { loadVictoryRoomView } from "@/lib/v2-victory-room-view";

function seasonCommitmentIds(
  seasonList: Awaited<ReturnType<typeof loadVictorySeasonListForRoom>> | null
): string[] {
  if (!seasonList) return [];
  const ids: string[] = [];
  if (seasonList.currentSeason) ids.push(seasonList.currentSeason.commitmentId);
  for (const p of seasonList.pastSeasons) ids.push(p.commitmentId);
  return ids;
}

export default async function VictoryEarlierHistoryPage() {
  const user = await currentUser();
  if (!user?.id) redirect("/sign-in");

  const view = await loadVictoryRoomView(user.id);
  if (!view.hasActiveV2Commitment || !view.commitment) {
    redirect("/dashboard/victory-room");
  }

  const seasonList = await loadVictorySeasonListForRoom(user.id);
  const excludeIds = seasonCommitmentIds(seasonList);

  const index = await loadVictoryEarlierChapterIndex({
    clerkUserId: user.id,
    activeCommitmentId: view.commitment.id,
    excludeCommitmentIds: excludeIds,
  });

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

      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Earlier proof history</h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          Past commitments that are not on your current My Seasons list. Proof loads only when you open a
          chapter.
        </p>
      </header>

      <VictoryEarlierHistoryIndexSection chapters={index.chapters} />
    </main>
  );
}
