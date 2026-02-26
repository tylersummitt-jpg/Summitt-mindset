import { NextResponse } from "next/server";
import { listClerkUsers } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { getOrCreateDailyCoachPatNote } from "@/lib/get-or-create-daily-coach-pat-note";
import { getOrCreateDailyPracticeVersion } from "@/lib/get-or-create-daily-practice-version";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";
import { sendSMS, isTwilioReady } from "@/lib/twilio";
import { getUserStalenessLevel } from "@/lib/get-user-staleness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;
const SMS_DRY_RUN = process.env.SMS_DRY_RUN === "true";

function isWithinFixed8amWindow(local: Date) {
  return local.getHours() === 8;
}

function withComplianceFooter(body: string) {
  return (
    body +
    "\n\n— Summitt Mindset\nReply STOP to opt out. Reply HELP for help."
  );
}

function getReentryLine(level: string): string | null {
  if (level === "short_idle") return "Just picking back up. That’s enough.";
  if (level === "medium_idle") return "No need to restart. Just continue.";
  if (level === "long_idle") return "You’re not behind. Let’s take this small.";
  return null;
}

export async function GET(req: Request) {
  // ✅ OFFICIAL VERCEL CRON AUTH PATTERN
  const authHeader = req.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
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

      if (!isWithinFixed8amWindow(localNow)) continue;

      const todayKey = getDateKeyInTimezone(now, timezone);

      // ✅ Reservation insert (prevents duplicate sends)
      const { error: reservationError } = await supabaseServer
        .from("sms_send_events")
        .insert({
          clerk_user_id: user.id,
          day_key: todayKey,
          status: "reserved",
        });

      if (reservationError) {
        // Likely duplicate
        continue;
      }

      const { data: completed } = await supabaseServer
        .from("daily_completion_events")
        .select("id")
        .eq("clerk_user_id", user.id)
        .eq("day_key", todayKey)
        .limit(1);

      if (completed && completed.length > 0) {
        await supabaseServer
          .from("sms_send_events")
          .update({ status: "skipped_already_completed" })
          .eq("clerk_user_id", user.id)
          .eq("day_key", todayKey);
        continue;
      }

      const dayNumber =
        typeof md.currentDay === "number" && md.currentDay > 0
          ? md.currentDay
          : 1;

      const { level } = getUserStalenessLevel({
        timezoneFromMetadata: md.timezone,
        lastCompletedAt: md.lastCompletedAt,
      });

      const version = await getOrCreateDailyPracticeVersion({
        userId: user.id,
        dayNumber,
      });

      const note = await getOrCreateDailyCoachPatNote({
        userId: user.id,
        dayNumber,
      });

      const reentryLine = getReentryLine(level);

      let smsBody = "";

      if (reentryLine) smsBody += `${reentryLine}\n\n`;

      smsBody +=
        `${note.noteText}\n\n` +
        `Today’s Practice\n\n` +
        `${version.actionItem}\n\n` +
        `Reflection\n\n` +
        `${version.reflectionPrompt}\n\n` +
        `Reply with one honest sentence.\n` +
        `When you're ready, text DONE.`;

      smsBody = withComplianceFooter(smsBody);

      if (!isTwilioReady() || SMS_DRY_RUN) {
        await supabaseServer
          .from("sms_send_events")
          .update({ status: SMS_DRY_RUN ? "dry_run" : "skipped_missing_twilio" })
          .eq("clerk_user_id", user.id)
          .eq("day_key", todayKey);
        continue;
      }

      try {
        const message = await sendSMS({ to: phone, body: smsBody });

        await supabaseServer
          .from("sms_send_events")
          .update({
            message_sid: message.sid,
            status: message.status,
          })
          .eq("clerk_user_id", user.id)
          .eq("day_key", todayKey);
      } catch (err) {
        await supabaseServer
          .from("sms_send_events")
          .update({
            status: "send_failed",
            metadata: { error: String(err) },
          })
          .eq("clerk_user_id", user.id)
          .eq("day_key", todayKey);
      }
    }

    offset += users.length;
    if (users.length < pageLimit) break;
  }

  return NextResponse.json({ ok: true });
}