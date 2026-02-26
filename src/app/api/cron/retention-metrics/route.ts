// src/app/api/cron/retention-metrics/route.ts

import { NextResponse } from "next/server";
import { listClerkUsers } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

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

function riskScoreFrom(hours: number | null): number {
  if (hours === null) return 30; // new/unknown users
  if (hours <= 36) return 0;
  if (hours <= 96) return 10;
  if (hours <= 240) return 25; // 4–10 days
  return 40; // 10+ days
}

export async function GET(req: Request) {
  const secret = req.headers.get("x-cron-secret");
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const today = dayKeyUTC(new Date());

  const counts: Record<StalenessMode, { users: number; completions: number; smsSent: number; inbound: number }> = {
    fresh: { users: 0, completions: 0, smsSent: 0, inbound: 0 },
    normal: { users: 0, completions: 0, smsSent: 0, inbound: 0 },
    reentry: { users: 0, completions: 0, smsSent: 0, inbound: 0 },
    never: { users: 0, completions: 0, smsSent: 0, inbound: 0 },
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

      const hours = computeHoursSince(md.lastCompletedAt);
      const mode = bucket(hours);

      counts[mode].users += 1;

      const daysSince =
        hours === null ? null : Math.floor(hours / 24);

      const silentChurn =
        hours !== null && hours >= 240; // 10+ days since completion

      const risk = riskScoreFrom(hours);

      // Last SMS send today? (for rollup, but also helpful in retention_signals)
      const { data: smsSent } = await supabaseServer
        .from("sms_send_events")
        .select("id")
        .eq("clerk_user_id", u.id)
        .eq("day_key", today)
        .limit(1);

      if (smsSent && smsSent.length > 0) counts[mode].smsSent += 1;

      // Completion today?
      const { data: completions } = await supabaseServer
        .from("daily_completion_events")
        .select("id")
        .eq("clerk_user_id", u.id)
        .eq("day_key", today)
        .limit(1);

      if (completions && completions.length > 0) counts[mode].completions += 1;

      // Inbound today? (any inbound message saved as coach_conversations role=user)
      const { data: inbound } = await supabaseServer
        .from("coach_conversations")
        .select("id")
        .eq("clerk_user_id", u.id)
        .eq("role", "user")
        .gte("created_at", new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())).toISOString())
        .limit(1);

      if (inbound && inbound.length > 0) counts[mode].inbound += 1;

      // Update canonical per-user retention state (idempotent upsert)
      await supabaseServer.from("retention_signals").upsert(
        {
          clerk_user_id: u.id,
          staleness_mode: mode,
          hours_since_last_completion: hours === null ? null : Math.floor(hours),
          days_since_last_completion: daysSince,
          last_completed_at: typeof md.lastCompletedAt === "string" ? md.lastCompletedAt : null,
          last_sms_sent_day_key: smsSent && smsSent.length > 0 ? today : null,
          last_inbound_at: inbound && inbound.length > 0 ? new Date().toISOString() : null,
          silent_churn: silentChurn,
          risk_score: risk,
          updated_at: new Date().toISOString(),
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
        sms_sent_count: c.smsSent,
        inbound_count: c.inbound,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "day_key,staleness_mode" }
    );
  }

  return NextResponse.json({ ok: true, day: today, counts });
}