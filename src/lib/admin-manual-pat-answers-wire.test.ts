import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const HELPER = path.join(ROOT, "src/lib/admin-manual-pat-answers.ts");
const PAGE = path.join(ROOT, "src/app/admin/manual-pat-answers/page.tsx");
const DASH = path.join(ROOT, "src/app/admin/manual-pat-answers/manual-pat-answers-dashboard.tsx");
const GET = path.join(ROOT, "src/app/api/admin/manual-pat-answers/route.ts");
const PATCH = path.join(ROOT, "src/app/api/admin/manual-pat-answers/[messageSid]/route.ts");
const SEND = path.join(
  ROOT,
  "src/app/api/admin/manual-pat-answers/[messageSid]/send/route.ts"
);
const LAYOUT = path.join(ROOT, "src/app/admin/layout.tsx");
const CRON = path.join(ROOT, "src/app/api/cron/sms-inbound-coach/route.ts");
const WRITER = path.join(ROOT, "src/lib/inbound-sol-writer.ts");
const TURN = path.join(ROOT, "src/lib/inbound-sol-relationship-turn.ts");
const INTERPRETER = path.join(ROOT, "src/lib/inbound-sol-brief-interpreter.ts");

describe("admin manual Pat answers wire", () => {
  const helper = fs.readFileSync(HELPER, "utf8");
  const page = fs.readFileSync(PAGE, "utf8");
  const dash = fs.readFileSync(DASH, "utf8");
  const getSrc = fs.readFileSync(GET, "utf8");
  const patchSrc = fs.readFileSync(PATCH, "utf8");
  const sendSrc = fs.readFileSync(SEND, "utf8");
  const layout = fs.readFileSync(LAYOUT, "utf8");
  const cron = fs.readFileSync(CRON, "utf8");

  it("1: page and APIs use requireTylerAdmin", () => {
    expect(page).toContain("requireTylerAdmin");
    expect(getSrc).toContain("requireTylerAdmin");
    expect(patchSrc).toContain("requireTylerAdmin");
    expect(sendSrc).toContain("requireTylerAdmin");
  });

  it("2/3: queue query is awaiting oldest-first and shows raw_body", () => {
    expect(helper).toContain('eq("status", MANUAL_PAT_ANSWER_STATUS)');
    expect(helper).toContain('order("created_at", { ascending: true })');
    expect(helper).toContain("question: job.raw_body");
    expect(helper).toContain("preferred_name");
    expect(dash).toContain("{row.question");
    expect(dash).toContain("Your Coach Pat reply");
  });

  it("5: recent thread uses inbound 72h helper, not TTO 21-day wrapper", () => {
    expect(helper).toContain("buildRecentExactThread72h");
    expect(helper).toContain('path: "inbound"');
    expect(helper).toContain("preserveUserBodyFormatting: true");
    expect(helper).not.toContain("buildMorningExactThreadForPacket");
    expect(dash).toContain("Recent conversation");
  });

  it("14/15: send has no OpenAI, FVG, North Star, or reply_ready hop", () => {
    expect(helper).toContain('status: "sending"');
    expect(helper).toContain(".eq(\"status\", MANUAL_PAT_ANSWER_STATUS)");
    expect(helper).not.toMatch(/status:\s*"reply_ready"/);
    expect(helper).not.toContain("openai");
    expect(helper).not.toContain("chat.completions");
    expect(helper).not.toContain("applyFinalVoiceOwnershipGate");
    expect(helper).not.toContain("finalizeNorthStar");
    expect(helper).not.toContain("writeInboundSolBody");
    expect(helper).toContain("sendSMSChunked");
    expect(helper).toContain("checkInboundCoachSmsEligibility");
    expect(helper).toContain('expectedJobStatuses: ["sending"]');
  });

  it("22: send failure reverts to awaiting, not failed/pending/reply_ready", () => {
    expect(helper).toContain("revertSendingToAwaiting");
    expect(helper).toContain('status: MANUAL_PAT_ANSWER_STATUS');
    const revertFn = helper.slice(
      helper.indexOf("async function revertSendingToAwaiting"),
      helper.indexOf("async function cancelJob")
    );
    expect(revertFn).toContain("status: MANUAL_PAT_ANSWER_STATUS");
    expect(revertFn).not.toContain('status: "failed"');
    expect(revertFn).not.toContain('status: "pending"');
    expect(revertFn).not.toMatch(/status:\s*"reply_ready"/);
    expect(helper).not.toMatch(/status:\s*"(failed|pending|reply_ready)"/);
  });

  it("24: cron claim list is unchanged", () => {
    expect(cron).toContain('.in("status", ["pending", "failed", "reply_ready"])');
    expect(
      cron.match(/\.in\("status", \["pending", "failed", "reply_ready"\]\)/g)?.length
    ).toBe(2);
  });

  it("25: does not touch writer/interpreter/turn/TTO/daily/evening/weekly/Ask Pat/retrieval", () => {
    expect(fs.readFileSync(WRITER, "utf8")).not.toContain("manual-pat-answers");
    expect(fs.readFileSync(TURN, "utf8")).not.toContain("manual-pat-answers");
    expect(fs.readFileSync(INTERPRETER, "utf8")).not.toContain("manual-pat-answers");

    const changed = new Set(
      execSync("git status --short --untracked-files=all", { cwd: ROOT, encoding: "utf8" })
        .split("\n")
        .map((line) => line.trim().replace(/^\S+\s+/, ""))
        .filter(Boolean)
    );
    const protectedPaths = [
      "src/lib/inbound-sol-writer.ts",
      "src/lib/inbound-sol-relationship-turn.ts",
      "src/lib/inbound-sol-brief-interpreter.ts",
      "src/lib/inbound-pat-source-evidence.ts",
      "src/app/api/ask-pat/route.ts",
      "src/app/api/cron/daily-sms/route.ts",
      "src/app/api/cron/evening-sms/route.ts",
      "src/app/api/cron/weekly-sms/route.ts",
      "src/lib/tyler-text-overview-admin.ts",
      "src/app/api/cron/sms-inbound-coach/route.ts",
    ];
    for (const p of protectedPaths) {
      expect(changed.has(p), p).toBe(false);
    }
  });

  it("nav link exists", () => {
    expect(layout).toContain('href="/admin/manual-pat-answers"');
    expect(layout).toContain("Manual Pat Answers");
  });

  it("UI is save/send only", () => {
    expect(dash).toContain('"Save"');
    expect(dash).toContain('"Send"');
    expect(dash).toContain('"Saved."');
    expect(dash).toContain('"Sent."');
    expect(dash).toContain("merged[row.messageSid] = row.replyBody");
    expect(dash).not.toContain("regenerate");
    expect(dash).not.toContain("machine_should_send");
    expect(dash).not.toContain("provenance");
    expect(page).toContain("Questions Coach Pat needs Tyler to answer.");
  });
});
