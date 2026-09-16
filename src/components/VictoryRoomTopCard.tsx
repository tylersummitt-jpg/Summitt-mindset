import Link from "next/link";
import { VrIconGoal, VrIconIdentity } from "@/components/VictoryRoomIcons";
import {
  vrAccentLink,
  vrBody,
  vrBodyMuted,
  vrDivider,
  vrIconCircle,
  vrLabel,
  vrSectionCard,
  vrSectionCardFoundation,
} from "@/components/victory-room-visual";
import type { VictoryRoomProfileIdentity } from "@/lib/v2-victory-room-view";

type VictoryRoomTopCardProps = {
  profile: VictoryRoomProfileIdentity;
  commitment: { title: string; behavior_statement: string | null };
  showUpdateGoalLink?: boolean;
  showEditIdentityLink?: boolean;
};

/** Local padding/margin only — do not change `vrSectionCard` globally. */
const foundationCardClass = `${vrSectionCard} ${vrSectionCardFoundation} !mb-8 !p-5 sm:!mb-12 sm:!p-8 lg:!p-8`;

const iconCircleClass = `${vrIconCircle} !h-8 !w-8`;

/** Same amber underline language as Proud Moments; `!` beats global `a { color: inherit }`. */
const foundationActionClass = `${vrAccentLink} inline-flex min-h-11 items-center !text-amber-300 !underline !decoration-amber-500/50 hover:!text-amber-200 hover:!decoration-amber-400/80`;

export function VictoryRoomTopCard({
  profile,
  commitment,
  showUpdateGoalLink = false,
  showEditIdentityLink = false,
}: VictoryRoomTopCardProps) {
  return (
    <section className={foundationCardClass}>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/20 to-transparent"
        aria-hidden
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 sm:gap-8">
        <div className="flex min-w-0 gap-3">
          <div className={iconCircleClass} aria-hidden>
            <VrIconIdentity />
          </div>
          <div className="min-w-0 flex-1">
            <p className={vrLabel}>My identity</p>
            {profile.identity_anchor_text?.trim() ? (
              <p className={`${vrBody} mt-1.5 break-words font-medium`}>
                {profile.identity_anchor_text}
              </p>
            ) : (
              <p className={`${vrBodyMuted} mt-1.5`}>
                Still being shaped — your identity line will show here.
              </p>
            )}
            {showEditIdentityLink ? (
              <div className="mt-2">
                <Link href="/dashboard/edit-identity" className={foundationActionClass}>
                  Edit identity
                </Link>
              </div>
            ) : null}
          </div>
        </div>

        <div className={`${vrDivider} my-4 sm:hidden`} />

        <div className="flex min-w-0 gap-3">
          <div className={iconCircleClass} aria-hidden>
            <VrIconGoal />
          </div>
          <div className="min-w-0 flex-1">
            <p className={vrLabel}>My current goal</p>
            {commitment.behavior_statement?.trim() ? (
              <p className={`${vrBody} mt-1.5 break-words font-medium`}>
                {commitment.behavior_statement}
              </p>
            ) : (
              <p className={`${vrBodyMuted} mt-1.5`}>No current goal set yet.</p>
            )}
            {showUpdateGoalLink ? (
              <div className="mt-2">
                <Link href="/dashboard/update-goal" className={foundationActionClass}>
                  Update goal
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
