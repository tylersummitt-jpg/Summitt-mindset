import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingProgress from "@/components/onboarding-progress";
import { supabaseServer } from "@/lib/supabase-server";
import IdentityClient from "./identity-client";

export const dynamic = "force-dynamic";

export default async function IdentityPage(): Promise<ReactElement> {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  const isCoach = md.acquisitionSource === "coach";

  if (md?.onboardingCompleted === true) {
    redirect("/post-sign-in");
  }

  const { data: profile } = await supabaseServer
    .from("user_profiles")
    .select("preferred_name, people_summary, identity_anchor_text, responsibility")
    .eq("clerk_user_id", user.id)
    .maybeSingle();

  return (
    <div>
      <OnboardingProgress currentStep={1} />

      {isCoach ? (
        <>
          <h1 className="text-3xl font-bold mb-4">
            What standard are you trying to live as a coach?
          </h1>

          <p className="text-gray-600 mb-10">
            Summitt Mindset uses this to personalize your daily accountability.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-3xl font-bold mb-4">
            Let’s start with what matters most.
          </h1>

          <p className="text-gray-600 mb-10">
            Short answers are perfect. Relationship context and who you&apos;re
            becoming are separate — both help Coach Pat text you like a real coach.
          </p>
        </>
      )}

      <IdentityClient
        initialPreferredName={profile?.preferred_name ?? null}
        initialPeopleSummary={profile?.people_summary ?? null}
        initialIdentityAnchor={profile?.identity_anchor_text ?? null}
        initialResponsibility={profile?.responsibility ?? null}
      />
    </div>
  );
}
