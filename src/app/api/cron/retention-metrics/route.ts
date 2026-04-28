// src/app/api/cron/retention-metrics/route.ts
//
// Staleness for users on the V2 accountability path uses the latest `v2_commitment_event`
// timestamp (fallback: Clerk `lastCompletedAt` when the spine has no rows yet).
// "completions" in rollups counts any spine activity today for V2; legacy users still use
// `daily_completion_events` for that column name.
// "inbound" rollups count rows in `sms_inbound_messages` (Twilio-delivered user SMS) today UTC—
// not in-app `coach_conversations`.
// Dual-write: `retention_staleness_basis`, `last_v2_spine_activity_at`, `hours_since_v2_spine` and
// rollup `v2_spine_touches_today` / `legacy_daily_completion_touches_today` — see migration
// 20260503120000_retention_reporting_truth_columns.sql and COMMENT ON in Supabase.

import { NextResponse } from "next/server";
import { validateCronSecretRequest } from "@/lib/cron-auth";
import { listClerkUsers } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { resolveUserFullyOnV2ForCutoverMessaging } from "@/lib/v2-cutover-gates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StalenessMode = "fresh" | "normal" | "reentry" | "never";

function computeHoursSince(stamp?: string): number | null {
  if (!stamp) return null;
  const d = new Date(stamp);
  if (Number.isNaN(d.getTime())) return null;
  const hours = (Date.now() - d.getTime()) / (1000 * 60 * 60);
  return Number.isFinite(hours) ? Math.max(0, hours) : null;
}

function bucket(hours: number | null): StalenessMode {
  if (hours === null) return "never";
  if (hours <= 36) return "fresh";
  if (hours <= 96) return "normal";
  return "reentry";
}

