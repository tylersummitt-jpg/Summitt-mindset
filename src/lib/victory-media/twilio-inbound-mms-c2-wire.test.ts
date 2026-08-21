import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const C2 = path.join(process.cwd(), "src/lib/victory-media/attach-inbound-mms-c2.ts");
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
const TWILIO = path.join(process.cwd(), "src/app/api/twilio/inbound/route.ts");
const CRON = path.join(process.cwd(), "src/app/api/cron/victory-media/route.ts");
const ENRICH = path.join(
  process.cwd(),
  "src/lib/victory-media/enrich-public-wins-with-media.ts"
);

describe("twilio inbound — MMS C2 wire", () => {
  const c2 = fs.readFileSync(C2, "utf8");
  const c1 = fs.readFileSync(C1, "utf8");
  const b2 = fs.readFileSync(B2, "utf8");
  const pipe = fs.readFileSync(PIPE, "utf8");
  const winWire = fs.readFileSync(WIN_WIRE, "utf8");
  const solWins = fs.readFileSync(SOL_WINS, "utf8");
  const twilio = fs.readFileSync(TWILIO, "utf8");
  const cron = fs.readFileSync(CRON, "utf8");
  const enrich = fs.readFileSync(ENRICH, "utf8");

  it("pipeline order is B1 → B2 → C1 → C2 with limit 1", () => {
    expect(pipe).toContain("INBOUND_MEDIA_PIPELINE_C2_LIMIT");
    expect(c2).toContain("INBOUND_MEDIA_PIPELINE_C2_LIMIT = 1");
    const b1 = pipe.indexOf("listB1(");
    const b2i = pipe.indexOf("listB2(");
    const c1i = pipe.indexOf("listC1(");
    const c2i = pipe.indexOf("listC2(");
    expect(b1).toBeGreaterThan(0);
    expect(b2i).toBeGreaterThan(b1);
    expect(c1i).toBeGreaterThan(b2i);
    expect(c2i).toBeGreaterThan(c1i);
  });

  it("B2 and C1 apply do not call C2; persist hook does not call C2", () => {
    expect(b2).not.toContain("tryAttachInboundMmsC2Job");
    expect(b2).not.toContain("evaluateAndAttachInboundMmsC2Job");
    expect(c1).not.toContain("tryAttachInboundMmsC2Job");
    expect(c1).not.toContain("evaluateAndAttachInboundMmsC2Job");
    expect(winWire).not.toContain("tryAttachInboundMmsC2Job");
    expect(solWins).not.toContain("tryAttachInboundMmsC2Job");
  });

  it("Twilio route is unchanged besides pipeline result shape logging", () => {
    expect(twilio).toContain("await kickInboundMediaPipeline()");
    expect(twilio).not.toContain("tryAttachInboundMmsC2Job");
    expect(twilio).not.toContain("finalizeVictoryWinMedia");
  });

  it("cron still kicks the pipeline once and does not implement C2 itself", () => {
    expect(cron).toContain("await kickInboundMediaPipeline()");
    expect(cron).not.toContain("tryAttachInboundMmsC2Job");
    expect(cron).toContain("c2Attempted");
  });

  it("C1 due list excludes C2-owned last_error_code in SQL", () => {
    const list = c1.slice(c1.indexOf("export async function listInboundMediaJobsForC1"));
    expect(list).toContain(".or(");
    expect(list).toContain("last_error_code.is.null");
    expect(list).toContain(
      "last_error_code.not.in.(attach_eligible,c2_storage_read_failed,c2_metadata_failed,c2_finalize_failed,c2_stale_ownership)"
    );
    expect(list).not.toContain("fetchN");
    expect(list).not.toContain("Math.min(25");
  });

  it("C2 due list SQL-filters attach_eligible/c2_* and does not over-fetch", () => {
    const list = c2.slice(c2.indexOf("export async function listInboundMediaJobsForC2"));
    expect(list).toContain('.in("last_error_code"');
    expect(list).toContain("attach_eligible");
    expect(list).toContain("c2_storage_read_failed");
    expect(list).toContain("c2_stale_ownership");
    expect(list).not.toContain("Math.min(25, n * 10)");
  });

  it("C2 never sends SMS, calls OpenAI/vision, or creates Wins", () => {
    expect(c2).not.toMatch(/\bopenai\b/i);
    expect(c2).not.toContain("sendSMS");
    expect(c2).not.toContain("buildTwimlResponse");
    expect(c2).not.toContain("persistRecognizedWins");
    expect(c2).not.toContain('.eq("status", "pending_semantics")');
    expect(c2).not.toContain("inboundJobId");
  });

  it("C2 uses job.id as media id and does not re-normalize", () => {
    expect(c2).toContain("mediaId: job.id");
    expect(c2).not.toContain("normalizeVictoryImage");
    expect(c2).toContain("userSelected: false");
    expect(c2).toContain('sourceType: "inbound_mms"');
  });

  it("Victory Room enrich does not filter source_type", () => {
    expect(enrich).toContain("PUBLIC_WIN_MEDIA_SELECT_COLUMNS");
    expect(enrich).not.toContain("source_type");
    expect(enrich).not.toContain("inbound_mms");
  });
});
