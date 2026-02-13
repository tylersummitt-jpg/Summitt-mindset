import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { verifyRescueToken } from "@/lib/rescue-token";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";

export const runtime = "nodejs";

/**
 * ======================================================
 * Rescue Intake (CANONICAL)
 * ======================================================
 *
 * Accepts a signed token (no login required)
 * Logs the choice and (if YES) flips microPracticeMode on
 */

function normalizeBool(v: unknown): boolean {
  return v === true;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const yes = normalizeBool(body?.yes);

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing token" }, { status: 400 });
    }

    const verified = verifyRescueToken(token);
    if (!verified.ok) {
      return NextResponse.json(
        { ok: false, error: "Invalid token", reason: verified.reason },
        { status: 401 }
      );
    }

    const clerk_user_id = verified.clerk_user_id;

    // Always log the response (truth ledger)
    await supabaseServer.from("feedback_events").insert({
      clerk_user_id,
      source: "sms",
      moment: yes ? "inactivity_rescue_yes" : "inactivity_rescue_no",
      type: "friction",
      rating: null,
      sentiment: null,
      reason_code: yes ? "micro_practice_requested" : "no_change",
      message: null,
      share_permission: false,
      metadata: { canonical: true },
    });

    if (yes) {
      // Flip a flag in Clerk so the Daily OS can respect it later
      const md = await getClerkPublicMetadata(clerk_user_id);
      await updateClerkPublicMetadata(clerk_user_id, {
        microPracticeMode: true,
        microPracticeModeSetAt: new Date().toISOString(),
        // keep any existing fields
        ...{},
      });

      // Optional: reset feedbackState ignoredCount (calm)
      if (md?.feedbackState) {
        await updateClerkPublicMetadata(clerk_user_id, {
          feedbackState: {
            ...md.feedbackState,
            ignoredCount: 0,
          },
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Server failed" }, { status: 500 });
  }
}
