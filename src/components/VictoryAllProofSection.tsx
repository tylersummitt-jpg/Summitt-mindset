import Link from "next/link";
import { VictoryProudMomentsEditChrome } from "@/components/VictoryProudMomentsEditChrome";
import { VictoryRoomSectionShell } from "@/components/VictoryRoomSectionShell";
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
        title="All Proud Moments"
        subtitle="Your archive of real moments — newest first."
      >
        <VictoryProudMomentsEditChrome
          addHref="/dashboard/victory-room/add-win?from=all-wins"
          addLabel="Add a Proud Moment"
          groups={monthGroups.map((group) => ({
            key: group.monthLabel,
            heading: group.monthLabel,
            headingId: `wins-month-${group.monthLabel}`,
            cards: group.wins.map((w) => ({
              displayTitle: w.displayTitle,
              displayBody: w.displayBody,
              dateLabel: formatVictoryRoomDate(w.occurredAt, timeZone),
              supportingQuote: w.supportingQuote,
              celebrationAppropriate: w.celebrationAppropriate,
              media: w.media,
              winId: w.id,
              expectedUpdatedAt: w.updatedAt,
              editHref: buildEditWinHref(w.id, { kind: "all-wins" }),
            })),
          }))}
          emptyState={
            <p className={vrEmptyState}>
              No Proud Moments yet. When something real in your life is worth remembering, it will show up
              here.
            </p>
          }
          footer={
            olderHref ? (
              <p>
                <Link href={olderHref} className={vrAccentLink}>
                  View older Proud Moments
                </Link>
              </p>
            ) : null
          }
        />
      </VictoryRoomSectionShell>
    </>
  );
}
