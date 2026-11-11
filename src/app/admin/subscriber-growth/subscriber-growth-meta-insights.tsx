import { UNKNOWN_METRIC } from "@/lib/admin-subscriber-growth-pure";
import {
  SUBSCRIBER_GROWTH_TZ,
  type MetaAdInsightRow,
  type MetaAdLabInsightsResult,
} from "@/lib/meta-ad-lab-insights-pure";

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SUBSCRIBER_GROWTH_TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function money(spend: string | null): string {
  if (spend == null) return UNKNOWN_METRIC;
  const value = Number(spend);
  if (!Number.isFinite(value)) return UNKNOWN_METRIC;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function count(value: number | null): string {
  return value == null ? UNKNOWN_METRIC : String(value);
}

function RowCells({ row }: { row: MetaAdInsightRow }) {
  return (
    <>
      <td className="px-2 py-1.5 whitespace-nowrap">{row.date}</td>
      <td className="max-w-[16rem] break-words px-2 py-1.5">{row.adName}</td>
      <td className="px-2 py-1.5 font-mono">{row.adId}</td>
      <td className="px-2 py-1.5 tabular-nums">{money(row.spend)}</td>
      <td className="px-2 py-1.5 tabular-nums">{count(row.impressions)}</td>
      <td className="px-2 py-1.5 tabular-nums">{count(row.outboundClicks)}</td>
      <td className="px-2 py-1.5 tabular-nums">{count(row.landingPageViews)}</td>
    </>
  );
}

export function SubscriberGrowthMetaInsights({
  report,
}: {
  report: MetaAdLabInsightsResult;
}) {
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
      <h3 className="text-[11px] font-medium text-gray-800">Meta ad delivery</h3>
      <p className="mt-0.5 text-[10px] text-gray-500">
        Read from Meta Ads Insights for {report.since} through {report.until}. This does
        not change the hand-entered spend or the costs above. A dash means Meta did not
        return that number.
      </p>
      {report.rangeNote ? (
        <p className="mt-1 text-[10px] text-gray-500">{report.rangeNote}</p>
      ) : null}
      {report.status === "unconfigured" ? (
        <p className="mt-2 text-[11px] text-gray-700">
          Meta ad read is not configured on this server
          {report.missing.length > 0 ? ` (${report.missing.join(", ")} missing)` : ""}. The
          rest of this page is unchanged.
        </p>
      ) : null}
      {report.status === "error" ? (
        <p className="mt-2 text-[11px] text-gray-800">
          This refresh failed at {formatWhen(report.fetchedAt)}
          {report.httpStatus != null || report.code != null
            ? ` (${[
                report.httpStatus != null ? `HTTP ${report.httpStatus}` : null,
                report.code != null ? `Meta code ${report.code}` : null,
              ]
                .filter(Boolean)
                .join(", ")}).`
            : "."}{" "}
          {report.message} The rest of this page is unchanged.
        </p>
      ) : null}
      {report.status === "ok" ? (
        <>
          <p className="mt-1 text-[10px] text-gray-500">
            Last successful refresh: {formatWhen(report.fetchedAt)}.
            {report.fields === "core"
              ? " Meta rejected the click and landing-page fields, so those columns are blank."
              : ""}
          </p>
          {report.truncated ? (
            <p className="mt-1 text-[10px] text-gray-500">
              Meta has another page of rows. This view shows the first page only.
            </p>
          ) : null}
          {report.rows.length === 0 ? (
            <p className="mt-2 text-[11px] text-gray-700">
              Meta returned no ad rows for these dates.
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-[720px] w-full text-left text-[11px] text-gray-800">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    {["Date", "Ad", "Ad ID", "Spend", "Impressions", "Outbound clicks", "Landing-page views"].map(
                      (heading) => (
                        <th key={heading} className="px-2 py-1.5 font-medium">
                          {heading}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={`${row.adId}-${row.date}`} className="border-t border-gray-100">
                      <RowCells row={row} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
