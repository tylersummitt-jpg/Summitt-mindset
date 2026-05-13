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

  it("does not run OpenAI as normal finalizer for v3_daily_relationship_lane", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await finalizeNorthStarCoachSmsAsync({
      proposedBody: "Still here with you — one clean rep today?",
      channel: "daily_outbound",
      replySource: "v3_daily_relationship_lane",
      contextPacket: { source: "daily", effectiveAskText: "30 min focus" },
    });
    expect(r.meta.openaiAttempted).toBe(false);
    expect(r.meta.north_star_openai_mode).toBe("disabled_for_v3_voice");
  });

  it("does not run OpenAI as normal finalizer for v3_daily_check_in (telemetry)", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await finalizeNorthStarCoachSmsAsync({
      proposedBody: "Quick check — still on track?",
      channel: "daily_outbound",
      replySource: "v3_daily_check_in",
      contextPacket: { source: "daily", effectiveAskText: "30 min focus" },
    });
    expect(r.meta.openaiAttempted).toBe(false);
    expect(r.meta.north_star_openai_mode).toBe("disabled_for_v3_voice");
  });

  it("does not run OpenAI as normal finalizer for v3_sms_brain", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await finalizeNorthStarCoachSmsAsync({
      proposedBody: "Great job today!",
      channel: "inbound_coach_reply",
      replySource: "v3_sms_brain",
      latestInboundRaw: "ok",
      contextPacket: { source: "test", latestInboundRaw: "ok" },
    });
    expect(r.meta.openaiAttempted).toBe(false);
    expect(r.meta.north_star_openai_mode).toBe("disabled_for_v3_voice");
  });

  it("does not run OpenAI as normal finalizer for v3_answer_to_open_question", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await finalizeNorthStarCoachSmsAsync({
      proposedBody: "Sounds good.",
      channel: "inbound_coach_reply",
      replySource: "v3_answer_to_open_question",
      latestInboundRaw: "yes",
      contextPacket: { source: "test", latestInboundRaw: "yes" },
    });
    expect(r.meta.openaiAttempted).toBe(false);
    expect(r.meta.north_star_openai_mode).toBe("disabled_for_v3_voice");
  });

  it("does not run OpenAI as normal finalizer for v3_voice_repair", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await finalizeNorthStarCoachSmsAsync({
      proposedBody: "Repaired line here.",
      channel: "inbound_coach_reply",
      replySource: "v3_voice_repair",
      latestInboundRaw: "ok",
      contextPacket: { source: "test", latestInboundRaw: "ok" },
    });
    expect(r.meta.openaiAttempted).toBe(false);
    expect(r.meta.north_star_openai_mode).toBe("disabled_for_v3_voice");
  });

  it("marks repair_only mode when northStarOpenAiRepairOnly is set (explicit repair posture) without key", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await finalizeNorthStarCoachSmsAsync({
      proposedBody: "Say it straight — what moved?",
      channel: "inbound_coach_reply",
      replySource: "v3_sms_brain",
      contextPacket: { source: "test", latestInboundRaw: "x" },
      northStarOpenAiRepairOnly: {
        blockedReasons: ["say_it_straight"],
        originalBodyForRepair: "Say it straight — what moved?",
      },
    });
    expect(r.meta.north_star_openai_mode).toBe("repair_only");
    expect(r.meta.openaiAttempted).toBe(false);
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
