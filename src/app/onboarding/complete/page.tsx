import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { AuthMarketingShell } from "@/components/auth-marketing-shell";
import { CoachCompletionPanel } from "@/components/coach-completion-panel";
import OnboardingProgress from "@/components/onboarding-progress";
import CompleteOnboardingButton from "@/components/CompleteOnboardingButton";
import { supabaseServer } from "@/lib/supabase-server";

/**
 * Final onboarding step: readiness + canonical completion POST.
 */

export const dynamic = "force-dynamic";

export default async function CompletePage(): Promise<ReactElement> {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  const isCoach = md.acquisitionSource === "coach";

  if (md?.onboardingCompleted === true && isCoach) {
    return (
      <AuthMarketingShell authPage="coach-complete" contentClassName="w-full max-w-lg">
        <CoachCompletionPanel />
      </AuthMarketingShell>
    );
  }

  if (md?.onboardingCompleted === true) {
    redirect("/post-sign-in");
  }

  const { data: profile } = await supabaseServer
    .from("user_profiles")
    .select("preferred_name, people_summary, responsibility")
    .eq("clerk_user_id", user.id)
    .maybeSingle();

  if (!profile) {
    redirect("/onboarding/identity");
  }

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

  if (!commitmentForSummary?.id) {
    redirect("/onboarding/commitment");
  }

  const preferredName =
    typeof profile.preferred_name === "string" && profile.preferred_name.trim()
      ? profile.preferred_name.trim()
      : null;
  const peopleSummary =
    typeof profile.people_summary === "string" && profile.people_summary.trim()
      ? profile.people_summary.trim()
      : null;
  const responsibility =
    typeof profile.responsibility === "string" && profile.responsibility.trim()
      ? profile.responsibility.trim()
      : null;

  const commitmentTitle =
    typeof commitmentForSummary.title === "string" && commitmentForSummary.title.trim()
      ? commitmentForSummary.title.trim()
      : null;
  const commitmentBehavior =
    typeof commitmentForSummary.behavior_statement === "string" &&
    commitmentForSummary.behavior_statement.trim()
      ? commitmentForSummary.behavior_statement.trim()
      : null;

  return (
    <div className="space-y-10 text-center">
      <OnboardingProgress currentStep={4} />

      <header className="space-y-3">
        {isCoach ? (
          <>
            <h1 className="text-4xl font-bold">
              Activate your daily accountability.
            </h1>

            <p className="text-gray-600 text-lg leading-relaxed max-w-lg mx-auto">
              Finish onboarding to start your texts and begin Leadership Kit
              follow-up.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-4xl font-bold">Almost there.</h1>

            <p className="text-gray-600 text-lg leading-relaxed max-w-lg mx-auto">
              Coach Pat will start holding you accountable through your daily texts.
            </p>
          </>
        )}
      </header>

      <section className="border rounded-xl bg-gray-50 p-6 text-left space-y-4">
        <p className="font-semibold text-gray-900">Your coaching setup:</p>

        <ul className="text-sm text-gray-700 space-y-2 list-disc pl-5">
          {preferredName ? (
            <li>
              <strong>What to call you:</strong> {preferredName}
            </li>
          ) : null}

          {peopleSummary ? (
            <li>
              <strong>Who you show up for:</strong> {peopleSummary}
            </li>
          ) : null}

          {responsibility ? (
            <li>
              <strong>More context:</strong> {responsibility}
            </li>
          ) : null}

          {commitmentTitle ? (
            <li>
              <strong>Commitment:</strong> {commitmentTitle}
            </li>
          ) : null}

          {commitmentBehavior ? (
            <li>
              <strong>Daily check-in:</strong> {commitmentBehavior}
            </li>
          ) : null}
        </ul>
      </section>

      <section className="border rounded-xl bg-white shadow-sm p-6 text-left space-y-4">
        <CompleteOnboardingButton />
      </section>

      <p className="text-xs text-gray-500">
        {isCoach
          ? "After you finish, your daily texts begin and Kit follow-up can start."
          : "Coach Pat will guide you one step at a time."}
      </p>
    </div>
  );
}
