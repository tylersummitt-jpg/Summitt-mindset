// src/app/api/cron/daily-sms/route.ts

import { NextResponse } from "next/server";
import { listClerkUsers } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { getOrCreateDailyCoachPatNote } from "@/lib/get-or-create-daily-coach-pat-note";
import { ensureDailyPrompt } from "@/lib/ensure-daily-prompt";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";
import { sendSMS, isTwilioReady } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

function normalizeText(input: string) {
  return (input || "").trim().replace(/\s+/g, " ");
}

function isWithinSendWindow(local: Date, preference?: string) {
  const hour = local.getHours();

  if (!preference || preference === "morning") return hour === 8;
  if (preference === "afternoon") return hour === 12;
  if (preference === "evening") return hour === 18;

  return hour === 8;
}

function dayKeyToDate(key: string): Date {
  // key format: YYYY-MM-DD
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function diffInDays(a: string, b: string) {
  const d1 = dayKeyToDate(a);
  const d2 = dayKeyToDate(b);
  const ms = d1.getTime() - d2.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * ======================================================
 * TWILIO APPROVAL SIGNAL
 * ======================================================
 * Outbound messages should identify sender + STOP/HELP.
 * This footer is short and safe to include in every message.
 */
function withComplianceFooter(body: string) {
  const footer = "\n\n— Summitt Mindset\nReply STOP to opt out. Reply HELP for help.";
  return `${body}${footer}`;
}

export async function GET(req: Request) {
  const secret = req.headers.get("x-cron-secret");

  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const pageLimit = 200;
  let offset = 0;

  while (true) {
    const users = await listClerkUsers({ limit: pageLimit, offset });
    if (!users || users.length === 0) break;

    for (const user of users) {
      const md = user.public_metadata || {};

      if (md.summittSubscribed !== true) continue;
      if (md.smsEnabled !== true) continue;

      const { data: identity } = await supabaseServer
        .from("sms_identities")
        .select("phone_number, sms_enabled, stopped_at")
        .eq("clerk_user_id", user.id)
        .maybeSingle();

      if (!identity?.phone_number) continue;
      if (identity.sms_enabled !== true) continue;
      if (typeof identity.stopped_at === "string") continue;

      const phone = identity.phone_number;

      const timezone = resolveUserTimezone(md.timezone);
      const now = new Date();
      const localNow = new Date(
        now.toLocaleString("en-US", { timeZone: timezone })
      );

      if (!isWithinSendWindow(localNow, md.smsTimePreference)) continue;

      const todayKey = getDateKeyInTimezone(localNow, timezone);

      const { data: existing } = await supabaseServer
        .from("sms_send_events")
        .select("id")
        .eq("clerk_user_id", user.id)
        .eq("day_key", todayKey)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const dayNumber =
        typeof md.currentDay === "number" && md.currentDay > 0
          ? md.currentDay
          : 1;

      // --------------------------------------------------
      // Check last completion
      // --------------------------------------------------
      const { data: lastCompletion } = await supabaseServer
        .from("daily_completion_events")
        .select("day_key")
        .eq("clerk_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let smsBody: string;

      const lastDayKey = lastCompletion?.day_key ?? null;

      const missedDays = lastDayKey ? diffInDays(todayKey, lastDayKey) : 0;

      // --------------------------------------------------
      // RE-ENTRY MODE (2+ days missed)
      // --------------------------------------------------
      if (lastDayKey && missedDays >= 2) {
        smsBody =
          `Glad you're here.\n\n` +
          `No catching up.\n` +
          `No guilt.\n\n` +
          `Today is enough.\n\n` +
          `Reply with one honest sentence.\n` +
          `When you're ready, text DONE.`;
      } else {
        // --------------------------------------------------
        // NORMAL MODE
        // --------------------------------------------------
        const trainingCampTrack =
          md.trainingCampTrack === "women" ? "women" : "standard";

        const primaryGoal =
          typeof md.summittGoal === "string"
            ? normalizeText(md.summittGoal)
            : undefined;

        const ensured = await ensureDailyPrompt({
          userId: user.id,
          dayNumber,
          trainingCampTrack,
          primaryGoal,
        });

        const note = await getOrCreateDailyCoachPatNote({
          userId: user.id,
          dayNumber,
        });

        const actionItem = normalizeText(ensured.actionItem);
        const coachNote = normalizeText(note.noteText);

        smsBody =
          `Good morning.\n` +
          `Day ${dayNumber}.\n\n` +
          `Today’s practice:\n${actionItem}\n\n` +
          `Coach Pat:\n${coachNote}\n\n` +
          `Reply with one honest sentence.\n` +
          `When you're ready, text DONE.`;
      }

      // ✅ Always append compliance footer
      smsBody = withComplianceFooter(smsBody);

      if (!isTwilioReady()) {
        await supabaseServer.from("sms_send_events").insert({
          clerk_user_id: user.id,
          day_key: todayKey,
          status: "skipped_missing_twilio",
          metadata: { canonical: true, intended_body: smsBody },
        });

        continue;
      }

      try {
        const message = await sendSMS({ to: phone, body: smsBody });

        await supabaseServer.from("sms_send_events").insert({
          clerk_user_id: user.id,
          day_key: todayKey,
          message_sid: message.sid,
          status: message.status,
          metadata: { canonical: true },
        });
      } catch (err) {
        await supabaseServer.from("sms_send_events").insert({
          clerk_user_id: user.id,
          day_key: todayKey,
          status: "send_failed",
          metadata: { error: String(err) },
        });
      }
    }

    offset += users.length;
    if (users.length < pageLimit) break;
  }

  return NextResponse.json({ ok: true });
}
