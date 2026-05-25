import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { VictoryEvidenceSection } from "@/components/VictoryEvidenceSection";
import { VictoryPatPrinciplesSection } from "@/components/VictoryPatPrinciplesSection";
import { VictoryPatReadSection } from "@/components/VictoryPatReadSection";
import { VictoryRecentProofSection } from "@/components/VictoryRecentProofSection";
import { VictoryEarlierHistoryLinkSection } from "@/components/VictoryEarlierHistoryLinkSection";
import { VictoryRoomFooterNav } from "@/components/VictoryRoomFooterNav";
import { VictoryEvolutionNudgeSection } from "@/components/VictoryEvolutionNudgeSection";
import { VictoryRoomTopCard } from "@/components/VictoryRoomTopCard";
import { VictorySeasonsSection } from "@/components/VictorySeasonsSection";
import { hasEarlierChapterHistory } from "@/lib/v2-victory-earlier-chapter-index";
import { loadPatReadForVictoryRoom } from "@/lib/v2-victory-pat-read-persist";
import { loadPatPrinciplesForVictoryRoom } from "@/lib/v2-victory-principles-persist";
import { loadVictorySeasonListForRoom } from "@/lib/v2-victory-season-list";
import { resolveUserTimezone } from "@/lib/timezone";
import { loadVictoryEvolutionNudge } from "@/lib/v2-victory-evolution-nudge";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { getPendingResolutionOrNull, isSmsInboundPendingResolutionActionable } from "@/lib/v2-guided-resolution";
import {
  formatVictoryRoomDate,
  getRecentProofCategoryLabel,
  loadVictoryRoomView,
} from "@/lib/v2-victory-room-view";
import type { VictoryRoomViewForShare } from "@/lib/v2-victory-share-snippet";

export default async function VictoryRoomPage() {
  const user = await currentUser();
  if (!user?.id) redirect("/sign-in");

  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  const timeZone = resolveUserTimezone(md?.timezone);

  const view = await loadVictoryRoomView(user.id);

  let showUpdateGoalLink = false;
  let showEditIdentityLink = false;
  if (view.hasActiveV2Commitment) {
    const activeCommitment = await getActiveCommitment(user.id);
    const pending = activeCommitment ? getPendingResolutionOrNull(activeCommitment) : null;
    const pendingBlocksEdit =
      Boolean(pending) ||
      Boolean(activeCommitment && isSmsInboundPendingResolutionActionable(activeCommitment));
    const canEditFoundation =
      Boolean(activeCommitment?.id) &&
      !pendingBlocksEdit &&
      activeCommitment?.accountability_phase !== "low_pressure_reactivation";
    showUpdateGoalLink = canEditFoundation;
    showEditIdentityLink = canEditFoundation;
  }

  const displayName =
    view.profile.preferred_name?.trim() ||
    user.firstName?.trim() ||
    "there";

  const patRead = view.hasActiveV2Commitment
    ? await loadPatReadForVictoryRoom({
        clerkUserId: user.id,
        view,
        displayName,
        timezone: timeZone,
      })
    : null;

  const patPrinciples = view.hasActiveV2Commitment
    ? await loadPatPrinciplesForVictoryRoom({
        clerkUserId: user.id,
        view,
        timezone: timeZone,
      })
    : null;

  const seasonList = view.hasActiveV2Commitment
    ? await loadVictorySeasonListForRoom(user.id)
    : null;

  const seasonCommitmentIds: string[] = [];
  if (seasonList?.currentSeason) seasonCommitmentIds.push(seasonList.currentSeason.commitmentId);
  if (seasonList?.pastSeasons) {
    for (const p of seasonList.pastSeasons) seasonCommitmentIds.push(p.commitmentId);
  }

  const hasEarlierHistory =
    view.hasActiveV2Commitment && view.commitment
      ? await hasEarlierChapterHistory({
          clerkUserId: user.id,
          activeCommitmentId: view.commitment.id,
          excludeCommitmentIds: seasonCommitmentIds,
        })
      : false;

  const evolutionNudge = view.hasActiveV2Commitment
    ? await loadVictoryEvolutionNudge({ clerkUserId: user.id })
    : null;

  const viewForShare: VictoryRoomViewForShare | null = view.hasActiveV2Commitment
    ? { ...view, share_identity_line: displayName }
    : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      {!view.hasActiveV2Commitment ? (
        <section className="rounded-xl border border-amber-200 bg-white p-6 text-gray-800 shadow-sm">
          <h2 className="text-lg font-medium text-gray-900">Not quite ready</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">
            Victory Room reads your <strong>active commitment</strong> and the honest back-and-forth in your
            text check-ins. If you do not have an active commitment yet, there is nothing to show — and that is
            okay.
          </p>
          <p className="mt-4 text-sm text-gray-600">
            <Link href="/dashboard/commitment-setup" className="font-medium text-gray-900 underline underline-offset-2">
              Set up your commitment
            </Link>
          </p>
        </section>
      ) : (
        <>
          <header className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Victory Room</h1>
            <p className="mt-3 text-gray-700 leading-relaxed">
              A living trophy room for character — where proof of who you are becoming is saved from your
              real choices.
            </p>
          </header>

          <VictoryEvolutionNudgeSection nudge={evolutionNudge} />

          {view.commitment ? (
            <VictoryRoomTopCard
              profile={view.profile}
              commitment={view.commitment}
              activeSeason={view.activeSeason}
              timeZone={timeZone}
              showUpdateGoalLink={showUpdateGoalLink}
              showEditIdentityLink={showEditIdentityLink}
            />
          ) : null}

          {patRead ? <VictoryPatReadSection read={patRead} /> : null}

          {viewForShare ? (
            <VictoryRecentProofSection
              viewForShare={viewForShare}
              moments={view.moments.map((m) => ({
                id: m.id,
                categoryLabel: getRecentProofCategoryLabel(m),
                headline: m.headline,
                body: m.body,
                dateLabel: formatVictoryRoomDate(m.occurredAt, timeZone),
                groundedInEventTypes: m.groundedInEventTypes,
              }))}
            />
          ) : null}

          <VictoryEvidenceSection counts={view.evidenceCounts} />

          {patPrinciples ? <VictoryPatPrinciplesSection principles={patPrinciples} /> : null}

          {seasonList ? (
            <VictorySeasonsSection
              currentSeason={seasonList.currentSeason}
              pastSeasons={seasonList.pastSeasons}
              timeZone={timeZone}
            />
          ) : null}

          <VictoryEarlierHistoryLinkSection hasEarlierHistory={hasEarlierHistory} />

          <VictoryRoomFooterNav />
        </>
      )}
    </main>
  );
}
