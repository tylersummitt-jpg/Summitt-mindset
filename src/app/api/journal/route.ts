import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";

/**
 * ======================================================
 * JOURNAL API (CANONICAL)
 * ======================================================
 *
 * DOMAIN CONTRACT
 * ------------------------------------------------------
 * - Journal reads/writes are NOT progression.
 * - Missing journal rows are expected states.
 * - Domain outcomes return 200 with explicit payloads.
 *
 * HTTP status codes are reserved for:
 * - 500 → true server errors only
 */

/**
 * ======================================================
 * GET — Load journal content for a given day
 * ======================================================
 */
export async function GET(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { ok: false, reason: "unauthenticated" },
        { status: 200 }
      );
    }

    const { searchParams } = new URL(req.url);
    const dayParam = searchParams.get("day");
    const dayNumber = Number(dayParam);

    if (!Number.isFinite(dayNumber)) {
      return NextResponse.json(
        { ok: false, reason: "invalid_day" },
        { status: 200 }
      );
    }

    const { data, error } = await supabaseServer
      .from("journal_entries")
      .select("content")
      .eq("clerk_user_id", userId)
      .eq("day_number", dayNumber)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, reason: "journal_lookup_failed" },
        { status: 200 }
      );
    }

    return NextResponse.json({
      ok: true,
      content: data?.content ?? "",
    });
  } catch (err) {
    console.error("[JOURNAL GET] SERVER ERROR:", err);

    return NextResponse.json(
      { ok: false, reason: "server_error" },
      { status: 500 }
    );
  }
}

/**
 * ======================================================
 * POST — Upsert journal entry (CANONICAL WRITE PATH)
 * ======================================================
 */
export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { ok: false, reason: "unauthenticated" },
        { status: 200 }
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, reason: "invalid_body" },
        { status: 200 }
      );
    }

    const {
      day,
      content,
      promptId,
      reflectionPrompt,
      actionItem,
      source = "app",
    } = body;

    if (typeof day !== "number" || typeof content !== "string") {
      return NextResponse.json(
        { ok: false, reason: "invalid_journal_payload" },
        { status: 200 }
      );
    }

    const md = await getClerkPublicMetadata(userId);
    const currentDay =
      typeof md?.currentDay === "number" && md.currentDay > 0
        ? Math.floor(md.currentDay)
        : null;

    if (currentDay === null || day !== currentDay) {
      return NextResponse.json(
        { ok: false, error: "invalid_day" },
        { status: 200 }
      );
    }

    const payload: any = {
      clerk_user_id: userId,
      day_number: day,
      content,
      reflection_prompt: reflectionPrompt,
      action_item: actionItem,
      source,
    };

    // Only attach prompt_id if valid UUID
    if (typeof promptId === "string" && promptId.length === 36) {
      payload.prompt_id = promptId;
    }

    const { error } = await supabaseServer
      .from("journal_entries")
      .upsert(payload, {
        onConflict: "clerk_user_id,day_number",
      });

    if (error) {
      return NextResponse.json(
        { ok: false, reason: "journal_write_failed" },
        { status: 200 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[JOURNAL POST] SERVER ERROR:", err);

    return NextResponse.json(
      { ok: false, reason: "server_error" },
      { status: 500 }
    );
  }
}
