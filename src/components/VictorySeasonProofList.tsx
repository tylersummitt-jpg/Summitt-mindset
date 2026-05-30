import { VictoryMomentCard } from "@/components/VictoryMomentCard";
import { VictoryRoomSectionShell } from "@/components/VictoryRoomSectionShell";
import { formatVictoryRoomDate } from "@/lib/v2-victory-room-view";
import type { SeasonProofMomentDisplay } from "@/lib/v2-victory-season-proof-view";

type VictorySeasonProofListProps = {
  moments: SeasonProofMomentDisplay[];
  timeZone: string;
  heading?: string;
  intro?: string;
};

export function VictorySeasonProofList({
  moments,
  timeZone,
  heading = "Proof from this season",
  intro = "Moments saved from your real check-ins — nothing invented.",
}: VictorySeasonProofListProps) {
  if (moments.length === 0) return null;

  return (
    <VictoryRoomSectionShell title={heading} subtitle={intro}>
      <ul className="mt-8 space-y-4">
        {moments.map((m) => (
          <li key={m.id}>
            <VictoryMomentCard
              categoryLabel={m.categoryLabel}
              headline={m.headline}
              body={m.meaning ?? m.body}
              quote={m.quote ?? null}
              meaning={m.meaning ?? m.body}
              dateLabel={formatVictoryRoomDate(m.occurredAt, timeZone)}
              groundedInEventTypes={m.groundedInEventTypes ?? []}
            />
          </li>
        ))}
      </ul>
    </VictoryRoomSectionShell>
  );
}
