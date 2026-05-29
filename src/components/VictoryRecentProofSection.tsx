import { VictoryRoomProofShareSection } from "@/components/VictoryRoomProofShareSection";
import { VictoryRoomSectionShell } from "@/components/VictoryRoomSectionShell";
import { VrIconProof } from "@/components/VictoryRoomIcons";
import { vrEmptyState, vrIconCircle } from "@/components/victory-room-visual";
import type { VictoryRoomViewForShare } from "@/lib/v2-victory-share-snippet";

type ProofMomentRow = {
  id: string;
  categoryLabel: string;
  headline: string;
  body: string;
  dateLabel: string;
  groundedInEventTypes: string[];
};

type VictoryRecentProofSectionProps = {
  viewForShare: VictoryRoomViewForShare;
  moments: ProofMomentRow[];
};

export function VictoryRecentProofSection({ viewForShare, moments }: VictoryRecentProofSectionProps) {
  return (
    <VictoryRoomSectionShell
      number={3}
      title="Recent Proof"
      subtitle="Real moments from your recent check-ins — nothing invented."
    >
      {moments.length === 0 ? (
        <div className={vrEmptyState}>
          <div className={`${vrIconCircle} mx-auto mb-4 sm:mx-0`} aria-hidden>
            <VrIconProof />
          </div>
          <p>
            Your proof starts now. As you answer text check-ins honestly, moments that show who you are
            becoming will appear here.
          </p>
        </div>
      ) : (
        <VictoryRoomProofShareSection viewForShare={viewForShare} moments={moments} />
      )}
    </VictoryRoomSectionShell>
  );
}
