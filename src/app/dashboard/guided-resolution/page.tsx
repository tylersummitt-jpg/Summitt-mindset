import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { computeShrinkProposalText, getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import {
  clearPendingResolution,
  getPendingResolutionOrNull,
  isPendingResolutionExpired,
} from "@/lib/v2-guided-resolution";
import { supabaseServer } from "@/lib/supabase-server";
import GuidedResolutionClient from "./guided-resolution-client";

export const dynamic = "force-dynamic";

export default async function GuidedResolutionPage() {
  const user = await currentUser();
  if (!user) {
    redirect("/sign-in");
  }

  const clerkId = user.id;
  let commitment = await getActiveCommitment(clerkId);

  let clearedExpiredPending = false;
  if (commitment) {
    const pendingBefore = getPendingResolutionOrNull(commitment);
    if (pendingBefore && isPendingResolutionExpired(commitment, Date.now())) {
      await clearPendingResolution(commitment.id);
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "guided_resolution_page_expired_cleanup",
      });
      clearedExpiredPending = true;
      commitment = await getActiveCommitment(clerkId);
    }
  }

  if (commitment?.accountability_phase === "low_pressure_reactivation") {
    const p = getPendingResolutionOrNull(commitment);
    if (p) {
      await clearPendingResolution(commitment.id);
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "guided_resolution_page_pause_cleanup",
      });
      commitment = await getActiveCommitment(clerkId);
    }
  }

  const pending = commitment ? getPendingResolutionOrNull(commitment) : null;

  const { data: prof } = await supabaseServer
    .from("user_profiles")
    .select("identity_anchor_text")
    .eq("clerk_user_id", clerkId)
    .maybeSingle();

  const prefilledIdentity =
    typeof prof?.identity_anchor_text === "string" ? prof.identity_anchor_text : "";

  const prefilledCommitment = commitment
    ? getEffectiveCoachingAsk(commitment, Date.now())
    : "";

  if (clearedExpiredPending && !pending) {
    return (
      <GuidedResolutionClient
        view="expired"
        prefilledIdentity=""
        prefilledCommitment=""
        prefilledTighten=""
      />
    );
  }

  if (!pending) {
    return (
      <GuidedResolutionClient
        view="none"
        prefilledIdentity={prefilledIdentity}
        prefilledCommitment={prefilledCommitment}
        prefilledTighten=""
      />
    );
  }

  if (pending.kind === "identity_anchor_update") {
    return (
      <GuidedResolutionClient
        view="identity"
        prefilledIdentity={prefilledIdentity}
        prefilledCommitment=""
        prefilledTighten=""
      />
    );
  }

  if (pending.kind === "commitment_replace") {
    return (
      <GuidedResolutionClient
        view="commitment"
        prefilledIdentity=""
        prefilledCommitment={prefilledCommitment}
        prefilledTighten=""
      />
    );
  }

  const prefilledTighten = commitment
    ? computeShrinkProposalText(commitment.behavior_statement)
    : "";

  return (
    <GuidedResolutionClient
      view="tighten"
      prefilledIdentity=""
      prefilledCommitment=""
      prefilledTighten={prefilledTighten}
    />
  );
}
