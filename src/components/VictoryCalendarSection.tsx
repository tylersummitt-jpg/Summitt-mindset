import Link from "next/link";
import { VictoryCalendarGrid } from "@/components/VictoryCalendarGrid";
import { VictoryWinCard } from "@/components/VictoryWinCard";
import { vrAccentLink, vrBodyMuted } from "@/components/victory-room-visual";
import { formatVictoryCalendarDayHeading } from "@/lib/v2-victory-calendar";
import { formatVictoryRoomDate } from "@/lib/v2-victory-room-view";
import { buildCalendarAddWinHref } from "@/lib/v2-win-edit-origin";
import type { PublicWinDto, VictoryWinMonthDayMarker } from "@/lib/v2-win-public-read";

type VictoryCalendarSectionProps = {
  monthKey: string;
  currentMonthKey: string;
  todayKey: string;
  selectedDay: string | null;
  markers: Record<string, VictoryWinMonthDayMarker>;
  selectedWins: PublicWinDto[];
  timeZone: string;
};

export function VictoryCalendarSection({
  monthKey,
  currentMonthKey,
  todayKey,
  selectedDay,
  markers,
  selectedWins,
  timeZone,
}: VictoryCalendarSectionProps) {
  const heading = selectedDay ? formatVictoryCalendarDayHeading(selectedDay) : null;
  const winCount = selectedWins.length;
  const winCountLabel =
    winCount === 0
      ? "No Victories recorded yet."
      : winCount === 1
        ? "1 Victory"
        : `${winCount} Victories`;

  return (
    <>
      <VictoryCalendarGrid
        monthKey={monthKey}
        currentMonthKey={currentMonthKey}
        todayKey={todayKey}
        selectedDay={selectedDay}
        markers={markers}
      />

      {selectedDay && heading ? (
        <div className="mt-8 border-t border-amber-500/20 pt-8">
          <h3 className="font-serif text-xl font-semibold tracking-tight text-stone-50 sm:text-2xl">
            {heading}
          </h3>
          <p className={`mt-2 ${vrBodyMuted}`}>{winCountLabel}</p>
          {winCount > 0 ? (
            <ul className="mt-6 space-y-4">
              {selectedWins.map((w) => (
                <li key={w.id}>
                  <VictoryWinCard
                    displayTitle={w.displayTitle}
                    displayBody={w.displayBody}
                    dateLabel={formatVictoryRoomDate(w.occurredAt, timeZone)}
                    supportingQuote={w.supportingQuote}
                    celebrationAppropriate={w.celebrationAppropriate}
                    winKind={w.winKind}
                    media={w.media}
                    showEditingControls={false}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-6">
            <Link
              href={buildCalendarAddWinHref(monthKey, selectedDay)}
              className={vrAccentLink}
            >
              + Add a Victory
            </Link>
          </p>
        </div>
      ) : null}
    </>
  );
}
