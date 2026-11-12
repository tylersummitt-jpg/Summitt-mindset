import crypto from "crypto";
import { NextResponse } from "next/server";

import { runAdLabImport } from "@/lib/ad-lab-import";
import { importWindowAllowed } from "@/lib/ad-lab-import-pure";

/**
 * Stores yesterday and today from Meta Ads Insights.
 * Optional since and until, at most 7 days, for a manual backfill.
 * Does not change campaigns, spend ledgers, or the Conversions API.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const xCron = req.headers.get("x-cron-secret");
  if (xCron && timingSafeEqualUtf8(xCron, secret)) return true;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token && timingSafeEqualUtf8(token, secret)) return true;
  }
  return false;
}

function readWindow(url: URL): { since: string; until: string } | { error: string } | "default" {
  const since = url.searchParams.get("since")?.trim() ?? "";
  const until = url.searchParams.get("until")?.trim() ?? "";
  if (!since && !until) return "default";
  if (!since || !until || since.length > 10 || until.length > 10) {
    return { error: "Provide both since and until, or neither." };
  }
  if (!importWindowAllowed(since, until)) {
    return { error: "An import window can cover at most 7 days." };
  }
  return { since, until };
}

async function handleCron(request: Request) {
  if (!validateCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const window = readWindow(new URL(request.url));
  if (typeof window === "object" && "error" in window) {
    return NextResponse.json({ ok: false, reason: "window", message: window.error }, { status: 400 });
  }
  try {
    const result = await runAdLabImport(
      window === "default" ? {} : { since: window.since, until: window.until }
    );
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch {
    console.error("[meta-ad-lab] cron_failed");
    return NextResponse.json(
      { ok: false, reason: "meta", message: "Meta import could not finish." },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
