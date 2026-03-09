import { NextResponse } from "next/server";
import { sendChallengeEmail } from "@/lib/send-challenge-email";
import { supabaseServer } from "@/lib/supabase-server";

export async function POST(request: Request) {
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400 }
    );
  }

  const email = typeof body.email === "string" ? body.email.trim() : undefined;
  if (!email) {
    return NextResponse.json(
      { error: "Email is required" },
      { status: 400 }
    );
  }

  const { error } = await supabaseServer
    .from("challenge_participants")
    .insert({
      email,
      challenge_day: 1,
      started_at: new Date().toISOString(),
      completed: false,
    });

  if (error) {
    const isDuplicateEmail =
      error.code === "23505" ||
      (error.message?.toLowerCase().includes("unique") ?? false);
    if (isDuplicateEmail) {
      return NextResponse.json({ success: true });
    }
    return NextResponse.json(
      { error: "Failed to save signup" },
      { status: 500 }
    );
  }

  try {
    await sendChallengeEmail(email, 1);
    await supabaseServer
      .from("challenge_participants")
      .update({ challenge_day: 2 })
      .eq("email", email);
  } catch (err) {
    console.error("Challenge email failed:", err);
  }

  return NextResponse.json({ success: true });
}
