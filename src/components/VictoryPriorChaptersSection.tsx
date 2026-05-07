import type { VictoryMoment, VictoryPriorChapterView } from "@/lib/v2-victory-room-view";
import { formatVictoryRoomDate } from "@/lib/v2-victory-room-view";

type VictoryPriorChaptersSectionProps = {
  chapters: VictoryPriorChapterView[];
  timeZone: string;
};

/**
 * Earlier seasons — prior `v2_commitment` rows (canonical) + spine-backed moments per chapter.
 * `user_profiles` is not used for chapter boundaries.
 */
export function VictoryPriorChaptersSection({ chapters, timeZone }: VictoryPriorChaptersSectionProps) {
  if (chapters.length === 0) return null;

  return (
    <section className="mb-10 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-gray-900">Earlier seasons</h2>
      <p className="mt-2 text-sm text-gray-600 leading-relaxed">
        Each block is one past commitment from your account — proof stays inside that season only.
      </p>
      <div className="mt-6 space-y-3">
        {chapters.map((ch) => (
          <details
            key={ch.commitmentId}
            className="group rounded-lg border border-stone-200 bg-white shadow-sm open:shadow-md"
          >
            <summary className="cursor-pointer list-none px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-base font-medium text-gray-900">{ch.chapterTitle}</span>
                <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {ch.statusLabel}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500">{ch.rangeLabel}</p>
              <p className="mt-2 text-xs text-gray-400 group-open:hidden">Tap to open proof from this season.</p>
            </summary>
            <div className="border-t border-gray-100 px-4 pb-4 pt-2">
              {ch.moments.length === 0 ? (
                <p className="text-sm text-gray-600 leading-relaxed">
                  Little was captured here in text — that does not erase the season you lived.
                </p>
              ) : (
                <ul className="space-y-3">
                  {ch.moments.map((m: VictoryMoment) => (
                    <li key={m.id}>
                      <article className="rounded-md border border-gray-200 bg-white p-3 shadow-sm">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">{m.headline}</p>
                        <p className="mt-1 text-sm leading-relaxed text-gray-900">{m.body}</p>
                        <p className="mt-2 text-[11px] text-gray-500">{formatVictoryRoomDate(m.occurredAt, timeZone)}</p>
                      </article>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
