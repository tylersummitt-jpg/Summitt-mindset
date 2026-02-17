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

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

function isWithinSendWindow(local: Date, preference?: string) {
  const hour = local.getHours();

  if (!preference || preference === "morning") return hour === 8;
  if (preference === "afternoon") return hour === 12;
  if (preference === "evening") return hour === 18;

  return hour === 8;
}

export async function GET(req: Request) {
  const secret = req.headers.get("x-cron-secret");

  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json(
      { ok: false, reason: "unauthorized" },
      { status: 401 }
    );
  }

  const pageLimit = 200;
  let offset = 0;

  let scanned = 0;
  let attempted = 0;
  let sent = 0;

  let skippedWindow = 0;
  let skippedNoIdentity = 0;
  let skippedSmsDisabled = 0;
  let skippedStopped = 0;
  let skippedTwilio = 0;

  while (true) {
    const users = await listClerkUsers({ limit: pageLimit, offset });
    if (!users || users.length === 0) break;

    for (const user of users) {
      scanned += 1;

      const md = user.public_metadata || {};

      // Only active subs
      if (md.summittSubscribed !== true) continue;

      // Only sms enabled (Clerk)
      if (md.smsEnabled !== true) {
        skippedSmsDisabled += 1;
        continue;
      }

      // --------------------------------------------------
      // Pull identity from Supabase (SOURCE OF TRUTH FOR PHONE)
      // --------------------------------------------------
      const { data: identity, error: identityError } = await supabaseServer
        .from("sms_identities")
        .select("phone_number, sms_enabled, stopped_at")
        .eq("clerk_user_id", user.id)
        .maybeSingle();

      if (identityError) {
        console.error("SMS IDENTITY LOOKUP ERROR:", identityError);
      }

      // Must exist
      if (!identity?.phone_number) {
        skippedNoIdentity += 1;
        continue;
      }

      // Must be enabled (Supabase)
      if (identity.sms_enabled !== true) {
        skippedSmsDisabled += 1;
        continue;
      }

      // If STOPped, do not send
      if (typeof identity.stopped_at === "string") {
        skippedStopped += 1;
        continue;
      }

      const phone = identity.phone_number;

      // --------------------------------------------------
      // Local time check
      // --------------------------------------------------
      const timezone = resolveUserTimezone(md.timezone);
      const now = new Date();

      const localNow = new Date(
        now.toLocaleString("en-US", { timeZone: timezone })
      );

      if (!isWithinSendWindow(localNow, md.smsTimePreference)) {
        skippedWindow += 1;
        continue;
      }

      const todayKey = getDateKeyInTimezone(localNow, timezone);

      // --------------------------------------------------
      // once/day guard
      // --------------------------------------------------
      const { data: existing } = await supabaseServer
        .from("sms_send_events")
        .select("id")
        .eq("clerk_user_id", user.id)
        .eq("day_key", todayKey)
        .limit(1);

      if (existing && existing.length > 0) continue;

      attempted += 1;

      // --------------------------------------------------
      // Canonical day number
      // --------------------------------------------------
      const dayNumber =
        typeof md.currentDay === "number" && md.currentDay > 0
          ? md.currentDay
          : 1;

      // --------------------------------------------------
      // Ensure canonical prompt exists
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

      // --------------------------------------------------
      // Canonical Coach Pat note (persisted)
      // --------------------------------------------------
      const note = await getOrCreateDailyCoachPatNote({
        userId: user.id,
        dayNumber,
      });

      const actionItem = normalizeText(ensured.actionItem);
      const coachNote = normalizeText(note.noteText);

      const smsBody =
        `Good morning.\n` +
        `Day ${dayNumber}.\n\n` +
        `Today’s practice:\n${actionItem}\n\n` +
        `Coach Pat:\n${coachNote}\n\n` +
        `Reply with one honest sentence.\n` +
        `When you're ready, text DONE and I’ll mark it complete.`;

      // --------------------------------------------------
      // Twilio not ready (log attempt)
      // --------------------------------------------------
      if (!isTwilioReady()) {
        skippedTwilio += 1;

        await supabaseServer.from("sms_send_events").insert({
          clerk_user_id: user.id,
          day_key: todayKey,
          status: "skipped_missing_twilio",
          metadata: {
            canonical: true,
            intended_body: smsBody,
            smsTimePreference: md.smsTimePreference ?? null,
            timezone,
            dayNumber,
            phone_number: phone,
          },
        });

        continue;
      }

      // --------------------------------------------------
      // Send
      // --------------------------------------------------
      try {
        const message = await sendSMS({
          to: phone,
          body: smsBody,
        });

        await supabaseServer.from("sms_send_events").insert({
          clerk_user_id: user.id,
          day_key: todayKey,
          message_sid: message.sid,
          status: message.status,
          metadata: {
            canonical: true,
            timezone,
            smsTimePreference: md.smsTimePreference ?? null,
            dayNumber,
            phone_number: phone,
          },
        });

        sent += 1;
      } catch (err) {
        console.error("TWILIO SEND ERROR:", err);

        await supabaseServer.from("sms_send_events").insert({
          clerk_user_id: user.id,
          day_key: todayKey,
          status: "send_failed",
          metadata: {
            canonical: true,
            intended_body: smsBody,
            smsTimePreference: md.smsTimePreference ?? null,
            timezone,
            dayNumber,
            phone_number: phone,
            error: String(err),
          },
        });
      }
    }

    offset += users.length;
    if (users.length < pageLimit) break;
  }

  return NextResponse.json({
    ok: true,
    scanned,
    attempted,
    sent,
    skippedWindow,
    skippedNoIdentity,
    skippedSmsDisabled,
    skippedStopped,
    skippedTwilio,
  });
}
