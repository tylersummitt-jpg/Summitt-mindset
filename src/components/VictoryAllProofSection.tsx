import Link from "next/link";
import { VictoryRoomProofShareSection } from "@/components/VictoryRoomProofShareSection";
import { VictoryRoomSectionShell } from "@/components/VictoryRoomSectionShell";
import { VrIconProof } from "@/components/VictoryRoomIcons";
import { vrAccentLink, vrEmptyState, vrIconCircle } from "@/components/victory-room-visual";
import {
  formatVictoryRoomDate,
  getRecentProofCategoryLabel,
  groupProofMomentsByMonth,
  type VictoryMoment,
} from "@/lib/v2-victory-room-view";
import { mapVictoryMomentToProofCardRow } from "@/lib/v2-victory-room-display";
import type { VictoryRoomViewForShare } from "@/lib/v2-victory-share-snippet";

type VictoryAllProofSectionProps = {
  moments: VictoryMoment[];
  timeZone: string;
  truncated: boolean;
  viewForShare: VictoryRoomViewForShare | null;
};

export function VictoryAllProofSection({
  moments,
  timeZone,
  truncated,
  viewForShare,
}: VictoryAllProofSectionProps) {
  const monthGroups = groupProofMomentsByMonth(moments, timeZone);

  return (
    <>
      <p className="mb-8">
        <Link href="/dashboard/victory-room" className={vrAccentLink}>
          ← Victory Room
        </Link>
      </p>

      <VictoryRoomSectionShell
        title="All Proof"
        subtitle="Every saved proof moment from your check-ins, newest first."
      >
        {moments.length === 0 ? (
          <p className={vrEmptyState}>
            No proof saved yet. Your text check-ins are where honest proof begins.
          </p>
        ) : (
          <div className="mt-8 space-y-10">
            {monthGroups.map((group) => (
              <section key={group.monthLabel} aria-labelledby={`proof-month-${group.monthLabel}`}>
                <h2
                  id={`proof-month-${group.monthLabel}`}
                  className="text-sm font-semibold uppercase tracking-[0.14em] text-stone-400"
                >
                  {group.monthLabel}
                </h2>
                <VictoryRoomProofShareSection
                  viewForShare={viewForShare}
                  moments={group.moments.map((m) =>
                    mapVictoryMomentToProofCardRow({
                      moment: m,
                      surface: "allProof",
                      dateLabel: formatVictoryRoomDate(m.occurredAt, timeZone),
                      categoryLabel: getRecentProofCategoryLabel(m),
                    })
                  )}
                />
              </section>
            ))}
            {truncated ? (
              <p className="text-sm leading-relaxed text-stone-500">
                Showing your most recent saved proof. Older moments may live in season and chapter
                pages.
              </p>
            ) : null}
          </div>
        )}
      </VictoryRoomSectionShell>
    </>
  );
}
