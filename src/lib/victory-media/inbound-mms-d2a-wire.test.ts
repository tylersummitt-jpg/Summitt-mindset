import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const D2A = path.join(process.cwd(), "src/lib/victory-media/inbound-mms-d2a.ts");
const SEM = path.join(
  process.cwd(),
  "src/lib/victory-media/inbound-mms-d2a-semantics.ts"
);
const CODES = path.join(
  process.cwd(),
  "src/lib/victory-media/inbound-mms-d2a-codes.ts"
);
const B2 = path.join(
  process.cwd(),
  "src/lib/victory-media/process-inbound-media-b2.ts"
);
const C1 = path.join(
  process.cwd(),
  "src/lib/victory-media/correlate-inbound-mms-c1.ts"
);
const C2 = path.join(
  process.cwd(),
  "src/lib/victory-media/attach-inbound-mms-c2.ts"
);
const PIPE = path.join(
  process.cwd(),
  "src/lib/victory-media/kick-inbound-media-pipeline.ts"
);
const CRON = path.join(
  process.cwd(),
  "src/app/api/cron/victory-media/route.ts"
);
const VERCEL = path.join(process.cwd(), "vercel.json");
const MIGRATIONS = path.join(process.cwd(), "supabase/migrations");

describe("inbound MMS D2a wire", () => {
  const d2a = fs.readFileSync(D2A, "utf8");
  const sem = fs.readFileSync(SEM, "utf8");
  const codes = fs.readFileSync(CODES, "utf8");
  const b2 = fs.readFileSync(B2, "utf8");
  const c1 = fs.readFileSync(C1, "utf8");
  const c2 = fs.readFileSync(C2, "utf8");
  const pipe = fs.readFileSync(PIPE, "utf8");
  const cron = fs.readFileSync(CRON, "utf8");
  const vercel = fs.readFileSync(VERCEL, "utf8");

  it("B2 image-only arms semantic_due; body+photo does not", () => {
    expect(b2).toContain("INBOUND_MEDIA_D2A_SEMANTIC_DUE");
    expect(b2).toContain('nextStatus === "pending_semantics"');
    expect(b2).toContain('nextStatus === "awaiting_attach"');
    expect(b2).not.toContain("ask_clarification");
  });

  it("D2a is last in the existing pipeline with limit 1 and no new cron", () => {
    expect(pipe).toContain("listInboundMediaJobsForD2");
    expect(pipe).toContain("processInboundMmsD2Job");
    expect(pipe.indexOf("listD2(")).toBeGreaterThan(pipe.indexOf("listC2("));
    expect(pipe).toContain("INBOUND_MEDIA_PIPELINE_D2_LIMIT");
    expect(cron).toContain("await kickInboundMediaPipeline()");
    expect((cron.match(/kickInboundMediaPipeline\(/g) ?? []).length).toBe(1);
    expect(vercel).toContain('"/api/cron/victory-media"');
    expect(
      (JSON.parse(vercel) as { crons: Array<{ path: string }> }).crons.filter(
        (c) => c.path === "/api/cron/victory-media"
      )
    ).toHaveLength(1);
  });

  it("sends no SMS and does not create Wins, fake inbound, or use vision", () => {
    for (const src of [d2a, sem, codes]) {
      expect(src).not.toContain("sendSMS");
      expect(src).not.toContain("sendSMSChunked");
      expect(src).not.toContain("messages.create");
      expect(src).not.toContain("twilio.messages");
      expect(src).not.toMatch(/\bvision\b/i);
      expect(src).not.toContain("persistRecognizedWins");
      expect(src).not.toContain("ask_clarification");
      expect(src).not.toContain("pending_user");
      expect(src).not.toContain("clarification_body");
      expect(src).not.toContain("wait_for_user");
    }
    expect(d2a).not.toMatch(/\.from\("v2_win"\)\s*\.(insert|update|delete)/);
    expect(d2a).not.toMatch(/\.from\("sms_inbound_messages"\)\s*\.insert/);
    expect(d2a).not.toContain("sms_inbound_coach_jobs");
    expect(sem).not.toContain("image_url");
    expect(sem).not.toContain("data:image");
    expect(d2a).toContain("buildRecentExactThread72h");
    expect(d2a).toContain("claimInboundMediaJobSemanticTarget");
    expect(d2a).toContain("expectedResolution: null");
    expect(d2a).toContain("listInboundMmsD1EligiblePendingJobs");
  });

  it("queue SQL is D2a-owned codes only and does not JS-filter all pending_semantics", () => {
    const list = d2a.slice(d2a.indexOf("export async function listInboundMediaJobsForD2a"));
    expect(list).toContain('.eq("status", "pending_semantics")');
    expect(list).toContain('.in("last_error_code"');
    expect(list).toContain("INBOUND_MEDIA_D2A_OWNED_LAST_ERROR_CODES");
    expect(list).toContain('.not("next_retry_at", "is", null)');
    expect(list).not.toContain("Math.min(25");
    expect(list).toContain("INBOUND_MEDIA_PIPELINE_D2A_LIMIT");
  });

  it("C1/C2 ownership sets do not include D2a codes", () => {
    expect(c1).not.toContain("semantic_due");
    expect(c1).not.toContain("semantic_grace");
    expect(c1).not.toContain("semantic_model_failed");
    expect(c2).not.toContain("semantic_due");
    expect(c2).not.toContain("semantic_grace");
    expect(c2).not.toContain("semantic_model_failed");
  });

  it("does not add a migration, env, flag, or secret", () => {
    expect(d2a).not.toContain("process.env.");
    expect(codes).not.toContain("process.env.");
    expect(sem).toContain("OPENAI_API_KEY");
    expect(d2a).not.toContain("VICTORY_MEDIA_MMS");
    expect(fs.existsSync(MIGRATIONS)).toBe(true);
    const added = fs
      .readdirSync(MIGRATIONS)
      .filter((f) => f.toLowerCase().includes("d2a") || f.toLowerCase().includes("semantic_due"));
    expect(added).toEqual([]);
  });

  it("model contract is attach_existing_win | no_attach only", () => {
    expect(sem).toContain('"attach_existing_win"');
    expect(sem).toContain('"no_attach"');
    expect(sem).not.toContain("ask_clarification");
    expect(d2a).toContain("INBOUND_MEDIA_D2A_SEMANTIC_GRACE");
    expect(d2a).not.toContain("writeInboundSolBody");
    expect(d2a).not.toContain("runInboundSolBriefInterpreter");
  });
});
