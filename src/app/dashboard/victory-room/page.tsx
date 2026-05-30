import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { VictoryEvidenceSection } from "@/components/VictoryEvidenceSection";
import { VictoryPatPrinciplesSection } from "@/components/VictoryPatPrinciplesSection";
import { VictoryPatReadSection } from "@/components/VictoryPatReadSection";
import { VictoryRecentProofSection } from "@/components/VictoryRecentProofSection";
import { VictoryEarlierHistoryLinkSection } from "@/components/VictoryEarlierHistoryLinkSection";
import { VictoryRoomTopCard } from "@/components/VictoryRoomTopCard";
import { VictorySeasonsSection } from "@/components/VictorySeasonsSection";
import {
  vrAccentLink,
  vrEvolutionNudge,
  vrPageGlow,
  vrPageInner,
  vrPageOuter,
  vrSectionCard,
} from "@/components/victory-room-visual";
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
    <div className={`victory-room-route-canvas ${vrPageOuter}`}>
      <div className={vrPageGlow} aria-hidden />
      <main className={vrPageInner}>
        {!view.hasActiveV2Commitment ? (
          <section className={`${vrSectionCard} border-amber-500/30`}>
            <h2 className="font-serif text-xl font-semibold text-stone-50">Not quite ready</h2>
            <p className="mt-3 text-sm leading-relaxed text-stone-300">
              Victory Room reads your <strong className="font-semibold text-stone-100">active commitment</strong>{" "}
              and the honest back-and-forth in your text check-ins. If you do not have an active commitment yet,
              there is nothing to show — and that is okay.
            </p>
            <p className="mt-5">
              <Link href="/dashboard/commitment-setup" className={vrAccentLink}>
                Set up your commitment
              </Link>
            </p>
          </section>
        ) : (
          <>
            {evolutionNudge ? (
              <section className={vrEvolutionNudge}>
                <h2 className="text-base font-semibold text-amber-100 sm:text-lg">{evolutionNudge.headline}</h2>
                <p className="mt-3 text-base leading-relaxed text-stone-300">{evolutionNudge.body}</p>
                <Link href={evolutionNudge.href} className={`${vrAccentLink} mt-4 inline-block`}>
                  Review recommendation
                </Link>
              </section>
            ) : null}

            {view.commitment ? (
              <VictoryRoomTopCard
                profile={view.profile}
                commitment={view.commitment}
                showUpdateGoalLink={showUpdateGoalLink}
                showEditIdentityLink={showEditIdentityLink}
              />
            ) : null}

            <VictoryEvidenceSection counts={view.evidenceCounts} />

            {viewForShare ? (
              <VictoryRecentProofSection
                viewForShare={viewForShare}
                moments={view.moments.map((m) => ({
                  id: m.id,
                  categoryLabel: getRecentProofCategoryLabel(m),
                  headline: m.headline,
                  body: m.body,
                  quote: m.quote,
                  meaning: m.meaning,
                  dateLabel: formatVictoryRoomDate(m.occurredAt, timeZone),
                  groundedInEventTypes: m.groundedInEventTypes,
                }))}
              />
            ) : null}

            {patRead ? <VictoryPatReadSection read={patRead} /> : null}

            {patPrinciples ? <VictoryPatPrinciplesSection principles={patPrinciples} /> : null}

            {seasonList ? (
              <VictorySeasonsSection
                currentSeason={seasonList.currentSeason}
                pastSeasons={seasonList.pastSeasons}
                timeZone={timeZone}
              />
            ) : null}

            <VictoryEarlierHistoryLinkSection hasEarlierHistory={hasEarlierHistory} />
          </>
        )}
      </main>
    </div>
  );
}
