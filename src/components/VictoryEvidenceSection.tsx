import { VictoryRoomSectionShell } from "@/components/VictoryRoomSectionShell";
import {
  getVictoryProofCategoryTone,
  vrEmptyState,
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
          {tiles.map((t) => {
            const tone = getVictoryProofCategoryTone(t.label);
            return (
              <li
                key={t.label}
                className={`${vrEvidenceTile} flex flex-col items-center justify-center rounded-2xl px-4 py-6 text-center sm:py-7 ${tone.evidenceTile}`}
              >
                <p className={`font-serif text-4xl font-semibold tabular-nums leading-none sm:text-5xl ${tone.evidenceCount}`}>
                  {t.count}
                </p>
                <p className={`${vrLabel} mt-3 normal-case tracking-normal ${tone.evidenceLabel}`}>{t.label}</p>
              </li>
            );
          })}
        </ul>
      )}
    </VictoryRoomSectionShell>
  );
}
