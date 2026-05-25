import Link from "next/link";
import type { VictoryRoomActiveSeason, VictoryRoomProfileIdentity } from "@/lib/v2-victory-room-view";
import { formatVictoryRoomDate } from "@/lib/v2-victory-room-view";

const foundationActionLinkClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm transition hover:border-stone-400 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50";

type VictoryRoomTopCardProps = {
  profile: VictoryRoomProfileIdentity;
  commitment: { title: string; behavior_statement: string | null };
  activeSeason: VictoryRoomActiveSeason | null;
  timeZone: string;
  showUpdateGoalLink?: boolean;
  showEditIdentityLink?: boolean;
};

export function VictoryRoomTopCard({
  profile,
  commitment,
  activeSeason,
  timeZone,
  showUpdateGoalLink = false,
  showEditIdentityLink = false,
}: VictoryRoomTopCardProps) {
  const seasonStarted =
    activeSeason?.started_at && formatVictoryRoomDate(activeSeason.started_at, timeZone);

  return (
    <section className="mb-8 rounded-2xl border border-stone-200 bg-stone-50 p-6 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Your foundation</h2>
      <dl className="mt-4 space-y-4 text-sm text-gray-800">
        <div>
          <dt className="font-medium text-gray-900">My Identity</dt>
          <dd className="mt-1 leading-relaxed">
            {profile.identity_anchor_text?.trim() ? (
              profile.identity_anchor_text
            ) : (
              <span className="text-gray-600">Still being shaped — your identity line will show here.</span>
            )}
            {showEditIdentityLink ? (
              <div className="mt-4">
                <Link href="/dashboard/edit-identity" className={foundationActionLinkClass}>
                  Edit identity
                </Link>
                <p className="mt-2 text-xs leading-relaxed text-gray-600">
                  Update who you&apos;re becoming — your current goal stays the same unless you choose
                  to change it.
                </p>
              </div>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-gray-900">My Current Goal</dt>
          <dd className="mt-1">
            {commitment.behavior_statement?.trim() ? (
              <span className="block font-medium leading-relaxed text-gray-900">
                {commitment.behavior_statement}
              </span>
            ) : (
              <span className="font-medium text-gray-900">{commitment.title}</span>
            )}
            {commitment.title?.trim() &&
            commitment.behavior_statement?.trim() &&
            commitment.title.trim().toLowerCase() !==
              commitment.behavior_statement.trim().toLowerCase() ? (
              <span className="mt-1 block text-xs text-gray-500">{commitment.title}</span>
            ) : null}
            {showUpdateGoalLink ? (
              <div className="mt-4">
                <Link href="/dashboard/update-goal" className={foundationActionLinkClass}>
                  Update goal
                </Link>
                <p className="mt-2 text-xs leading-relaxed text-gray-600">
                  Adjust what Pat holds you to next.
                </p>
              </div>
            ) : null}
          </dd>
        </div>
        {activeSeason?.season_name ? (
          <div>
            <dt className="font-medium text-gray-900">Current Season</dt>
            <dd className="mt-1">
              {activeSeason.season_name}
              {seasonStarted ? (
                <span className="block text-gray-600 text-xs mt-1">Opened {seasonStarted}</span>
              ) : null}
            </dd>
          </div>
        ) : (
          <div>
            <dt className="font-medium text-gray-900">Current Season</dt>
            <dd className="mt-1 text-gray-600">Your first season is open.</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
