import Link from "next/link";
import { VictoryRoomProofShareSection } from "@/components/VictoryRoomProofShareSection";
import { VictoryRoomSectionShell } from "@/components/VictoryRoomSectionShell";
import { VrIconProof } from "@/components/VictoryRoomIcons";
import { vrAccentLink, vrEmptyState, vrIconCircle } from "@/components/victory-room-visual";
import type { VictoryRoomViewForShare } from "@/lib/v2-victory-share-snippet";

type ProofMomentRow = {
  id: string;
  categoryLabel: string;
  headline: string;
  body: string;
  quote?: string | null;
  meaning?: string | null;
  dateLabel: string;
  groundedInEventTypes: string[];
};

type VictoryRecentProofSectionProps = {
  viewForShare: VictoryRoomViewForShare | null;
  moments: ProofMomentRow[];
};

export function VictoryRecentProofSection({ viewForShare, moments }: VictoryRecentProofSectionProps) {
  return (
    <VictoryRoomSectionShell
      title="Your Wins"
      subtitle="The latest proof saved from your real check-ins."
    >
      {moments.length === 0 ? (
        <div className={vrEmptyState}>
          <div className={`${vrIconCircle} mx-auto mb-4 sm:mx-0`} aria-hidden>
            <VrIconProof />
          </div>
          <p>
            Your wins start here. As you answer text check-ins honestly, proof that you kept showing
            up will appear here.
          </p>
        </div>
      ) : (
        <>
          <VictoryRoomProofShareSection viewForShare={viewForShare} moments={moments} />
          <p className="mt-8">
            <Link href="/dashboard/victory-room/all-proof" className={vrAccentLink}>
              See all proof
            </Link>
          </p>
        </>
      )}
    </VictoryRoomSectionShell>
  );
}
