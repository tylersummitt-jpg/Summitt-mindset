import { VictoryRoomSectionShell } from "@/components/VictoryRoomSectionShell";
import {
  vrEmptyState,
  vrEvidenceCount,
  vrEvidenceTile,
  vrLabel,
} from "@/components/victory-room-visual";
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
    <VictoryRoomSectionShell
      number={4}
      title="The Evidence"
      subtitle="Simple counts from your bounded check-in window. This is evidence, not a scoreboard."
    >
      {tiles.length === 0 ? (
        <p className={vrEmptyState}>
          Evidence fills in as you answer real check-ins. There is no scoreboard here — only honest
          proof of who you are becoming.
        </p>
      ) : (
        <ul className="mt-8 grid grid-cols-2 gap-3 sm:gap-4">
          {tiles.map((t) => (
            <li key={t.label} className={vrEvidenceTile}>
              <p className={vrEvidenceCount}>{t.count}</p>
              <p className={`${vrLabel} mt-3 normal-case tracking-normal text-stone-300`}>{t.label}</p>
            </li>
          ))}
        </ul>
      )}
    </VictoryRoomSectionShell>
  );
}
