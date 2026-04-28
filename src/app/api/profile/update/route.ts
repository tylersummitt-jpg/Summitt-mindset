import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import {
  computeIdentityRefreshDueAtIsoFromNow,
  normalizeIdentityAnchorText,
} from "@/lib/v2-identity-anchor";

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
  "identity_anchor_text",
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

    const row: Record<string, unknown> = { clerk_user_id: userId };

    for (const key of ALLOWED_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;

      const raw = body[key];
      if (raw === undefined || raw === null) continue;
      if (typeof raw !== "string") continue;

      if (key === "identity_anchor_text") {
        const normalized = normalizeIdentityAnchorText(raw);
        const nowIso = new Date().toISOString();
        if (!normalized) {
          row.identity_anchor_text = null;
          row.identity_source = null;
          row.identity_last_confirmed_at = null;
          row.identity_refresh_due_at = null;
          row.identity_last_referenced_at = null;
        } else {
          row.identity_anchor_text = normalized;
          row.identity_source = "user_edited";
          row.identity_last_confirmed_at = nowIso;
          row.identity_refresh_due_at = computeIdentityRefreshDueAtIsoFromNow();
        }
        continue;
      }

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
