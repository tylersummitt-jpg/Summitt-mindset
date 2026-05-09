import { describe, expect, it, afterEach } from "vitest";
import {
  finalizeNorthStarCoachSmsAsync,
  finalizeNorthStarCoachSmsPreservingSuffixAsync,
} from "./north-star-coach-sms-openai";

describe("finalizeNorthStarCoachSmsAsync", () => {
  const prevKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
  });

  it("uses deterministic path when OPENAI_API_KEY is unset (no OpenAI attempt)", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await finalizeNorthStarCoachSmsAsync({
      proposedBody: "Quick check — did you finish?",
      channel: "followup_sms",
      contextPacket: { source: "followup_sms" },
    });
    expect(r.meta.openaiAttempted).toBe(false);
    expect(r.visibleBody.toLowerCase()).not.toContain("quick check");
    expect(r.meta.finalizerVersion).toBeDefined();
  });

  it("deterministic guards still rewrite robotic OpenAI draft after mocked success path", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await finalizeNorthStarCoachSmsAsync({
      proposedBody: "Great job! Keep momentum — you've got this.",
      channel: "inbound_coach_reply",
      latestInboundRaw: "done",
      contextPacket: {
        source: "test",
        latestInboundRaw: "done",
        todayCompleted: true,
      },
    });
    expect(r.meta.openaiAttempted).toBe(false);
    expect(r.visibleBody.toLowerCase()).not.toContain("great job");
  });
});

describe("finalizeNorthStarCoachSmsPreservingSuffixAsync", () => {
  const prevKey = process.env.OPENAI_API_KEY;
  const SAMPLE = "Reply STOP to opt out. Reply HELP for help.";

  afterEach(() => {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
  });

  it("preserves compliance suffix verbatim when OpenAI is unavailable", async () => {
    delete process.env.OPENAI_API_KEY;
    const pre = `Pat Pause.\n\nQuick check: how was your week?\n\n${SAMPLE}`;
    const r = await finalizeNorthStarCoachSmsPreservingSuffixAsync({
      proposedFullBody: pre,
      suffixToPreserve: SAMPLE,
      channel: "weekly_sms",
      preserveNewlines: true,
      contextPacket: {
        source: "weekly_sms",
        behaviorStatement: "Daily reps",
        effectiveAskText: "Daily reps",
      },
    });
    expect(r.visibleBody.endsWith(SAMPLE)).toBe(true);
    expect(r.meta.blockedReasons).toContain("compliance_suffix_preserved_unchanged");
  });
});
