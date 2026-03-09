import { NextResponse } from "next/server";
import { sendChallengeEmail } from "@/lib/send-challenge-email";
import { supabaseServer } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  if (secret !== "cron_8f3c9a1e5d2b7a6f0c4e9d8a7b6e5f1c") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: participants } = await supabaseServer
    .from("challenge_participants")
    .select("*")
    .eq("completed", false)
    .gte("challenge_day", 2)
    .lte("challenge_day", 7);

  const list = participants ?? [];
  let processed = 0;

  for (const participant of list) {
    try {
      await sendChallengeEmail(participant.email, participant.challenge_day);
    } catch (err) {
      console.error("Challenge email failed for", participant.email, err);
      continue;
    }

    const nextDay = participant.challenge_day + 1;
    await supabaseServer
      .from("challenge_participants")
      .update({
        challenge_day: nextDay,
        completed: nextDay > 7,
      })
      .eq("id", participant.id);

    processed++;
  }

  return NextResponse.json({ success: true, processed });
}
