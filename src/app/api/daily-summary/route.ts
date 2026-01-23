import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseServer } from "@/lib/supabase-server";

/**
 * GET /api/daily-summary?day=X
 * Returns the stored daily summary for a given day (read-only)
 */
export async function GET(req: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const dayParam = searchParams.get("day");

  if (!dayParam) {
    return NextResponse.json({ error: "Day is required" }, { status: 400 });
  }

  const dayNumber = Number(dayParam);

  if (Number.isNaN(dayNumber)) {
    return NextResponse.json({ error: "Invalid day" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("daily_summaries")
    .select("daily_summaries")
    .eq("clerk_user_id", userId)
    .eq("day_number", dayNumber)
    .single();

  // PGRST116 = no rows found (which is OK)
  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    summary: data?.daily_summaries ?? "",
  });
}
