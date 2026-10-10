import { NextResponse } from "next/server";

import { recoveryTokenHash } from "@/lib/recovery-engine";
import { supabaseServer } from "@/lib/supabase-server";

export async function POST(request: Request) {
  return unsubscribe(request);
}

export async function GET(request: Request) {
  return unsubscribe(request);
}

async function unsubscribe(request: Request) {
  const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  if (!token) {
    return NextResponse.json({ ok: false, message: "This unsubscribe link is not valid." }, { status: 400 });
  }
  const tokenHash = recoveryTokenHash(token);
  const { data, error } = await supabaseServer
    .from("recovery_messages")
    .select("id, enrollment_id")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error || !data?.enrollment_id) {
    return NextResponse.json(
      { ok: false, message: "This unsubscribe link is not valid." },
      { status: 400 }
    );
  }
  const { data: enrollment } = await supabaseServer
    .from("recovery_enrollments")
    .select("email_normalized")
    .eq("id", data.enrollment_id)
    .maybeSingle();
  const email = enrollment?.email_normalized;
  if (typeof email === "string" && email.includes("@")) {
    await supabaseServer.from("recovery_suppressions").insert({
      email_normalized: email,
      reason: "unsubscribe",
      token_hash: tokenHash,
    });
  }
  await supabaseServer
    .from("recovery_enrollments")
    .update({ status: "stopped", stop_reason: "unsubscribe" })
    .eq("id", data.enrollment_id)
    .eq("status", "active");
  await supabaseServer
    .from("recovery_messages")
    .update({ status: "canceled" })
    .eq("enrollment_id", data.enrollment_id)
    .in("status", ["scheduled", "claimed"]);
  return NextResponse.json({
    ok: true,
    message: "You will not receive more Summitt Mindset recovery emails.",
  });
}
