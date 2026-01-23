import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseServer } from "@/lib/supabase-server";

/**
 * ======================================================
 * GET — Load journal content for a given day
 * ======================================================
 */
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const dayParam = searchParams.get("day");
  const dayNumber = Number(dayParam);

  if (!Number.isFinite(dayNumber)) {
    return NextResponse.json({ error: "Invalid day" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("journal_entries")
    .select("content")
    .eq("clerk_user_id", userId)
    .eq("day_number", dayNumber)
    .single();

  // PGRST116 = no rows found (acceptable for first load)
  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ content: data?.content ?? "" });
}

/**
 * ======================================================
 * POST — Upsert journal entry (canonical write path)
 * ======================================================
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const {
    day,
    content,
    promptId,
    reflectionPrompt,
    actionItem,
    source = "app",
  } = body;

  /**
   * --------------------------------------------------
   * Validate required fields
   * --------------------------------------------------
   */
  if (typeof day !== "number" || typeof content !== "string") {
    return NextResponse.json(
      { error: "Invalid journal payload" },
      { status: 400 }
    );
  }

  /**
   * --------------------------------------------------
   * Build payload safely
   * --------------------------------------------------
   * - UUIDs only go into UUID columns
   * - Semantic IDs (e.g. "is-day-31") are ignored
   * - (clerk_user_id, day_number) is the true identity
   */
  const payload: any = {
    clerk_user_id: userId,
    day_number: day,
    content,
    reflection_prompt: reflectionPrompt,
    action_item: actionItem,
    source,
  };

  // Only attach prompt_id if it is a valid UUID
  if (typeof promptId === "string" && promptId.length === 36) {
    payload.prompt_id = promptId;
  }

  /**
   * --------------------------------------------------
   * Upsert journal entry
   * --------------------------------------------------
   */
  const { error } = await supabaseServer
    .from("journal_entries")
    .upsert(payload, {
      onConflict: "clerk_user_id,day_number",
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
