import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingProgress from "@/components/onboarding-progress";
import { requireOnboardingSobPath } from "@/lib/onboarding-sob-page-guard";
import { loadIdentityOnboardingDraft } from "@/lib/onboarding-load-identity-draft";
import { supabaseServer } from "@/lib/supabase-server";
import IdentityClient from "./identity-client";

export const dynamic = "force-dynamic";

export default async function IdentityPage(): Promise<ReactElement> {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  await requireOnboardingSobPath(user.id, md, "/onboarding/identity");

  const { data: profile } = await supabaseServer
    .from("user_profiles")
    .select("preferred_name, identity_anchor_text, active_identity_version_id")
    .eq("clerk_user_id", user.id)
    .maybeSingle();

  const draft = await loadIdentityOnboardingDraft(
    user.id,
    profile?.active_identity_version_id
  );

  return (
    <div>
      <OnboardingProgress currentStep={1} />

      <IdentityClient
        initialPreferredName={profile?.preferred_name ?? null}
        initialIdentityAnchor={profile?.identity_anchor_text ?? null}
        initialIngredientIds={draft.ingredientIds}
        initialOtherText={draft.otherText}
        initialImportantPeople={draft.importantPeople}
      />
    </div>
  );
}
