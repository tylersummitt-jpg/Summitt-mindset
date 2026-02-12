import { auth } from "@clerk/nextjs/server";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { TRAINING_THEMES } from "@/lib/onboarding-config";

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const body = await req.json().catch(() => ({}));
    const trainingThemes = body?.trainingThemes;

    if (!Array.isArray(trainingThemes)) {
      return new Response(
        JSON.stringify({ error: "trainingThemes must be an array" }),
        { status: 400 }
      );
    }

    /**
     * ======================================================
     * IMPORTANT
     * ======================================================
     *
     * TypeScript is picky when calling includes() against a
     * readonly union type array.
     *
     * So we use a Set<string> for validation.
     */
    const allowedSlugSet = new Set<string>(
      TRAINING_THEMES.map((t) => t.slug)
    );

    const cleaned = trainingThemes
      .filter((x: any) => typeof x === "string")
      .map((x: string) => normalizeText(x).toLowerCase())
      .filter(Boolean)
      .filter((slug: string) => allowedSlugSet.has(slug));

    // Deduplicate while preserving order
    const unique: string[] = [];
    const seen = new Set<string>();

    for (const slug of cleaned) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      unique.push(slug);
    }

    if (unique.length !== 3) {
      return new Response(
        JSON.stringify({ error: "You must select exactly 3" }),
        { status: 400 }
      );
    }

    await updateClerkPublicMetadata(userId, {
      trainingThemes: unique,
      onboardingTrainingFocusCompleted: true,
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("TRAINING FOCUS ERROR:", err);

    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500,
    });
  }
}
