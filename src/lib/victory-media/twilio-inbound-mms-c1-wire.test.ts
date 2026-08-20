import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const C1 = path.join(
  process.cwd(),
  "src/lib/victory-media/correlate-inbound-mms-c1.ts"
);
const B2 = path.join(
  process.cwd(),
  "src/lib/victory-media/process-inbound-media-b2.ts"
);
const PIPE = path.join(
  process.cwd(),
  "src/lib/victory-media/kick-inbound-media-pipeline.ts"
);
const WIN_WIRE = path.join(process.cwd(), "src/lib/inbound-win-recognition-wire.ts");
const SOL_WINS = path.join(process.cwd(), "src/lib/inbound-sol-wins.ts");
const COACH = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");
const VERCEL = path.join(process.cwd(), "vercel.json");

describe("twilio inbound — MMS C1 wire", () => {
  const c1 = fs.readFileSync(C1, "utf8");
  const b2 = fs.readFileSync(B2, "utf8");
  const pipe = fs.readFileSync(PIPE, "utf8");
  const winWire = fs.readFileSync(WIN_WIRE, "utf8");
  const solWins = fs.readFileSync(SOL_WINS, "utf8");
  const coach = fs.readFileSync(COACH, "utf8");
  const vercel = fs.readFileSync(VERCEL, "utf8");

  it("Win correlation query is a collection (never maybeSingle / single / LIMIT 1)", () => {
    const fnStart = c1.indexOf("async function loadCorrelatedWins");
    const fnEnd = c1.indexOf("async function loadMediaForWin");
    expect(fnStart).toBeGreaterThan(0);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const fn = c1.slice(fnStart, fnEnd);
    expect(fn).toContain('.from("v2_win")');
    expect(fn).toContain('.eq("clerk_user_id"');
    expect(fn).toContain('.eq("source_message_sid"');
    expect(fn).toContain('.eq("source_type", "sms_inbound")');
    expect(fn).not.toContain("maybeSingle");
    expect(fn).not.toContain(".single(");
    expect(fn).not.toMatch(/\.limit\(\s*1\s*\)/);
    expect(fn).toContain("Array.isArray(data)");
  });

  it("no canonical Storage write / finalizer / v2_win_media insert", () => {
    expect(c1).not.toContain("finalizeVictoryWinMedia");
    expect(c1).not.toContain("victoryMediaMasterPath");
    expect(c1).not.toContain("victoryMediaCardPath");
    expect(c1).not.toContain('.from("v2_win_media")\n    .insert');
    expect(c1).not.toContain(".insert(");
    expect(c1).not.toContain("storage.from");
    expect(c1).not.toContain(".upload(");
    expect(c1).not.toContain(".copy(");
    expect(c1).toContain('.from("v2_win_media")');
  });

  it("no OpenAI, vision, or user SMS", () => {
    expect(c1).not.toMatch(/\bopenai\b/i);
    expect(c1).not.toMatch(/\bvision\b/i);
    expect(c1).not.toContain("sendSMS");
    expect(c1).not.toContain("buildTwimlResponse");
    expect(c1).not.toContain("splitIntoChunks");
  });

  it("B2 triggers C1 after awaiting_attach without C2/finalization", () => {
    expect(b2).toContain("tryCorrelateInboundMmsC1Job");
    const idx = b2.indexOf('if (nextStatus === "awaiting_attach")');
    expect(idx).toBeGreaterThan(0);
    const block = b2.slice(idx, idx + 800);
    expect(block).toContain("await tryCorrelateInboundMmsC1Job(job.id)");
    expect(block).not.toContain("finalizeVictoryWinMedia");
    expect(b2).not.toContain("void tryCorrelate");
    expect(block).not.toContain("{ now }");
  });

  it("Win persist schedules C1 via after(); does not await correlation inline", () => {
    expect(winWire).toContain("scheduleC1IfWinsDurable");
    expect(solWins).toContain("scheduleC1IfWinsDurable");
    const persistIdx = winWire.indexOf("export async function persistInboundRecognizedWinsBeforeSend");
    const persistFn = winWire.slice(persistIdx, persistIdx + 4500);
    expect(persistFn).toContain("scheduleC1IfWinsDurable");
    expect(persistFn).not.toContain("await tryCorrelateAwaitingInboundMmsForMessageSid");
    expect(c1).toContain("after(async () =>");
    expect(c1).toContain("await tryCorrelateAwaitingInboundMmsForMessageSid");
    expect(c1).not.toMatch(/void\s+tryCorrelateAwaitingInboundMmsForMessageSid/);
  });

  it("semantic hook cannot block Coach SMS (after persist, not before send path rewrite)", () => {
    expect(coach).toContain("maybePersistInboundWinRecognitionBundle");
    expect(coach).toContain("commitAndSendInboundCoachReply");
    expect(winWire).toContain("scheduleC1IfWinsDurable");
    const persistStart = winWire.indexOf(
      "export async function persistInboundRecognizedWinsBeforeSend"
    );
    expect(persistStart).toBeGreaterThan(0);
    const persistFn = winWire.slice(persistStart, persistStart + 4500);
    const persistCall = persistFn.lastIndexOf("await persistRecognizedWins");
    const hookCall = persistFn.lastIndexOf("scheduleC1IfWinsDurable");
    expect(persistCall).toBeGreaterThan(0);
    expect(hookCall).toBeGreaterThan(persistCall);
  });

  it("pipeline opportunistic C1 is max 1 after B1/B2; no new cron/env/flag", () => {
    expect(pipe).toContain("INBOUND_MEDIA_PIPELINE_C1_LIMIT");
    expect(c1).toContain("INBOUND_MEDIA_PIPELINE_C1_LIMIT = 1");
    expect(pipe).toContain("listInboundMediaJobsForC1");
    const b2BlockEnd = pipe.indexOf("c1Attempted");
    expect(b2BlockEnd).toBeGreaterThan(0);
    expect(c1).not.toMatch(/process\.env\./);
    expect(c1).not.toMatch(/VICTORY_MEDIA_MMS_C1/);
    expect(vercel).not.toMatch(/mms-c1|inbound.media.c1/i);
  });

  it("kind-specific terminal validators never chain a different terminal kind", () => {
    const blockStart = c1.indexOf("function staleTerminalRetry");
    const blockEnd = c1.indexOf(
      "export async function evaluateAndApplyInboundMmsC1Job"
    );
    expect(blockStart).toBeGreaterThan(0);
    expect(blockEnd).toBeGreaterThan(blockStart);
    const body = c1.slice(blockStart, blockEnd);
    expect(body).toContain("validateAmbiguousWinsStillTrue");
    expect(body).toContain("validateAmbiguousMediaStillTrue");
    expect(body).toContain("validateWebPriorityStillTrue");
    expect(body).toContain("validateOtherMmsStillTrue");
    expect(body).toContain("stale_ambiguous_wins");
    expect(body).toContain("stale_ambiguous_media");
    expect(body).toContain("stale_web_priority");
    expect(body).toContain("stale_other_mms_occupied");
    expect(body).toContain("staleTerminalRetry");
    expect(body).not.toContain("evaluateAwaitingInboundMmsAttachment");
    expect(body).not.toContain("same_mms_replay");
    expect(body).not.toContain("loadC1ExternalFacts");
    expect(body).toContain('kind: "error_retry"');
    expect(body).not.toContain("skipped_conflict");
  });

  it("ATTACH_ELIGIBLE apply path arms retry without attached fields", () => {
    const apply = c1.slice(c1.indexOf("export async function applyInboundMmsC1Decision"));
    expect(apply).toContain('if (d.kind === "attach_eligible")');
    expect(apply).toContain('waitPatch(now, "attach_eligible")');
    const replay = apply.slice(apply.indexOf('d.kind === "same_mms_replay"'));
    expect(replay).toContain('status: "attached"');
    const attachEligiblePatch = apply.slice(
      apply.indexOf('if (d.kind === "attach_eligible")'),
      apply.indexOf('d.kind === "waiting_for_win"')
    );
    expect(attachEligiblePatch).not.toContain('status: "attached"');
    expect(attachEligiblePatch).not.toContain("attached_win_id: d.winId");
  });

  it("sibling cardinality probe is LIMIT 2; SID eval and pipeline are LIMIT 1", () => {
    expect(c1).toContain("INBOUND_MEDIA_C1_SID_CARDINALITY_LIMIT = 2");
    expect(c1).toContain("INBOUND_MEDIA_C1_SID_JOB_EVAL_LIMIT = 1");
    expect(c1).toContain("INBOUND_MEDIA_PIPELINE_C1_LIMIT = 1");
    expect(c1).not.toContain("INBOUND_MEDIA_C1_SID_JOB_CAP = 5");
  });
});
