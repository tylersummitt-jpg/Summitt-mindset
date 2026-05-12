// src/app/api/cron/weekly-sms/route.ts

import crypto from "crypto";
import { NextResponse } from "next/server";
import { listClerkUsers } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { resolveUserTimezone } from "@/lib/timezone";
import { generateWeeklySmsReflection } from "@/lib/weekly-sms-reflection-shadow";
import { getWeekKey } from "@/lib/weekly-sms-week-key";
import { sendSMS, isTwilioReady } from "@/lib/twilio";
import { resolveUserFullyOnV2ForCutoverMessaging } from "@/lib/v2-cutover-gates";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { isSmsInboundPendingResolutionActionable } from "@/lib/v2-guided-resolution";
import {
  buildV2WeeklyProofPack,
  generateV2WeeklyProofSmsBody,
  V2_WEEKLY_PROOF_PROMPT_VERSION,
} from "@/lib/v2-weekly-proof-sms";
import {
  buildV2SmsConversationContextPack,
  type V2SmsConversationContextPack,
} from "@/lib/v2-sms-conversation-context";
import { NORTH_STAR_SMS_LONG_FORM_MAX_LEN } from "@/lib/north-star-coach-sms";
import { buildWeeklySmsNorthStarContextPacket } from "@/lib/north-star-sms-context-packet";
import { finalizeNorthStarCoachSmsAsync } from "@/lib/north-star-coach-sms-openai";
import { refineMachineSmsBodyWithV3RefineLane } from "@/lib/v3-sms-machine-refine";
import { appendPreservedSmsSuffix, applyFinalVoiceOwnershipGate } from "@/lib/v3-sms-voice-ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;
const ENV_SMS_DRY_RUN = process.env.SMS_DRY_RUN === "true";

const PAT_PAUSE_INTROS = [
  "Time for a Pat Pause.",
  "Let’s take a Pat Pause.",
  "It’s your weekly Pat Pause.",
  "Time for our Sunday Pat Pause.",
] as const;

const WEEKLY_SMS_COMPLIANCE_FOOTER =
  "Reply STOP to opt out. Reply HELP for help.";

/**
 * ======================================================
 * CRON AUTH
 * ======================================================
 * Valid CRON_SECRET required. Accept either:
 * - x-cron-secret: <CRON_SECRET>
 * - Authorization: Bearer <CRON_SECRET> (Vercel scheduled crons)
 */
function timingSafeEqualUtf8(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function validateCronSecret(req: Request): boolean {
  if (!CRON_SECRET) return false;

  const xCron = req.headers.get("x-cron-secret");
  if (xCron && timingSafeEqualUtf8(xCron, CRON_SECRET)) return true;

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token && timingSafeEqualUtf8(token, CRON_SECRET)) return true;
  }

  return false;
}

/**
 * ======================================================
 * Sunday 12PM (noon) Local Logic
 * ======================================================
 */
function shouldSendNow(local: Date) {
  return (
    local.getDay() === 0 && // Sunday
    local.getHours() === 12 &&
    local.getMinutes() < 15
  );
}

