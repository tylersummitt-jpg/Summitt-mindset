import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");
const HELPER = path.join(process.cwd(), "src/lib/notify-manual-pat-answer.ts");
const WRITER = path.join(process.cwd(), "src/lib/inbound-sol-writer.ts");
const TURN = path.join(process.cwd(), "src/lib/inbound-sol-relationship-turn.ts");
const INTERPRETER = path.join(process.cwd(), "src/lib/inbound-sol-brief-interpreter.ts");
const TWILIO_INBOUND = path.join(process.cwd(), "src/app/api/twilio/inbound/route.ts");

function solMainBlock(src: string): string {
  const start = src.indexOf("if (\n      isInboundSolMainCoachingBranch");
  const sent = src.indexOf("inbound_sol_main_sent", start);
  expect(start).toBeGreaterThan(0);
  expect(sent).toBeGreaterThan(start);
  return src.slice(start, sent + "inbound_sol_main_sent".length);
}

function solNoSendBlock(src: string): string {
  const block = solMainBlock(src);
  const noSend = block.indexOf("if (!solTurn.shouldSend || !solTurn.body?.trim())");
  const replyReady = block.indexOf('status: "reply_ready"');
  expect(noSend).toBeGreaterThan(0);
  expect(replyReady).toBeGreaterThan(noSend);
  return block.slice(noSend, replyReady);
}

function genericCancelledStart(src: string): number {
  const tag = src.indexOf('tag: "inbound_sol_main_no_send"');
  expect(tag).toBeGreaterThan(0);
  const cancelled = src.lastIndexOf('status: "cancelled"', tag);
  expect(cancelled).toBeGreaterThan(0);
  return cancelled;
}

function manualParkBlock(src: string): string {
  const noSend = solNoSendBlock(src);
  const start = noSend.indexOf('solTurn.noSendReason === "manual_pat_answer_needed"');
  const genericIdx = genericCancelledStart(noSend);
  expect(start).toBeGreaterThan(0);
  expect(genericIdx).toBeGreaterThan(start);
  return noSend.slice(start, genericIdx);
}

