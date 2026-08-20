import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/twilio/inbound/route.ts");
const PROC = path.join(
  process.cwd(),
  "src/lib/victory-media/process-inbound-media-b1.ts"
);
const DL = path.join(
  process.cwd(),
  "src/lib/victory-media/download-twilio-mms-media.ts"
);
const PIPE = path.join(
  process.cwd(),
  "src/lib/victory-media/kick-inbound-media-pipeline.ts"
);

describe("twilio inbound — MMS B1 wire", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const proc = fs.readFileSync(PROC, "utf8");
  const dl = fs.readFileSync(DL, "utf8");
  const pipe = fs.readFileSync(PIPE, "utf8");

  it("after() kick schedules pipeline without new cron/env", () => {
    expect(src).toContain("scheduleInboundMediaPipelineKick");
    expect(src).toContain("kickInboundMediaPipeline");
    expect(src).toContain("after(async () =>");
    expect(src).not.toContain("VICTORY_MEDIA_MMS_DOWNLOAD_ENABLED");
    expect(src).not.toContain("VICTORY_MEDIA_MMS_WORKER_ENABLED");
    expect(src).not.toMatch(/crons:[\s\S]*mms/i);
  });

  it("after() awaits pipeline kick (no detached void promise)", () => {
    const fn = src.slice(src.indexOf("function scheduleInboundMediaPipelineKick"));
    const body = fn.slice(0, fn.indexOf("/** HELP"));
    expect(body).toContain("after(async () =>");
    expect(body).toContain("await kickInboundMediaPipeline()");
    expect(body).not.toMatch(/void\s+kickInboundMediaPipeline/);
    expect(body).not.toMatch(/kickInboundMediaPipeline\(\)\s*\n?\s*\.then/);
  });

  it("kick is after enqueue insert and cannot block TwiML", () => {
    const post = src.slice(src.indexOf("export async function POST"));
    const imageBlock = post.slice(
      post.indexOf("No fabricated Body, no sms_inbound_messages, no coach job"),
      post.indexOf('from("sms_inbound_messages")')
    );
    expect(imageBlock).toContain("scheduleInboundMediaPipelineKick");
    expect(imageBlock.indexOf("scheduleInboundMediaPipelineKick")).toBeLessThan(
      imageBlock.indexOf("return fastAckTwiml()")
    );
    expect(imageBlock).not.toContain("await kickInboundMediaPipeline");
  });

  it("download abort classification distinguishes timer timeout vs request_aborted", () => {
    expect(dl).toContain('timedOut = true');
    expect(dl).toContain('"request_aborted"');
    expect(dl).toContain('"timeout"');
    expect(dl).toContain('stage: "first_hop"');
    expect(dl).toContain('stage: "cdn_fetch"');
    expect(dl).toContain('stage: "stream_read"');
  });

  it("processor download_failed log includes stage without secrets", () => {
    expect(proc).toContain("stage: err.stage");
    expect(proc).toContain("abort_name: err.abortName");
    expect(proc).not.toContain("Authorization");
    expect(proc).not.toContain("TWILIO_AUTH_TOKEN");
  });

  it("B1 processor does not normalize / finalize / OpenAI / v2_win_media", () => {
    expect(proc).not.toContain("normalizeVictoryImage");
    expect(proc).not.toContain("finalizeVictoryWinMedia");
    expect(proc).not.toMatch(/\bopenai\b/i);
    expect(proc).not.toContain("v2_win_media");
    expect(proc).not.toContain("/mms-norm/");
    expect(proc).toContain("victoryMediaMmsTempPath");
    expect(proc).toContain('status: "normalizing"');
    expect(proc).toContain("temp_storage_path");
    expect(proc).toContain("storageMimeForSniffedImageFormat");
    expect(proc).toContain("upsert: true");
    expect(proc).not.toContain("application/octet-stream");
  });

  it("download uses redirect manual and locked CDN host", () => {
    expect(dl).toContain('redirect: "manual"');
    expect(dl).toContain("mms.twiliocdn.com");
    expect(dl).toContain("Authorization");
    expect(dl).toContain("Intentionally NO Authorization");
  });

  it("pipeline kick is serial and documents opportunistic recovery", () => {
    expect(pipe).toContain("INBOUND_MEDIA_PIPELINE_B1_LIMIT = 1");
    expect(pipe).toContain("due B2");
    expect(pipe).toContain("leased B2-ready");
  });

  it("claim module never treats normalizing+temp as B1-actionable and uses 15m stale", () => {
    const claimPath = path.join(
      process.cwd(),
      "src/lib/victory-media/claim-inbound-media-job.ts"
    );
    const claimSrc = fs.readFileSync(claimPath, "utf8");
    expect(claimSrc).toContain("INBOUND_MEDIA_B1_STALE_NORMALIZING_MS = 15 * 60 * 1000");
    expect(claimSrc).toContain("isInboundMediaJobB1Complete");
    expect(claimSrc).toContain("stale_normalizing_abandoned");
  });

  it("no new MMS download/worker feature flags in B1 modules", () => {
    expect(proc).not.toContain("VICTORY_MEDIA_MMS_DOWNLOAD_ENABLED");
    expect(pipe).not.toContain("VICTORY_MEDIA_MMS_DOWNLOAD_ENABLED");
    expect(dl).not.toContain("VICTORY_MEDIA_MMS_DOWNLOAD_ENABLED");
  });
});
