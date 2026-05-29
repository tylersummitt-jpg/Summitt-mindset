import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { VictoryEvidenceSection } from "@/components/VictoryEvidenceSection";
import { VictoryPatPrinciplesSection } from "@/components/VictoryPatPrinciplesSection";
import { VictoryPatReadSection } from "@/components/VictoryPatReadSection";
import { VictoryRecentProofSection } from "@/components/VictoryRecentProofSection";
import { VictoryEarlierHistoryLinkSection } from "@/components/VictoryEarlierHistoryLinkSection";
import { VictoryRoomFooterNav } from "@/components/VictoryRoomFooterNav";
import { VictoryRoomTopCard } from "@/components/VictoryRoomTopCard";
import { VictorySeasonsSection } from "@/components/VictorySeasonsSection";
import {
  vrAccentLink,
  vrHeroAccentLine,
  vrHeroArtSlot,
  vrHeroEyebrow,
  vrHeroFrame,
  vrHeroFrameGlow,
  vrPageGlow,
  vrPageInner,
  vrPageOuter,
  vrSectionCard,
  vrHeroSubtitle,
  vrHeroTitle,
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
    <div className={vrPageOuter}>
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
            <header className={`${vrHeroFrame} mb-12 sm:mb-14`}>
              <div className={vrHeroFrameGlow} aria-hidden />
              <div className={vrHeroArtSlot} aria-hidden />
              <div className="relative">
                <p className={vrHeroEyebrow}>Summitt Mindset</p>
                <h1 className={`${vrHeroTitle} mt-4`}>Victory Room</h1>
                <p className={vrHeroSubtitle}>
                  A living trophy room for character — where proof of who you are becoming is saved from your
                  real choices.
                </p>
                <div className={vrHeroAccentLine} aria-hidden />
              </div>
            </header>

            {evolutionNudge ? (
              <section className="mb-10 rounded-2xl border border-amber-500/30 bg-gradient-to-br from-[#101622]/95 to-[#0a0e16]/90 p-6 shadow-[0_0_40px_-12px_rgba(251,191,36,0.22)] sm:p-7">
                <h2 className="text-base font-semibold text-amber-100 sm:text-lg">{evolutionNudge.headline}</h2>
                <p className="mt-3 text-base leading-relaxed text-stone-400">{evolutionNudge.body}</p>
                <Link href={evolutionNudge.href} className={`${vrAccentLink} mt-4 inline-block`}>
                  Review recommendation
                </Link>
              </section>
            ) : null}

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
    </div>
  );
}
