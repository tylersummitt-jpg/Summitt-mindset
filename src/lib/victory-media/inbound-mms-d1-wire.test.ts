import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("next/server", () => ({
  after: vi.fn(),
}));

const D1_PENDING = path.join(
  process.cwd(),
  "src/lib/victory-media/inbound-mms-d1-pending-context.ts"
);
const D1_CLAIM = path.join(
  process.cwd(),
  "src/lib/victory-media/inbound-mms-d1-claim.ts"
);
const PACKET = path.join(process.cwd(), "src/lib/inbound-relationship-packet.ts");
const TURN = path.join(process.cwd(), "src/lib/inbound-sol-relationship-turn.ts");
const INTERPRETER = path.join(
  process.cwd(),
  "src/lib/inbound-sol-brief-interpreter.ts"
);
const SCHEMA = path.join(process.cwd(), "src/lib/inbound-sol-brief-json-schema.ts");
const WRITER = path.join(process.cwd(), "src/lib/inbound-sol-writer.ts");
const TWILIO = path.join(process.cwd(), "src/app/api/twilio/inbound/route.ts");
const B2 = path.join(process.cwd(), "src/lib/victory-media/process-inbound-media-b2.ts");
const C1 = path.join(process.cwd(), "src/lib/victory-media/correlate-inbound-mms-c1.ts");
const C2 = path.join(process.cwd(), "src/lib/victory-media/attach-inbound-mms-c2.ts");
const PIPE = path.join(
  process.cwd(),
  "src/lib/victory-media/kick-inbound-media-pipeline.ts"
);
const CRON = path.join(process.cwd(), "src/app/api/cron/victory-media/route.ts");
const SAFETY = path.join(
  process.cwd(),
  "src/app/api/cron/sms-inbound-coach/route.ts"
);
const CLAIM_JOB = path.join(
  process.cwd(),
  "src/lib/victory-media/claim-inbound-media-job.ts"
);

