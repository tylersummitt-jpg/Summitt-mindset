import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingProgress from "@/components/onboarding-progress";
import CommitmentClient from "./commitment-client";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function CommitmentPage(): Promise<ReactElement> {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const md = (user.publicMetadata || {}) as Record<string, unknown>;

  if (md?.onboardingCompleted === true) {
    redirect("/post-sign-in");
  }

  const { data: profile } = await supabaseServer
    .from("user_profiles")
    .select("preferred_name, people_summary, responsibility")
    .eq("clerk_user_id", user.id)
    .maybeSingle();

  const preferredOk =
    typeof profile?.preferred_name === "string" && profile.preferred_name.trim().length > 0;
  const peopleOk =
    typeof profile?.people_summary === "string" && profile.people_summary.trim().length > 0;
  const responsibilityOk =
    typeof profile?.responsibility === "string" && profile.responsibility.trim().length > 0;

  if (!profile || !preferredOk || !peopleOk || !responsibilityOk) {
    redirect("/onboarding/identity");
  }

  const { data: activeCommitment } = await supabaseServer
    .from("v2_commitment")
    .select("id")
    .eq("clerk_user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (activeCommitment?.id) {
    redirect("/onboarding/complete");
  }

  return (
    <div>
      <OnboardingProgress currentStep={2} />

      <h1 className="text-3xl font-bold mb-4">
        Choose the one thing Coach Pat will text you about.
      </h1>

      <p className="text-gray-600 mb-10">
        Start small. Pick one behavior Coach Pat can help you stay consistent with, one
        day at a time.
      </p>

      <CommitmentClient />
    </div>
  );
}
