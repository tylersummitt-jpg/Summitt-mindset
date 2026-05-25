import { auth } from "@clerk/nextjs/server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";

/**
 * POST /api/onboarding/review
 * Persists Review acknowledgment for the current proposed commitment.
 */
export async function POST() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const md = await getClerkPublicMetadata(userId);
    if (md?.onboardingCompleted === true) {
      return Response.json({ ok: true });
    }

    const { data: proposed } = await supabaseServer
      .from("v2_commitment")
      .select("id")
      .eq("clerk_user_id", userId)
      .eq("status", "proposed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!proposed?.id) {
      return Response.json(
        { error: "Save your current goal before continuing." },
        { status: 400 }
      );
    }

    const { data: intake } = await supabaseServer
      .from("v2_commitment_intake")
      .select("commitment_id, review_acknowledged_at")
      .eq("commitment_id", proposed.id)
      .eq("clerk_user_id", userId)
      .maybeSingle();

    if (!intake?.commitment_id) {
      return Response.json(
        { error: "Goal intake is missing. Please save your current goal again." },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    const { error } = await supabaseServer
      .from("v2_commitment_intake")
      .update({ review_acknowledged_at: nowIso, updated_at: nowIso })
      .eq("commitment_id", proposed.id)
      .eq("clerk_user_id", userId);

    if (error) {
      console.error("[onboarding/review] update failed", error);
      return Response.json({ error: "Failed to save review." }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[onboarding/review]", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
