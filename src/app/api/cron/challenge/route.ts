import { NextResponse } from "next/server";
import { sendChallengeEmail } from "@/lib/send-challenge-email";
import { supabaseServer } from "@/lib/supabase-server";

function getNext8AMEastern() {
  const now = new Date();
  const est = new Date(
    now.toLocaleString("en-US", { timeZone: "America/New_York" })
  );

  const next = new Date(est);
  next.setHours(8, 0, 0, 0);

  if (est >= next) {
    next.setDate(next.getDate() + 1);
  }

  return new Date(
    next.toLocaleString("en-US", { timeZone: "UTC" })
  ).toISOString();
}

async function handleCron(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  if (secret !== "cron_8f3c9a1e5d2b7a6f0c4e9d8a7b6e5f1c") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();

  const { data: participants } = await supabaseServer
    .from("challenge_participants")
    .select("*")
    .eq("completed", false)
    .gte("challenge_day", 2)
    .lte("challenge_day", 7)
    .lte("next_send_at", now);

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
        next_send_at: getNext8AMEastern(),
      })
      .eq("id", participant.id);

    processed++;
  }

  return NextResponse.json({ success: true, processed });
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
