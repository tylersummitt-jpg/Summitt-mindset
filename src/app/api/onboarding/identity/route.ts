import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import {
  computeIdentityRefreshDueAtIsoFromNow,
  isQuotableIdentitySource,
  isRelationshipDerivedIdentitySource,
  normalizeIdentityAnchorText,
  ONBOARDING_IDENTITY_ANCHOR_SOURCE,
  validateOnboardingIdentityAnchorInput,
} from "@/lib/v2-identity-anchor";

/**
 * POST /api/onboarding/identity
 *
 * Saves relationship context (people_summary, responsibility) separately from identity anchor.
 * Wave 8: identity_anchor_text from “who are you becoming?”
 * Wave 8.1: Do not overwrite user_edited / guided_resolution_identity / explicitly_confirmed /
 * onboarding_identity_anchor_v1 unless the submitted anchor validates and differs (intentional edit).
 * Relationship-derived sources may be replaced by a valid onboarding anchor.
 */
export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existing = await getClerkPublicMetadata(userId);
    if (existing?.onboardingCompleted === true) {
      return Response.json({ success: true });
    }

    const body = await req.json();

    const { preferred_name, people_summary, responsibility, identity_anchor_text } = body;

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

    const existingSource =
      typeof existingProfile?.identity_source === "string" ? existingProfile.identity_source.trim() : null;
    const existingNormalized = normalizeIdentityAnchorText(existingProfile?.identity_anchor_text);

    const hasTrustedProtectedAnchor =
      existingNormalized != null &&
      existingNormalized.length > 0 &&
      isQuotableIdentitySource(existingSource);

    const relationshipDerived = isRelationshipDerivedIdentitySource(existingSource);

    const upsertRow: Record<string, unknown> = {
      clerk_user_id: userId,
      preferred_name: preferredName,
      people_summary: people,
      responsibility: responsibilityText,
    };

    const nowIso = new Date().toISOString();

    const rawSubmitted = body.identity_anchor_text;
    const submittedKeyPresent = Object.prototype.hasOwnProperty.call(body, "identity_anchor_text");

    if (relationshipDerived || !hasTrustedProtectedAnchor) {
      const anchorValidation = validateOnboardingIdentityAnchorInput(identity_anchor_text);
      if (!anchorValidation.ok) {
        return Response.json({ error: anchorValidation.error }, { status: 400 });
      }
      upsertRow.identity_anchor_text = anchorValidation.normalized;
      upsertRow.identity_source = ONBOARDING_IDENTITY_ANCHOR_SOURCE;
      upsertRow.identity_last_confirmed_at = nowIso;
      upsertRow.identity_refresh_due_at = computeIdentityRefreshDueAtIsoFromNow();
    } else {
      if (!submittedKeyPresent) {
        /* Legacy / resume client without identity field — do not touch identity columns. */
      } else {
        const anchorValidation = validateOnboardingIdentityAnchorInput(rawSubmitted);
        if (!anchorValidation.ok) {
          /* Invalid submission: keep existing trusted anchor; still save relationship fields. */
        } else if (anchorValidation.normalized === existingNormalized) {
          /* Same normalized text — skip identity writes (preserve source + timestamps). */
        } else {
          upsertRow.identity_anchor_text = anchorValidation.normalized;
          upsertRow.identity_source = existingSource;
          upsertRow.identity_last_confirmed_at = nowIso;
          upsertRow.identity_refresh_due_at = computeIdentityRefreshDueAtIsoFromNow();
        }
      }
    }

    const { error } = await supabaseServer
      .from("user_profiles")
      .upsert(upsertRow, { onConflict: "clerk_user_id" });

    if (error) {
      console.error("Identity onboarding error:", error);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
