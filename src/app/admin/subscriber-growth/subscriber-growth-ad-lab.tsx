import { SUBSCRIBER_GROWTH_TZ, UNKNOWN_METRIC } from "@/lib/admin-subscriber-growth-pure";
import type { AdLabPanel } from "@/lib/ad-lab-import-pure";

function formatWhen(iso: string | null): string {
  if (!iso) return "Unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SUBSCRIBER_GROWTH_TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function money(cents: number | null, currency: string): string {
  if (cents == null) return UNKNOWN_METRIC;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function count(value: number | null): string {
  return value == null ? UNKNOWN_METRIC : String(value);
}

function ctr(value: number | null): string {
  if (value == null) return UNKNOWN_METRIC;
  return `${(value * 100).toFixed(1)}%`;
}

function statusLabel(status: string | null): string {
  if (!status) return "Status not stored";
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function SubscriberGrowthAdLab({ view }: { view: AdLabPanel }) {
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
      <h3 className="text-[11px] font-medium text-gray-800">Summitt Ad Lab</h3>
      <p className="mt-0.5 text-[10px] text-gray-500">
        Meta-reported delivery from the stored import. It is not added to the
        hand-entered advertising spend above. Verified trials, paying subscribers,
        and cost per result are not connected to individual ads yet.
      </p>
      {view.status !== "ready" ? (
        <p className="mt-2 text-[11px] text-gray-700">{view.message}</p>
      ) : (
        <Ready view={view} />
      )}
    </div>
  );
}

function Ready({ view }: { view: Extract<AdLabPanel, { status: "ready" }> }) {
  const { summary } = view;
  return (
    <>
      <p className="mt-1 text-[10px] text-gray-500">
        Today and this week use {summary.timezone}, the Meta ad account timezone.
        Each ad below uses the date range selected at the top of this page (
        {summary.rangeSince} through {summary.rangeUntil}). A dash means that
        number was not stored. A missing day is omitted, not treated as zero.
      </p>
      <p className="mt-1 text-[10px] text-gray-500">
        {summary.stale
          ? `These stored figures are from ${formatWhen(summary.lastImportedAt)}. A newer import has not succeeded.`
          : `Last successful import: ${formatWhen(summary.lastImportedAt)}.`}
      </p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Figure label="Today's Meta spend" value={money(summary.todaySpendCents, summary.currency)} />
        <Figure
          label="This week"
          value={money(summary.weekSpendCents, summary.currency)}
          note={`${summary.weekStart} through ${summary.todayKey}`}
        />
        <Figure
          label="Active ads"
          value={summary.activeCount == null ? UNKNOWN_METRIC : String(summary.activeCount)}
          note={
            summary.activeCount == null
              ? "Shown after a recent status read. Status is separate from spend."
              : "From the last Meta status read. Separate from spend."
          }
        />
      </div>
      {summary.ads.length === 0 ? (
        <p className="mt-2 text-[11px] text-gray-700">
          No stored ad delivery falls in the selected dates.
        </p>
      ) : (
        <div className="mt-2 max-h-80 space-y-1 overflow-y-auto">
          {summary.ads.map((ad) => (
            <details key={ad.metaAdId} className="rounded border border-gray-100 px-2 py-1">
              <summary className="cursor-pointer text-[11px] text-gray-800">
                <span className="font-medium">{ad.adName}</span>
                <span className="text-gray-500">
                  {" "}
                  · {statusLabel(ad.status)} · {money(ad.spendCents, summary.currency)}
                </span>
              </summary>
              <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-gray-600 sm:grid-cols-3">
                <Pair label="Ad ID" value={ad.metaAdId} />
                <Pair label="Impressions" value={count(ad.impressions)} />
                <Pair label="Outbound clicks" value={count(ad.outboundClicks)} />
                <Pair label="Outbound CTR" value={ctr(ad.outboundCtr)} />
                <Pair label="Landing-page views" value={count(ad.landingPageViews)} />
                <Pair label="Campaign" value={ad.campaignName ?? UNKNOWN_METRIC} />
                <Pair label="Ad set" value={ad.adsetName ?? UNKNOWN_METRIC} />
              </dl>
            </details>
          ))}
        </div>
      )}
    </>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded border border-gray-100 px-2 py-1.5">
      <p className="text-[10px] text-gray-500">{label}</p>
      <p className="text-sm font-medium tabular-nums text-gray-900">{value}</p>
      {note ? <p className="text-[10px] text-gray-500">{note}</p> : null}
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-gray-400">{label}</dt>
      <dd className="text-gray-800">{value}</dd>
    </div>
  );
}
