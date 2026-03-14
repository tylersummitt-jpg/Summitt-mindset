import { NextResponse } from "next/server";
import { sendChallengeEmail } from "@/lib/send-challenge-email";
import { supabaseServer } from "@/lib/supabase-server";
import { getNext8AMEastern } from "@/lib/timezone";

const CRON_SECRET = process.env.CRON_SECRET;

function validateCronSecret(req: Request) {
  const vercelCronHeader = req.headers.get("x-vercel-cron");
  const isVercelCron =
    vercelCronHeader === "1" ||
    vercelCronHeader === "true" ||
    vercelCronHeader === "True" ||
    vercelCronHeader === "yes" ||
    vercelCronHeader === "on";

  if (isVercelCron) return true;

  if (!CRON_SECRET) return false;

  const header = req.headers.get("x-cron-secret");
  if (header && header === CRON_SECRET) return true;

  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (secret && secret === CRON_SECRET) return true;

  return false;
}

async function handleCron(request: Request) {
  if (!validateCronSecret(request)) {
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
    const { data: updated } = await supabaseServer
      .from("challenge_participants")
      .update({
        challenge_day: nextDay,
        completed: nextDay > 7,
        next_send_at: getNext8AMEastern(),
        last_sent_at: new Date().toISOString(),
      })
      .eq("id", participant.id)
      .eq("challenge_day", participant.challenge_day)
      .select("id");

    if (updated && updated.length > 0) {
      processed++;
    }
  }

  return NextResponse.json({ success: true, processed });
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
