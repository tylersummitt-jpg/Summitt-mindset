import { VictoryPrincipleCard } from "@/components/VictoryPrincipleCard";
import { VictoryRoomSectionShell } from "@/components/VictoryRoomSectionShell";
import { vrBody, vrBodyMuted } from "@/components/victory-room-visual";
import type { VictoryPatPrinciplesForDisplay } from "@/lib/v2-victory-principles-map";

type VictoryPatPrinciplesSectionProps = {
  principles: VictoryPatPrinciplesForDisplay;
};

export function VictoryPatPrinciplesSection({ principles }: VictoryPatPrinciplesSectionProps) {
  const onlyFocusNext = !principles.livingWell;

  return (
    <VictoryRoomSectionShell
      title="Pat Principles I'm Living"
      subtitle="Coach Pat connects your proof to the standards she taught: the Definite Dozen."
    >
      {principles.starterText ? (
        <p className={`${vrBody} mt-8 text-lg text-stone-200 sm:text-xl`}>{principles.starterText}</p>
      ) : null}

      <div
        className={`mt-8 grid gap-5 ${onlyFocusNext ? "grid-cols-1" : "sm:grid-cols-2"}`}
      >
        {principles.livingWell ? (
          <VictoryPrincipleCard label="Living well" card={principles.livingWell} variant="highlight" />
        ) : null}
        <VictoryPrincipleCard
          label="Focus next"
          card={principles.focusNext}
          fullWidth={onlyFocusNext}
        />
      </div>

      {principles.updatedFromProof ? (
        <p className={`${vrBodyMuted} mt-5 text-sm text-amber-200/70`}>
          Updated from your recent proof
        </p>
      ) : null}
    </VictoryRoomSectionShell>
  );
}