export async function GET(req: Request) {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const dryRunOverride = url.searchParams.get("dryRun") === "1";
  const SMS_DRY_RUN = ENV_SMS_DRY_RUN || dryRunOverride;

  const stats = {
    scanned: 0,
    eligible: 0,
    reserved: 0,
    sent: 0,
    dryRun: 0,
    skippedNotTime: 0,
    skippedOptedOut: 0,
    skippedMissingIdentity: 0,
    skippedMissingTwilio: 0,
    /** Legacy-only counter retained at 0 — V2 weekly proof ships separately below. */
    skippedV2WeeklyDeferred: 0,
    v2WeeklyEligible: 0,
    skippedV2WeeklyPendingResolution: 0,
    skippedV2WeeklyDuplicate: 0,
    sentV2WeeklyProof: 0,
    failed: 0,
  };

  const pageLimit = 200;
  let offset = 0;

  while (true) {
    const users = await listClerkUsers({ limit: pageLimit, offset });
    if (!users || users.length === 0) break;

    for (const user of users) {
      stats.scanned++;

      const md = user.public_metadata || {};

      if (md.summittSubscribed !== true) continue;
      if (md.smsEnabled !== true) continue;

      const { data: identity } = await supabaseServer
        .from("sms_identities")
        .select("phone_number, sms_enabled, stopped_at")
        .eq("clerk_user_id", user.id)
        .maybeSingle();

      if (!identity?.phone_number) {
        stats.skippedMissingIdentity++;
        continue;
      }

      if (identity.sms_enabled !== true || identity.stopped_at) {
        stats.skippedOptedOut++;
        continue;
      }

      const timezone = resolveUserTimezone(md.timezone);
      const now = new Date();

      const localNow = new Date(
        now.toLocaleString("en-US", { timeZone: timezone })
      );

      if (!force && !shouldSendNow(localNow)) {
        stats.skippedNotTime++;
        continue;
      }

      const v2Gate = await resolveUserFullyOnV2ForCutoverMessaging(user.id);
      if (v2Gate.fullyOnV2) {
        stats.v2WeeklyEligible += 1;
        const weekKeyV2 = getWeekKey(localNow);
        const commitment = await getActiveCommitment(user.id);
        if (!commitment?.id) {
          continue;
        }
        if (isSmsInboundPendingResolutionActionable(commitment)) {
          stats.skippedV2WeeklyPendingResolution += 1;
          continue;
        }

        const { error: v2ResErr } = await supabaseServer
          .from("sms_weekly_send_events")
          .insert({
            clerk_user_id: user.id,
            week_key: weekKeyV2,
            status: "reserved",
          });

        if (v2ResErr) {
          stats.skippedV2WeeklyDuplicate += 1;
          continue;
        }

        const pack = await buildV2WeeklyProofPack({
          clerkUserId: user.id,
          commitment,
          localNow,
          timezone,
        });
        let weeklySmsThreadAppend: string | null = null;
        let convForNorthStar: V2SmsConversationContextPack | null = null;
        try {
          const conv = await buildV2SmsConversationContextPack({
            clerkUserId: user.id,
            commitmentId: commitment.id,
            commitment,
            timezone,
          });
          convForNorthStar = conv;
          weeklySmsThreadAppend = conv.recentTranscriptLines.slice(-5).join(" | ").slice(0, 700);
        } catch (e) {
          console.warn("[weekly-sms] sms_conversation_context_pack_failed", {
            commitment_id: commitment.id,
            message: e instanceof Error ? e.message : String(e),
          });
        }
        const { body: proofCore, aiUsed } = await generateV2WeeklyProofSmsBody(pack, {
          recentSmsThreadAppend: weeklySmsThreadAppend,
        });

        let proofStyled = proofCore.trim();
        let weeklyV3ReplySource: string | undefined;
        try {
          const pr = await refineMachineSmsBodyWithV3RefineLane({
            clerkUserId: user.id,
            messageSid: `weekly_proof:${user.id}:${weekKeyV2}`,
            commitment,
            timezone,
            inboundRaw: "[weekly_pat_pause]",
            machineBody: proofStyled,
            hintSource: "weekly_proof_core",
            ownedReplySource: "v3_weekly_proof_refined",
          });
          proofStyled = pr.body.trim();
          weeklyV3ReplySource = pr.replySource;
        } catch (e) {
          console.warn("[weekly-sms] v3_weekly_proof_refine_failed", {
            clerk_user_id: user.id,
            message: e instanceof Error ? e.message : String(e),
          });
        }

        const introV2 =
          PAT_PAUSE_INTROS[Math.floor(Math.random() * PAT_PAUSE_INTROS.length)];
        const preGateWeeklyV2 = `${introV2}\n\n${proofStyled}`;
        const weeklyNorthStarCtx = buildWeeklySmsNorthStarContextPacket({
          commitmentId: commitment.id,
          behaviorStatement: commitment.behavior_statement,
          transcriptSnippet: weeklySmsThreadAppend,
          transcriptLines: convForNorthStar?.recentTranscriptLines.slice(-8),
        });
        const gatedWeeklyV2 = await finalizeNorthStarCoachSmsAsync({
          proposedBody: preGateWeeklyV2,
          channel: "weekly_sms",
          preserveNewlines: true,
          maxLen: NORTH_STAR_SMS_LONG_FORM_MAX_LEN,
          behaviorStatement: commitment.behavior_statement,
          effectiveAskText: commitment.behavior_statement?.trim() ?? undefined,
          contextPacket: weeklyNorthStarCtx,
          replySource: weeklyV3ReplySource,
        });
        const voiceWeeklyV2 = await applyFinalVoiceOwnershipGate({
          proposedBody: gatedWeeklyV2.visibleBody,
          replySource: weeklyV3ReplySource,
          channel: "weekly_sms",
          activeCommitmentId: commitment.id,
          effectiveAsk: commitment.behavior_statement,
          behaviorStatement: commitment.behavior_statement,
          contextPacket: weeklyNorthStarCtx,
          northStarMeta: gatedWeeklyV2.meta,
          normalCoaching: true,
        });
        const finalBodyV2 = appendPreservedSmsSuffix(voiceWeeklyV2.body, WEEKLY_SMS_COMPLIANCE_FOOTER);

        const v2Metadata = {
          v2_weekly_proof_sms: true,
          commitment_id: commitment.id,
          week_start: pack.week_start,
          week_end: pack.week_end,
          yes_count: pack.yes_count,
          no_count: pack.no_count,
          partial_count: pack.partial_count,
          blocker_count: pack.blocker_count,
          check_sent_count: pack.check_sent_count,
          response_count: pack.response_count,
          silent_week: pack.silent_week,
          comeback_after_miss: pack.comeback_after_miss,
          ai_used: aiUsed,
          message_purpose: "weekly_proof_reflection",
          prompt_version: V2_WEEKLY_PROOF_PROMPT_VERSION,
          sms_context_pack_thread_used: Boolean(weeklySmsThreadAppend?.trim()),
          weekly_evolution_note_used: Boolean(pack.weekly_evolution_coaching_line?.trim()),
          north_star_gate: {
            original_body: gatedWeeklyV2.meta.originalBody,
            final_body: finalBodyV2,
            north_star_gate_source: gatedWeeklyV2.meta.source,
            north_star_gate_reasons: gatedWeeklyV2.meta.blockedReasons,
            openai_attempted: gatedWeeklyV2.meta.openaiAttempted,
            openai_failed_reason: gatedWeeklyV2.meta.openaiFailedReason ?? null,
            context_packet_used: gatedWeeklyV2.meta.contextPacketUsed,
            finalizer_version: gatedWeeklyV2.meta.finalizerVersion,
          },
          final_voice_gate: voiceWeeklyV2.metadata,
          compliance_suffix_preserved: true,
        } as const;

        if (!isTwilioReady() || SMS_DRY_RUN) {
          await supabaseServer
            .from("sms_weekly_send_events")
            .update({
              status: SMS_DRY_RUN ? "dry_run" : "skipped_missing_twilio",
              metadata: v2Metadata,
            })
            .eq("clerk_user_id", user.id)
            .eq("week_key", weekKeyV2);

          if (SMS_DRY_RUN) stats.dryRun++;
          else stats.skippedMissingTwilio++;
          continue;
        }

        try {
          const messageV2 = await sendSMS({
            to: identity.phone_number,
            body: finalBodyV2,
            lastOutbound: {
              clerkUserId: user.id,
              messageKind: "weekly",
            },
          });

          await supabaseServer
            .from("sms_weekly_send_events")
            .update({
              message_sid: messageV2.sid,
              status: messageV2.status,
              metadata: v2Metadata,
            })
            .eq("clerk_user_id", user.id)
            .eq("week_key", weekKeyV2);

          stats.sentV2WeeklyProof += 1;
        } catch (err) {
          await supabaseServer
            .from("sms_weekly_send_events")
            .update({
              status: "send_failed",
              metadata: { ...v2Metadata, error: String(err) },
            })
            .eq("clerk_user_id", user.id)
            .eq("week_key", weekKeyV2);

          stats.failed++;
        }
        continue;
      }

      try {
        await generateWeeklySmsReflection(user.id, timezone, localNow);
      } catch (e) {
        console.error("[weekly-sms-shadow] failed", {
          userId: user.id,
          error: String(e),
        });
      }

      stats.eligible++;

      const weekKey = getWeekKey(localNow);

      const { data: reflectionRow } = await supabaseServer
        .from("weekly_sms_reflections")
        .select("sms_body, status")
        .eq("clerk_user_id", user.id)
        .eq("week_key", weekKey)
        .maybeSingle();

      const reflectionSmsBodyTrimmed =
        typeof reflectionRow?.sms_body === "string"
          ? reflectionRow.sms_body.trim()
          : "";
      const validSmsBody =
        reflectionRow != null &&
        reflectionSmsBodyTrimmed.length > 50 &&
        reflectionRow.status !== "generation_failed";

      const { error: reservationError } = await supabaseServer
        .from("sms_weekly_send_events")
        .insert({
          clerk_user_id: user.id,
          week_key: weekKey,
          status: "reserved",
        });

      if (reservationError) continue;

      stats.reserved++;

      /**
       * Pull latest weekly summary
       */
      const { data: summary } = await supabaseServer
        .from("weekly_summaries")
        .select("weekly_summary")
        .eq("clerk_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const summaryText =
        summary?.weekly_summary ||
        "You showed up this week. That matters.";

      const smsBody =
        `I’ve been thinking about your week.\n\n` +
        `${summaryText}\n\n` +
        `You showed up. That matters more than you think.\n` +
        `Steady honesty with yourself is how this kind of change sticks.\n\n` +
        `I'm with you between check-ins.\n\n` +
        `Reply anytime.\n\n` +
        `${WEEKLY_SMS_COMPLIANCE_FOOTER}`;

      const legacyCommitment = await getActiveCommitment(user.id);

      let outgoingBase = validSmsBody ? reflectionSmsBodyTrimmed : smsBody;
      let legacyWeeklyV3Rs: string | undefined;
      if (legacyCommitment?.id) {
        try {
          const lr = await refineMachineSmsBodyWithV3RefineLane({
            clerkUserId: user.id,
            messageSid: `weekly_legacy:${user.id}:${weekKey}`,
            commitment: legacyCommitment,
            timezone,
            inboundRaw: "[weekly_legacy_pat_pause]",
            machineBody: outgoingBase.trim(),
            hintSource: "weekly_legacy_body",
            ownedReplySource: "v3_weekly_proof_refined",
          });
          outgoingBase = lr.body;
          legacyWeeklyV3Rs = lr.replySource;
        } catch (e) {
          console.warn("[weekly-sms] v3_legacy_weekly_refine_failed", {
            clerk_user_id: user.id,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }

      const intro =
        PAT_PAUSE_INTROS[
          Math.floor(Math.random() * PAT_PAUSE_INTROS.length)
        ];

      let bodyForWrap = outgoingBase.trim();
      if (bodyForWrap.endsWith(WEEKLY_SMS_COMPLIANCE_FOOTER)) {
        bodyForWrap = bodyForWrap
          .slice(0, -WEEKLY_SMS_COMPLIANCE_FOOTER.length)
          .replace(/\s+$/, "");
      }

      const preGateLegacy = `${intro}\n\n${bodyForWrap}`;
      const legacyWeeklyCtx =
        legacyCommitment?.id != null
          ? buildWeeklySmsNorthStarContextPacket({
              commitmentId: legacyCommitment.id,
              behaviorStatement: legacyCommitment.behavior_statement,
              transcriptSnippet: null,
            })
          : { source: "weekly_sms" };
      const gatedLegacyWeekly = await finalizeNorthStarCoachSmsAsync({
        proposedBody: preGateLegacy,
        channel: "weekly_sms",
        preserveNewlines: true,
        maxLen: NORTH_STAR_SMS_LONG_FORM_MAX_LEN,
        contextPacket: legacyWeeklyCtx,
        replySource: legacyWeeklyV3Rs,
      });
      const voiceLegacyWeekly = await applyFinalVoiceOwnershipGate({
        proposedBody: gatedLegacyWeekly.visibleBody,
        replySource: legacyWeeklyV3Rs,
        channel: "weekly_sms",
        activeCommitmentId: legacyCommitment?.id ?? null,
        effectiveAsk: legacyCommitment?.behavior_statement ?? null,
        behaviorStatement: legacyCommitment?.behavior_statement ?? null,
        contextPacket: legacyCommitment?.id ? legacyWeeklyCtx : undefined,
        northStarMeta: gatedLegacyWeekly.meta,
        normalCoaching: Boolean(legacyCommitment?.id),
      });
      const finalBody = appendPreservedSmsSuffix(voiceLegacyWeekly.body, WEEKLY_SMS_COMPLIANCE_FOOTER);

      if (!isTwilioReady() || SMS_DRY_RUN) {
        await supabaseServer
          .from("sms_weekly_send_events")
          .update({
            status: SMS_DRY_RUN ? "dry_run" : "skipped_missing_twilio",
          })
          .eq("clerk_user_id", user.id)
          .eq("week_key", weekKey);

        if (SMS_DRY_RUN) stats.dryRun++;
        else stats.skippedMissingTwilio++;

        continue;
      }

      try {
        const message = await sendSMS({
          to: identity.phone_number,
          body: finalBody,
          lastOutbound: {
            clerkUserId: user.id,
            messageKind: "weekly",
          },
        });

        await supabaseServer
          .from("sms_weekly_send_events")
          .update({
            message_sid: message.sid,
            status: message.status,
            metadata: {
              north_star_gate: {
                original_body: gatedLegacyWeekly.meta.originalBody,
                final_body: finalBody,
                north_star_gate_source: gatedLegacyWeekly.meta.source,
                north_star_gate_reasons: gatedLegacyWeekly.meta.blockedReasons,
              },
              final_voice_gate: voiceLegacyWeekly.metadata,
              compliance_suffix_preserved: true,
            },
          })
          .eq("clerk_user_id", user.id)
          .eq("week_key", weekKey);

        stats.sent++;
      } catch (err) {
        await supabaseServer
          .from("sms_weekly_send_events")
          .update({
            status: "send_failed",
            metadata: { error: String(err) },
          })
          .eq("clerk_user_id", user.id)
          .eq("week_key", weekKey);

        stats.failed++;
      }
    }

    offset += users.length;
    if (users.length < pageLimit) break;
  }

  return NextResponse.json(stats);
}