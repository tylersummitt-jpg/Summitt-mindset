import type { SeasonSummaryForDisplay } from "@/lib/v2-victory-season-summary-persist";

type VictorySeasonSummaryBlockProps = {
  summary: SeasonSummaryForDisplay;
};

export function VictorySeasonSummaryBlock({ summary }: VictorySeasonSummaryBlockProps) {
  if (!summary.summaryText) return null;

  return (
    <section className="mb-8 rounded-xl border border-stone-200 bg-stone-50/60 p-5">
      <h2 className="text-sm font-semibold text-gray-900">Season summary</h2>
      <p className="mt-3 text-sm leading-relaxed text-gray-800">{summary.summaryText}</p>
      {summary.patternText ? (
        <p className="mt-3 text-sm leading-relaxed text-gray-700">
          <span className="font-medium text-gray-900">Pattern: </span>
          {summary.patternText}
        </p>
      ) : null}
      {summary.principleLivedTitle ? (
        <p className="mt-2 text-sm text-gray-700">
          <span className="font-medium text-gray-900">Principle lived: </span>
          {summary.principleLivedTitle}
        </p>
      ) : null}
    </section>
  );
}
