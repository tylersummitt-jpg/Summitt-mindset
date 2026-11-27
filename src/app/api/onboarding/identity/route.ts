import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { recordOnboardingApiEvent } from "@/lib/onboarding-journey-diagnostics.server";
import type { OnboardingDiagnosticErrorCode } from "@/lib/onboarding-journey-diagnostics";
import {
  requireWeakAcceptForWarn,
  validateIdentityAnchorTiered,
  validateOtherTextTiered,
  validatePreferredNameTiered,
} from "@/lib/onboarding-intake-validation";
import {
  parseImportantPeopleFromBody,
  persistOnboardingIdentity,
} from "@/lib/onboarding-persist-identity";
import { clearProposedCommitmentReviewAcknowledgment } from "@/lib/onboarding-reset-review-ack";
import { normalizeIdentityAnchorText } from "@/lib/v2-identity-anchor-validation";
import {
  IDENTITY_INGREDIENT_OTHER_ID,
  normalizeIngredientIds,
} from "@/lib/onboarding-identity-templates";

const ROUTE = "/api/onboarding/identity";

const UI_SESSION = "Your session expired. Please sign in again.";
const UI_SAVE_RETRY = "We couldn’t save this step. Please try again in a moment.";
const UI_SAVE_GENERIC = "We couldn’t save this step. Please try again.";

function parseIntakeOrigin(raw: unknown): "user_written" | "generated" | "template" {
  if (raw === "generated" || raw === "template") return raw;
  return "user_written";
}

export async function POST(req: Request) {
  let diagnosticUserId: string | null = null;
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: UI_SESSION }, { status: 401 });
    }
    diagnosticUserId = userId;

    const note = (
      outcome: "request_received" | "validation_blocked" | "save_failed",
      errorCode: OnboardingDiagnosticErrorCode = "none"
    ) => recordOnboardingApiEvent({ request: req, clerkUserId: userId, step: "identity", outcome, errorCode });

    await note("request_received");

    const existing = await getClerkPublicMetadata(userId);
    if (existing?.onboardingCompleted === true) {
      await note("save_failed", "forbidden");
      return NextResponse.json(
        { error: "Use Edit identity in Victory Room to update your identity." },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const intakeWeakAccept = body.intake_weak_accept === true;

    const preferredTier = validatePreferredNameTiered(body.preferred_name);
    if (preferredTier.tier === "block") {
      await note(
        "validation_blocked",
        preferredTier.error === "Add what Coach Pat should call you." ? "missing_name" : "invalid_input"
      );
      return Response.json({ error: preferredTier.error }, { status: 400 });
    }

    const ingredientIds = normalizeIngredientIds(body.ingredient_ids);
    const otherTextRaw =
      typeof body.other_text === "string" ? body.other_text.trim() : "";
    if (ingredientIds.includes(IDENTITY_INGREDIENT_OTHER_ID) && otherTextRaw) {
      const otherTier = validateOtherTextTiered(otherTextRaw);
      if (otherTier.tier === "block") {
        await note("validation_blocked", "invalid_input");
        return Response.json({ error: otherTier.error }, { status: 400 });
      }
    }

    const anchorTier = requireWeakAcceptForWarn(
      validateIdentityAnchorTiered(body.identity_anchor_text, { intakeWeakAccept }),
      intakeWeakAccept
    );
    if (anchorTier.tier === "block") {
      await note("validation_blocked", "invalid_input");
      return Response.json({ error: anchorTier.error }, { status: 400 });
    }
    if (anchorTier.tier === "warn") {
      await note("validation_blocked", "weak_anchor");
      return Response.json(
        { error: anchorTier.error ?? "Use mine anyway to continue with this identity line." },
        { status: 400 }
      );
    }

    const normalizedAnchor = normalizeIdentityAnchorText(body.identity_anchor_text);
    if (!normalizedAnchor) {
      await note("validation_blocked", "missing_anchor");
      return Response.json({ error: "Add who you are becoming." }, { status: 400 });
    }

    const preferredName =
      typeof body.preferred_name === "string"
        ? body.preferred_name.trim().replace(/\s+/g, " ")
        : "";

    const responsibilityRaw =
      typeof body.responsibility === "string" ? body.responsibility.trim() : "";
    const responsibility =
      responsibilityRaw.length > 0
        ? responsibilityRaw.slice(0, 500).replace(/\s+/g, " ")
        : null;

    const importantPeople = parseImportantPeopleFromBody(body.important_people);
    const replaceImportantPeople = body.replace_important_people !== false;

    const clarityScore =
      typeof body.clarity_score === "number" && Number.isFinite(body.clarity_score)
        ? Math.min(100, Math.max(0, Math.round(body.clarity_score)))
        : anchorTier.warnReason
          ? 55
          : 80;

    const result = await persistOnboardingIdentity({
      clerkUserId: userId,
      preferredName,
      identityAnchorText: normalizedAnchor,
      ingredientIds,
      otherText: otherTextRaw ? otherTextRaw.slice(0, 400) : null,
      intakeOrigin: parseIntakeOrigin(body.intake_origin),
      useMineAnyway: intakeWeakAccept || body.use_mine_anyway === true,
      clarityScore,
      importantPeople,
      responsibility,
      replaceImportantPeople,
    });

    if (!result.ok) {
      await note("save_failed", "persistence");
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    await clearProposedCommitmentReviewAcknowledgment(userId);

    return Response.json({
      ok: true,
      versionId: result.versionId,
      identity_anchor_text: normalizedAnchor,
    });
  } catch (err) {
    console.error(ROUTE, err);
    if (diagnosticUserId) {
      await recordOnboardingApiEvent({
        request: req,
        clerkUserId: diagnosticUserId,
        step: "identity",
        outcome: "save_failed",
        errorCode: "server",
      });
    }
    return NextResponse.json({ error: UI_SAVE_GENERIC }, { status: 500 });
  }
}
