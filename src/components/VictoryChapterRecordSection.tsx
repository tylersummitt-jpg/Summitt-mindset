import type { VictoryChapterRecord } from "@/lib/v2-victory-room-view";

function formatChapterRecordDate(iso: string, timeZone: string | undefined): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: timeZone && timeZone.trim() ? timeZone : "UTC",
    }).format(t);
  } catch {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
      t
    );
  }
}

type VictoryChapterRecordSectionProps = {
  chapterRecord: VictoryChapterRecord;
  timeZone: string;
};

export function VictoryChapterRecordSection({ chapterRecord, timeZone }: VictoryChapterRecordSectionProps) {
  const openedLabel = chapterRecord.openedAt ? formatChapterRecordDate(chapterRecord.openedAt, timeZone) : null;
  const firstLabel = chapterRecord.firstProofAt ? formatChapterRecordDate(chapterRecord.firstProofAt, timeZone) : null;
  const latestLabel = chapterRecord.latestProofAt ? formatChapterRecordDate(chapterRecord.latestProofAt, timeZone) : null;

  const hasProof = Boolean(firstLabel || latestLabel || chapterRecord.proofCategoryLabels.length > 0);
  const showLatest = Boolean(latestLabel && (!firstLabel || latestLabel !== firstLabel));

  return (
    <section className="mb-10 rounded-xl border border-stone-200 bg-white/90 p-6 shadow-sm" aria-label="Chapter record">
      <h2 className="text-lg font-semibold tracking-tight text-gray-900">Chapter record</h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-700">
        This is a real chapter — proof starts gathering as you keep answering real check-ins.
      </p>

      <div className="mt-5 space-y-2 text-sm text-gray-800">
        {openedLabel ? <p>Opened {openedLabel}</p> : <p>This chapter has started.</p>}
        {firstLabel ? <p>First proof captured {firstLabel}</p> : null}
        {showLatest ? <p>Latest proof captured {latestLabel}</p> : null}
      </div>

      {chapterRecord.proofCategoryLabels.length > 0 ? (
        <div className="mt-5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Proof has started to show up as
          </p>
          <p className="mt-2 text-sm leading-relaxed text-gray-800">
            {chapterRecord.proofCategoryLabels.join(" · ")}
          </p>
        </div>
      ) : hasProof ? null : (
        <p className="mt-5 text-sm leading-relaxed text-gray-700">
          Proof starts gathering as you answer real check-ins.
        </p>
      )}

      {chapterRecord.earlierSeasonCount > 0 ? (
        <p className="mt-5 text-xs leading-relaxed text-gray-500">Earlier seasons are saved below.</p>
      ) : null}
    </section>
  );
}

