import { VictoryRoomProofShareSection } from "@/components/VictoryRoomProofShareSection";
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
    <section className="mb-10 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-gray-900">Recent Proof</h2>
      <p className="mt-2 text-sm text-gray-600 leading-relaxed">
        Real moments from your recent check-ins — nothing invented.
      </p>
      {moments.length === 0 ? (
        <p className="mt-6 rounded-lg border border-stone-200 px-5 py-4 text-sm text-gray-700 leading-relaxed">
          Your proof starts now. As you answer text check-ins honestly, moments that show who you are
          becoming will appear here.
        </p>
      ) : (
        <VictoryRoomProofShareSection viewForShare={viewForShare} moments={moments} />
      )}
    </section>
  );
}
