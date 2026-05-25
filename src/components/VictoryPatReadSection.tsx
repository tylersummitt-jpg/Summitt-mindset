import type { VictoryPatReadForDisplay } from "@/lib/v2-victory-pat-read-persist";

type VictoryPatReadSectionProps = {
  read: VictoryPatReadForDisplay;
};

export function VictoryPatReadSection({ read }: VictoryPatReadSectionProps) {
  return (
    <section className="mb-10 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-gray-900">Coach Pat&apos;s Read</h2>
      <p className="mt-2 text-sm text-gray-600 leading-relaxed">
        Grounded in your commitment and real check-ins — not a scoreboard.
      </p>
      <div className="mt-5 space-y-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Strength</h3>
          <p className="mt-2 text-base leading-relaxed text-gray-900">{read.strength}</p>
        </div>
        {read.pattern ? (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Pattern</h3>
            <p className="mt-2 text-base leading-relaxed text-gray-900">{read.pattern}</p>
          </div>
        ) : null}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Next move</h3>
          <p className="mt-2 text-base leading-relaxed text-gray-900">{read.nextMove}</p>
        </div>
      </div>
    </section>
  );
}
