import type { VictoryPrincipleCardDisplay } from "@/lib/v2-victory-principles-map";

type VictoryPrincipleCardProps = {
  label: string;
  card: VictoryPrincipleCardDisplay;
};

export function VictoryPrincipleCard({ label, card }: VictoryPrincipleCardProps) {
  return (
    <article className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</h3>
      <p className="mt-2 text-sm font-medium text-gray-900">{card.title}</p>
      <p className="mt-2 text-sm leading-relaxed text-gray-800">{card.text}</p>
    </article>
  );
}
