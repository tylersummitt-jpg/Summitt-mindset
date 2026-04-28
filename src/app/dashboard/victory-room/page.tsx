import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { VictoryArchiveSection } from "@/components/VictoryArchiveSection";
import { VictoryCornerstoneSection } from "@/components/VictoryCornerstoneSection";
import { VictoryPriorChaptersSection } from "@/components/VictoryPriorChaptersSection";
import { VictoryRoomProofShareSection } from "@/components/VictoryRoomProofShareSection";
import { resolveUserTimezone } from "@/lib/timezone";
import {
  formatVictoryRoomDate,
  loadVictoryRoomView,
} from "@/lib/v2-victory-room-view";
import { resolveVictoryRoomSummaryParagraph } from "@/lib/v2-victory-room-summary";
import type { VictoryRoomViewForShare } from "@/lib/v2-victory-share-snippet";

export default async function VictoryRoomPage() {
  const user = await currentUser();
  if (!user?.id) redirect("/sign-in");

  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  const timeZone = resolveUserTimezone(md?.timezone);

  const view = await loadVictoryRoomView(user.id);

  const displayName =
    view.profile.preferred_name?.trim() ||
    user.firstName?.trim() ||
    "there";

  const victorySummary = view.hasActiveV2Commitment
    ? await resolveVictoryRoomSummaryParagraph(view, displayName)
    : null;

  const viewForShare: VictoryRoomViewForShare | null = view.hasActiveV2Commitment
    ? { ...view, share_identity_line: displayName }
    : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="mb-4 text-sm text-gray-500">
        <Link href="/dashboard" className="text-gray-700 underline underline-offset-2 hover:text-gray-900">
          ← Dashboard
        </Link>
      </p>

      {/* A. Hero */}
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Victory Room</h1>
        <p className="mt-3 text-gray-600 leading-relaxed">
          A quiet record of real choices — so the coaching you cannot see becomes proof you can feel.
        </p>
      </header>

      {!view.hasActiveV2Commitment ? (
        <section className="rounded-xl border border-amber-100 bg-amber-50/60 p-6 text-gray-800">
          <h2 className="text-lg font-medium text-gray-900">Not quite ready</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">
            Victory Room reads your <strong>active commitment</strong> and the honest back-and-forth on SMS
            checks. If you do not have an active commitment yet, there is nothing to show — and that is
            okay.
          </p>
          <p className="mt-4 text-sm text-gray-600">
            <Link href="/dashboard" className="font-medium text-gray-900 underline underline-offset-2">
              Return to the dashboard
            </Link>
          </p>
        </section>
      ) : (
        <>
          {victorySummary?.paragraph ? (
            <section
              className="mb-10 rounded-lg border border-gray-200 border-l-4 border-l-stone-500 bg-stone-50/90 px-5 py-4 shadow-sm"
              aria-label="Victory summary"
            >
              <p className="text-base leading-relaxed text-gray-900">{victorySummary.paragraph}</p>
              <p className="mt-3 text-[11px] leading-snug text-gray-500">
                {victorySummary.provenance === "early_chapter"
                  ? "Grounded in your active commitment — proof builds as you keep showing up."
                  : "Built from your recent accountability moments."}
              </p>
            </section>
          ) : null}

          <VictoryCornerstoneSection moments={view.cornerstoneMoments} timeZone={timeZone} />

          {/* B. Your bar — commitment row + getEffectiveCoachingAsk (canonical) */}
          <section className="mb-10 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Your bar</h2>
            <p className="mt-3 text-gray-900 leading-relaxed">
              {view.effectiveCoachingAsk?.trim() || "Your commitment is active; the precise ask will appear here."}
            </p>
            <p className="mt-3 text-sm text-gray-600 leading-relaxed">
              This is what your coach is holding you to right now — drawn from your current commitment, not a
              scoreboard.
            </p>
            {view.commitment?.title ? (
              <p className="mt-4 text-xs text-gray-400">Commitment: {view.commitment.title}</p>
            ) : null}
          </section>

          {view.optionalMemoryProjectionLine ? (
            <p className="mb-10 text-xs leading-relaxed text-gray-500">{view.optionalMemoryProjectionLine}</p>
          ) : null}

          {/* C. Proof — v2_commitment_event (canonical) */}
          <section className="mb-10">
            <h2 className="text-xl font-semibold text-gray-900">Proof from recent weeks</h2>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              Built from your real check-ins — no invented wins.
            </p>
            {view.moments.length === 0 ? (
              <p className="mt-6 rounded-lg border border-gray-100 bg-gray-50 p-5 text-sm text-gray-700 leading-relaxed">
                Proof builds as you answer checks honestly. A few real replies, and this wall will start to
                reflect you.
              </p>
            ) : viewForShare ? (
              <VictoryRoomProofShareSection
                viewForShare={viewForShare}
                moments={view.moments.map((m) => ({
                  id: m.id,
                  headline: m.headline,
                  body: m.body,
                  dateLabel: formatVictoryRoomDate(m.occurredAt, timeZone),
                  groundedInEventTypes: m.groundedInEventTypes,
                }))}
              />
            ) : null}
          </section>

          {/* D. Comeback / courage — only when composite / reactivation evidence exists */}
          {view.comebackLines.length > 0 ? (
            <section className="mb-10 rounded-xl border border-gray-200 bg-gray-50/80 p-6">
              <h2 className="text-xl font-semibold text-gray-900">Comeback &amp; courage</h2>
              <ul className="mt-4 list-disc space-y-2 pl-5 text-gray-800 leading-relaxed">
                {view.comebackLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <VictoryArchiveSection moments={view.archiveMoments} timeZone={timeZone} />

          <VictoryPriorChaptersSection chapters={view.priorChapters} timeZone={timeZone} />
        </>
      )}
    </main>
  );
}
