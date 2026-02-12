import { auth } from "@clerk/nextjs/server";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { MISS_PLAN_OPTIONS } from "@/lib/onboarding-config";

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
    const missPlanRaw = body?.missPlan;

    const missPlan =
      typeof missPlanRaw === "string" ? normalizeText(missPlanRaw) : "";

    if (!missPlan) {
      return new Response(JSON.stringify({ error: "Reset plan is required" }), {
        status: 400,
      });
    }

    const isValid = (MISS_PLAN_OPTIONS as readonly string[]).includes(missPlan);

    if (!isValid) {
      return new Response(JSON.stringify({ error: "Invalid reset plan" }), {
        status: 400,
      });
    }

    await updateClerkPublicMetadata(userId, {
      onboardingMissPlan: missPlan,
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("ONBOARDING MISS PLAN ERROR:", err);

    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500,
    });
  }
}
