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
const KICK = path.join(process.cwd(), "src/lib/victory-media/kick-inbound-media-b1.ts");

describe("twilio inbound — MMS B1 wire", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const proc = fs.readFileSync(PROC, "utf8");
  const dl = fs.readFileSync(DL, "utf8");
  const kick = fs.readFileSync(KICK, "utf8");

  it("after() kick schedules B1 without new cron/env", () => {
    expect(src).toContain("scheduleInboundMediaB1Kick");
    expect(src).toContain("kickInboundMediaB1Downloads");
    expect(src).toContain("after(() =>");
    expect(src).not.toContain("VICTORY_MEDIA_MMS_DOWNLOAD_ENABLED");
    expect(src).not.toContain("VICTORY_MEDIA_MMS_WORKER_ENABLED");
    expect(src).not.toMatch(/crons:[\s\S]*mms/i);
  });

  it("kick is after enqueue insert and cannot block TwiML", () => {
    const post = src.slice(src.indexOf("export async function POST"));
    const imageBlock = post.slice(
      post.indexOf("No fabricated Body, no sms_inbound_messages, no coach job"),
      post.indexOf('from("sms_inbound_messages")')
    );
    expect(imageBlock).toContain("scheduleInboundMediaB1Kick");
    expect(imageBlock.indexOf("scheduleInboundMediaB1Kick")).toBeLessThan(
      imageBlock.indexOf("return fastAckTwiml()")
    );
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
  });

  it("download uses redirect manual and locked CDN host", () => {
    expect(dl).toContain('redirect: "manual"');
    expect(dl).toContain("mms.twiliocdn.com");
    expect(dl).toContain("Authorization");
    expect(dl).toContain("Intentionally NO Authorization");
  });

  it("batch limit is tiny (2) and kick documents opportunistic recovery", () => {
    expect(kick).toContain("INBOUND_MEDIA_B1_BATCH_LIMIT = 2");
    expect(kick).toContain("due failed");
    expect(kick).toContain("stale normalizing");
  });

  it("claim module never treats normalizing+temp as actionable and uses 15m stale", () => {
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
    expect(kick).not.toContain("VICTORY_MEDIA_MMS_DOWNLOAD_ENABLED");
    expect(dl).not.toContain("VICTORY_MEDIA_MMS_DOWNLOAD_ENABLED");
  });
});
