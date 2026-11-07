import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingProgress from "@/components/onboarding-progress";
import CompleteOnboardingButton from "@/components/CompleteOnboardingButton";
import { YoureInVideoTracker } from "@/components/youre-in-video-tracker";
import { requireOnboardingSobPath } from "@/lib/onboarding-sob-page-guard";
import { supabaseServer } from "@/lib/supabase-server";
import { isQuotableIdentitySource } from "@/lib/v2-identity-anchor-validation";
import { buildVimeoPlayerEmbedUrl } from "@/lib/vimeo-player-embed";

export const dynamic = "force-dynamic";

const WELCOME_VIMEO_ID = "1244458037";

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

  const phone =
    typeof md.phoneNumber === "string" && md.phoneNumber.trim().length > 0
      ? md.phoneNumber.trim()
      : null;
  const welcomeVideoSrc = buildVimeoPlayerEmbedUrl(WELCOME_VIMEO_ID);

  return (
    <div className="space-y-8 text-center">
      <OnboardingProgress currentStep={4} />

      <h1 className="text-4xl font-bold">You&apos;re In!</h1>

      {welcomeVideoSrc ? (
        <div className="overflow-hidden rounded-xl border bg-black text-left">
          <div className="relative aspect-video w-full">
            <iframe
              data-youre-in-player=""
              title="Welcome to Summitt Mindset"
              src={welcomeVideoSrc}
              className="absolute inset-0 h-full w-full"
              allow="fullscreen; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      ) : null}
      <YoureInVideoTracker />

      <section className="rounded-xl border bg-gray-50 p-6 text-left space-y-3">
        <h2 className="font-semibold text-gray-900">Your Setup</h2>
        {identityAnchor ? (
          <p className="text-sm text-gray-800">
            <span className="font-semibold">Identity:</span> {identityAnchor}
          </p>
        ) : null}
        {commitmentForSummary?.title ? (
          <p className="text-sm text-gray-800">
            <span className="font-semibold">Current Goal:</span> {commitmentForSummary.title}
          </p>
        ) : null}
        {commitmentForSummary?.behavior_statement ? (
          <p className="text-sm text-gray-800">{commitmentForSummary.behavior_statement}</p>
        ) : null}
        <p className="text-sm text-gray-800">
          <span className="font-semibold">Daily texts:</span>{" "}
          {phone ? `on, at ${phone}` : "on"}
        </p>
      </section>

      <CompleteOnboardingButton />
    </div>
  );
}
