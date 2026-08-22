import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const D2B = path.join(ROOT, "src/lib/victory-media/inbound-mms-d2b.ts");
const SEM = path.join(ROOT, "src/lib/victory-media/inbound-mms-d2b-semantics.ts");
const ELIG = path.join(
  ROOT,
  "src/lib/victory-media/inbound-mms-d2b-eligibility.ts"
);
const CODES = path.join(ROOT, "src/lib/victory-media/inbound-mms-d2b-codes.ts");
const PIPE = path.join(
  ROOT,
  "src/lib/victory-media/kick-inbound-media-pipeline.ts"
);
const CRON = path.join(ROOT, "src/app/api/cron/victory-media/route.ts");
const C1 = path.join(ROOT, "src/lib/victory-media/correlate-inbound-mms-c1.ts");
const C2 = path.join(ROOT, "src/lib/victory-media/attach-inbound-mms-c2.ts");
const VERCEL = path.join(ROOT, "vercel.json");
const MIGRATION = path.join(
  ROOT,
  "supabase/migrations/20260822120000_v2_inbound_media_job_clarification_body.sql"
);

describe("inbound MMS D2b wire", () => {
  const d2b = fs.readFileSync(D2B, "utf8");
  const sem = fs.readFileSync(SEM, "utf8");
  const elig = fs.readFileSync(ELIG, "utf8");
  const codes = fs.readFileSync(CODES, "utf8");
  const pipe = fs.readFileSync(PIPE, "utf8");
  const cron = fs.readFileSync(CRON, "utf8");
  const c1 = fs.readFileSync(C1, "utf8");
  const c2 = fs.readFileSync(C2, "utf8");
  const vercel = fs.readFileSync(VERCEL, "utf8");
  const migration = fs.readFileSync(MIGRATION, "utf8");

  it("uses sendSMSChunked with lastOutbound question, never Twilio SDK", () => {
    expect(d2b).toContain("sendSMSChunked");
    expect(d2b).toContain('messageKind: "question"');
    expect(d2b).toContain("fullBodyForContext");
    expect(d2b).not.toContain("messages.create");
    expect(d2b).not.toContain("twilio.messages");
    expect(d2b).not.toMatch(/from\("twilio"\)/);
    expect(d2b).not.toContain("getTwilioClient");
  });

  it("does not create Wins, fake inbound, coach jobs, or use vision", () => {
    for (const src of [d2b, sem, elig, codes]) {
      expect(src).not.toMatch(/\.from\("v2_win"\)\s*\.(insert|update|delete)/);
      expect(src).not.toMatch(/\.from\("sms_inbound_messages"\)\s*\.insert/);
      expect(src).not.toContain("sms_inbound_coach_jobs");
      expect(src).not.toMatch(/\bvision\b/i);
      expect(src).not.toContain("image_url");
      expect(src).not.toContain("data:image");
      expect(src).not.toContain("persistRecognizedWins");
    }
    expect(elig).not.toContain("checkInboundCoachSmsEligibility");
  });

  it("does not implement D2c answer pairing", () => {
    expect(d2b).not.toContain("clarification_answer");
    expect(d2b).not.toContain("pairClarification");
    expect(d2b).not.toContain("pending_user_answer");
  });

  it("queue SQL requires D2-owned last_error_code and next_retry_at", () => {
    const list = d2b.slice(
      d2b.indexOf("export async function listInboundMediaJobsForD2")
    );
    expect(list).toContain('.eq("status", "pending_semantics")');
    expect(list).toContain("INBOUND_MEDIA_D2_QUEUE_LAST_ERROR_CODES");
    expect(list).toContain('.not("next_retry_at", "is", null)');
    expect(list).toContain("INBOUND_MEDIA_PIPELINE_D2_LIMIT");
  });

  it("C1/C2 ownership sets do not include D2b codes", () => {
    expect(c1).not.toContain("clarification_due");
    expect(c1).not.toContain("clarification_send_failed");
    expect(c2).not.toContain("clarification_due");
    expect(c2).not.toContain("clarification_send_failed");
  });

  it("reuses existing victory-media cron; no new cron", () => {
    expect(pipe).toContain("listInboundMediaJobsForD2");
    expect(pipe).toContain("processInboundMmsD2Job");
    expect(cron).toContain("await kickInboundMediaPipeline()");
    expect((cron.match(/kickInboundMediaPipeline\(/g) ?? []).length).toBe(1);
    expect(
      (JSON.parse(vercel) as { crons: Array<{ path: string }> }).crons.filter(
        (c) => c.path === "/api/cron/victory-media"
      )
    ).toHaveLength(1);
  });

  it("persists clarification_body via dedicated column, not classifier_target", () => {
    expect(migration).toContain("ADD COLUMN clarification_body TEXT NULL");
    expect(d2b).toContain("clarification_body:");
    expect(d2b).not.toContain("classifier_target:");
    expect(codes).toContain("mms-d2-clarify:");
    expect(d2b).toContain('resolution: "pending_user"');
  });

  it("does not add env/flag/secret", () => {
    expect(d2b).not.toContain("process.env.");
    expect(codes).not.toContain("process.env.");
    expect(elig).not.toContain("process.env.");
    expect(sem).toContain("OPENAI_API_KEY");
    expect(codes).not.toContain('from "@/lib/twilio"');
    expect(codes).toContain("INBOUND_MEDIA_D2B_CLARIFICATION_MAX_LENGTH = 280");
  });

  it("schema/prompt do not treat no_action as a product decision; grace is D2b-owned", () => {
    expect(sem).toContain('enum: ["attach_existing_win", "ask_clarification"]');
    expect(sem).not.toContain(
      'enum: ["attach_existing_win", "ask_clarification", "no_action"]'
    );
    expect(sem).toContain('decision === "no_action"');
    expect(d2b).toContain("return armModelFailed()");
    expect(codes).toContain("INBOUND_MEDIA_D2A_SEMANTIC_GRACE");
    expect(codes).toContain("INBOUND_MEDIA_D2B_OWNED_LAST_ERROR_CODES = [");
  });
});
