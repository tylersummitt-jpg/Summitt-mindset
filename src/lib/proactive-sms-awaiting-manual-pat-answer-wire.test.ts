import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const HELPER = path.join(ROOT, "src/lib/has-awaiting-manual-pat-answer.ts");
const DAILY = path.join(ROOT, "src/app/api/cron/daily-sms/route.ts");
const EVENING_SEND = path.join(ROOT, "src/lib/tyler-text-overview-evening-send.ts");
const EVENING_CRON = path.join(ROOT, "src/app/api/cron/evening-sms/route.ts");
const WEEKLY_SEND = path.join(ROOT, "src/lib/tyler-text-overview-weekly-send.ts");
const WEEKLY_CRON = path.join(ROOT, "src/app/api/cron/weekly-sms/route.ts");
const WRITER = path.join(ROOT, "src/lib/inbound-sol-writer.ts");
const TURN = path.join(ROOT, "src/lib/inbound-sol-relationship-turn.ts");
const INTERPRETER = path.join(ROOT, "src/lib/inbound-sol-brief-interpreter.ts");
const ADMIN_SEND = path.join(ROOT, "src/lib/admin-manual-pat-answers.ts");
const CRON_INBOUND = path.join(ROOT, "src/app/api/cron/sms-inbound-coach/route.ts");
const TWILIO_INBOUND = path.join(ROOT, "src/app/api/twilio/inbound/route.ts");
const ASK_PAT = path.join(ROOT, "src/app/api/ask-pat/route.ts");
const TTO_ADMIN = path.join(ROOT, "src/lib/tyler-text-overview-admin.ts");
const WEEKLY_GENERATE = path.join(ROOT, "src/lib/tyler-text-overview-weekly-generate.ts");
const RETRIEVAL = path.join(ROOT, "src/lib/inbound-pat-source-evidence.ts");

