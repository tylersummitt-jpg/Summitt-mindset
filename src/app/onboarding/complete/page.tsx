import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingProgress from "@/components/onboarding-progress";
import CompleteOnboardingButton from "@/components/CompleteOnboardingButton";
import { requireOnboardingSobPath } from "@/lib/onboarding-sob-page-guard";
import { supabaseServer } from "@/lib/supabase-server";
import { isQuotableIdentitySource } from "@/lib/v2-identity-anchor-validation";

export const dynamic = "force-dynamic";

export default async function CompletePage(): Promise<ReactElement> {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  await requireOnboardingSobPath(user.id, md, "/onboarding/complete");

  const { data: profile } = await supabaseServer
    .from("user_profiles")
    .select("preferred_name, identity_anchor_text, identity_source")
    .eq("clerk_user_id", user.id)
    .maybeSingle();

  const { data: proposedCommitment } = await supabaseServer
    .from("v2_commitment")
    .select("id, title, behavior_statement")
    .eq("clerk_user_id", user.id)
    .eq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let commitmentForSummary = proposedCommitment;

  if (!commitmentForSummary?.id) {
    const { data: activeCommitment } = await supabaseServer
      .from("v2_commitment")
      .select("id, title, behavior_statement")
      .eq("clerk_user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    commitmentForSummary = activeCommitment ?? null;
  }

  const idSrc =
    typeof profile?.identity_source === "string" ? profile.identity_source.trim() : null;
  const identityAnchor =
    typeof profile?.identity_anchor_text === "string" &&
    isQuotableIdentitySource(idSrc)
      ? profile.identity_anchor_text.trim()
      : null;

  return (
    <div className="space-y-10 text-center">
      <OnboardingProgress currentStep={5} />

      <header className="space-y-3">
        <h1 className="text-4xl font-bold">Almost there.</h1>
        <p className="text-gray-600 text-lg leading-relaxed max-w-lg mx-auto">
          Finish setup to activate your commitment and enter your Victory Room.
        </p>
      </header>

      <section className="border rounded-xl bg-gray-50 p-6 text-left space-y-4">
        <p className="font-semibold text-gray-900">Your coaching setup:</p>
        <ul className="text-sm text-gray-700 space-y-2 list-disc pl-5">
          {profile?.preferred_name ? (
            <li>
              <strong>What to call you:</strong> {profile.preferred_name}
            </li>
          ) : null}
          {identityAnchor ? (
            <li>
              <strong>My Identity:</strong> {identityAnchor}
            </li>
          ) : null}
          {commitmentForSummary?.title ? (
            <li>
              <strong>My Current Goal:</strong> {commitmentForSummary.title}
            </li>
          ) : null}
          {commitmentForSummary?.behavior_statement ? (
            <li>
              <strong>Daily check-in:</strong> {commitmentForSummary.behavior_statement}
            </li>
          ) : null}
        </ul>
      </section>

      <section className="border rounded-xl bg-white shadow-sm p-6 text-left space-y-4">
        <CompleteOnboardingButton />
      </section>
    </div>
  );
}
