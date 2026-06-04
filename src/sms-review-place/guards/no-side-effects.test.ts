import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const REVIEW_ROOT = path.join(REPO_ROOT, "src", "sms-review-place");

const FORBIDDEN_SUBSTRINGS = [
  "@/lib/twilio",
  "lib/twilio",
  "sendSMSChunked",
  "sendSMS(",
  "api/cron/daily-sms",
  "api/cron/sms-inbound-coach",
  "api/cron/weekly-sms",
  "api/twilio/inbound",
  "operator-sms-qa",
  "internal/sms-qa",
  "supabase-server",
  "v2-inbound-accountability-outcome-persist",
  "sms-meaning-interpreter-shadow",
  "v2-sms-comms-preferences-writer",
  "loadSmsVictoryBackgroundContext",
  "buildRecentExactThread72h",
  "buildSmsRelationshipMemoryPacket",
  "@clerk/nextjs",
  'from "stripe"',
  'from "openai"',
  'import OpenAI',
  "NextRequest",
  "NextResponse",
  "app/api/cron",
];

const REAL_OPENAI_TEST = "run-review-real-openai.test.ts";
const REAL_OPENAI_RUNNER = "run-review-runner.ts";
const REAL_OPENAI_TEST_MARKERS = ["SMS_REVIEW_REAL_OPENAI", "describe.runIf"];
const REAL_OPENAI_RUNNER_GATE_MARKERS = [
  "SMS_REVIEW_ACK_NETWORK",
  "SMS_REVIEW_ACK_FAKE_USERS_ONLY",
  "GITHUB_ACTIONS",
  "NODE_ENV",
  "assertRealOpenAiGates",
];

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTsFiles(full).forEach((f) => out.push(f));
    else if (ent.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function isTestModule(filePath: string): boolean {
  return filePath.endsWith(".test.ts");
}

function assertNoForbidden(content: string, rel: string): void {
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    if (content.includes(forbidden)) {
      throw new Error(`Forbidden substring "${forbidden}" in ${rel}`);
    }
  }
}

describe("SMS Review Place — no side-effect imports", () => {
  it("non-test modules do not import forbidden production surfaces", () => {
    const files = walkTsFiles(REVIEW_ROOT).filter((f) => !isTestModule(f));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const rel = path.relative(REVIEW_ROOT, file);
      const content = fs.readFileSync(file, "utf8");
      assertNoForbidden(content, rel);
    }
  });

  it("run-review.test.ts does not import twilio or cron routes", () => {
    const content = fs.readFileSync(path.join(REVIEW_ROOT, "run-review.test.ts"), "utf8");
    expect(content).not.toContain("@/lib/twilio");
    expect(content).not.toContain("api/cron/daily-sms");
    expect(content).toContain('vi.mock("openai"');
  });

  it("run-review-real-openai.test.ts has skip gate and no OpenAI mock", () => {
    const filePath = path.join(REVIEW_ROOT, REAL_OPENAI_TEST);
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).not.toContain('vi.mock("openai"');
    for (const marker of REAL_OPENAI_TEST_MARKERS) {
      expect(content).toContain(marker);
    }
    const realForbidden = FORBIDDEN_SUBSTRINGS.filter((s) => s !== "supabase-server");
    for (const forbidden of realForbidden) {
      if (content.includes(forbidden)) {
        throw new Error(`Forbidden substring "${forbidden}" in ${REAL_OPENAI_TEST}`);
      }
    }
  });

  it("run-review-runner.ts implements real OpenAI safety gates", () => {
    const content = fs.readFileSync(path.join(REVIEW_ROOT, REAL_OPENAI_RUNNER), "utf8");
    for (const marker of REAL_OPENAI_RUNNER_GATE_MARKERS) {
      expect(content).toContain(marker);
    }
    expect(content).toContain("CI");
  });
});
