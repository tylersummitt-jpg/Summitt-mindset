import "server-only";

import { buildPeopleSummaryMirror } from "@/lib/onboarding-people-summary";
import type { ImportantPersonInput } from "@/lib/onboarding-persist-identity";
import { loadIdentityEditDraft } from "@/lib/load-identity-edit-draft";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import { computeIdentityRefreshDueAtIsoFromNow } from "@/lib/v2-identity-anchor";
import { supabaseServer } from "@/lib/supabase-server";

const INTAKE_PEOPLE_SOURCES = ["onboarding", "edit"] as const;

export type PersistAppIdentityEditInput = {
  clerkUserId: string;
  preferredName: string;
  identityAnchorText: string;
  ingredientIds: string[];
  otherText: string | null;
  intakeOrigin: "user_written" | "generated" | "template";
  useMineAnyway: boolean;
  clarityScore: number | null;
  importantPeople: ImportantPersonInput[];
  replaceImportantPeople: boolean;
  expectedActiveVersionId?: string | null;
  coachingMemoryReasonCode?: string;
  identitySource?: "user_edited" | "explicitly_confirmed";
  skipCoachingMemoryRecompute?: boolean;
};

export type PersistAppIdentityEditErrorCode =
  | "version_conflict"
  | "save_failed"
  | "rollback_failed"
  | "identity_state_may_need_repair"
  | "identity_setup_incomplete";

export type PersistAppIdentityEditResult =
  | { ok: true; versionId: string; identityAnchorText: string }
  | { ok: false; error: string; code?: PersistAppIdentityEditErrorCode };

type RollbackStepResult = { ok: true } | { ok: false; step: string; message: string };

async function reactivatePreviousIdentityVersion(
  clerkUserId: string,
  previousActiveId: string,
  nowIso: string
): Promise<RollbackStepResult> {
  const { error } = await supabaseServer
    .from("user_identity_version")
    .update({ is_active: true, updated_at: nowIso })
    .eq("id", previousActiveId)
    .eq("clerk_user_id", clerkUserId);

  if (error) {
    console.error("[v2-persist-identity-edit] rollback reactivate previous failed", {
      clerk_user_id: clerkUserId,
      previous_active_id: previousActiveId,
      message: error.message,
    });
    return { ok: false, step: "reactivate_previous_version", message: error.message };
  }
  return { ok: true };
}

async function rollbackNewIdentityVersion(args: {
  clerkUserId: string;
  versionId: string;
  previousActiveId: string | null;
  nowIso: string;
}): Promise<RollbackStepResult> {
  const { error: deleteErr } = await supabaseServer
    .from("user_identity_version")
    .delete()
    .eq("id", args.versionId)
    .eq("clerk_user_id", args.clerkUserId);

  if (deleteErr) {
    console.error("[v2-persist-identity-edit] rollback delete new version failed", {
      clerk_user_id: args.clerkUserId,
      version_id: args.versionId,
      message: deleteErr.message,
    });
    return { ok: false, step: "delete_new_version", message: deleteErr.message };
  }

  if (args.previousActiveId) {
    return reactivatePreviousIdentityVersion(
      args.clerkUserId,
      args.previousActiveId,
      args.nowIso
    );
  }
  return { ok: true };
}

async function inactivateInsertedImportantPeople(
  clerkUserId: string,
  peopleIds: string[],
  nowIso: string
): Promise<RollbackStepResult> {
  if (peopleIds.length === 0) {
    return { ok: true };
  }

  const { error } = await supabaseServer
    .from("important_people")
    .update({ is_active: false, removed_at: nowIso, updated_at: nowIso })
    .eq("clerk_user_id", clerkUserId)
    .in("id", peopleIds);

  if (error) {
    console.error("[v2-persist-identity-edit] rollback inactivate inserted people failed", {
      clerk_user_id: clerkUserId,
      people_ids: peopleIds,
      message: error.message,
    });
    return { ok: false, step: "inactivate_inserted_people", message: error.message };
  }
  return { ok: true };
}

/**
 * Insert new edit rows first; only inactivate prior onboarding/edit rows after insert succeeds.
 * source='sms' is never queried or modified.
 */
