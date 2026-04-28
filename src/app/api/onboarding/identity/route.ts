import { auth } from "@clerk/nextjs/server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import {
  computeIdentityRefreshDueAtIsoFromNow,
  normalizeIdentityAnchorText,
} from "@/lib/v2-identity-anchor";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    const existing = await getClerkPublicMetadata(userId);
    if (existing?.onboardingCompleted === true) {
      return Response.json({ success: true });
    }

    const body = await req.json();

    const { preferred_name, people_summary, responsibility } = body;

    const preferredName =
      typeof preferred_name === "string" ? preferred_name.trim().replace(/\s+/g, " ") : "";
    if (!preferredName) {
      return Response.json(
        { error: "Add what Coach Pat should call you." },
        { status: 400 }
      );
    }

    const people =
      typeof people_summary === "string" ? people_summary.trim().replace(/\s+/g, " ") : "";
    if (!people) {
      return Response.json(
        { error: "Add who you’re trying to show up for right now." },
        { status: 400 }
      );
    }

    const responsibilityText =
      typeof responsibility === "string" ? responsibility.trim().replace(/\s+/g, " ") : "";
    if (!responsibilityText) {
      return Response.json(
        {
          error:
            "Add anything else Coach Pat should know about your family, team, or responsibilities.",
        },
        { status: 400 }
      );
    }

    const { data: existingProfile } = await supabaseServer
      .from("user_profiles")
      .select("identity_source, identity_anchor_text")
      .eq("clerk_user_id", userId)
      .maybeSingle();

    const preserveUserEditedIdentity =
      existingProfile?.identity_source === "user_edited" &&
      typeof existingProfile.identity_anchor_text === "string" &&
      existingProfile.identity_anchor_text.trim().length > 0;

    const upsertRow: Record<string, unknown> = {
      clerk_user_id: userId,
      preferred_name: preferredName,
      people_summary: people,
      responsibility: responsibilityText,
    };

    if (!preserveUserEditedIdentity) {
      const anchor = normalizeIdentityAnchorText(people);
      const nowIso = new Date().toISOString();
      if (anchor) {
        upsertRow.identity_anchor_text = anchor;
        upsertRow.identity_source = "onboarding_people_summary_v2";
        upsertRow.identity_last_confirmed_at = nowIso;
        upsertRow.identity_refresh_due_at = computeIdentityRefreshDueAtIsoFromNow();
      }
    }

    const { error } = await supabaseServer
      .from("user_profiles")
      .upsert(upsertRow, { onConflict: "clerk_user_id" });

    if (error) {
      console.error("Identity onboarding error:", error);
      return new Response("Database error", { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error(err);
    return new Response("Server error", { status: 500 });
  }
}
