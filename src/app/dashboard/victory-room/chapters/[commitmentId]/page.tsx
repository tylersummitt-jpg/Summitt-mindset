import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { VictoryEarlierChapterHeader } from "@/components/VictoryEarlierChapterHeader";
import { VictorySeasonEmptyState } from "@/components/VictorySeasonEmptyState";
import { VictorySeasonProofList } from "@/components/VictorySeasonProofList";
import { resolveUserTimezone } from "@/lib/timezone";
import { loadVictoryEarlierChapterProofView } from "@/lib/v2-victory-earlier-chapter-proof-view";

type PageProps = {
  params: Promise<{ commitmentId: string }>;
};

function emptyMessage(hasDerivedProofInWindow: boolean): string {
  if (hasDerivedProofInWindow) {
    return "There were check-ins in this chapter, but not enough saved proof to show here yet.";
  }
  return "Little was captured in text for this chapter — that does not erase the work you did.";
}

export default async function VictoryEarlierChapterDetailPage({ params }: PageProps) {
  const user = await currentUser();
  if (!user?.id) notFound();

  const { commitmentId } = await params;
  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  const timeZone = resolveUserTimezone(md?.timezone);

  const view = await loadVictoryEarlierChapterProofView({
    clerkUserId: user.id,
    commitmentId,
  });

  if (!view) notFound();

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

      <VictoryEarlierChapterHeader
        title={view.title}
        statusLabel={view.statusLabel}
        startedAt={view.startedAt}
        endedAt={view.endedAt}
        behaviorStatement={view.behaviorStatement}
        timeZone={timeZone}
      />

      {!view.hasCuratedProof ? (
        <VictorySeasonEmptyState message={emptyMessage(view.hasDerivedProofInWindow)} />
      ) : (
        <VictorySeasonProofList
          moments={view.proofMoments}
          timeZone={timeZone}
          heading="Proof from this chapter"
        />
      )}
    </main>
  );
}
