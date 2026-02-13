import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

/**
 * ======================================================
 * Post-Churn Winback Scanner (CANONICAL)
 * ======================================================
 *
 * Finds users who canceled 7–14 days ago
 * and need a winback outreach.
 *
 * Email-first until Twilio is live.
 */

export const runtime = "nodejs";

export async function GET() {
  // 🔒 Tyler-only
  await requireTylerAdmin();

  const since = new Date();
  since.setDate(since.getDate() - 10);

  const sinceIso = since.toISOString();

  // ✅ Find cancellations older than 10 days
  const { data: churned } = await supabaseServer
    .from("feedback_events")
    .select("clerk_user_id, created_at, reason_code")
    .eq("moment", "cancel_attempt")
    .lte("created_at", sinceIso)
    .limit(20);

  return NextResponse.json({
    ok: true,
    candidates: churned || [],
    note: "Email these users: What would bring you back?",
  });
}
