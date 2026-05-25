import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/** Life Context fields only — must stay aligned with src/app/life-context/page.tsx. */
const PROFILE_GET_SELECT =
  "relationship_status, partner_name, children_summary, people_summary, responsibility, work_challenge, physical_state, health_goal, energy_obstacles, pressure_summary, proud_of, best_self_trigger, preferred_name";

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
      .select(PROFILE_GET_SELECT)
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
