import { auth } from "@clerk/nextjs/server";
import { generateIdentityOptions } from "@/lib/onboarding-generation";
import {
  normalizeIngredientIds,
  type IdentityGenerationContext,
} from "@/lib/onboarding-identity-templates";
import { buildPeopleSummaryMirror } from "@/lib/onboarding-people-summary";
import { parseImportantPeopleFromBody } from "@/lib/onboarding-persist-identity";

function normalizeGeneratedOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((option): option is string => typeof option === "string")
    .map((option) => option.trim().replace(/\s+/g, " "))
    .filter((option) => option.length >= 12);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const preferredName =
    typeof body.preferred_name === "string"
      ? body.preferred_name.trim().replace(/\s+/g, " ")
      : "";

  if (!preferredName) {
    return Response.json({ error: "Add your preferred name first." }, { status: 400 });
  }

  const people = parseImportantPeopleFromBody(body.important_people);
  const mirror = buildPeopleSummaryMirror(
    people.map((p) => ({ relationship_type: p.relationship_type }))
  );

  const draftRaw =
    typeof body.user_written_words === "string"
      ? body.user_written_words
      : typeof body.draft_identity_text === "string"
        ? body.draft_identity_text
        : "";
  const userWrittenWords = draftRaw.trim().replace(/\s+/g, " ").slice(0, 500) || null;

  const ctx: IdentityGenerationContext = {
    preferredName,
    ingredientIds: normalizeIngredientIds(body.ingredient_ids),
    otherText: typeof body.other_text === "string" ? body.other_text : null,
    peopleSummaryMirror: mirror,
    userWrittenWords,
  };

  let rawOptions: string[];
  try {
    rawOptions = await generateIdentityOptions(ctx);
  } catch (err) {
    console.error("[generate-identity-options] generation failed", err);
    return Response.json(
      { error: "Could not generate identity options right now." },
      { status: 503 }
    );
  }

  const options = normalizeGeneratedOptions(rawOptions);
  if (options.length === 0) {
    return Response.json(
      { error: "Could not generate identity options right now." },
      { status: 503 }
    );
  }

  return Response.json({ options: options.slice(0, 5) });
}
