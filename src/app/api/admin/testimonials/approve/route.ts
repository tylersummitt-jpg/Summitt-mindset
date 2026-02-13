import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

/**
 * ======================================================
 * Approve Testimonial (Tyler Only)
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
      approved: true,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
