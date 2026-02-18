// src/app/api/admin/coach-audit/route.ts

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ======================================================
 * ADMIN: COACH AUDIT ENDPOINT
 * ------------------------------------------------------
 * Tyler-only visibility into:
 *  - Last 50 coach replies (SMS only)
 *  - Last 50 daily Coach Pat notes
 *  - Last 50 milestone SMS events
 *
 * This is observability only.
 * No mutations. No side effects.
 * ======================================================
 */

export async function GET() {
  try {
    // 🔐 Hard admin gate
    await requireTylerAdmin();

    // --------------------------------------------------
    // 1️⃣ Last 50 Coach Replies (SMS only via metadata)
    // --------------------------------------------------
    const { data: coachRepliesRaw, error: coachError } =
      await supabaseServer
        .from("coach_conversations")
        .select(
          "clerk_user_id, day_number, content, metadata, created_at"
        )
        .eq("role", "coach")
        .order("created_at", { ascending: false })
        .limit(100); // grab more, filter in memory

    if (coachError) {
      console.error(
        "COACH AUDIT - coach_conversations error:",
        coachError
      );
      return NextResponse.json(
        { ok: false, error: "coach_conversations_query_failed" },
        { status: 500 }
      );
    }

    const coachReplies =
      (coachRepliesRaw || [])
        .filter((row: any) => {
          const meta = row?.metadata;
          return (
            meta &&
            typeof meta === "object" &&
            meta?.source === "sms"
          );
        })
        .slice(0, 50);

    // --------------------------------------------------
    // 2️⃣ Last 50 Daily Coach Pat Notes
    // --------------------------------------------------
    const { data: dailyNotes, error: notesError } =
      await supabaseServer
        .from("coach_pat_daily_notes")
        .select(
          "clerk_user_id, day_number, note_text, model, day_key, created_at"
        )
        .order("created_at", { ascending: false })
        .limit(50);

    if (notesError) {
      console.error(
        "COACH AUDIT - coach_pat_daily_notes error:",
        notesError
      );
      return NextResponse.json(
        { ok: false, error: "coach_pat_daily_notes_query_failed" },
        { status: 500 }
      );
    }

    // --------------------------------------------------
    // 3️⃣ Last 50 Milestone SMS Events
    // --------------------------------------------------
    const { data: milestoneEventsRaw, error: milestoneError } =
      await supabaseServer
        .from("sms_send_events")
        .select("clerk_user_id, metadata, status, created_at")
        .order("created_at", { ascending: false })
        .limit(100); // grab 100 and filter in memory

    if (milestoneError) {
      console.error(
        "COACH AUDIT - sms_send_events error:",
        milestoneError
      );
      return NextResponse.json(
        { ok: false, error: "sms_send_events_query_failed" },
        { status: 500 }
      );
    }

    const milestoneOnly =
      (milestoneEventsRaw || [])
        .filter(
          (row: any) =>
            row?.metadata &&
            typeof row.metadata === "object" &&
            row.metadata.milestone === true
        )
        .slice(0, 50);

    // --------------------------------------------------
    // Final Response
    // --------------------------------------------------
    return NextResponse.json({
      ok: true,
      coachReplies,
      dailyCoachNotes: dailyNotes || [],
      milestoneEvents: milestoneOnly || [],
    });
  } catch (err: any) {
    console.error("COACH AUDIT ERROR:", err);

    const status =
      typeof err?.status === "number" ? err.status : 500;

    return NextResponse.json(
      { ok: false, error: err?.message || "unknown_error" },
      { status }
    );
  }
}
