"use client";

import { useRouter } from "next/navigation";
import { VrIconArrow } from "@/components/VictoryRoomIcons";
import {
  vrAccentLink,
  vrCalendarCellFuture,
  vrCalendarCellInteractive,
  vrCalendarCellSelected,
  vrCalendarCellToday,
  vrCalendarCellWin,
  vrCalendarNavBtn,
  vrCalendarWeekday,
} from "@/components/victory-room-visual";
import {
  VICTORY_CALENDAR_PATH,
  VICTORY_CALENDAR_WEEKDAY_LABELS,
  buildVictoryCalendarGrid,
  buildVictoryCalendarHref,
  formatVictoryCalendarMonthLabel,
  nextVictoryCalendarMonth,
  previousVictoryCalendarMonth,
  victoryCalendarDayAccessibleName,
} from "@/lib/v2-victory-calendar";

type VictoryCalendarGridProps = {
  monthKey: string;
  currentMonthKey: string;
  todayKey: string;
  selectedDay: string | null;
  counts: Record<string, number>;
};

export function VictoryCalendarGrid({
  monthKey,
  currentMonthKey,
  todayKey,
  selectedDay,
  counts,
}: VictoryCalendarGridProps) {
  const router = useRouter();
  const slots = buildVictoryCalendarGrid(monthKey);
  const monthLabel = formatVictoryCalendarMonthLabel(monthKey);
  const prevMonth = previousVictoryCalendarMonth(monthKey);
  const nextMonth = nextVictoryCalendarMonth(monthKey);
  const atCurrentMonth = monthKey >= currentMonthKey;
  const showBackToThisMonth = monthKey !== currentMonthKey;

  function go(href: string) {
    router.replace(href, { scroll: false });
  }

  if (!slots || !monthLabel) return null;

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className={vrCalendarNavBtn}
          aria-label="Previous month"
          disabled={!prevMonth}
          onClick={() => {
            if (!prevMonth) return;
            go(buildVictoryCalendarHref({ monthKey: prevMonth, currentMonthKey }));
          }}
        >
          <VrIconArrow className="h-5 w-5 rotate-180" />
        </button>
        <p className="min-w-0 flex-1 text-center font-serif text-lg font-semibold tracking-[0.14em] text-stone-50 sm:text-xl">
          {monthLabel.toUpperCase()}
        </p>
        <button
          type="button"
          className={vrCalendarNavBtn}
          aria-label="Next month"
          disabled={atCurrentMonth || !nextMonth}
          onClick={() => {
            if (atCurrentMonth || !nextMonth) return;
            go(buildVictoryCalendarHref({ monthKey: nextMonth, currentMonthKey }));
          }}
        >
          <VrIconArrow className="h-5 w-5" />
        </button>
      </div>

      {showBackToThisMonth ? (
        <p className="mt-3 text-center">
          <button
            type="button"
            className={`${vrAccentLink} text-sm`}
            onClick={() => go(VICTORY_CALENDAR_PATH)}
          >
            Back to This Month
          </button>
        </p>
      ) : null}

      <div
        className="mt-6 grid grid-cols-7 gap-x-0.5 gap-y-1"
        role="group"
        aria-label={monthLabel}
      >
        {VICTORY_CALENDAR_WEEKDAY_LABELS.map((label, i) => (
          <div key={`wd-${i}`} className={vrCalendarWeekday} aria-hidden>
            {label}
          </div>
        ))}
        {slots.map((slot, i) => {
          if (slot.kind === "blank") {
            return <div key={`b-${i}`} className="min-h-11" aria-hidden />;
          }

          const winCount = counts[slot.dateKey] ?? 0;
          const isToday = slot.dateKey === todayKey;
          const isFuture = slot.dateKey > todayKey;
          const isSelected = selectedDay === slot.dateKey;
          const name = victoryCalendarDayAccessibleName({
            dateKey: slot.dateKey,
            winCount,
            isToday,
          });

          if (isFuture) {
            return (
              <div key={slot.dateKey} className={vrCalendarCellFuture}>
                {slot.dayOfMonth}
              </div>
            );
          }

          const winChrome = winCount > 0 ? vrCalendarCellWin : "";
          const todayChrome = isToday ? vrCalendarCellToday : "";
          const selectedChrome = isSelected ? vrCalendarCellSelected : "";

          return (
            <button
              key={slot.dateKey}
              type="button"
              className={`${vrCalendarCellInteractive} ${winChrome} ${todayChrome} ${selectedChrome}`.trim()}
              aria-label={name ?? undefined}
              aria-pressed={isSelected}
              onClick={() =>
                go(
                  buildVictoryCalendarHref({
                    monthKey,
                    currentMonthKey,
                    dayKey: slot.dateKey,
                  })
                )
              }
            >
              <span>{slot.dayOfMonth}</span>
              {winCount > 0 ? (
                <span className="flex items-center gap-0.5 text-[11px] leading-none text-amber-300" aria-hidden>
                  <span>🏆</span>
                  {winCount > 1 ? (
                    <span className="tabular-nums text-amber-200/90">{winCount}</span>
                  ) : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
