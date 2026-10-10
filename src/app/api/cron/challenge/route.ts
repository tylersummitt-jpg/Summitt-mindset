import crypto from "crypto";
import { NextResponse } from "next/server";
import { runChallengeCron } from "@/lib/challenge-runtime";

/**
 * Email-only challenge cadence — no SMS in this cron.
 *
 * Rollback is manual:
 * 1. Pause this cron before deploying an older application.
 * 2. Wait until every send_claim_until is in the past (the claim lasts 5 minutes).
 * 3. Do not clear suppressed_at. Never set it back to null.
 * 4. The old cron ignores idempotency keys and selects next_send_at <= now.
 *    Set next_send_at and next_retry_at to null where attempt_idempotency_key
 *    is set, or send_state is claimed or unknown. Leave an already accepted
 *    lesson that is scheduled for a later day alone.
 * 5. Prefer a forward fix when the old application cannot honor the new state.
 * Re-enrollment is the only path that may clear suppression.
 */

const CRON_SECRET = process.env.CRON_SECRET;

/**
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

async function handleCron(request: Request) {
  if (!validateCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runChallengeCron();
    return NextResponse.json(result);
  } catch {
    console.error("[challenge] cron_failed");
    return NextResponse.json({ error: "Challenge cron failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
