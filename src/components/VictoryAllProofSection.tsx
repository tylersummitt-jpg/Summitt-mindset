import Link from "next/link";
import { VictoryRoomSectionShell } from "@/components/VictoryRoomSectionShell";
import { VictoryWinCard } from "@/components/VictoryWinCard";
import { vrAccentLink, vrEmptyState } from "@/components/victory-room-visual";
import { formatVictoryRoomDate, formatVictoryRoomMonthYear } from "@/lib/v2-victory-room-view";
import { buildEditWinHref } from "@/lib/v2-win-edit-origin";
import type { PublicWinDto } from "@/lib/v2-win-public-read";

type VictoryAllProofSectionProps = {
  wins: PublicWinDto[];
  timeZone: string;
  hasMore: boolean;
  nextCursor: string | null;
};

function groupWinsByMonth(wins: PublicWinDto[], timeZone: string) {
  const order: string[] = [];
  const buckets = new Map<string, PublicWinDto[]>();
  for (const w of wins) {
    const monthLabel = formatVictoryRoomMonthYear(w.occurredAt, timeZone) || "Unknown";
    if (!buckets.has(monthLabel)) {
      buckets.set(monthLabel, []);
      order.push(monthLabel);
    }
    buckets.get(monthLabel)!.push(w);
  }
  return order.map((monthLabel) => ({ monthLabel, wins: buckets.get(monthLabel)! }));
}

export function VictoryAllProofSection({
  wins,
  timeZone,
  hasMore,
  nextCursor,
}: VictoryAllProofSectionProps) {
  const monthGroups = groupWinsByMonth(wins, timeZone);
  const olderHref =
    hasMore && nextCursor
      ? `/dashboard/victory-room/all-proof?cursor=${encodeURIComponent(nextCursor)}`
      : null;

  return (
    <>
      <p className="mb-8">
        <Link href="/dashboard/victory-room" className={vrAccentLink}>
          ← Victory Room
        </Link>
      </p>

      <VictoryRoomSectionShell
        title="All Wins"
        subtitle="Your archive of real moments — newest first."
      >
        <p className="mt-4">
          <Link href="/dashboard/victory-room/add-win?from=all-wins" className={vrAccentLink}>
            Add a Win
          </Link>
        </p>
        {wins.length === 0 ? (
          <p className={vrEmptyState}>
            No Wins yet. When something real in your life is worth remembering, it will show up
            here.
          </p>
        ) : (
          <div className="mt-8 space-y-10">
            {monthGroups.map((group) => (
              <section key={group.monthLabel} aria-labelledby={`wins-month-${group.monthLabel}`}>
                <h2
                  id={`wins-month-${group.monthLabel}`}
                  className="text-sm font-semibold uppercase tracking-[0.14em] text-stone-400"
                >
                  {group.monthLabel}
                </h2>
                <ul className="mt-4 space-y-4">
                  {group.wins.map((w) => (
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
                        editHref={buildEditWinHref(w.id, { kind: "all-wins" })}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {olderHref ? (
              <p>
                <Link href={olderHref} className={vrAccentLink}>
                  View older Wins
                </Link>
              </p>
            ) : null}
          </div>
        )}
      </VictoryRoomSectionShell>
    </>
  );
}
