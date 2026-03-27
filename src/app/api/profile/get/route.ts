import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/profile/get
 * Returns user_profiles row for the signed-in user, or { profile: {} } if none.
 */
export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { ok: false, profile: {} },
        { status: 401 }
      );
    }

    const { data, error } = await supabaseServer
      .from("user_profiles")
      .select("*")
      .eq("clerk_user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("profile get:", error.message);
      return NextResponse.json({ ok: true, profile: {} });
    }

    return NextResponse.json({
      ok: true,
      profile: data ?? {},
    });
  } catch (err) {
    console.error("profile get:", err);
    return NextResponse.json({ ok: true, profile: {} });
  }
}
