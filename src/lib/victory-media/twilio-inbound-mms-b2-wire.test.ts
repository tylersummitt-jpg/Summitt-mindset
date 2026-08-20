import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/twilio/inbound/route.ts");
const PROC = path.join(
  process.cwd(),
  "src/lib/victory-media/process-inbound-media-b2.ts"
);
const PIPE = path.join(
  process.cwd(),
  "src/lib/victory-media/kick-inbound-media-pipeline.ts"
);
const CLAIM = path.join(
  process.cwd(),
  "src/lib/victory-media/claim-inbound-media-job.ts"
);
const VERCEL = path.join(process.cwd(), "vercel.json");

describe("twilio inbound — MMS B2 wire", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const proc = fs.readFileSync(PROC, "utf8");
  const pipe = fs.readFileSync(PIPE, "utf8");
  const claim = fs.readFileSync(CLAIM, "utf8");
  const vercel = fs.readFileSync(VERCEL, "utf8");

  it("after() awaits pipeline (no detached promise, no new cron/env/flag)", () => {
    expect(src).toContain("kickInboundMediaPipeline");
    expect(src).toContain("after(async () =>");
    const fn = src.slice(src.indexOf("function scheduleInboundMediaPipelineKick"));
    const body = fn.slice(0, fn.indexOf("/** HELP"));
    expect(body).toContain("await kickInboundMediaPipeline()");
    expect(body).not.toMatch(/void\s+kickInboundMediaPipeline/);
    expect(src).not.toContain("VICTORY_MEDIA_MMS_DOWNLOAD_ENABLED");
    expect(src).not.toContain("VICTORY_MEDIA_MMS_WORKER_ENABLED");
    expect(src).not.toContain("VICTORY_MEDIA_MMS_NORMALIZE");
    expect(vercel).not.toMatch(/mms/i);
  });

  it("pipeline is max one B1 and max one B2; oldest listed B2 outranks fresh B1", () => {
    expect(pipe).toContain("INBOUND_MEDIA_PIPELINE_B1_LIMIT = 1");
    expect(pipe).toContain("INBOUND_MEDIA_PIPELINE_B2_LIMIT = 1");
    expect(pipe).toContain("selectInboundMediaPipelineB2Target");
    expect(pipe).toContain("processInboundMediaJobB2AfterSuccessfulB1");
    expect(pipe).not.toContain("forceClaim");
    expect(proc).not.toContain("forceClaim");
    expect(claim).toContain("claimInboundMediaJobForNormalizeAfterSuccessfulB1");
    expect(claim).not.toMatch(/opts\?: \{ now\?: Date; bypassLease/);
  });

  it("B2 processor never contacts Twilio, OpenAI, or the canonical finalizer; C1 correlation is DB-only", () => {
    expect(proc).toContain('kind: "supabase_object"');
    expect(proc).toContain("normalizeVictoryImage");
    expect(proc).not.toContain("downloadTwilioMmsMediaBytes");
    expect(proc).not.toContain("finalizeVictoryWinMedia");
    expect(proc).not.toMatch(/\bopenai\b/i);
    expect(proc).not.toContain("splitIntoChunks");
    expect(proc).not.toContain("buildTwimlResponse");
    expect(proc).toContain("victoryMediaMmsNormMasterPath");
    expect(proc).toContain("victoryMediaMmsNormCardPath");
    expect(proc).not.toContain("victoryMediaMasterPath");
    expect(proc).toContain("tryCorrelateInboundMmsC1Job");
  });

  it("Body mode lookup selects id only (no raw_body)", () => {
    expect(proc).toContain('.from("sms_inbound_messages")');
    expect(proc).toContain('.select("id")');
    expect(proc).not.toContain("raw_body");
  });

  it("B2 failure/expiry CAS matches claimed attempt, not id only", () => {
    expect(proc).toContain("casOwnedB2Attempt");
    expect(proc).toContain('.eq("attempt_count", args.claimed.attempt_count)');
    expect(proc).toContain('.eq("updated_at", args.claimed.updated_at)');
    expect(proc).toContain('.eq("temp_storage_path", args.claimed.temp_storage_path)');
    expect(proc).not.toMatch(/\.eq\("id", args\.jobId\)\s*;/);
    expect(proc).not.toMatch(/async function markExpired\(jobId: string/);
  });

  it("B1 failed discovery requires null temp", () => {
    expect(claim).toContain('.is("temp_storage_path", null)');
    expect(claim).toContain("INBOUND_MEDIA_B2_LEASE_MS = 5 * 60 * 1000");
    expect(claim).toContain("INBOUND_MEDIA_B2_MAX_ATTEMPTS = 10");
    expect(claim).toContain("INBOUND_MEDIA_B2_EXPIRES_MS = 72 * 60 * 60 * 1000");
  });
});
