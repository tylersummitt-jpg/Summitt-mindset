import Link from "next/link";
import { loadRecentUnresolvedRefreshReconcileCases } from "@/lib/v2-refresh-session";

export default async function InternalRefreshReconcilePage() {
  const cases = await loadRecentUnresolvedRefreshReconcileCases(60);

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Refresh reconcile cases</h1>
        <p className="mt-1 text-sm text-gray-600">
          Read-only rollup of recent unresolved refresh post-send bookkeeping candidates. Source:
          <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 text-xs">v2_commitment_event.check_sent</code>
          with missing matching
          <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 text-xs">coaching_refresh_prompted</code>.
        </p>
      </div>

      {cases.length === 0 ? (
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-600">No unresolved refresh reconcile cases found.</p>
        </section>
      ) : (
        <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-2 py-2 font-semibold">replay_key</th>
                <th className="px-2 py-2 font-semibold">commitment_id</th>
                <th className="px-2 py-2 font-semibold">session_id</th>
                <th className="px-2 py-2 font-semibold">step</th>
                <th className="px-2 py-2 font-semibold">message_sid</th>
                <th className="px-2 py-2 font-semibold">reason</th>
                <th className="px-2 py-2 font-semibold">age_minutes</th>
                <th className="px-2 py-2 font-semibold">repeated_likely</th>
                <th className="px-2 py-2 font-semibold">where_seen</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.replay_key} className="border-t border-gray-100">
                  <td className="px-2 py-2 font-mono">{c.replay_key}</td>
                  <td className="px-2 py-2 font-mono">{c.commitment_id}</td>
                  <td className="px-2 py-2 font-mono">{c.session_id}</td>
                  <td className="px-2 py-2">{c.step}</td>
                  <td className="px-2 py-2 font-mono">{c.message_sid}</td>
                  <td className="px-2 py-2">{c.reason}</td>
                  <td className="px-2 py-2">{c.age_minutes}</td>
                  <td className="px-2 py-2">{c.repeated_likely ? "yes" : "no"}</td>
                  <td className="px-2 py-2">{c.where_seen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="text-center text-xs text-gray-400">
        <Link href="/internal/coach-state" className="underline hover:text-gray-600">
          Back to coach state
        </Link>
      </p>
    </main>
  );
}
