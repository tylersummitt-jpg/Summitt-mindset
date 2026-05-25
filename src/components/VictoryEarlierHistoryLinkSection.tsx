import Link from "next/link";

type VictoryEarlierHistoryLinkSectionProps = {
  hasEarlierHistory: boolean;
};

export function VictoryEarlierHistoryLinkSection({
  hasEarlierHistory,
}: VictoryEarlierHistoryLinkSectionProps) {
  if (!hasEarlierHistory) return null;

  return (
    <section className="mb-10 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">Earlier proof history</h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">
        Proof from past commitments that is not shown in My Seasons. Open it when you want to look back.
      </p>
      <Link
        href="/dashboard/victory-room/history"
        className="mt-4 inline-block text-sm font-medium text-gray-900 underline underline-offset-2"
      >
        View earlier chapters
      </Link>
    </section>
  );
}
