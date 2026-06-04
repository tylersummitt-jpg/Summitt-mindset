/**
 * SMS Review Place — manual real OpenAI dry-run (skipped unless explicitly enabled).
 *
 * Requires SMS_REVIEW_REAL_OPENAI=1, SMS_REVIEW_ACK_NETWORK=1,
 * SMS_REVIEW_ACK_FAKE_USERS_ONLY=1, and a real OPENAI_API_KEY. Never run in CI.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  assertRealOpenAiGates,
  runAllFilteredSteps,
} from "@/sms-review-place/run-review-runner";
import { reportsRootDir, writeSmsReviewReport } from "@/sms-review-place/report";

const REAL_OPENAI_ENABLED = process.env.SMS_REVIEW_REAL_OPENAI === "1";

describe.runIf(REAL_OPENAI_ENABLED)("SMS Review Place — real OpenAI dry-run", () => {
  beforeAll(() => {
    assertRealOpenAiGates();
  });

  it("runs filtered scenario(s) with live OpenAI and writes local report", async () => {
    const rows = await runAllFilteredSteps({
      mode: "real_openai",
      setMockStepKey: false,
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.run_mode === "real_openai")).toBe(true);
    for (const row of rows) {
      expect(row.persona_id).toMatch(/^[a-z]+$/);
    }

    const dir = writeSmsReviewReport(rows, { mode: "real_openai" });
    expect(dir.startsWith(reportsRootDir("real_openai"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "run.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "summary.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "report.md"))).toBe(true);

    const md = fs.readFileSync(path.join(dir, "report.md"), "utf8");
    expect(md).toContain("Real OpenAI Dry-Run");
    expect(md).toContain("real_openai");
    expect(md).toContain("No Twilio");
    expect(md).toContain("No DB writes");

    const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
    expect(summary.run_mode).toBe("real_openai");
    expect(summary.openai_live).toBe(true);
    expect(summary.advisory_review).toBe(true);
    expect(summary.fixtures_only).toBe(true);
  }, 300_000);
});