async function replaceIntakeImportantPeople(args: {
  clerkUserId: string;
  importantPeople: ImportantPersonInput[];
  nowIso: string;
}): Promise<RollbackStepResult> {
  let newPeopleIds: string[] = [];

  if (args.importantPeople.length > 0) {
    const rows = args.importantPeople.map((p) => ({
      clerk_user_id: args.clerkUserId,
      display_name: p.display_name,
      relationship_type: p.relationship_type,
      source: "edit" as const,
      is_private: true,
      is_active: true,
    }));

    const { data: inserted, error: insertErr } = await supabaseServer
      .from("important_people")
      .insert(rows)
      .select("id");

    if (insertErr) {
      console.error("[v2-persist-identity-edit] important_people insert failed", insertErr);
      return { ok: false, step: "insert_important_people", message: insertErr.message };
    }

    newPeopleIds = (inserted ?? [])
      .map((row) => (typeof row.id === "string" ? row.id : null))
      .filter((id): id is string => Boolean(id));
  }

  let deactivateQuery = supabaseServer
    .from("important_people")
    .update({ is_active: false, removed_at: args.nowIso, updated_at: args.nowIso })
    .eq("clerk_user_id", args.clerkUserId)
    .in("source", [...INTAKE_PEOPLE_SOURCES])
    .is("removed_at", null);

  if (newPeopleIds.length > 0) {
    deactivateQuery = deactivateQuery.not("id", "in", `(${newPeopleIds.join(",")})`);
  }

  const { error: deactivateErr } = await deactivateQuery;

  if (deactivateErr) {
    console.error("[v2-persist-identity-edit] important_people deactivate prior failed", {
      clerk_user_id: args.clerkUserId,
      message: deactivateErr.message,
    });
    const rollback = await inactivateInsertedImportantPeople(
      args.clerkUserId,
      newPeopleIds,
      args.nowIso
    );
    if (!rollback.ok) {
      return {
        ok: false,
        step: "deactivate_prior_people_then_rollback_inserted",
        message: `${deactivateErr.message}; rollback: ${rollback.message}`,
      };
    }
    return { ok: false, step: "deactivate_prior_important_people", message: deactivateErr.message };
  }

  return { ok: true };
}