describe("commit 3 — manual Pat answer email notify wire", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const helper = fs.readFileSync(HELPER, "utf8");
  const turn = fs.readFileSync(TURN, "utf8");
  const writer = fs.readFileSync(WRITER, "utf8");
  const interpreter = fs.readFileSync(INTERPRETER, "utf8");
  const twilioInbound = fs.readFileSync(TWILIO_INBOUND, "utf8");

  it("1: parks the job before attempting email", () => {
    const manual = manualParkBlock(src);
    const parkIdx = manual.indexOf('status: "awaiting_manual_pat_answer"');
    const loadIdx = manual.indexOf("await loadJob(job.message_sid)");
    const gateIdx = manual.indexOf('parked?.status === "awaiting_manual_pat_answer"');
    const notifyIdx = manual.indexOf("await notifyManualPatAnswerNeeded(");
    expect(parkIdx).toBeGreaterThan(0);
    expect(loadIdx).toBeGreaterThan(parkIdx);
    expect(gateIdx).toBeGreaterThan(loadIdx);
    expect(notifyIdx).toBeGreaterThan(gateIdx);
    expect(manual.indexOf("replyBody: null")).toBeGreaterThan(0);
    expect(manual.indexOf("replyBody: null")).toBeLessThan(notifyIdx);
  });

  it("2: successful email is attempted only after confirmed awaiting status", () => {
    const manual = manualParkBlock(src);
    expect(src).toContain('from "@/lib/notify-manual-pat-answer"');
    expect(manual).toContain("await notifyManualPatAnswerNeeded(");
    expect(manual).toContain("preferredName:");
    expect(manual).toContain("question: userMessage || job.raw_body || \"\"");
    expect(manual).toContain("messageSid: job.message_sid");
    expect(manual).not.toContain('status: "cancelled"');
    expect(helper).toContain("manual_pat_answer_notification_sent");
  });

  it("3: email failure is fail-soft and cannot change job status", () => {
    const manual = manualParkBlock(src);
    expect(manual).toContain("} catch (notifyErr)");
    expect(manual).toContain("manual_pat_answer_notification_failed");
    const catchStart = manual.indexOf("} catch (notifyErr)");
    expect(catchStart).toBeGreaterThan(0);
    const catchEnd = manual.indexOf("} else {", catchStart);
    const catchBlock = manual.slice(
      catchStart,
      catchEnd > catchStart ? catchEnd : catchStart + 320
    );
    expect(catchBlock).toContain("manual_pat_answer_notification_failed");
    expect(catchBlock).not.toContain("markJobFinal");
    expect(catchBlock).not.toContain('status: "failed"');
    expect(catchBlock).not.toContain('status: "cancelled"');
    expect(helper).toContain("never throws");
    expect(helper).toContain("} catch (err)");
  });

  it("4: email is not attempted if DB park is not confirmed", () => {
    const manual = manualParkBlock(src);
    const gate = 'if (parked?.status === "awaiting_manual_pat_answer")';
    expect(manual).toContain(gate);
    const afterGate = manual.slice(manual.indexOf(gate));
    const elseIdx = afterGate.indexOf("} else {");
    const notifyInIf = afterGate.slice(0, elseIdx);
    const notifyElse = afterGate.slice(elseIdx);
    expect(notifyInIf).toContain("await notifyManualPatAnswerNeeded(");
    expect(notifyElse).not.toContain("await notifyManualPatAnswerNeeded(");
    expect(notifyElse).toContain("park_unconfirmed");
  });

  it("5: re-entry of awaiting_manual_pat_answer does not email again", () => {
    const processStart = src.indexOf("async function processJob(claimedJob: JobRow)");
    const processEnd = src.indexOf("export async function GET(req: Request)");
    const processFn = src.slice(processStart, processEnd);
    const idempotent = processFn.indexOf(
      'if (job.status === "awaiting_manual_pat_answer")'
    );
    expect(idempotent).toBeGreaterThan(0);
    const early = processFn.slice(idempotent, processFn.indexOf("return;", idempotent) + 8);
    expect(early).toContain("inbound_sol_awaiting_manual_pat_answer_idempotent");
    expect(early).not.toContain("notifyManualPatAnswerNeeded");
    expect(processFn).not.toContain("notifyManualPatAnswerNeeded");
  });

  it("6: generic cancelled no-send does not email", () => {
    const noSend = solNoSendBlock(src);
    const generic = noSend.slice(genericCancelledStart(noSend));
    const genericMark = generic.slice(
      0,
      generic.indexOf("insertInboundTurnTelemetryBestEffort")
    );
    expect(genericMark).toContain('status: "cancelled"');
    expect(genericMark).toContain("inbound_sol_main_no_send");
    expect(genericMark).not.toContain("notifyManualPatAnswerNeeded");
  });

  it("7: normal grounded Pat send does not email", () => {
    const block = solMainBlock(src);
    const noSendEnd = block.indexOf("return;", block.indexOf("if (!solTurn.shouldSend"));
    const sendPath = block.slice(noSendEnd);
    expect(sendPath).toContain('status: "reply_ready"');
    expect(sendPath).toContain("commitAndSendInboundCoachReply");
    expect(sendPath).not.toContain("notifyManualPatAnswerNeeded");
  });

  it("8: manual path still does not send Twilio", () => {
    const manual = manualParkBlock(src);
    expect(manual).not.toContain("commitAndSendInboundCoachReply");
    expect(manual).not.toContain("sendSMSChunked");
    expect(manual).toContain("replyBody: null");
  });

  it("9: no new OpenAI/model calls", () => {
    expect(src.split("await runInboundSolRelationshipTurn({").length - 1).toBe(1);
    expect(turn.split("writeInboundSolBody({").length - 1).toBe(1);
    expect(turn.split("runInboundSolBriefInterpreter({").length - 1).toBe(1);
    expect(writer.split("chat.completions.create").length - 1).toBe(1);
    expect(interpreter.split("chat.completions.create").length - 1).toBe(1);
    expect(helper).not.toContain("openai");
    expect(helper).not.toContain("chat.completions");
  });

  it("10: no admin / M/E/W / answer-UI behavior yet", () => {
    const manual = manualParkBlock(src);
    expect(manual).not.toMatch(/\bmorning\b/i);
    expect(manual).not.toMatch(/\bevening\b/i);
    expect(manual).not.toMatch(/\bweekly\b/i);
    expect(manual).not.toContain("/admin/");
    expect(helper).not.toContain("/admin/");
    expect(helper).not.toContain("tyler-text-overview");
    expect(src).not.toContain('from "resend"');
    const safetyFn = src.slice(
      src.indexOf("async function processInboundSmsSafetyShortCircuit"),
      src.indexOf("async function handleV2SmsInboundCoachJob")
    );
    expect(safetyFn).not.toContain("notifyManualPatAnswerNeeded");
    expect(twilioInbound).toContain("isStopCommand(body)");
  });

  it("claim list and retry statuses are unchanged", () => {
    const get = src.slice(src.indexOf("export async function GET(req: Request)"));
    expect(get).toContain('.in("status", ["pending", "failed", "reply_ready"])');
    expect(get.match(/\.in\("status", \["pending", "failed", "reply_ready"\]\)/g)?.length).toBe(
      2
    );
    expect(src).toContain("const MAX_ATTEMPTS = 25");
  });
});
