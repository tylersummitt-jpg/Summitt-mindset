import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingProgress from "@/components/onboarding-progress";
import { requireOnboardingSobPath } from "@/lib/onboarding-sob-page-guard";
import { loadIdentityOnboardingDraft } from "@/lib/onboarding-load-identity-draft";
import CommitmentClient from "./commitment-client";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function CommitmentPage(): Promise<ReactElement> {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  await requireOnboardingSobPath(user.id, md, "/onboarding/commitment");

  const { data: profile } = await supabaseServer
    .from("user_profiles")
    .select("identity_anchor_text, active_identity_version_id")
    .eq("clerk_user_id", user.id)
    .maybeSingle();

  const { data: proposedCommitment } = await supabaseServer
    .from("v2_commitment")
    .select("title, behavior_statement")
    .eq("clerk_user_id", user.id)
    .eq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const identityAnchor = profile?.identity_anchor_text ?? null;
  const identityDraft = await loadIdentityOnboardingDraft(
    user.id,
    profile?.active_identity_version_id
  );

  return (
    <div>
      <OnboardingProgress currentStep={2} />

      {identityAnchor ? (
        <section className="mb-8 rounded-lg border bg-gray-50 p-4">
          <h2 className="text-lg font-bold text-gray-900 mb-2">My Identity</h2>
          <p className="text-sm text-gray-700">{identityAnchor}</p>
        </section>
      ) : null}

      <h1 className="text-3xl font-bold mb-3">My Current Goal</h1>

      <p className="text-gray-700 mb-2">
        Pick a goal Coach Pat can check regularly. The best goals are small enough to practice
        today.
      </p>
      <p className="text-sm text-gray-600 mb-10">
        Start small. The goal is not to impress Coach Pat — it is to give her something real to
        check on.
      </p>

      <CommitmentClient
        initialTitle={proposedCommitment?.title ?? null}
        initialBehaviorStatement={proposedCommitment?.behavior_statement ?? null}
        identityAnchor={identityAnchor}
        personalizationContext={{
          ingredientIds: identityDraft.ingredientIds,
          importantPeople: identityDraft.importantPeople.map((person) => ({
            relationship_type: person.relationship_type,
          })),
        }}
      />
    </div>
  );
}
