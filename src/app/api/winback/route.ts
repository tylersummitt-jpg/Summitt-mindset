import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { verifyWinbackToken } from "@/lib/winback-token";

export const runtime = "nodejs";

/**
 * ======================================================
 * Post-Churn Winback Truth Intake (Stream C)
 * ======================================================
 *
 * Called from calm winback reflection form.
 *
 * Canonical:
 * - Accept signed token (no login required)
 * - Store real clerk_user_id when possible
 * - Fall back to "anonymous_winback" if token missing/invalid
 */

function normalizeText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().replace(/\s+/g, " ");
  return t.length ? t : null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const message = normalizeText(body?.message);
    const token = normalizeText(body?.token);

    if (!message) {
      return NextResponse.json(
        { ok: false, error: "Message required" },
        { status: 400 }
      );
    }

    // Default: anonymous (calm fallback)
    let clerk_user_id = "anonymous_winback";
    let token_status: string = "missing";

    if (token) {
      const verified = verifyWinbackToken(token);
      if (verified.ok) {
        clerk_user_id = verified.clerk_user_id;
        token_status = "verified";
      } else {
        token_status = `invalid:${verified.reason}`;
      }
    }

    await supabaseServer.from("feedback_events").insert({
      clerk_user_id,
      source: "email", // could be sms/email — we keep it "email" for now
      moment: "post_churn_winback",
      type: "churn",

      rating: null,
      sentiment: null,

      reason_code: "winback_reflection",
      message,

      share_permission: false,
      metadata: {
        canonical: true,
        token_status,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Winback error:", err);

    return NextResponse.json(
      { ok: false, error: "Server failed" },
      { status: 500 }
    );
  }
}
