import Link from "next/link";
import { VictoryRoomSectionShell } from "@/components/VictoryRoomSectionShell";
import { vrAccentLink } from "@/components/victory-room-visual";

type VictoryEarlierHistoryLinkSectionProps = {
  hasEarlierHistory: boolean;
};

export function VictoryEarlierHistoryLinkSection({
  hasEarlierHistory,
}: VictoryEarlierHistoryLinkSectionProps) {
  if (!hasEarlierHistory) return null;

  return (
    <VictoryRoomSectionShell
      number={7}
      title="Earlier Chapters"
      subtitle="Proof from past commitments that is not shown in My Seasons. Open it when you want to look back."
    >
      <Link href="/dashboard/victory-room/history" className={`${vrAccentLink} mt-6 inline-block`}>
        View earlier chapters
      </Link>
    </VictoryRoomSectionShell>
  );
}
