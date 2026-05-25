import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import OnboardingProgress from "@/components/onboarding-progress";
import { requireOnboardingSobPath } from "@/lib/onboarding-sob-page-guard";
import { supabaseServer } from "@/lib/supabase-server";
import { shouldShowReviewCoachPatNote } from "@/lib/onboarding-coherence";
import { isQuotableIdentitySource } from "@/lib/v2-identity-anchor-validation";
import ReviewAcknowledgeButton from "./review-acknowledge-button";

export const dynamic = "force-dynamic";

export default async function ReviewPage(): Promise<ReactElement> {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  await requireOnboardingSobPath(user.id, md, "/onboarding/review");

  const { data: profile } = await supabaseServer
    .from("user_profiles")
    .select("preferred_name, identity_anchor_text, identity_source")
    .eq("clerk_user_id", user.id)
    .maybeSingle();

  const idSrc =
    typeof profile?.identity_source === "string" ? profile.identity_source.trim() : null;
  const anchor =
    typeof profile?.identity_anchor_text === "string" &&
    isQuotableIdentitySource(idSrc)
      ? profile.identity_anchor_text.trim()
      : null;

  const { data: proposed } = await supabaseServer
    .from("v2_commitment")
    .select("id, title, behavior_statement")
    .eq("clerk_user_id", user.id)
    .eq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: intake } = proposed?.id
    ? await supabaseServer
        .from("v2_commitment_intake")
        .select("coherence_status")
        .eq("commitment_id", proposed.id)
        .maybeSingle()
    : { data: null };

  const { data: coherence } = proposed?.id
    ? await supabaseServer
        .from("goal_coherence_log")
        .select("direct_connection_likely, confidence, coach_pat_note_text")
        .eq("commitment_id", proposed.id)
        .maybeSingle()
    : { data: null };

  const showPatNote =
    coherence &&
    intake &&
    shouldShowReviewCoachPatNote({
      coherence_status: intake.coherence_status,
      direct_connection_likely: coherence.direct_connection_likely,
      confidence: coherence.confidence,
      coach_pat_note_text: coherence.coach_pat_note_text,
    });

  return (
    <div className="space-y-10">
      <OnboardingProgress currentStep={3} />

      <header className="space-y-3">
        <h1 className="text-3xl font-bold">Review your setup</h1>
        <p className="text-gray-600">
          Make sure Coach Pat has the right identity line and daily goal before text check-ins.
        </p>
      </header>

      <section className="border rounded-xl bg-gray-50 p-6 space-y-4 text-left">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">My Identity</p>
          <p className="mt-2 text-gray-900">{anchor ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">My Current Goal</p>
          <p className="mt-2 font-medium text-gray-900">{proposed?.title ?? "—"}</p>
          <p className="mt-1 text-sm text-gray-700">{proposed?.behavior_statement ?? ""}</p>
        </div>
        {showPatNote && coherence?.coach_pat_note_text ? (
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Coach Pat</p>
            <p className="mt-2 text-sm text-gray-800">{coherence.coach_pat_note_text}</p>
          </div>
        ) : null}
      </section>

      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          href="/onboarding/identity"
          className="flex-1 text-center border rounded-md py-3 text-sm font-medium"
        >
          Edit Identity
        </Link>
        <Link
          href="/onboarding/commitment"
          className="flex-1 text-center border rounded-md py-3 text-sm font-medium"
        >
          Edit Current Goal
        </Link>
        <ReviewAcknowledgeButton />
      </div>
    </div>
  );
}