export async function persistAppIdentityEdit(
  input: PersistAppIdentityEditInput
): Promise<PersistAppIdentityEditResult> {
  const nowIso = new Date().toISOString();

  const { data: activeVersion, error: activeErr } = await supabaseServer
    .from("user_identity_version")
    .select("id, version_number")
    .eq("clerk_user_id", input.clerkUserId)
    .eq("is_active", true)
    .maybeSingle();

  if (activeErr) {
    console.error("[v2-persist-identity-edit] active version load failed", activeErr);
    return { ok: false, error: "We couldn’t save your identity. Please try again.", code: "save_failed" };
  }

  if (
    input.expectedActiveVersionId &&
    activeVersion?.id &&
    input.expectedActiveVersionId !== activeVersion.id
  ) {
    return {
      ok: false,
      error: "Your identity was updated elsewhere. Refresh and try again.",
      code: "version_conflict",
    };
  }

  const { data: maxVersionRow, error: maxErr } = await supabaseServer
    .from("user_identity_version")
    .select("version_number")
    .eq("clerk_user_id", input.clerkUserId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxErr) {
    console.error("[v2-persist-identity-edit] max version load failed", maxErr);
    return { ok: false, error: "We couldn’t save your identity. Please try again.", code: "save_failed" };
  }

  const nextVersionNumber = (maxVersionRow?.version_number ?? 0) + 1;
  const previousActiveId = activeVersion?.id ?? null;

  if (previousActiveId) {
    const { error: deactivateErr } = await supabaseServer
      .from("user_identity_version")
      .update({ is_active: false, updated_at: nowIso })
      .eq("id", previousActiveId)
      .eq("clerk_user_id", input.clerkUserId)
      .eq("is_active", true);

    if (deactivateErr) {
      console.error("[v2-persist-identity-edit] deactivate failed", deactivateErr);
      return { ok: false, error: "We couldn’t save your identity. Please try again.", code: "save_failed" };
    }
  }

  const { data: inserted, error: insErr } = await supabaseServer
    .from("user_identity_version")
    .insert({
      clerk_user_id: input.clerkUserId,
      version_number: nextVersionNumber,
      identity_anchor_text: input.identityAnchorText,
      intake_origin: input.intakeOrigin,
      ingredient_ids: input.ingredientIds,
      other_text: input.otherText,
      use_mine_anyway: input.useMineAnyway,
      clarity_score: input.clarityScore,
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id")
    .maybeSingle();

  if (insErr || !inserted?.id) {
    console.error("[v2-persist-identity-edit] insert failed", insErr);
    if (previousActiveId) {
      const rollback = await reactivatePreviousIdentityVersion(
        input.clerkUserId,
        previousActiveId,
        nowIso
      );
      if (!rollback.ok) {
        return {
          ok: false,
          error: "We couldn’t save your identity. Please refresh and try again.",
          code: "identity_state_may_need_repair",
        };
      }
    }
    return { ok: false, error: "We couldn’t save your identity. Please try again.", code: "save_failed" };
  }

  const versionId = inserted.id as string;
  const mirror = buildPeopleSummaryMirror(
    input.importantPeople.map((p) => ({ relationship_type: p.relationship_type }))
  );

  const profilePatch: Record<string, unknown> = {
    preferred_name: input.preferredName,
    identity_anchor_text: input.identityAnchorText,
    active_identity_version_id: versionId,
    identity_source: input.identitySource ?? "user_edited",
    identity_last_confirmed_at: nowIso,
    identity_refresh_due_at: computeIdentityRefreshDueAtIsoFromNow(),
  };
  if (input.replaceImportantPeople) {
    profilePatch.people_summary = mirror;
  }

  const { error: profErr } = await supabaseServer
    .from("user_profiles")
    .update(profilePatch)
    .eq("clerk_user_id", input.clerkUserId);

  if (profErr) {
    console.error("[v2-persist-identity-edit] profile update failed", profErr);
    const rollback = await rollbackNewIdentityVersion({
      clerkUserId: input.clerkUserId,
      versionId,
      previousActiveId,
      nowIso,
    });
    if (!rollback.ok) {
      return {
        ok: false,
        error: "We couldn’t save your identity. Please refresh and try again.",
        code: "identity_state_may_need_repair",
      };
    }
    return { ok: false, error: "We couldn’t save your identity. Please try again.", code: "save_failed" };
  }

  if (input.replaceImportantPeople) {
    const peopleResult = await replaceIntakeImportantPeople({
      clerkUserId: input.clerkUserId,
      importantPeople: input.importantPeople,
      nowIso,
    });
    if (!peopleResult.ok) {
      return {
        ok: false,
        error: "We couldn’t save your identity. Please try again.",
        code: "save_failed",
      };
    }
  }

  if (!input.skipCoachingMemoryRecompute) {
    const commitment = await getActiveCommitment(input.clerkUserId);
    if (commitment?.id) {
      const reasonCode = input.coachingMemoryReasonCode ?? "app_identity_edit";
      try {
        await recomputeV2CoachingMemory(commitment.id, { reasonCode });
      } catch (err) {
        console.warn("[v2-persist-identity-edit] coaching memory recompute failed", {
          commitment_id: commitment.id,
          clerk_user_id: input.clerkUserId,
          err,
        });
      }
    }
  }

  return {
    ok: true,
    versionId,
    identityAnchorText: input.identityAnchorText,
  };
}

/**
 * Guided-resolution identity anchor update: new version, preserve ingredients/people.
 */
export async function persistGuidedIdentityAnchorEdit(args: {
  clerkUserId: string;
  identityAnchorText: string;
}): Promise<PersistAppIdentityEditResult> {
  const draft = await loadIdentityEditDraft(args.clerkUserId);

  if (!draft.activeIdentityVersionId) {
    return {
      ok: false,
      error:
        "Your identity setup is incomplete. Use Edit identity in Victory Room to update your identity.",
      code: "identity_setup_incomplete",
    };
  }

  return persistAppIdentityEdit({
    clerkUserId: args.clerkUserId,
    preferredName: draft.preferredName ?? "",
    identityAnchorText: args.identityAnchorText,
    ingredientIds: draft.ingredientIds,
    otherText: draft.otherText,
    intakeOrigin: draft.intakeOrigin ?? "user_written",
    useMineAnyway: draft.useMineAnyway,
    clarityScore: draft.clarityScore,
    importantPeople: draft.importantPeople.map((person) => ({
      display_name: person.display_name,
      relationship_type: person.relationship_type,
    })),
    replaceImportantPeople: false,
    expectedActiveVersionId: draft.activeIdentityVersionId,
    coachingMemoryReasonCode: "guided_resolution_identity",
  });
}

/**
 * Wave11 SMS memory confirmation: versioned anchor update with SMS-confirmed source.
 * Coaching memory recompute is handled by the inbound memory-confirmation branch.
 */
export async function persistWave11ConfirmedIdentityAnchorEdit(args: {
  clerkUserId: string;
  identityAnchorText: string;
}): Promise<PersistAppIdentityEditResult> {
  const draft = await loadIdentityEditDraft(args.clerkUserId);

  if (!draft.activeIdentityVersionId) {
    return {
      ok: false,
      error:
        "Your identity setup is incomplete. Use Edit identity in Victory Room to update your identity.",
      code: "identity_setup_incomplete",
    };
  }

  return persistAppIdentityEdit({
    clerkUserId: args.clerkUserId,
    preferredName: draft.preferredName ?? "",
    identityAnchorText: args.identityAnchorText,
    ingredientIds: draft.ingredientIds,
    otherText: draft.otherText,
    intakeOrigin: draft.intakeOrigin ?? "user_written",
    useMineAnyway: draft.useMineAnyway,
    clarityScore: draft.clarityScore,
    importantPeople: draft.importantPeople.map((person) => ({
      display_name: person.display_name,
      relationship_type: person.relationship_type,
    })),
    replaceImportantPeople: false,
    expectedActiveVersionId: draft.activeIdentityVersionId,
    identitySource: "explicitly_confirmed",
    skipCoachingMemoryRecompute: true,
  });
}
