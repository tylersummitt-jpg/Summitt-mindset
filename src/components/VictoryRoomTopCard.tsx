import Link from "next/link";
import { VictoryRoomSectionShell } from "@/components/VictoryRoomSectionShell";
import { VrIconGoal, VrIconIdentity } from "@/components/VictoryRoomIcons";
import {
  vrBody,
  vrBodyLarge,
  vrBodyMuted,
  vrDivider,
  vrFoundationBtn,
  vrIconCircle,
  vrInnerPanel,
  vrLabel,
  vrSectionCardFoundation,
} from "@/components/victory-room-visual";
import type { VictoryRoomActiveSeason, VictoryRoomProfileIdentity } from "@/lib/v2-victory-room-view";
import { formatVictoryRoomDate } from "@/lib/v2-victory-room-view";

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
    <VictoryRoomSectionShell
      number={1}
      title="Your Foundation"
      subtitle="Who you are becoming and what Pat holds you to today."
      className={vrSectionCardFoundation}
    >
      <div className={`${vrInnerPanel} mt-8 border-amber-500/30 bg-gradient-to-r from-amber-500/8 to-transparent`}>
        <p className={vrLabel}>Current season</p>
        {activeSeason?.season_name ? (
          <>
            <p className="mt-3 font-serif text-2xl font-semibold leading-tight text-stone-50 sm:text-3xl">
              {activeSeason.season_name}
            </p>
            {seasonStarted ? (
              <p className="mt-2 text-sm text-stone-500">Opened {seasonStarted}</p>
            ) : null}
          </>
        ) : (
          <p className={`${vrBody} mt-3`}>Your first season is open.</p>
        )}
      </div>

      <div className={`${vrDivider} my-8`} />

      <div className="flex gap-4 sm:gap-5">
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
            <p className={`${vrBodyLarge} mt-3 font-medium`}>{commitment.title}</p>
          )}
          {commitment.title?.trim() &&
          commitment.behavior_statement?.trim() &&
          commitment.title.trim().toLowerCase() !==
            commitment.behavior_statement.trim().toLowerCase() ? (
            <p className="mt-2 text-sm text-stone-500">{commitment.title}</p>
          ) : null}
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
    </VictoryRoomSectionShell>
  );
}