describe("proactive M/E/W awaiting-manual-pat-answer suppression wire", () => {
  const helper = fs.readFileSync(HELPER, "utf8");
  const daily = fs.readFileSync(DAILY, "utf8");
  const eveningSend = fs.readFileSync(EVENING_SEND, "utf8");
  const eveningCron = fs.readFileSync(EVENING_CRON, "utf8");
  const weeklySend = fs.readFileSync(WEEKLY_SEND, "utf8");
  const weeklyCron = fs.readFileSync(WEEKLY_CRON, "utf8");

  it("11: helper is a boolean DB check with no model/AI", () => {
    expect(helper).toContain("export async function hasAwaitingManualPatAnswer");
    expect(helper).toContain('eq("status", AWAITING_MANUAL_PAT_ANSWER_STATUS)');
    expect(helper).toContain(".from(\"sms_inbound_coach_jobs\")");
    expect(helper).not.toContain("openai");
    expect(helper).not.toContain("chat.completions");
    expect(helper).not.toContain("writeInboundSolBody");
    expect(helper).not.toContain("applyFinalVoiceOwnershipGate");
  });

  it("1: Morning skip is before Twilio and does not change active-inbound helper", () => {
    expect(daily).toContain("hasAwaitingManualPatAnswer");
    expect(daily).toContain("shouldSkipDailyForAwaitingManualPatAnswer");
    expect(daily).toContain('skip_reason: AWAITING_MANUAL_PAT_ANSWER_SKIP_REASON');
    expect(daily).toContain("skippedAwaitingManualPatAnswer");

    const inboundHelper = daily.slice(
      daily.indexOf("async function shouldSkipDailyForActiveInboundThread"),
      daily.indexOf("async function shouldSkipDailyForAwaitingManualPatAnswer")
    );
    expect(inboundHelper).toContain("hasRecentInboundAccountabilityExchange");
    expect(inboundHelper).not.toContain("hasAwaitingManualPatAnswer");

    const retrySkip = daily.indexOf('path: "retry"');
    const retrySend = daily.indexOf("attemptMorningTtoTwilioSend", retrySkip);
    expect(retrySkip).toBeGreaterThan(0);
    expect(retrySend).toBeGreaterThan(retrySkip);

    const mainSkip = daily.indexOf('path: "main"');
    const mainReserve = daily.indexOf("reserveTodaySendOrSkip", mainSkip);
    expect(mainSkip).toBeGreaterThan(0);
    expect(mainReserve).toBeGreaterThan(mainSkip);
  });

  it("2: Evening cron send skips before Twilio and does not mutate drafts", () => {
    expect(eveningSend).toContain("hasAwaitingManualPatAnswer");
    expect(eveningSend).toContain('"awaiting_manual_pat_answer"');
    const gateIdx = eveningSend.indexOf("if (await hasAwaitingManualPatAnswer");
    const sendIdx = eveningSend.indexOf("await sendSMS(");
    expect(gateIdx).toBeGreaterThan(0);
    expect(sendIdx).toBeGreaterThan(gateIdx);
    const skipBranch = eveningSend.slice(
      gateIdx,
      eveningSend.indexOf("const existing = await readExistingEveningSendEvent", gateIdx)
    );
    expect(skipBranch).toContain("return refuse(");
    expect(skipBranch).toContain('"awaiting_manual_pat_answer"');
    expect(skipBranch).not.toContain(".update(");
    expect(skipBranch).not.toContain("current_body_to_send");
    expect(eveningCron).toContain("skippedAwaitingManualPatAnswer");
    expect(eveningCron).toContain('case "awaiting_manual_pat_answer"');
  });

  it("3/4: Weekly send-time gate covers cron and manual; drafts are not blanked", () => {
    expect(weeklySend).toContain("hasAwaitingManualPatAnswer");
    expect(weeklySend).toContain('"awaiting_manual_pat_answer"');
    const sendFn = weeklySend.slice(
      weeklySend.indexOf("export async function sendWeeklyTtoDraftAuthoritative")
    );
    const gateIdx = sendFn.indexOf("await hasAwaitingManualPatAnswer");
    const twilioIdx = sendFn.indexOf("await sendSMS(");
    const reserveIdx = sendFn.indexOf("reserveWeeklySmsSendEvent");
    expect(gateIdx).toBeGreaterThan(0);
    expect(reserveIdx).toBeGreaterThan(gateIdx);
    expect(twilioIdx).toBeGreaterThan(gateIdx);
    expect(sendFn.slice(gateIdx, twilioIdx)).not.toContain("current_body_to_send:");
    expect(weeklySend).toContain("export async function sendWeeklyTtoDraftManually");
    expect(weeklySend).toContain("sendWeeklyTtoDraftAuthoritative({");
    expect(weeklyCron).toContain("hasAwaitingManualPatAnswer");
    expect(weeklyCron).toContain("skippedAwaitingManualPatAnswer");
  });

  it("12/13/14/15: protected surfaces and existing skip logic stay intact", () => {
    expect(fs.readFileSync(WRITER, "utf8")).not.toContain("hasAwaitingManualPatAnswer");
    expect(fs.readFileSync(TURN, "utf8")).not.toContain("hasAwaitingManualPatAnswer");
    expect(fs.readFileSync(INTERPRETER, "utf8")).not.toContain("hasAwaitingManualPatAnswer");
    expect(fs.readFileSync(ADMIN_SEND, "utf8")).not.toContain("hasAwaitingManualPatAnswer");
    expect(fs.readFileSync(ASK_PAT, "utf8")).not.toContain("hasAwaitingManualPatAnswer");
    expect(fs.readFileSync(TTO_ADMIN, "utf8")).not.toContain("hasAwaitingManualPatAnswer");
    expect(fs.readFileSync(WEEKLY_GENERATE, "utf8")).not.toContain("hasAwaitingManualPatAnswer");
    expect(fs.readFileSync(RETRIEVAL, "utf8")).not.toContain("hasAwaitingManualPatAnswer");

    const inboundCron = fs.readFileSync(CRON_INBOUND, "utf8");
    expect(inboundCron).toContain('.in("status", ["pending", "failed", "reply_ready"])');
    expect(inboundCron).not.toContain("hasAwaitingManualPatAnswer");

    expect(daily).toContain("shouldSkipDailyForActiveInboundThread");
    expect(daily).toContain("hasRecentInboundAccountabilityExchange");
  });

  it("8/9/10: STOP, inbound, and manual Pat send files are not in this slice", () => {
    const changed = new Set(
      execSync("git status --short --untracked-files=all", { cwd: ROOT, encoding: "utf8" })
        .split("\n")
        .map((line) => line.trim().replace(/^\S+\s+/, ""))
        .filter(Boolean)
    );
    const protectedPaths = [
      "src/lib/inbound-sol-writer.ts",
      "src/lib/inbound-sol-relationship-turn.ts",
      "src/lib/inbound-sol-brief-interpreter.ts",
      "src/lib/inbound-pat-source-evidence.ts",
      "src/app/api/ask-pat/route.ts",
      "src/lib/admin-manual-pat-answers.ts",
      "src/app/api/cron/sms-inbound-coach/route.ts",
      "src/app/api/twilio/inbound/route.ts",
      "src/lib/tyler-text-overview-admin.ts",
      "src/lib/tyler-text-overview-weekly-generate.ts",
    ];
    for (const p of protectedPaths) {
      expect(changed.has(p), p).toBe(false);
    }
    expect(fs.readFileSync(TWILIO_INBOUND, "utf8")).not.toContain("hasAwaitingManualPatAnswer");
  });
});
