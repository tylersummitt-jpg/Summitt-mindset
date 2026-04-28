/**
 * V2 cutover PR2 — internal ops endpoint (same auth model as other crons).
 *
 * GET: inventory only (read).
 * POST: JSON `{ "dry_run": true }` (default) or `{ "dry_run": false }` to apply idempotent backfill.
 *
 * Secured with CRON_SECRET (x-cron-secret, Authorization: Bearer, or GET cron_secret query).
 */

import crypto from "crypto";
import { NextResponse } from "next/server";
import {
  buildCutoverInventoryReport,
  runCutoverBackfillPass,
} from "@/lib/v2-cutover-backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

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

  const hasXCronHeader = req.headers.get("x-cron-secret") != null;
  const hasAuthorizationHeader = req.headers.get("authorization") != null;

  if (!hasXCronHeader && !hasAuthorizationHeader) {
    try {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/api/cron/")) {
        const qSecret = url.searchParams.get("cron_secret");
        if (qSecret && timingSafeEqualUtf8(qSecret, CRON_SECRET)) return true;
      }
    } catch {
      // ignore
    }
  }

  return false;
}

export async function GET(req: Request) {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const report = await buildCutoverInventoryReport();
  return NextResponse.json({
    ok: true,
    mode: "inventory",
    scope: "sms_audience summitt_subscribed=true sms_enabled=true",
    counts: report.counts,
    rows: report.rows,
  });
}

export async function POST(req: Request) {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  /** Default dry-run unless body explicitly sets `"dry_run": false`. */
  const dryRun = body.dry_run !== false;

  const result = await runCutoverBackfillPass({ dryRun });

  return NextResponse.json({
    ok: true,
    mode: dryRun ? "backfill_dry_run" : "backfill_apply",
    scope: "sms_audience summitt_subscribed=true sms_enabled=true",
    dry_run: dryRun,
    rows: result.rows,
  });
}
