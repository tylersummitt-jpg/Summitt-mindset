import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { resolveEvolutionRecommendationForUser } from "@/lib/v2-commitment-evolution-recommendation";

export const dynamic = "force-dynamic";

/**
 * POST /api/v2/commitment-evolution
 * Body: { recommendationId: string, intent: "dismiss" | "accept" }
 * Marks a pending evolution recommendation row only (no commitment mutation).
 */
export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const recommendationId =
      typeof body.recommendationId === "string" ? body.recommendationId.trim() : "";
    const intent = body.intent === "dismiss" || body.intent === "accept" ? body.intent : null;

    if (!recommendationId || !intent) {
      return NextResponse.json(
        { ok: false, error: "recommendationId and intent (dismiss|accept) required" },
        { status: 400 }
      );
    }

    const result = await resolveEvolutionRecommendationForUser({
      userId,
      recommendationId,
      intent,
    });

    if (!result.ok) {
      const status = result.error === "not_found_or_not_pending" ? 404 : 500;
      return NextResponse.json({ ok: false, error: result.error }, { status });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[commitment-evolution] POST error", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
