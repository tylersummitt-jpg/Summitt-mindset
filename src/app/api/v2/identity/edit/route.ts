import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import {
  requireWeakAcceptForWarn,
  validateIdentityAnchorTiered,
  validateOtherTextTiered,
  validatePreferredNameTiered,
} from "@/lib/onboarding-intake-validation";
import {
  parseImportantPeopleFromBody,
} from "@/lib/onboarding-persist-identity";
import {
  IDENTITY_INGREDIENT_OTHER_ID,
  normalizeIngredientIds,
} from "@/lib/onboarding-identity-templates";
import { getActiveCommitment } from "@/lib/v2-commitment";
import {
  getPendingResolutionOrNull,
  isSmsInboundPendingResolutionActionable,
} from "@/lib/v2-guided-resolution";
import { loadIdentityEditDraft } from "@/lib/load-identity-edit-draft";
import { persistAppIdentityEdit } from "@/lib/v2-persist-identity-edit";
import { normalizeIdentityAnchorText } from "@/lib/v2-identity-anchor-validation";

export const dynamic = "force-dynamic";

const ROUTE = "/api/v2/identity/edit";

const UI_SESSION = "Your session expired. Please sign in again.";
const UI_SAVE_GENERIC = "We couldn’t save your identity. Please try again.";

function parseIntakeOrigin(raw: unknown): "user_written" | "generated" | "template" {
  if (raw === "generated" || raw === "template") return raw;
  return "user_written";
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: UI_SESSION }, { status: 401 });
    }

    const md = await getClerkPublicMetadata(userId);
    if (md?.onboardingCompleted !== true) {
      return NextResponse.json(
        { ok: false, error: "Complete onboarding before editing identity." },
        { status: 403 }
      );
    }

    const commitment = await getActiveCommitment(userId);
    if (!commitment?.id) {
      return NextResponse.json({ ok: false, error: "No active commitment" }, { status: 404 });
    }

    if (commitment.accountability_phase === "low_pressure_reactivation") {
      return NextResponse.json(
        { ok: false, error: "Identity edit is not available during low-pressure pause." },
        { status: 409 }
      );
    }

    const pending = getPendingResolutionOrNull(commitment);
    if (pending || isSmsInboundPendingResolutionActionable(commitment)) {
      return NextResponse.json(
        { ok: false, error: "Finish your pending check-in update before editing identity." },
        { status: 409 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const intakeWeakAccept = body.intake_weak_accept === true;

    const preferredTier = validatePreferredNameTiered(body.preferred_name);
    if (preferredTier.tier === "block") {
      return NextResponse.json({ ok: false, error: preferredTier.error }, { status: 400 });
    }

    const ingredientIds = normalizeIngredientIds(body.ingredient_ids);
    const otherTextRaw =
      typeof body.other_text === "string" ? body.other_text.trim() : "";
    if (ingredientIds.includes(IDENTITY_INGREDIENT_OTHER_ID) && otherTextRaw) {
      const otherTier = validateOtherTextTiered(otherTextRaw);
      if (otherTier.tier === "block") {
        return NextResponse.json({ ok: false, error: otherTier.error }, { status: 400 });
      }
    }

    const anchorTier = requireWeakAcceptForWarn(
      validateIdentityAnchorTiered(body.identity_anchor_text, { intakeWeakAccept }),
      intakeWeakAccept
    );
    if (anchorTier.tier === "block") {
      return NextResponse.json({ ok: false, error: anchorTier.error }, { status: 400 });
    }
    if (anchorTier.tier === "warn") {
      return NextResponse.json(
        {
          ok: false,
          error: anchorTier.error ?? "Use mine anyway to continue with this identity line.",
        },
        { status: 400 }
      );
    }

    const normalizedAnchor = normalizeIdentityAnchorText(body.identity_anchor_text);
    if (!normalizedAnchor) {
      return NextResponse.json({ ok: false, error: "Add who you are becoming." }, { status: 400 });
    }

    const preferredName =
      typeof body.preferred_name === "string"
        ? body.preferred_name.trim().replace(/\s+/g, " ")
        : "";

    const importantPeople = parseImportantPeopleFromBody(body.important_people);
    const replaceImportantPeople = body.replace_important_people !== false;

    const clarityScore =
      typeof body.clarity_score === "number" && Number.isFinite(body.clarity_score)
        ? Math.min(100, Math.max(0, Math.round(body.clarity_score)))
        : anchorTier.warnReason
          ? 55
          : 80;

    const expectedActiveVersionId =
      typeof body.expected_active_version_id === "string" &&
      body.expected_active_version_id.trim().length > 0
        ? body.expected_active_version_id.trim()
        : null;

    const draft = await loadIdentityEditDraft(userId);
    if (draft.activeIdentityVersionId && !expectedActiveVersionId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Your identity was updated elsewhere. Refresh and try again.",
          code: "missing_expected_version",
        },
        { status: 409 }
      );
    }

    const result = await persistAppIdentityEdit({
      clerkUserId: userId,
      preferredName,
      identityAnchorText: normalizedAnchor,
      ingredientIds,
      otherText: otherTextRaw ? otherTextRaw.slice(0, 400) : null,
      intakeOrigin: parseIntakeOrigin(body.intake_origin),
      useMineAnyway: intakeWeakAccept || body.use_mine_anyway === true,
      clarityScore,
      importantPeople,
      replaceImportantPeople,
      expectedActiveVersionId,
    });

    if (!result.ok) {
      const status = result.code === "version_conflict" ? 409 : 500;
      return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status });
    }

    return NextResponse.json({
      ok: true,
      versionId: result.versionId,
      identity_anchor_text: result.identityAnchorText,
    });
  } catch (err) {
    console.error(ROUTE, err);
    return NextResponse.json({ ok: false, error: UI_SAVE_GENERIC }, { status: 500 });
  }
}
