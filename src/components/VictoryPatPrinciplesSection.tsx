import { VictoryPrincipleCard } from "@/components/VictoryPrincipleCard";
import type { VictoryPatPrinciplesForDisplay } from "@/lib/v2-victory-principles-map";

type VictoryPatPrinciplesSectionProps = {
  principles: VictoryPatPrinciplesForDisplay;
};

export function VictoryPatPrinciplesSection({ principles }: VictoryPatPrinciplesSectionProps) {
  return (
    <section className="mb-10 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">Pat Principles I&apos;m Living</h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">
        Coach Pat connects your proof to the standards she taught: the Definite Dozen.
      </p>

      {principles.starterText ? (
        <p className="mt-4 text-sm leading-relaxed text-gray-800">{principles.starterText}</p>
      ) : null}

      <div className="mt-5 space-y-4">
        {principles.livingWell ? (
          <VictoryPrincipleCard label="Principle you&apos;re living well" card={principles.livingWell} />
        ) : null}
        <VictoryPrincipleCard label="Principle to focus on next" card={principles.focusNext} />
      </div>

      {principles.updatedFromProof ? (
        <p className="mt-4 text-xs text-gray-500">Updated from your recent proof</p>
      ) : null}
    </section>
  );
}
