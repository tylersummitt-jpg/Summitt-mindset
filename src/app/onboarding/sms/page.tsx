import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingProgress from "@/components/onboarding-progress";
import SmsClient from "./sms-client";
import { supabaseServer } from "@/lib/supabase-server";

/**
 * ======================================================
 * SMS Consent Step (Twilio-facing Compliance Screen)
 * ======================================================
 *
 * CANONICAL RULE:
 * - No SMS schedule selection.
 * - SMS always sends at 8:00 AM local time.
 */

export const dynamic = "force-dynamic";

export default async function SmsPage(): Promise<ReactElement> {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const md = (user.publicMetadata || {}) as Record<string, any>;

  if (md?.onboardingCompleted === true) {
    redirect("/post-sign-in");
  }

  // Soft guard: if profile intake hasn't started, send them back to start.
  const { data: profile } = await supabaseServer
    .from("user_profiles")
    .select("clerk_user_id")
    .eq("clerk_user_id", user.id)
    .maybeSingle();

  if (!profile?.clerk_user_id) {
    redirect("/onboarding/identity");
  }

  const { data: proposedCommitment } = await supabaseServer
    .from("v2_commitment")
    .select("id")
    .eq("clerk_user_id", user.id)
    .eq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!proposedCommitment?.id) {
    const { data: activeCommitment } = await supabaseServer
      .from("v2_commitment")
      .select("id")
      .eq("clerk_user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!activeCommitment?.id) {
      redirect("/onboarding/commitment");
    }
  }

  return (
    <div>
      <OnboardingProgress currentStep={3} />

      <h1 className="text-3xl font-bold mb-4">
        Set up your accountability texts.
      </h1>

      <p className="text-gray-600 mb-8">
        This is the heart of Summitt Mindset. Coach Pat will use your commitment to check in with you by text.
      </p>

      <SmsClient />
    </div>
  );
}