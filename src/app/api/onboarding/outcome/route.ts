import { auth } from "@clerk/nextjs/server";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import {
  getOutcomesForArena,
  isArena,
  type Arena,
} from "@/lib/onboarding-config";

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
    const outcomeRaw = body?.outcome;

    const arenaText =
      typeof arenaRaw === "string" ? normalizeText(arenaRaw) : "";

    const outcome =
      typeof outcomeRaw === "string" ? normalizeText(outcomeRaw) : "";

    if (!arenaText) {
      return new Response(JSON.stringify({ error: "Arena is required" }), {
        status: 400,
      });
    }

    if (!outcome) {
      return new Response(JSON.stringify({ error: "Outcome is required" }), {
        status: 400,
      });
    }

    if (!isArena(arenaText)) {
      return new Response(JSON.stringify({ error: "Invalid arena" }), {
        status: 400,
      });
    }

    const arena: Arena = arenaText;

    const validOutcomes = getOutcomesForArena(arena);
    const isValidOutcome = validOutcomes.includes(outcome);

    if (!isValidOutcome) {
      return new Response(JSON.stringify({ error: "Invalid outcome" }), {
        status: 400,
      });
    }

    await updateClerkPublicMetadata(userId, {
      onboardingArena: arena,
      onboardingOutcome: outcome,
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("ONBOARDING OUTCOME ERROR:", err);

    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500,
    });
  }
}
