import { VictoryProudMomentsEditChrome } from "@/components/VictoryProudMomentsEditChrome";
import { formatVictoryRoomDate } from "@/lib/v2-victory-room-view";
import { buildEditWinHref } from "@/lib/v2-win-edit-origin";
import type { PublicWinDto } from "@/lib/v2-win-public-read";

type VictorySeasonWinsSectionProps = {
  wins: PublicWinDto[];
  timeZone: string;
  /** Owned Season id for Edit origin return. */
  seasonId: string;
};

/**
 * Season-detail Wins list with Add + global Edit Mode chrome.
 * Empty seasons still show Add; the Wins section shell is omitted.
 */
export function VictorySeasonWinsSection({
  wins,
  timeZone,
  seasonId,
}: VictorySeasonWinsSectionProps) {
  return (
    <VictoryProudMomentsEditChrome
      className="-mt-4 mb-10"
      addHref={`/dashboard/victory-room/add-win?seasonId=${encodeURIComponent(seasonId)}`}
      addLabel="Add a Victory"
      sectionTitle={wins.length > 0 ? "Victories from this season" : undefined}
      groups={
        wins.length
          ? [
              {
                key: "season",
                cards: wins.map((w) => ({
                  displayTitle: w.displayTitle,
                  displayBody: w.displayBody,
                  dateLabel: formatVictoryRoomDate(w.occurredAt, timeZone),
                  supportingQuote: w.supportingQuote,
                  celebrationAppropriate: w.celebrationAppropriate,
                  winKind: w.winKind,
                  media: w.media,
                  winId: w.id,
                  expectedUpdatedAt: w.updatedAt,
                  editHref: buildEditWinHref(w.id, { kind: "season", seasonId }),
                })),
              },
            ]
          : []
      }
    />
  );
}