function dayKeyUTC(now = new Date()): string {
  // UTC YYYY-MM-DD
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function utcDayStartIsoFromDayKey(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString();
}

function riskScoreFrom(hours: number | null): number {
  if (hours === null) return 30; // new/unknown users
  if (hours <= 36) return 0;
  if (hours <= 96) return 10;
  if (hours <= 240) return 25; // 4–10 days
  return 40; // 10+ days
}

export async function GET(req: Request) {
  if (!validateCronSecretRequest(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const today = dayKeyUTC(new Date());

  const counts: Record<
    StalenessMode,
    {
      users: number;
      completions: number;
      v2SpineTouches: number;
      legacyDailyCompletionTouches: number;
      smsSent: number;
      inbound: number;
    }
  > = {
    fresh: { users: 0, completions: 0, v2SpineTouches: 0, legacyDailyCompletionTouches: 0, smsSent: 0, inbound: 0 },
    normal: { users: 0, completions: 0, v2SpineTouches: 0, legacyDailyCompletionTouches: 0, smsSent: 0, inbound: 0 },
    reentry: { users: 0, completions: 0, v2SpineTouches: 0, legacyDailyCompletionTouches: 0, smsSent: 0, inbound: 0 },
    never: { users: 0, completions: 0, v2SpineTouches: 0, legacyDailyCompletionTouches: 0, smsSent: 0, inbound: 0 },
  };

  const pageLimit = 200;
  let offset = 0;

  while (true) {
    const users = await listClerkUsers({ limit: pageLimit, offset });
    if (!users || users.length === 0) break;

    for (const u of users) {
      const md = u.public_metadata || {};

      // Only measure active product users (subscribed)
      if (md.summittSubscribed !== true) continue;

      const gate = await resolveUserFullyOnV2ForCutoverMessaging(u.id);

      let hours: number | null;
      let lastV2SpineActivityAt: string | null = null;
      if (gate.fullyOnV2) {
        const { data: lastSpine } = await supabaseServer
          .from("v2_commitment_event")
          .select("created_at")
          .eq("clerk_user_id", u.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const spineIso =
          typeof lastSpine?.created_at === "string" ? lastSpine.created_at : undefined;
        if (spineIso) {
          lastV2SpineActivityAt = spineIso;
        }
        hours = computeHoursSince(spineIso);
        if (hours === null) {
          hours = computeHoursSince(
            typeof md.lastCompletedAt === "string" ? md.lastCompletedAt : undefined
          );
        }
      } else {
        hours = computeHoursSince(md.lastCompletedAt);
      }

      const retentionStalenessBasis: "v2_spine" | "v2_clerk_cache_fallback" | "legacy_clerk" =
        gate.fullyOnV2
          ? lastV2SpineActivityAt
            ? "v2_spine"
            : "v2_clerk_cache_fallback"
          : "legacy_clerk";

      const hoursSinceV2SpineRaw = lastV2SpineActivityAt
        ? computeHoursSince(lastV2SpineActivityAt)
        : null;
      const hoursSinceV2Spine =
        hoursSinceV2SpineRaw === null || !Number.isFinite(hoursSinceV2SpineRaw)
          ? null
          : Math.floor(hoursSinceV2SpineRaw);

      const mode = bucket(hours);

      counts[mode].users += 1;

      const daysSince =
        hours === null ? null : Math.floor(hours / 24);

      const silentChurn =
        hours !== null && hours >= 240; // 10+ days since last activity (spine or legacy completion)

      const risk = riskScoreFrom(hours);

      // Last SMS send today? (for rollup, but also helpful in retention_signals)
      const { data: smsSent } = await supabaseServer
        .from("sms_send_events")
        .select("id")
        .eq("clerk_user_id", u.id)
        .eq("day_key", today)
        .limit(1);

      if (smsSent && smsSent.length > 0) counts[mode].smsSent += 1;

      let hadProductTouchToday = false;
      if (gate.fullyOnV2) {
        const dayStartIso = utcDayStartIsoFromDayKey(today);
        const { data: v2Today } = await supabaseServer
          .from("v2_commitment_event")
          .select("id")
          .eq("clerk_user_id", u.id)
          .gte("created_at", dayStartIso)
          .limit(1);
        hadProductTouchToday = Boolean(v2Today && v2Today.length > 0);
      } else {
        const { data: completions } = await supabaseServer
          .from("daily_completion_events")
          .select("id")
          .eq("clerk_user_id", u.id)
          .eq("day_key", today)
          .limit(1);
        hadProductTouchToday = Boolean(completions && completions.length > 0);
      }

      if (hadProductTouchToday) {
        counts[mode].completions += 1;
        if (gate.fullyOnV2) {
          counts[mode].v2SpineTouches += 1;
        } else {
          counts[mode].legacyDailyCompletionTouches += 1;
        }
      }

      const dayStartIsoInbound = utcDayStartIsoFromDayKey(today);
      const { data: inboundSms } = await supabaseServer
        .from("sms_inbound_messages")
        .select("created_at")
        .eq("clerk_user_id", u.id)
        .gte("created_at", dayStartIsoInbound)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const smsInboundCreatedAt =
        typeof inboundSms?.created_at === "string" ? inboundSms.created_at : null;
      const hadSmsInboundToday = smsInboundCreatedAt !== null;
      if (hadSmsInboundToday) counts[mode].inbound += 1;

      // Update canonical per-user retention state (idempotent upsert)
      await supabaseServer.from("retention_signals").upsert(
        {
          clerk_user_id: u.id,
          staleness_mode: mode,
          hours_since_last_completion: hours === null ? null : Math.floor(hours),
          days_since_last_completion: daysSince,
          last_completed_at: typeof md.lastCompletedAt === "string" ? md.lastCompletedAt : null,
          last_sms_sent_day_key: smsSent && smsSent.length > 0 ? today : null,
          last_inbound_at: smsInboundCreatedAt,
          silent_churn: silentChurn,
          risk_score: risk,
          updated_at: new Date().toISOString(),
          retention_staleness_basis: retentionStalenessBasis,
          last_v2_spine_activity_at: lastV2SpineActivityAt,
          hours_since_v2_spine: hoursSinceV2Spine,
        },
        { onConflict: "clerk_user_id" }
      );

      // Queue winback intelligence (no sending yet) — idempotent-ish via “already queued today”
      if (silentChurn) {
        const { data: already } = await supabaseServer
          .from("winback_queue")
          .select("id")
          .eq("clerk_user_id", u.id)
          .eq("status", "queued")
          .limit(1);

        if (!already || already.length === 0) {
          await supabaseServer.from("winback_queue").insert({
            clerk_user_id: u.id,
            reason: "silent_churn_10d",
            metadata: {
              staleness_mode: mode,
              hours_since_last_completion: hours,
              engagement_model: gate.fullyOnV2
                ? "v2_spine_staleness"
                : "legacy_lastCompletedAt",
            },
          });
        }
      }
    }

    offset += users.length;
    if (users.length < pageLimit) break;
  }

  // Write daily rollups (one row per bucket)
  for (const mode of Object.keys(counts) as StalenessMode[]) {
    const c = counts[mode];
    await supabaseServer.from("retention_daily_rollups").upsert(
      {
        day_key: today,
        staleness_mode: mode,
        users_count: c.users,
        completions_count: c.completions,
        v2_spine_touches_today: c.v2SpineTouches,
        legacy_daily_completion_touches_today: c.legacyDailyCompletionTouches,
        sms_sent_count: c.smsSent,
        inbound_count: c.inbound,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "day_key,staleness_mode" }
    );
  }

  return NextResponse.json({
    ok: true,
    day: today,
    counts,
    inbound_signal:
      "Rollup inbound_count = user SMS stored in sms_inbound_messages (created_at >= UTC day start). Not coach_conversations.",
    staleness_model:
      "V2 path: hours since latest v2_commitment_event (fallback Clerk lastCompletedAt). Legacy path: hours since lastCompletedAt. Rollups completions_count = spine activity today (V2) or daily_completion_events (legacy). inbound_count = sms_inbound_messages today UTC. DB columns retention_staleness_basis, last_v2_spine_activity_at, hours_since_v2_spine (retention_signals) and v2_spine_touches_today, legacy_daily_completion_touches_today (rollups) document truth explicitly.",
  });
}