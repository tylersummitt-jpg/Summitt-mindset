import type { SeasonSummaryForDisplay } from "@/lib/v2-victory-season-summary-persist";
import { vrBody, vrInnerPanel, vrLabel } from "@/components/victory-room-visual";

type VictorySeasonSummaryBlockProps = {
  summary: SeasonSummaryForDisplay;
};

export function VictorySeasonSummaryBlock({ summary }: VictorySeasonSummaryBlockProps) {
  if (!summary.summaryText) return null;

  return (
    <section className={`${vrInnerPanel} mb-10`}>
      <h2 className={vrLabel}>Season summary</h2>
      <p className={`${vrBody} mt-3 text-stone-300`}>{summary.summaryText}</p>
      {summary.patternText ? (
        <p className={`${vrBody} mt-3 text-stone-400`}>
          <span className="font-medium text-stone-200">Pattern: </span>
          {summary.patternText}
        </p>
      ) : null}
      {summary.principleLivedTitle ? (
        <p className={`${vrBody} mt-2 text-stone-400`}>
          <span className="font-medium text-stone-200">Principle lived: </span>
          {summary.principleLivedTitle}
        </p>
      ) : null}
    </section>
  );
}
