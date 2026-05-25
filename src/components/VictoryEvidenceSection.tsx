import type { VictoryEvidenceCounts } from "@/lib/v2-victory-room-view";

type EvidenceTile = {
  label: string;
  count: number;
};

function buildVisibleTiles(counts: VictoryEvidenceCounts): EvidenceTile[] {
  const tiles: EvidenceTile[] = [];
  if (counts.keptTheGoal > 0) {
    tiles.push({ label: "Kept the goal", count: counts.keptTheGoal });
  }
  if (counts.toldTheTruth > 0) {
    tiles.push({ label: "Told the truth", count: counts.toldTheTruth });
  }
  if (counts.gotBackOnTrack > 0) {
    tiles.push({ label: "Got back on track", count: counts.gotBackOnTrack });
  }
  if (counts.adjustedWisely > 0) {
    tiles.push({ label: "Adjusted wisely", count: counts.adjustedWisely });
  }
  if (counts.raisedTheBar > 0) {
    tiles.push({ label: "Raised the bar", count: counts.raisedTheBar });
  }
  if (counts.seasonsCompleted > 0) {
    tiles.push({ label: "Completed a season", count: counts.seasonsCompleted });
  }
  return tiles;
}

type VictoryEvidenceSectionProps = {
  counts: VictoryEvidenceCounts;
};

export function VictoryEvidenceSection({ counts }: VictoryEvidenceSectionProps) {
  const tiles = buildVisibleTiles(counts);

  return (
    <section className="mb-10 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-gray-900">The Evidence</h2>
      <p className="mt-2 text-sm text-gray-600 leading-relaxed">
        Simple counts from your bounded check-in window. This is evidence, not a scoreboard.
      </p>
      {tiles.length === 0 ? (
        <p className="mt-6 rounded-lg border border-stone-200 px-5 py-4 text-sm text-gray-700 leading-relaxed">
          Evidence fills in as you answer real check-ins. There is no scoreboard here — only honest
          proof of who you are becoming.
        </p>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {tiles.map((t) => (
            <li
              key={t.label}
              className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 shadow-sm"
            >
              <p className="text-lg font-semibold tabular-nums text-gray-800">{t.count}</p>
              <p className="mt-1 text-sm font-medium text-gray-700">{t.label}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