describe("inbound MMS D1 wire", () => {
  const pending = fs.readFileSync(D1_PENDING, "utf8");
  const claim = fs.readFileSync(D1_CLAIM, "utf8");
  const packet = fs.readFileSync(PACKET, "utf8");
  const turn = fs.readFileSync(TURN, "utf8");
  const interpreter = fs.readFileSync(INTERPRETER, "utf8");
  const schema = fs.readFileSync(SCHEMA, "utf8");
  const writer = fs.readFileSync(WRITER, "utf8");
  const twilio = fs.readFileSync(TWILIO, "utf8");
  const b2 = fs.readFileSync(B2, "utf8");
  const c1 = fs.readFileSync(C1, "utf8");
  const c2 = fs.readFileSync(C2, "utf8");
  const pipe = fs.readFileSync(PIPE, "utf8");
  const cron = fs.readFileSync(CRON, "utf8");
  const safety = fs.readFileSync(SAFETY, "utf8");

  it("loads pending facts on the Sol packet before the existing interpreter call", () => {
    expect(packet).toContain("loadInboundMmsD1PendingContext");
    expect(packet).toContain("pending_media_context");
    expect(turn).toContain("runInboundSolBriefInterpreter({ packet })");
    expect(turn.split("runInboundSolBriefInterpreter({").length - 1).toBe(1);
    const loadIdx = turn.indexOf("await loadInboundRelationshipPacket");
    const interpIdx = turn.indexOf("await runInboundSolBriefInterpreter");
    expect(interpIdx).toBeGreaterThan(loadIdx);
  });

  it("does not add a second OpenAI call or vision input", () => {
    expect(pending).not.toMatch(/\bopenai\b/i);
    expect(claim).not.toMatch(/\bopenai\b/i);
    expect(pending).not.toContain("download");
    expect(claim).not.toContain("sharp");
    expect(pending).not.toContain("data:image");
    expect(interpreter).toContain("You never receive image bytes, URLs, or Storage paths");
    expect(schema).toContain("pending_photo_relation");
  });

  it("schedules D0 claim after persist and does not await C2/Storage", () => {
    const persistCall = turn.lastIndexOf("await persistSolInboundWins");
    const d1Call = turn.lastIndexOf("scheduleInboundMmsD1SemanticClaim(");
    const writerIdx = turn.lastIndexOf("await writeInboundSolBody");
    expect(persistCall).toBeGreaterThan(0);
    expect(d1Call).toBeGreaterThan(persistCall);
    expect(writerIdx).toBeGreaterThan(d1Call);
    expect(turn).not.toContain("await scheduleInboundMmsD1SemanticClaim");
    expect(turn).not.toContain("tryAttachInboundMmsC2Job");
    expect(turn).not.toContain("evaluateAndAttachInboundMmsC2Job");
    expect(claim).toContain("claimInboundMediaJobSemanticTarget");
    expect(claim).toContain("afterFn");
    expect(claim).toContain("listInboundMmsD1EligiblePendingJobs");
    expect(claim).toContain("inboundMmsD1OriginalJobStillSoleEligible");
    expect(claim).not.toMatch(/latest photo/i);
    expect(claim).not.toMatch(/if\s*\(.*age_seconds/);
    expect(pending).toContain("INBOUND_MEDIA_D1_PENDING_LOOKBACK_MS = 30 * 60 * 1000");
    expect(pending).not.toContain("24 * 60 * 60 * 1000");
    expect(pending).not.toMatch(/if\s*\(.*age_seconds/);
    expect(pending).not.toContain(".update(");
    expect(claim).not.toContain(".update(");
    expect(fs.readFileSync(CLAIM_JOB, "utf8")).toContain(
      "INBOUND_MEDIA_B2_EXPIRES_MS = 72 * 60 * 60 * 1000"
    );
    expect(interpreter).toContain("Elapsed time by itself is never enough to pair");
    expect(interpreter).toContain(
      "Awesome family day today! Loved spending time with Brooke and the kids."
    );
  });

  it("does not implement D1 loaders on the media pipeline or cron", () => {
    expect(pipe).not.toContain("loadInboundMmsD1PendingContext");
    expect(pipe).not.toContain("scheduleInboundMmsD1SemanticClaim");
    expect(cron).not.toContain("scheduleInboundMmsD1SemanticClaim");
    expect(b2).not.toContain("pending_photo_relation");
    expect(b2).toContain("pending_semantics");
  });

  it("does not change C1/C2/B2/Twilio runtime", () => {
    expect(c1).not.toContain("scheduleInboundMmsD1SemanticClaim");
    expect(c1).not.toContain("loadInboundMmsD1PendingContext");
    expect(c2).not.toContain("scheduleInboundMmsD1SemanticClaim");
    expect(c2).not.toContain("loadInboundMmsD1PendingContext");
    expect(twilio).not.toContain("scheduleInboundMmsD1SemanticClaim");
    expect(twilio).not.toContain("loadInboundMmsD1PendingContext");
    expect(twilio).toContain("isStopCommand");
    expect(twilio).toContain("imageOnly");
  });

  it("STOP/HELP/START and safety remain before Sol/D1", () => {
    expect(twilio.indexOf("isStopCommand")).toBeGreaterThan(0);
    expect(twilio.indexOf("ensureCoachJobPresent")).toBeGreaterThan(
      twilio.indexOf("isStopCommand")
    );
    const handleStart = safety.indexOf("async function handleV2SmsInboundCoachJob");
    const handleBody = safety.slice(handleStart);
    const safetyCall = handleBody.indexOf("processInboundSmsSafetyShortCircuit");
    const normalCall = handleBody.indexOf("processV2NormalInboundOutcome");
    expect(handleStart).toBeGreaterThan(0);
    expect(safetyCall).toBeGreaterThan(0);
    expect(normalCall).toBeGreaterThan(safetyCall);
    expect(handleBody).not.toContain("scheduleInboundMmsD1SemanticClaim");
  });

  it("writer is not taught to claim a saved photo", () => {
    expect(writer).not.toContain("saved that picture");
    expect(writer).not.toContain("added that picture");
    expect(writer.toLowerCase()).not.toContain("your photo is in the victory room");
    expect(writer).toContain("toWriterFacingInboundRelationshipPacket");
    expect(writer).toContain("toWriterFacingInboundCoachingBrief");
    expect(writer).toContain(
      "Do not claim a photo or picture was saved, attached, added, or stored."
    );
  });
});
