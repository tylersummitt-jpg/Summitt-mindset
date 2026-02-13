import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

/**
 * ======================================================
 * List Testimonials (Tyler Only)
 * ======================================================
 */

export const runtime = "nodejs";

export async function GET() {
  await requireTylerAdmin();

  // ✅ Pending
  const { data: pending } = await supabaseServer
    .from("testimonials")
    .select("*")
    .eq("approved", false)
    .order("day_number", { ascending: true });

  // ✅ Approved
  const { data: approved } = await supabaseServer
    .from("testimonials")
    .select("*")
    .eq("approved", true)
    .order("approved_at", { ascending: false });

  return NextResponse.json({
    ok: true,
    pending: pending || [],
    approved: approved || [],
  });
}
