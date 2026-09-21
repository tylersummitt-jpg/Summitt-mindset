import Link from "next/link";
import { VictoryProudMomentsEditChrome } from "@/components/VictoryProudMomentsEditChrome";
import { VictoryRoomSectionShell } from "@/components/VictoryRoomSectionShell";
import { VrIconProof } from "@/components/VictoryRoomIcons";
import {
  vrAccentLink,
  vrEmptyState,
  vrIconCircle,
} from "@/components/victory-room-visual";
import { formatVictoryRoomDate } from "@/lib/v2-victory-room-view";
import { buildEditWinHref } from "@/lib/v2-win-edit-origin";
import type {
  PublicVictorySummaryCounts,
  PublicWinDto,
} from "@/lib/v2-win-public-read";

type VictoryRecentProofSectionProps = {
  summaryCounts: PublicVictorySummaryCounts | null;
  wins: PublicWinDto[];
  timeZone: string;
};

function summaryStatCell(value: number, label: string) {
  return (
    <div className="min-w-0">
      <p className="font-serif text-2xl font-semibold tabular-nums leading-none text-amber-50 sm:text-4xl">
        {value}
      </p>
      <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400 sm:text-xs">
        {label}
      </p>
    </div>
  );
}

export function VictoryRecentProofSection({
  summaryCounts,
  wins,
  timeZone,
}: VictoryRecentProofSectionProps) {
  return (
    <VictoryRoomSectionShell
      title="Proud Moments & Goal Wins"
      subtitle="Build your identity one day at a time."
    >
      <VictoryProudMomentsEditChrome
        addHref="/dashboard/victory-room/add-win"
        addLabel="+ Add a Proud Moment"
        header={
          summaryCounts ? (
            <div className="grid w-full grid-cols-3 gap-2 sm:gap-4">
              {summaryStatCell(summaryCounts.totalActiveWins, "TOTAL VICTORIES")}
              {summaryStatCell(summaryCounts.totalActiveGoalWins, "GOAL WINS")}
              {summaryStatCell(
                summaryCounts.totalActiveProudMoments,
                "PROUD MOMENTS"
              )}
            </div>
          ) : undefined
        }
        groups={
          wins.length
            ? [
                {
                  key: "recent",
                  cards: wins.map((w) => ({
                    displayTitle: w.displayTitle,
                    displayBody: w.displayBody,
                    dateLabel: formatVictoryRoomDate(w.occurredAt, timeZone),
                    supportingQuote: w.supportingQuote,
                    celebrationAppropriate: w.celebrationAppropriate,
                    media: w.media,
                    winId: w.id,
                    expectedUpdatedAt: w.updatedAt,
                    editHref: buildEditWinHref(w.id, { kind: "victory-room" }),
                  })),
                },
              ]
            : []
        }
        emptyState={
          <div className={vrEmptyState}>
            <div className={`${vrIconCircle} mx-auto mb-4 sm:mx-0`} aria-hidden>
              <VrIconProof />
            </div>
            <p className="font-medium text-stone-100">No Proud Moments yet.</p>
            <p className="mt-3">
              When something real in your life is worth remembering, it will show up here.
            </p>
          </div>
        }
        footer={
          <p className="mt-8">
            <Link href="/dashboard/victory-room/all-proof" className={vrAccentLink}>
              View all Proud Moments
            </Link>
          </p>
        }
      />
    </VictoryRoomSectionShell>
  );
}
