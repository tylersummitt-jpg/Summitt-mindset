import { auth } from "@clerk/nextjs/server";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { ARENAS } from "@/lib/onboarding-config";

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
    const arenaRaw = body?.arena;

    const arena = typeof arenaRaw === "string" ? normalizeText(arenaRaw) : "";

    if (!arena) {
      return new Response(JSON.stringify({ error: "Arena is required" }), {
        status: 400,
      });
    }

    // Deterministic validation
    const isValidArena = (ARENAS as readonly string[]).includes(arena);

    if (!isValidArena) {
      return new Response(JSON.stringify({ error: "Invalid arena" }), {
        status: 400,
      });
    }

    await updateClerkPublicMetadata(userId, {
      onboardingArena: arena,
      onboardingStarted: true,

      // --------------------------------------------------
      // NOTE TO SELF:
      // We intentionally keep summittGoal untouched for now.
      // We'll remove it later after the full onboarding rebuild
      // so we don't break any existing logic mid-migration.
      // --------------------------------------------------
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("ONBOARDING ARENA ERROR:", err);

    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500,
    });
  }
}
