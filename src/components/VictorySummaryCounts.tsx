"use client";

import { useEffect, useId, useRef, useState, type ComponentType } from "react";
import {
  VrIconGoal,
  VrIconInfo,
  VrIconStar,
} from "@/components/VictoryRoomIcons";
import { vrAccentLink, vrInnerPanel } from "@/components/victory-room-visual";
import { PROUD_MOMENT_STAT_QUOTE } from "@/lib/v2-victory-room-display";
import type { PublicVictorySummaryCounts } from "@/lib/v2-win-public-read";

type StatId = "total" | "goal" | "proud";

type StatExplanation = {
  id: StatId;
  countKey: keyof PublicVictorySummaryCounts;
  label: string;
  heading: string;
  definition: string;
  quote: string;
  icon?: ComponentType<{ className?: string }>;
  whatLabel: string;
};

const STATS: StatExplanation[] = [
  {
    id: "total",
    countKey: "totalActiveWins",
    label: "TOTAL VICTORIES",
    heading: "Total Victories",
    definition: "Your Total Victories are your Goal Wins + Proud Moments.",
    quote: "We keep score in life because it matters. It counts.",
    whatLabel: "What are Total Victories?",
  },
  {
    id: "goal",
    countKey: "totalActiveGoalWins",
    label: "GOAL WINS",
    heading: "Goal Wins",
    definition:
      "A Goal Win is a time you followed through on your current goal — evidence that you did what you said you would do.",
    quote: "Discipline yourself so nobody else has to.",
    icon: VrIconGoal,
    whatLabel: "What are Goal Wins?",
  },
  {
    id: "proud",
    countKey: "totalActiveProudMoments",
    label: "PROUD MOMENTS",
    heading: "Proud Moments",
    definition:
      "A Proud Moment is a meaningful accomplishment or life moment worth remembering — evidence from your own life you can look back on.",
    quote: PROUD_MOMENT_STAT_QUOTE,
    icon: VrIconStar,
    whatLabel: "What are Proud Moments?",
  },
];

const PANEL_ID = "victory-stat-explanation";

const infoButtonClass =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-amber-300/80 -mt-1 sm:mt-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#060a11]";

type VictorySummaryCountsProps = {
  counts: PublicVictorySummaryCounts;
};

export function VictorySummaryCounts({ counts }: VictorySummaryCountsProps) {
  const [openId, setOpenId] = useState<StatId | null>(null);
  const triggerRefs = useRef<Partial<Record<StatId, HTMLButtonElement | null>>>({});
  const headingPrefix = useId();
  const openStat = STATS.find((stat) => stat.id === openId) ?? null;

  useEffect(() => {
    if (!openId) return;
    const activeId = openId;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenId(null);
      triggerRefs.current[activeId]?.focus();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openId]);

  function closePanel() {
    const id = openId;
    setOpenId(null);
    if (id) triggerRefs.current[id]?.focus();
  }

  return (
    <div className="w-full">
      <div className="grid w-full grid-cols-3 gap-2 sm:gap-4">
        {STATS.map((stat) => {
          const Icon = stat.icon;
          const expanded = openId === stat.id;
          return (
            <div
              key={stat.id}
              className="flex min-w-0 flex-col items-center sm:items-start"
            >
              <p className="font-serif text-2xl font-semibold tabular-nums leading-none text-amber-50 sm:text-4xl">
                {counts[stat.countKey]}
              </p>
              <div className="mt-1 flex w-full min-w-0 flex-col items-center sm:flex-row sm:items-center sm:justify-start">
                <div className="flex min-w-0 max-w-full items-center justify-center sm:justify-start">
                  <p className="min-w-0 text-center text-[10px] font-semibold uppercase leading-tight tracking-[0.12em] text-stone-400 sm:text-left sm:text-xs">
                    {stat.label}
                  </p>
                  {Icon ? (
                    <Icon className="ml-1 h-3.5 w-3.5 shrink-0 text-amber-200" />
                  ) : null}
                </div>
                <button
                  type="button"
                  className={infoButtonClass}
                  aria-label={stat.whatLabel}
                  aria-expanded={expanded}
                  aria-controls={expanded ? PANEL_ID : undefined}
                  ref={(el) => {
                    triggerRefs.current[stat.id] = el;
                  }}
                  onClick={() =>
                    setOpenId((current) => (current === stat.id ? null : stat.id))
                  }
                >
                  <VrIconInfo className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {openStat ? (
        <div
          id={PANEL_ID}
          role="region"
          aria-labelledby={`${headingPrefix}-${openStat.id}`}
          className={`${vrInnerPanel} mt-4 w-full text-left`}
        >
          <h3
            id={`${headingPrefix}-${openStat.id}`}
            className="font-serif text-lg font-semibold text-stone-50"
          >
            {openStat.heading}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-stone-300 sm:text-base">
            {openStat.definition}
          </p>
          <blockquote className="mt-4">
            <p className="text-sm leading-relaxed text-stone-200 sm:text-base">
              “{openStat.quote}”
            </p>
            <footer className="mt-2 text-sm text-stone-400">— Pat Summitt</footer>
          </blockquote>
          <button
            type="button"
            className={`${vrAccentLink} mt-4 inline-flex min-h-11 items-center`}
            onClick={closePanel}
          >
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}
