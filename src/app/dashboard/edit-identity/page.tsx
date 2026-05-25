import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { loadIdentityEditDraft } from "@/lib/load-identity-edit-draft";
import { MEMBER_APP_HOME_PATH } from "@/lib/member-app-home-path";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { isUserFullyOnV2AccountabilityPath } from "@/lib/v2-cutover-gates";
import {
  getPendingResolutionOrNull,
  isSmsInboundPendingResolutionActionable,
} from "@/lib/v2-guided-resolution";
import EditIdentityClient from "./edit-identity-client";

export const dynamic = "force-dynamic";

export default async function EditIdentityPage() {
  const user = await currentUser();
  if (!user) {
    redirect("/sign-in");
  }

  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const fullyOnV2 = await isUserFullyOnV2AccountabilityPath(userId);
  if (!fullyOnV2) {
    redirect(MEMBER_APP_HOME_PATH);
  }

  const commitment = await getActiveCommitment(userId);
  if (!commitment?.id) {
    redirect(MEMBER_APP_HOME_PATH);
  }

  if (commitment.accountability_phase === "low_pressure_reactivation") {
    redirect(MEMBER_APP_HOME_PATH);
  }

  const pending = getPendingResolutionOrNull(commitment);
  if (pending || isSmsInboundPendingResolutionActionable(commitment)) {
    redirect(MEMBER_APP_HOME_PATH);
  }

  const draft = await loadIdentityEditDraft(userId);

  return <EditIdentityClient draft={draft} />;
}
