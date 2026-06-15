import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { VictoryAllProofSection } from "@/components/VictoryAllProofSection";
import { vrPageGlow, vrPageInner, vrPageOuter } from "@/components/victory-room-visual";
import { resolveUserTimezone } from "@/lib/timezone";
import { loadVictoryAllProofView } from "@/lib/v2-victory-all-proof-view";
import { loadVictoryRoomView } from "@/lib/v2-victory-room-view";
import type { VictoryRoomViewForShare } from "@/lib/v2-victory-share-snippet";

export const dynamic = "force-dynamic";

export default async function VictoryAllProofPage() {
  const user = await currentUser();
  if (!user?.id) redirect("/sign-in");

  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  const timeZone = resolveUserTimezone(md?.timezone);

  const [view, allProof] = await Promise.all([
    loadVictoryRoomView(user.id),
    loadVictoryAllProofView(user.id),
  ]);

  const displayName =
    view.profile.preferred_name?.trim() || user.firstName?.trim() || "there";

  const viewForShare: VictoryRoomViewForShare | null = view.hasActiveV2Commitment
    ? {
        ...view,
        share_identity_line: displayName,
        shareProofMoments: allProof.allProofMoments,
      }
    : null;

  return (
    <div className={`victory-room-route-canvas ${vrPageOuter}`}>
      <div className={vrPageGlow} aria-hidden />
      <main className={vrPageInner}>
        <VictoryAllProofSection
          moments={allProof.allProofMoments}
          timeZone={timeZone}
          truncated={allProof.allProofTruncated}
          viewForShare={viewForShare}
        />
      </main>
    </div>
  );
}
