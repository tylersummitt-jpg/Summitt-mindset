import type { ReactElement } from "react";
import { headers } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingProgress from "@/components/onboarding-progress";
import { scheduleOnboardingDiagnostic } from "@/lib/onboarding-journey-diagnostics.server";
import { requireOnboardingSobPath } from "@/lib/onboarding-sob-page-guard";
import { noteOnboardingReached } from "@/lib/stripe-first-checkout/signup-diagnostics";
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
  await noteOnboardingReached(user.id);
  scheduleOnboardingDiagnostic({
    clerkUserId: user.id,
    step: "identity",
    outcome: "step_reached",
    journeyId: "server",
    attemptId: crypto.randomUUID(),
    userAgent: (await headers()).get("user-agent"),
    source: "server",
  });

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
