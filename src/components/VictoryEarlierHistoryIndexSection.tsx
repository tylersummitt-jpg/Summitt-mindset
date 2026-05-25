import Link from "next/link";
import type { EarlierChapterIndexRow } from "@/lib/v2-victory-earlier-chapter-index";

type VictoryEarlierHistoryIndexSectionProps = {
  chapters: EarlierChapterIndexRow[];
};

export function VictoryEarlierHistoryIndexSection({
  chapters,
}: VictoryEarlierHistoryIndexSectionProps) {
  if (chapters.length === 0) {
    return (
      <p className="rounded-lg border border-stone-200 bg-stone-50/80 px-5 py-4 text-sm leading-relaxed text-gray-700">
        No earlier chapters to show. My Seasons holds your recent accountability seasons.
      </p>
    );
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900">Earlier chapters</h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">
        These are past commitments that are not part of your current My Seasons view.
      </p>
      <ul className="mt-6 space-y-3">
        {chapters.map((ch) => (
          <li key={ch.commitmentId}>
            <article className="rounded-lg border border-stone-200 bg-stone-50/60 px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-base font-medium text-gray-900">{ch.title}</p>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {ch.statusLabel}
                </p>
              </div>
              <p className="mt-1 text-xs text-gray-500">{ch.rangeLabel}</p>
              <Link
                href={ch.detailHref}
                className="mt-3 inline-block text-sm font-medium text-gray-900 underline underline-offset-2"
              >
                {ch.linkLabel}
              </Link>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
