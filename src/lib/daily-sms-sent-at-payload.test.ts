import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE_PATH = join(process.cwd(), "src/app/api/cron/daily-sms/route.ts");
const SENDER_PATH = join(process.cwd(), "src/lib/tyler-text-overview-send.ts");
const RESERVATION_SQL = join(
  process.cwd(),
  "supabase/migrations/20261125150000_sms_tto_scheduled_generation.sql"
);

function scheduledReservationSql(): string {
  const sql = readFileSync(RESERVATION_SQL, "utf8");
  const start = sql.indexOf("CREATE FUNCTION public.tto_reserve_scheduled_daily_delivery");
  const end = sql.indexOf("CREATE FUNCTION public.tto_begin_scheduled_daily_provider_attempt");
  return sql.slice(start, end);
}

function scheduledFinalizeSql(): string {
  const sql = readFileSync(RESERVATION_SQL, "utf8");
  const start = sql.indexOf("CREATE FUNCTION public.tto_finalize_scheduled_daily_acceptance");
  const end = sql.indexOf("CREATE FUNCTION public.tto_release_proven_pre_provider");
  return sql.slice(start, end);
}

describe("daily-sms Twilio success sms_send_events payload", () => {
  const src = readFileSync(ROUTE_PATH, "utf8");

  it("metadata.sent_at uses true server instant, not localNow", () => {
    const helperStart = src.indexOf("function dailySmsTwilioSuccessSendEventFields");
    expect(helperStart).toBeGreaterThan(-1);
    const helperEnd = src.indexOf("function compactSupabaseErrorMessage", helperStart);
    const helperBlock = src.slice(helperStart, helperEnd);
    expect(helperBlock).toMatch(/const sentAtIso = new Date\(\)\.toISOString\(\)/);
    expect(helperBlock).not.toMatch(/localNow/);
  });

  it("preserves metadata.local_time for user wall-clock display", () => {
    const reserve = scheduledReservationSql();
    expect(reserve).toContain("'time_zone', p_time_zone");
    expect(reserve).toContain("'member_local_date', p_member_local_date");
    const finalize = scheduledFinalizeSql();
    expect(finalize).toContain("'sent_at', to_jsonb(clock_timestamp())");
    expect(finalize).not.toContain("localNow");
  });

  it("does not write top-level sent_at on success payload", () => {
    const helperStart = src.indexOf("function dailySmsTwilioSuccessSendEventFields");
    expect(helperStart).toBeGreaterThan(-1);
    const returnStart = src.indexOf("return {", helperStart);
    const returnEnd = src.indexOf("};", returnStart);
    const returnBlock = src.slice(returnStart, returnEnd);
    expect(returnBlock).toMatch(/sms_body:\s*args\.smsBody,\s*\n\s*metadata:/);
    expect(returnBlock).toMatch(/sent_at:\s*sentAtIso/);
  });

  it("persists metadata.sent_at, twilio_message_sid, and visible body on success", () => {
    const finalize = scheduledFinalizeSql();
    expect(finalize).toContain("message_sid = p_message_sid");
    expect(finalize).toContain("sms_body = p_body");
    expect(finalize).toContain("'sent_at', to_jsonb(clock_timestamp())");
    expect(finalize).toContain("'final_body_sent', p_body");
    expect(finalize).toContain("'twilio_send_attempted', true");
    const sender = readFileSync(SENDER_PATH, "utf8");
    expect(sender).toContain('rpc("tto_finalize_scheduled_daily_acceptance"');
    expect(sender).toContain("p_message_sid: messageSid");
    expect(sender).toContain("p_body: ready.body");
  });

  it("keeps message_sid, status, and sms_body at top level", () => {
    expect(src).toMatch(/message_sid:\s*args\.messageSid/);
    expect(src).toMatch(/status:\s*args\.twilioStatus/);
    expect(src).toMatch(/sms_body:\s*args\.smsBody/);
  });

  it("does not alter Twilio sendSMS call surface", () => {
    const sendSmsIdx = src.indexOf("sendSMS(");
    expect(sendSmsIdx).toBeGreaterThan(-1);
    const twilioSuccessRegion = src.slice(sendSmsIdx, sendSmsIdx + 4000);
    expect(twilioSuccessRegion).not.toMatch(/sendSMS\([^)]*sent_at/);
  });

  it("records Twilio success via fallback helper after primary DB failure", () => {
    expect(src).toContain("function recordDailyTwilioSuccessOrFallback");
    expect(src).toContain("twilio_db_primary_update_failed: true");
    expect(src).toContain("note: \"sent_to_twilio_db_update_recovered\"");
    expect(src).toContain("CRITICAL orphan Twilio send");
  });

  it("treats metadata Twilio SID as non-retryable via hasAnyTwilioSidOnSendEvent", () => {
    const reserve = scheduledReservationSql();
    const sidGuard = reserve.indexOf("IF v_sid IS NOT NULL OR v_row.status = 'sent' OR v_attempted THEN");
    const retry = reserve.indexOf("ELSIF v_row.status = 'send_failed'");
    expect(sidGuard).toBeGreaterThan(-1);
    expect(retry).toBeGreaterThan(sidGuard);
    expect(reserve).toContain("AND message_sid IS NULL");
  });

  it("send_failed row with metadata.twilio_message_sid is not retried (guard before retry_count)", () => {
    const reserve = scheduledReservationSql();
    const failed = reserve.indexOf("ELSIF v_row.status = 'send_failed' AND NOT v_attempted AND v_sid IS NULL");
    const retryCount = reserve.indexOf("(metadata->>'retry_count')");
    expect(failed).toBeGreaterThan(-1);
    expect(retryCount).toBeGreaterThan(failed);
    expect(reserve.slice(retryCount)).toContain("AND message_sid IS NULL");
  });

  it("reserved recovery skips rows that already have a Twilio SID in metadata", () => {
    const reserve = scheduledReservationSql();
    expect(reserve).toMatch(/v_row\.status = 'reserved'[\s\S]*v_sid IS NULL[\s\S]*NOT v_attempted/);
    expect(reserve).toContain("AND message_sid IS NULL");
  });

  it("scheduling gate uses fixed Morning lane window, not adaptive hour authorities", () => {
    const production = src.slice(src.indexOf("export async function GET"));
    expect(production).toContain("deliverScheduledDailyCoaching");
    expect(production).not.toContain("evaluateMorningLaneTiming");
    expect(production).not.toContain("evaluateDailySendTimeWindow");
    expect(production).not.toContain("isLocalCatchupHour");
    expect(production).not.toMatch(/sendTimeWindowOk\s*=\s*isInSendWindow\(localNow/);
  });

  it("fresh reserved/no-SID rows are not reclaimed within lease", () => {
    const reserve = scheduledReservationSql();
    expect(reserve).toContain("v_lease > clock_timestamp() - interval '2 minutes'");
    expect(reserve).toContain("v_sid IS NULL");
    expect(reserve).toContain("NOT v_attempted");
  });

  it("force does not bypass Morning window", () => {
    const production = src.slice(src.indexOf("export async function GET"));
    expect(production).toContain("deliverScheduledDailyCoaching");
    expect(production).not.toMatch(/searchParams\.get\("force"\)/);
    expect(production).not.toMatch(/bypassWindowGate\s*=\s*Boolean\(existingEvent\)\s*\|\|\s*force/);
  });
});
