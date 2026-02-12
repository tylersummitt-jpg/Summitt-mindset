import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireTylerAdmin } from "@/lib/admin-only";

/**
 * ======================================================
 * Unapprove Testimonial (Tyler Only)
 * ======================================================
 */

export const runtime = "nodejs";

export async function POST(req: Request) {
  await requireTylerAdmin();

  const body = await req.json();
  const id = body?.id;

  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Missing testimonial id" },
      { status: 400 }
    );
  }

  await supabaseServer
    .from("testimonials")
    .update({
      approved: false,
      approved_at: null,
    })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
