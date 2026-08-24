import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const D2C_PENDING = path.join(
  ROOT,
  "src/lib/victory-media/inbound-mms-d2c-pending-context.ts"
);
const D2C_CLAIM = path.join(ROOT, "src/lib/victory-media/inbound-mms-d2c-claim.ts");
const D2B = path.join(ROOT, "src/lib/victory-media/inbound-mms-d2b.ts");
const D0 = path.join(
  ROOT,
  "src/lib/victory-media/claim-inbound-mms-semantic-target.ts"
);
const PACKET = path.join(ROOT, "src/lib/inbound-relationship-packet.ts");
const TURN = path.join(ROOT, "src/lib/inbound-sol-relationship-turn.ts");
const INTERPRETER = path.join(ROOT, "src/lib/inbound-sol-brief-interpreter.ts");
const SCHEMA = path.join(ROOT, "src/lib/inbound-sol-brief-json-schema.ts");
const WRITER = path.join(ROOT, "src/lib/inbound-sol-writer.ts");
const PIPE = path.join(ROOT, "src/lib/victory-media/kick-inbound-media-pipeline.ts");
const CRON = path.join(ROOT, "src/app/api/cron/victory-media/route.ts");
const TWILIO = path.join(ROOT, "src/app/api/twilio/inbound/route.ts");
const SAFETY = path.join(ROOT, "src/app/api/cron/sms-inbound-coach/route.ts");
const C2 = path.join(ROOT, "src/lib/victory-media/attach-inbound-mms-c2.ts");
const VERCEL = path.join(ROOT, "vercel.json");

