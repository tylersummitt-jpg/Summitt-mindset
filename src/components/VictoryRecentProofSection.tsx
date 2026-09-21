import Link from "next/link";
import { VictoryProudMomentsEditChrome } from "@/components/VictoryProudMomentsEditChrome";
import { VictoryRoomSectionShell } from "@/components/VictoryRoomSectionShell";
import { VrIconProof } from "@/components/VictoryRoomIcons";
import { VictorySummaryCounts } from "@/components/VictorySummaryCounts";
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

export function VictoryRecentProofSection({
  summaryCounts,
  wins,
  timeZone,
}: VictoryRecentProofSectionProps) {
  return (
    <VictoryRoomSectionShell title="Your Victories">
      <VictoryProudMomentsEditChrome
        addHref="/dashboard/victory-room/add-win"
        addLabel="+ Add a Victory"
        header={
          summaryCounts ? <VictorySummaryCounts counts={summaryCounts} /> : undefined
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
            <p className="font-medium text-stone-100">No Victories yet.</p>
            <p className="mt-3">
              When something real in your life is worth remembering, it will show up here.
            </p>
          </div>
        }
        footer={
          <p className="mt-8">
            <Link href="/dashboard/victory-room/all-proof" className={vrAccentLink}>
              View all Victories
            </Link>
          </p>
        }
      />
    </VictoryRoomSectionShell>
  );
}
