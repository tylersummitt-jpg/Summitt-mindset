import Link from "next/link";
import { VrIconGoal, VrIconIdentity } from "@/components/VictoryRoomIcons";
import {
  vrBodyLarge,
  vrBodyMuted,
  vrDivider,
  vrFoundationBtn,
  vrIconCircle,
  vrLabel,
  vrSectionCard,
  vrSectionCardFoundation,
  vrSectionSubtitle,
  vrSectionTitle,
} from "@/components/victory-room-visual";
import type { VictoryRoomProfileIdentity } from "@/lib/v2-victory-room-view";

type VictoryRoomTopCardProps = {
  profile: VictoryRoomProfileIdentity;
  commitment: { title: string; behavior_statement: string | null };
  showUpdateGoalLink?: boolean;
  showEditIdentityLink?: boolean;
};

export function VictoryRoomTopCard({
  profile,
  commitment,
  showUpdateGoalLink = false,
  showEditIdentityLink = false,
}: VictoryRoomTopCardProps) {
  return (
    <section className={`${vrSectionCard} ${vrSectionCardFoundation} mb-12`}>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/20 to-transparent"
        aria-hidden
      />
      <h1 className={vrSectionTitle}>Victory Room</h1>
      <p className={`${vrSectionSubtitle} mt-2.5 max-w-2xl`}>
        A place to remember who you&apos;re becoming — saved from your real choices.
      </p>

      <div className="mt-8 flex gap-4 sm:gap-5">
        <div className={vrIconCircle} aria-hidden>
          <VrIconIdentity />
        </div>
        <div className="min-w-0 flex-1">
          <p className={vrLabel}>My identity</p>
          {profile.identity_anchor_text?.trim() ? (
            <p className={`${vrBodyLarge} mt-3 font-medium`}>{profile.identity_anchor_text}</p>
          ) : (
            <p className={`${vrBodyMuted} mt-3`}>
              Still being shaped — your identity line will show here.
            </p>
          )}
          {showEditIdentityLink ? (
            <div className="mt-5">
              <Link href="/dashboard/edit-identity" className={vrFoundationBtn}>
                Edit identity
              </Link>
              <p className={`${vrBodyMuted} mt-3 text-sm`}>
                Update who you&apos;re becoming — your current goal stays the same unless you choose
                to change it.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className={`${vrDivider} my-8`} />

      <div className="flex gap-4 sm:gap-5">
        <div className={vrIconCircle} aria-hidden>
          <VrIconGoal />
        </div>
        <div className="min-w-0 flex-1">
          <p className={vrLabel}>My current goal</p>
          {commitment.behavior_statement?.trim() ? (
            <p className={`${vrBodyLarge} mt-3 font-medium`}>{commitment.behavior_statement}</p>
          ) : (
            <p className={`${vrBodyMuted} mt-3`}>No current goal set yet.</p>
          )}
          {showUpdateGoalLink ? (
            <div className="mt-5">
              <Link href="/dashboard/update-goal" className={vrFoundationBtn}>
                Update goal
              </Link>
              <p className={`${vrBodyMuted} mt-3 text-sm`}>Adjust what Pat holds you to next.</p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
