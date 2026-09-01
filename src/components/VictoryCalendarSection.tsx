import { VictoryCalendarGrid } from "@/components/VictoryCalendarGrid";
import { VictoryRoomSectionShell } from "@/components/VictoryRoomSectionShell";
import { VictoryWinCard } from "@/components/VictoryWinCard";
import { vrBodyMuted } from "@/components/victory-room-visual";
import { formatVictoryCalendarDayHeading } from "@/lib/v2-victory-calendar";
import { formatVictoryRoomDate } from "@/lib/v2-victory-room-view";
import { buildEditWinHref } from "@/lib/v2-win-edit-origin";
import type { PublicWinDto } from "@/lib/v2-win-public-read";

type VictoryCalendarSectionProps = {
  monthKey: string;
  currentMonthKey: string;
  todayKey: string;
  selectedDay: string | null;
  counts: Record<string, number>;
  selectedWins: PublicWinDto[];
  timeZone: string;
};

export function VictoryCalendarSection({
  monthKey,
  currentMonthKey,
  todayKey,
  selectedDay,
  counts,
  selectedWins,
  timeZone,
}: VictoryCalendarSectionProps) {
  const heading = selectedDay ? formatVictoryCalendarDayHeading(selectedDay) : null;
  const winCount = selectedWins.length;
  const winCountLabel =
    winCount === 0 ? "No Wins recorded yet." : winCount === 1 ? "1 Win" : `${winCount} Wins`;

  return (
    <VictoryRoomSectionShell
      title="Victory Calendar"
      subtitle="Your wins, one day at a time."
    >
      <VictoryCalendarGrid
        monthKey={monthKey}
        currentMonthKey={currentMonthKey}
        todayKey={todayKey}
        selectedDay={selectedDay}
        counts={counts}
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
                    media={w.media}
                    hasMedia={Boolean(w.media)}
                    winId={w.id}
                    expectedUpdatedAt={w.updatedAt}
                    editHref={buildEditWinHref(w.id, { kind: "victory-room" })}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </VictoryRoomSectionShell>
  );
}
