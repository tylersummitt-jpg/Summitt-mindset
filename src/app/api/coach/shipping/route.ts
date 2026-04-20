/* eslint-disable no-console */

import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { supabaseServer } from "@/lib/supabase-server";
import { notifyCoachKitSubmitted } from "@/lib/notify-coach-kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSubscribedFromMetadata(md: Record<string, unknown>): boolean {
  const subscribedRaw = md?.summittSubscribed;
  const plan = md?.summittPlan;
  return (
    subscribedRaw === true ||
    subscribedRaw === "true" ||
    plan === "monthly" ||
    plan === "annual"
  );
}

function requireNonEmptyString(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  if (t.length > maxLen) return null;
  return t;
}

/**
 * POST /api/coach/shipping
 * Authenticated coaches only; persists address to Supabase; sets coachAddressCollected in Clerk.
 */
export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const md = await getClerkPublicMetadata(userId);
    if (md?.acquisitionSource !== "coach") {
      return NextResponse.json(
        { ok: false, error: "Not allowed" },
        { status: 403 }
      );
    }

    if (!isSubscribedFromMetadata(md)) {
      return NextResponse.json(
        { ok: false, error: "Subscription required" },
        { status: 403 }
      );
    }

    if (md?.coachAddressCollected === true) {
      return NextResponse.json(
        { ok: false, error: "Address already submitted" },
        { status: 409 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const full_name = requireNonEmptyString(body.full_name, 200);
    const address_line_1 = requireNonEmptyString(body.address_line_1, 500);
    const city = requireNonEmptyString(body.city, 200);
    const state = requireNonEmptyString(body.state, 100);
    const postal_code = requireNonEmptyString(body.postal_code, 32);
    const country = requireNonEmptyString(body.country, 100);

    let line2: string | null = null;
    if (typeof body.address_line_2 === "string") {
      const t = body.address_line_2.trim();
      if (t.length > 500) {
        return NextResponse.json(
          { ok: false, error: "Invalid address line 2" },
          { status: 400 }
        );
      }
      line2 = t || null;
    }

    if (
      !full_name ||
      !address_line_1 ||
      !city ||
      !state ||
      !postal_code ||
      !country
    ) {
      return NextResponse.json(
        { ok: false, error: "Missing or invalid required fields" },
        { status: 400 }
      );
    }

    const user = await currentUser();
    const email =
      user?.emailAddresses?.[0]?.emailAddress?.trim() || "";
    if (!email) {
      return NextResponse.json(
        { ok: false, error: "Unable to read email" },
        { status: 500 }
      );
    }

    const now = new Date().toISOString();

    const { error: upsertError } = await supabaseServer
      .from("coach_shipping_addresses")
      .upsert(
        {
          clerk_user_id: userId,
          email,
          full_name,
          address_line_1,
          address_line_2: line2,
          city,
          state,
          postal_code,
          country,
          updated_at: now,
        },
        { onConflict: "clerk_user_id" }
      );

    if (upsertError) {
      console.error("coach_shipping_addresses upsert:", upsertError);
      return NextResponse.json(
        { ok: false, error: "Unable to save address" },
        { status: 500 }
      );
    }

    try {
      await updateClerkPublicMetadata(userId, {
        coachAddressCollected: true,
      });
    } catch (err) {
      console.error("Failed to set coachAddressCollected:", err);
      return NextResponse.json(
        { ok: false, error: "Saved address but could not update profile" },
        { status: 500 }
      );
    }

    const addressSummary = [
      address_line_1,
      line2,
      `${city}, ${state} ${postal_code}`,
      country,
    ]
      .filter(Boolean)
      .join("\n");

    await notifyCoachKitSubmitted({
      clerkUserId: userId,
      email,
      fullName: full_name,
      addressSummary,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/coach/shipping:", err);
    return NextResponse.json(
      { ok: false, error: "Server error" },
      { status: 500 }
    );
  }
}
