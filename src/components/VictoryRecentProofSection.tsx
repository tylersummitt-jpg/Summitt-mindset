import Link from "next/link";
import { VictoryRoomSectionShell } from "@/components/VictoryRoomSectionShell";
import { VictoryWinCard } from "@/components/VictoryWinCard";
import { VrIconProof } from "@/components/VictoryRoomIcons";
import {
  vrAccentLink,
  vrEmptyState,
  vrEvidenceCount,
  vrIconCircle,
} from "@/components/victory-room-visual";
import { formatVictoryRoomDate } from "@/lib/v2-victory-room-view";
import { buildEditWinHref } from "@/lib/v2-win-edit-origin";
import type { PublicWinDto } from "@/lib/v2-win-public-read";

type VictoryRecentProofSectionProps = {
  totalActiveWins: number;
  wins: PublicWinDto[];
  timeZone: string;
};

export function VictoryRecentProofSection({
  totalActiveWins,
  wins,
  timeZone,
}: VictoryRecentProofSectionProps) {
  return (
    <VictoryRoomSectionShell
      title="Your Wins"
      subtitle="Real moments worth remembering — from your life, not a scoreboard."
    >
      <div className="mt-8 flex flex-col items-center text-center sm:items-start sm:text-left">
        <p className={`${vrEvidenceCount} text-amber-50`}>{totalActiveWins}</p>
        <p className="mt-2 text-sm font-semibold uppercase tracking-[0.14em] text-stone-400">
          {totalActiveWins === 1 ? "Win" : "Wins"}
        </p>
        <p className="mt-4">
          <Link href="/dashboard/victory-room/add-win" className={vrAccentLink}>
            Add a Win
          </Link>
        </p>
      </div>

      {wins.length === 0 ? (
        <div className={vrEmptyState}>
          <div className={`${vrIconCircle} mx-auto mb-4 sm:mx-0`} aria-hidden>
            <VrIconProof />
          </div>
          <p className="font-medium text-stone-100">No Wins yet.</p>
          <p className="mt-3">
            When something real in your life is worth remembering, it will show up here.
          </p>
        </div>
      ) : (
        <>
          <ul className="mt-8 space-y-4">
            {wins.map((w) => (
              <li key={w.id}>
                <VictoryWinCard
                  displayTitle={w.displayTitle}
                  displayBody={w.displayBody}
                  dateLabel={formatVictoryRoomDate(w.occurredAt, timeZone)}
                  supportingQuote={w.supportingQuote}
                  celebrationAppropriate={w.celebrationAppropriate}
                  media={w.media}
                  winId={w.id}
                  expectedUpdatedAt={w.updatedAt}
                  editHref={buildEditWinHref(w.id, { kind: "victory-room" })}
                />
              </li>
            ))}
          </ul>
          <p className="mt-8">
            <Link href="/dashboard/victory-room/all-proof" className={vrAccentLink}>
              View all Wins
            </Link>
          </p>
        </>
      )}
    </VictoryRoomSectionShell>
  );
}
