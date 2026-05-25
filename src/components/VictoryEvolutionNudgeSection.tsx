import Link from "next/link";
import type { VictoryEvolutionNudge } from "@/lib/v2-victory-evolution-nudge";

type VictoryEvolutionNudgeSectionProps = {
  nudge: VictoryEvolutionNudge | null;
};

export function VictoryEvolutionNudgeSection({ nudge }: VictoryEvolutionNudgeSectionProps) {
  if (!nudge) return null;

  return (
    <section className="mb-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">{nudge.headline}</h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">{nudge.body}</p>
      <Link
        href={nudge.href}
        className="mt-3 inline-block text-sm font-medium text-gray-900 underline underline-offset-2"
      >
        Review recommendation
      </Link>
    </section>
  );
}
