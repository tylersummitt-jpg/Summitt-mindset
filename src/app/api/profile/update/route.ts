import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const ALLOWED_KEYS = [
  "relationship_status",
  "partner_name",
  "children_summary",
  "people_summary",
  "responsibility",
  "work_challenge",
  "physical_state",
  "health_goal",
  "energy_obstacles",
  "pressure_summary",
  "proud_of",
  "best_self_trigger",
  "preferred_name",
] as const;

/**
 * POST /api/profile/update
 * Partial upsert: only keys present in the JSON body are written.
 * omits undefined/null per-field so other columns are not touched.
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
      body = {};
    }

    if (Object.prototype.hasOwnProperty.call(body, "identity_anchor_text")) {
      return NextResponse.json(
        {
          ok: false,
          error: "Use Edit identity in Victory Room to update your identity.",
        },
        { status: 400 }
      );
    }

    const row: Record<string, unknown> = { clerk_user_id: userId };

    for (const key of ALLOWED_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;

      const raw = body[key];
      if (raw === undefined || raw === null) continue;
      if (typeof raw !== "string") continue;

      const trimmed = raw.trim();
      if (key === "preferred_name") {
        row[key] = trimmed === "" ? null : trimmed;
      } else {
        row[key] = trimmed;
      }
    }

    const dataKeys = Object.keys(row).filter((k) => k !== "clerk_user_id");
    if (dataKeys.length === 0) {
      return NextResponse.json({ ok: true, updated: false });
    }

    const { error } = await supabaseServer.from("user_profiles").upsert(row, {
      onConflict: "clerk_user_id",
    });

    if (error) {
      console.error("profile update:", error.message);
      return NextResponse.json(
        { ok: false, error: "Database error" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, updated: true });
  } catch (err) {
    console.error("profile update:", err);
    return NextResponse.json(
      { ok: false, error: "Server error" },
      { status: 500 }
    );
  }
}
