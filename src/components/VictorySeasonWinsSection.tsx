import { VictoryRoomSectionShell } from "@/components/VictoryRoomSectionShell";
import { VictoryWinCard } from "@/components/VictoryWinCard";
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
 * Season-detail Wins list. Omit when empty (no zero-state shell).
 */
export function VictorySeasonWinsSection({
  wins,
  timeZone,
  seasonId,
}: VictorySeasonWinsSectionProps) {
  if (wins.length === 0) return null;

  return (
    <div className="mb-10">
      <VictoryRoomSectionShell title="Wins from this season">
        <ul className="mt-8 space-y-4">
          {wins.map((w) => (
            <li key={w.id}>
              <VictoryWinCard
                displayTitle={w.displayTitle}
                displayBody={w.displayBody}
                dateLabel={formatVictoryRoomDate(w.occurredAt, timeZone)}
                supportingQuote={w.supportingQuote}
                celebrationAppropriate={w.celebrationAppropriate}
                media={w.media}
                hasMedia={Boolean(w.media)}
                winId={w.id}
                expectedUpdatedAt={w.updatedAt}
                editHref={buildEditWinHref(w.id, { kind: "season", seasonId })}
              />
            </li>
          ))}
        </ul>
      </VictoryRoomSectionShell>
    </div>
  );
}
