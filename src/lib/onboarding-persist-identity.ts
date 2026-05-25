import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import { computeIdentityRefreshDueAtIsoFromNow } from "@/lib/v2-identity-anchor";
import { ONBOARDING_IDENTITY_ANCHOR_SOURCE } from "@/lib/v2-identity-anchor-validation";
import {
  buildPeopleSummaryMirror,
  isImportantPeopleRelationshipType,
  type ImportantPeopleRelationshipType,
} from "@/lib/onboarding-people-summary";

export type ImportantPersonInput = {
  display_name: string;
  relationship_type: ImportantPeopleRelationshipType;
};

export type PersistIdentityInput = {
  clerkUserId: string;
  preferredName: string;
  identityAnchorText: string;
  ingredientIds: string[];
  otherText: string | null;
  intakeOrigin: "user_written" | "generated" | "template";
  useMineAnyway: boolean;
  clarityScore: number | null;
  importantPeople: ImportantPersonInput[];
  responsibility: string | null;
  replaceImportantPeople: boolean;
};

export async function persistOnboardingIdentity(
  input: PersistIdentityInput
): Promise<{ ok: true; versionId: string } | { ok: false; error: string }> {
  const nowIso = new Date().toISOString();

  const { data: existingVersion } = await supabaseServer
    .from("user_identity_version")
    .select("id, version_number")
    .eq("clerk_user_id", input.clerkUserId)
    .eq("is_active", true)
    .maybeSingle();

  let versionId: string;

  if (existingVersion?.id) {
    const { error: updErr } = await supabaseServer
      .from("user_identity_version")
      .update({
        identity_anchor_text: input.identityAnchorText,
        intake_origin: input.intakeOrigin,
        ingredient_ids: input.ingredientIds,
        other_text: input.otherText,
        use_mine_anyway: input.useMineAnyway,
        clarity_score: input.clarityScore,
        updated_at: nowIso,
      })
      .eq("id", existingVersion.id);

    if (updErr) {
      console.error("[persist-identity] version update failed", updErr);
      return { ok: false, error: "We couldn’t save this step. Please try again." };
    }
    versionId = existingVersion.id;
  } else {
    const { data: inserted, error: insErr } = await supabaseServer
      .from("user_identity_version")
      .insert({
        clerk_user_id: input.clerkUserId,
        version_number: 1,
        identity_anchor_text: input.identityAnchorText,
        intake_origin: input.intakeOrigin,
        ingredient_ids: input.ingredientIds,
        other_text: input.otherText,
        use_mine_anyway: input.useMineAnyway,
        clarity_score: input.clarityScore,
        is_active: true,
      })
      .select("id")
      .maybeSingle();

    if (insErr || !inserted?.id) {
      console.error("[persist-identity] version insert failed", insErr);
      return { ok: false, error: "We couldn’t save this step. Please try again." };
    }
    versionId = inserted.id as string;
  }

  const mirror = buildPeopleSummaryMirror(
    input.importantPeople.map((p) => ({ relationship_type: p.relationship_type }))
  );

  const profileRow: Record<string, unknown> = {
    clerk_user_id: input.clerkUserId,
    preferred_name: input.preferredName,
    identity_anchor_text: input.identityAnchorText,
    active_identity_version_id: versionId,
    identity_source: ONBOARDING_IDENTITY_ANCHOR_SOURCE,
    identity_last_confirmed_at: nowIso,
    identity_refresh_due_at: computeIdentityRefreshDueAtIsoFromNow(),
    people_summary: mirror,
  };

  if (input.responsibility != null) {
    profileRow.responsibility = input.responsibility;
  }

  const { error: profErr } = await supabaseServer
    .from("user_profiles")
    .upsert(profileRow, { onConflict: "clerk_user_id" });

  if (profErr) {
    console.error("[persist-identity] profile upsert failed", profErr);
    return { ok: false, error: "We couldn’t save this step. Please try again." };
  }

  if (input.replaceImportantPeople) {
    await supabaseServer
      .from("important_people")
      .update({ is_active: false, removed_at: nowIso, updated_at: nowIso })
      .eq("clerk_user_id", input.clerkUserId)
      .eq("source", "onboarding")
      .is("removed_at", null);

    if (input.importantPeople.length > 0) {
      const rows = input.importantPeople.map((p) => ({
        clerk_user_id: input.clerkUserId,
        display_name: p.display_name,
        relationship_type: p.relationship_type,
        source: "onboarding",
        is_private: true,
        is_active: true,
      }));

      const { error: pplErr } = await supabaseServer.from("important_people").insert(rows);
      if (pplErr) {
        console.error("[persist-identity] important_people insert failed", pplErr);
        return { ok: false, error: "We couldn’t save this step. Please try again." };
      }
    }
  }

  return { ok: true, versionId };
}

export function parseImportantPeopleFromBody(
  raw: unknown
): ImportantPersonInput[] {
  if (!Array.isArray(raw)) return [];
  const out: ImportantPersonInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name =
      typeof rec.display_name === "string" ? rec.display_name.trim() : "";
    if (!name || name.length > 40) continue;
    const rel = rec.relationship_type;
    if (!isImportantPeopleRelationshipType(rel)) continue;
    out.push({ display_name: name, relationship_type: rel });
  }
  return out;
}