describe("inbound MMS D2c wire", () => {
  const pending = fs.readFileSync(D2C_PENDING, "utf8");
  const claim = fs.readFileSync(D2C_CLAIM, "utf8");
  const d2b = fs.readFileSync(D2B, "utf8");
  const d0 = fs.readFileSync(D0, "utf8");
  const packet = fs.readFileSync(PACKET, "utf8");
  const turn = fs.readFileSync(TURN, "utf8");
  const interpreter = fs.readFileSync(INTERPRETER, "utf8");
  const schema = fs.readFileSync(SCHEMA, "utf8");
  const writer = fs.readFileSync(WRITER, "utf8");
  const pipe = fs.readFileSync(PIPE, "utf8");
  const cron = fs.readFileSync(CRON, "utf8");
  const twilio = fs.readFileSync(TWILIO, "utf8");
  const safety = fs.readFileSync(SAFETY, "utf8");
  const c2 = fs.readFileSync(C2, "utf8");
  const vercel = fs.readFileSync(VERCEL, "utf8");

  it("loads pending_user + exact sent body on the Sol packet before interpreter", () => {
    expect(packet).toContain("loadInboundMmsD2cPendingContext");
    expect(packet).toContain("inboundPendingMediaSourceFromD2c");
    expect(packet).toContain("loadInboundMmsD1PendingContext");
    const loadIdx = turn.indexOf("await loadInboundRelationshipPacket");
    const interpIdx = turn.indexOf("await runInboundSolBriefInterpreter");
    expect(interpIdx).toBeGreaterThan(loadIdx);
    expect(interpreter).toContain("clarification_body is the exact Coach question");
    expect(interpreter).toContain("I took Lakelyn to her first dance class.");
    expect(schema).toContain("exact Coach question already sent");
  });

  it("does not add a second OpenAI call, vision, Win insert, or SMS send", () => {
    for (const src of [pending, claim]) {
      expect(src).not.toMatch(/\bopenai\b/i);
      expect(src).not.toContain("sendSMSChunked");
      expect(src).not.toContain("messages.create");
      expect(src).not.toContain("image_url");
      expect(src).not.toContain("data:image");
      expect(src).not.toMatch(/\.from\("v2_win"\)\s*\.(insert|update|delete)/);
    }
    expect(turn.split("runInboundSolBriefInterpreter({").length - 1).toBe(1);
    expect(turn).not.toContain("await scheduleInboundMmsD2cSemanticClaim");
  });

  it("schedules D0 after persist with expectedResolution pending_user and does not await C2", () => {
    const persistCall = turn.lastIndexOf("await persistSolInboundWins");
    const d2cCall = turn.lastIndexOf("scheduleInboundMmsD2cSemanticClaim(");
    const writerIdx = turn.lastIndexOf("await writeInboundSolBody");
    expect(d2cCall).toBeGreaterThan(persistCall);
    expect(writerIdx).toBeGreaterThan(d2cCall);
    expect(claim).toContain('expectedResolution: INBOUND_MEDIA_D2C_EXPECTED_RESOLUTION');
    expect(claim).toContain("listInboundMmsD2cEligiblePendingJobs");
    expect(d0).toContain('expectedResolution !== "pending_user"');
    expect(turn).not.toContain("tryAttachInboundMmsC2Job");
    expect(c2).not.toContain("scheduleInboundMmsD2cSemanticClaim");
  });

  it("D2b still does not pair answers; D2c is interpreter-side", () => {
    expect(d2b).toContain("pair answers (D2c)");
    expect(d2b).not.toContain("pending_user_answer");
    expect(d2b).not.toContain("scheduleInboundMmsD2cSemanticClaim");
    expect(pipe).not.toContain("scheduleInboundMmsD2cSemanticClaim");
    expect(cron).not.toContain("scheduleInboundMmsD2cSemanticClaim");
  });

  it("STOP/safety remain before Sol/D2c; no new cron/env/flag", () => {
    expect(twilio.indexOf("isStopCommand")).toBeGreaterThan(0);
    const handleStart = safety.indexOf("async function handleV2SmsInboundCoachJob");
    const handleBody = safety.slice(handleStart);
    const safetyCall = handleBody.indexOf("processInboundSmsSafetyShortCircuit");
    const normalCall = handleBody.indexOf("processV2NormalInboundOutcome");
    expect(normalCall).toBeGreaterThan(safetyCall);
    expect(handleBody).not.toContain("scheduleInboundMmsD2cSemanticClaim");
    expect(pending).not.toContain("process.env.");
    expect(claim).not.toContain("process.env.");
    expect(
      (JSON.parse(vercel) as { crons: Array<{ path: string }> }).crons.filter(
        (c) => c.path === "/api/cron/victory-media"
      )
    ).toHaveLength(1);
  });

  it("writer still does not see pending media or claim a saved photo", () => {
    expect(writer).toContain("toWriterFacingInboundRelationshipPacket");
    expect(writer).toContain(
      "Do not claim a photo or picture was saved, attached, added, or stored."
    );
  });

  it("STOP/HELP/START stay in Twilio inbound before coach/D2c; safety owns the coach job before Sol", () => {
    expect(twilio).toContain("function isStopCommand");
    expect(twilio).toContain("function isHelpCommand");
    expect(twilio).toContain("function isStartCommand");
    const stopIdx = twilio.indexOf("if (isStopCommand(body))");
    const enqueueIdx = twilio.lastIndexOf("ensureCoachJobPresent");
    expect(stopIdx).toBeGreaterThan(0);
    expect(enqueueIdx).toBeGreaterThan(stopIdx);
    expect(twilio).not.toContain("scheduleInboundMmsD2cSemanticClaim");
    expect(twilio).not.toContain("loadInboundMmsD2cPendingContext");
    const handleStart = safety.indexOf("async function handleV2SmsInboundCoachJob");
    const handleBody = safety.slice(handleStart);
    const safetyCall = handleBody.indexOf("processInboundSmsSafetyShortCircuit");
    const normalCall = handleBody.indexOf("processV2NormalInboundOutcome");
    expect(safetyCall).toBeGreaterThan(0);
    expect(normalCall).toBeGreaterThan(safetyCall);
    expect(handleBody).not.toContain("scheduleInboundMmsD2cSemanticClaim");
  });

  it("goal-change heuristic excludes Sol/D2c; D2b still noops pending_user", () => {
    expect(safety).toContain("commitmentChangeHeuristicContext");
    expect(safety).toContain("isLikelyCommitmentChangeIntentTurn(userMessage)");
    expect(d2b).toContain("if (job.resolution === \"pending_user\")");
    expect(d2b).toContain('action: "noop"');
  });

  it("does not persist Hallway/Notebook media operational state", () => {
    for (const src of [pending, claim, packet, turn]) {
      expect(src).not.toContain("v2_hallway");
      expect(src).not.toContain("v3LearningNotebookAppend");
      expect(src).not.toContain("from(\"v2_coaching_notebook\")");
      expect(src).not.toContain("from(\"hallway");
    }
    expect(packet).not.toContain("sms_last_outbound_context");
  });

  it("generic last-ask inbound projection still runs before Sol (documented coupling)", () => {
    const fnStart = safety.indexOf("async function processV2NormalInboundOutcome");
    const solCall = safety.indexOf("await runInboundSolRelationshipTurn", fnStart);
    const beforeSol = safety.slice(fnStart, solCall);
    expect(beforeSol).toContain("persistInboundSmsThreadMemoryProjectionBestEffort");
  });

  it("writer failure cancels the inbound job and does not rerun Sol", () => {
    const start = safety.indexOf("if (\n      isInboundSolMainCoachingBranch");
    const sent = safety.indexOf("inbound_sol_main_sent", start);
    const block = safety.slice(start, sent);
    expect(block).toContain("inbound_sol_main_no_send");
    expect(block).toContain('status: "cancelled"');
    expect(block).toContain("farFutureIso()");
    const noSendIdx = block.indexOf("inbound_sol_main_no_send");
    expect(block.slice(noSendIdx)).not.toContain("await runInboundSolRelationshipTurn");
  });

  it("does not add abandon/never-mind as a D2c relation without an honest job state", () => {
    expect(schema).not.toContain('"abandon"');
    expect(interpreter).not.toMatch(/\bnever mind\b/i);
    expect(claim).not.toContain("abandon");
    expect(pending).not.toContain("user_abandoned");
  });
});
