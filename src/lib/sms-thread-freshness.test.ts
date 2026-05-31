import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/v3-sms-voice-ownership", () => ({
  repairV3RelationshipLaneBodyWithOpenAI: vi.fn(),
}));

import { repairV3RelationshipLaneBodyWithOpenAI } from "@/lib/v3-sms-voice-ownership";
import {
  applyThreadFreshnessGuard,
  bodyReasksFreshnessTopic,
  buildThreadFreshnessPromptGuidance,
  buildThreadFreshnessRepairInstruction,
  deriveRecentThreadFreshnessFacts,
  detectThreadFreshnessViolations,
} from "@/lib/sms-thread-freshness";
import { REPEAT_GUARD_WORD_OVERLAP_THRESHOLD } from "@/lib/sms-memory-anti-repeat";

const repairMock = vi.mocked(repairV3RelationshipLaneBodyWithOpenAI);

afterEach(() => {
  repairMock.mockReset();
});

describe("deriveRecentThreadFreshnessFacts", () => {
  it("Example A: lunch stretch completion produces completed_action and do_not_reask topic", () => {
    const transcript = [
      "Coach: How do you feel about prioritizing your five minutes of stretching at lunch?",
      "User: Good suggestion so did that at lunch.",
    ];
    const facts = deriveRecentThreadFreshnessFacts({
      recentExactThreadText: transcript.join("\n"),
      latestUserInbound: "Good suggestion so did that at lunch.",
      latestCoachQuestion:
        "How do you feel about prioritizing your five minutes of stretching at lunch?",
    });

    expect(facts.completed_actions.length).toBeGreaterThanOrEqual(1);
    expect(facts.completed_actions[0]?.evidence).toMatch(/did that at lunch/i);
    expect(facts.do_not_reask_topics.some((t) => /lunch|stretch/i.test(t))).toBe(true);
    expect(facts.recent_user_completion).toMatch(/did that at lunch/i);
  });

  it("Example B: tomorrow thread with early afternoon schedule sets tomorrow temporal frame", () => {
    const transcript = [
      "Coach: How do you feel about calls tomorrow?",
      "User: Early afternoon I have work early morning",
      "User: Text before calling",
    ];
    const facts = deriveRecentThreadFreshnessFacts({
      recentExactThreadText: transcript.join("\n"),
      latestUserInbound: "Text before calling",
      latestCoachQuestion: "How do you feel about calls tomorrow?",
    });

    expect(facts.active_temporal_frame).toBe("tomorrow");
    expect(facts.temporal_anchors).toEqual(
      expect.arrayContaining(["tomorrow", "early afternoon", "early morning"])
    );
    expect(facts.recent_user_plan_or_schedule).toMatch(/early afternoon/i);
  });

  it("conservative: vague text does not create false completed action", () => {
    const facts = deriveRecentThreadFreshnessFacts({
      recentExactThreadText: [
        "Coach: How was your morning?",
        "User: Pretty good thanks",
      ].join("\n"),
      latestUserInbound: "Pretty good thanks",
    });

    expect(facts.completed_actions).toHaveLength(0);
    expect(facts.do_not_reask_topics).toHaveLength(0);
    expect(facts.recent_user_completion).toBeNull();
  });
});

describe("detectThreadFreshnessViolations", () => {
  const lunchFreshness = deriveRecentThreadFreshnessFacts({
    recentExactThreadText: [
      "Coach: How do you feel about prioritizing your five minutes of stretching at lunch?",
      "User: Good suggestion so did that at lunch.",
    ].join("\n"),
    latestUserInbound: "Good suggestion so did that at lunch.",
  });

  const tomorrowFreshness = deriveRecentThreadFreshnessFacts({
    recentExactThreadText: [
      "Coach: How do you feel about calls tomorrow?",
      "User: Early afternoon I have work early morning",
      "User: Text before calling",
    ].join("\n"),
    latestUserInbound: "Text before calling",
  });

  it("flags re-ask of lunch stretch after completion", () => {
    const body =
      "How do you feel about prioritizing your five minutes of stretching at lunch?";
    const hit = detectThreadFreshnessViolations(body, lunchFreshness);
    expect(hit?.reason).toMatch(/reasked/);
  });

  it("flags today language when temporal frame is tomorrow", () => {
    const body =
      "It sounds like you're ready to text before calling. How do you feel about that approach for today?";
    const hit = detectThreadFreshnessViolations(body, tomorrowFreshness);
    expect(hit?.reason).toBe("temporal_today_when_thread_is_tomorrow");
  });

  it("allows forward-moving body that respects freshness", () => {
    const body = "Got it — early afternoon works. Text before you call tomorrow?";
    expect(detectThreadFreshnessViolations(body, tomorrowFreshness)).toBeNull();
  });

  it("bodyReasksFreshnessTopic requires a question mark", () => {
    expect(bodyReasksFreshnessTopic("Thinking about lunch stretch.", "lunch stretch")).toBe(
      false
    );
    expect(
      bodyReasksFreshnessTopic("How about lunch stretch tomorrow?", "lunch stretch")
    ).toBe(true);
  });
});

describe("buildThreadFreshnessPromptGuidance", () => {
  it("includes recent-thread authority and do-not-reask instructions", () => {
    const guidance = buildThreadFreshnessPromptGuidance();
    expect(guidance).toMatch(/thread_freshness/i);
    expect(guidance).toMatch(/completed_actions/i);
    expect(guidance).toMatch(/do_not_reask_topics/i);
    expect(guidance).toMatch(/active_temporal_frame/i);
    expect(guidance).toMatch(/do NOT re-ask/i);
    expect(guidance).toMatch(/do not praise a plan as proof/i);
  });
});

describe("applyThreadFreshnessGuard", () => {
  const lunchFreshness = deriveRecentThreadFreshnessFacts({
    recentExactThreadText: [
      "Coach: How do you feel about prioritizing your five minutes of stretching at lunch?",
      "User: Good suggestion so did that at lunch.",
    ].join("\n"),
    latestUserInbound: "Good suggestion so did that at lunch.",
  });

  const tomorrowFreshness = deriveRecentThreadFreshnessFacts({
    recentExactThreadText: [
      "Coach: How do you feel about calls tomorrow?",
      "User: Early afternoon I have work early morning",
      "User: Text before calling",
    ].join("\n"),
    latestUserInbound: "Text before calling",
  });

  it("passes through clean body without repair", async () => {
    const body = "Nice work at lunch — what's the next small win today?";
    const r = await applyThreadFreshnessGuard({
      routeKind: "inbound",
      routePurpose: "v2_accountability",
      body,
      factsJson: { thread_freshness: lunchFreshness },
      freshness: lunchFreshness,
      enabled: true,
    });
    expect(r.outcome).toBe("ok");
    expect(r.body).toBe(body);
    expect(repairMock).not.toHaveBeenCalled();
    expect(r.metadata.thread_freshness_violation_detected).toBe(false);
  });

  it("triggers OpenAI repair when body re-asks completed lunch stretch", async () => {
    const stale =
      "How do you feel about prioritizing your five minutes of stretching at lunch?";
    const repaired = "Nice — you got the lunch stretch in. What's next on your list?";
    repairMock.mockResolvedValueOnce({ body: repaired, safety_notes: [] });

    const r = await applyThreadFreshnessGuard({
      routeKind: "inbound",
      routePurpose: "v2_accountability",
      body: stale,
      factsJson: { thread_freshness: lunchFreshness },
      freshness: lunchFreshness,
      enabled: true,
    });

    expect(repairMock).toHaveBeenCalledTimes(1);
    expect(r.outcome).toBe("ok");
    expect(r.body).toBe(repaired);
    expect(r.metadata.thread_freshness_repair_succeeded).toBe(true);
    expect(r.metadata.thread_freshness_violation_reason).toMatch(/reasked/);
  });

  it("triggers repair when body says for today but frame is tomorrow", async () => {
    const stale =
      "It sounds like you're ready to text before calling. How do you feel about that approach for today?";
    const repaired =
      "Early afternoon makes sense — text before you call tomorrow and we'll go from there.";
    repairMock.mockResolvedValueOnce({ body: repaired, safety_notes: [] });

    const r = await applyThreadFreshnessGuard({
      routeKind: "inbound",
      routePurpose: "v2_accountability",
      body: stale,
      factsJson: { thread_freshness: tomorrowFreshness },
      freshness: tomorrowFreshness,
      enabled: true,
    });

    expect(repairMock).toHaveBeenCalledTimes(1);
    expect(r.outcome).toBe("ok");
    expect(r.body).toBe(repaired);
    expect(r.metadata.thread_freshness_repair_succeeded).toBe(true);
  });

  it("no-send when repair still contradicts thread (no hard-coded fallback SMS)", async () => {
    const stale =
      "How do you feel about prioritizing your five minutes of stretching at lunch?";
    repairMock.mockResolvedValueOnce({
      body: "Will you do the five-minute stretch at lunch today?",
      safety_notes: [],
    });

    const r = await applyThreadFreshnessGuard({
      routeKind: "inbound",
      routePurpose: "v2_accountability",
      body: stale,
      factsJson: { thread_freshness: lunchFreshness },
      freshness: lunchFreshness,
      enabled: true,
    });

    expect(r.outcome).toBe("no_send");
    expect(r.noSendReason).toBe("thread_freshness_stale_blocked");
    expect(r.metadata.thread_freshness_repair_succeeded).toBe(false);
  });

  it("repair instruction references violation diagnostics (OpenAI writes final text)", () => {
    const violation = detectThreadFreshnessViolations(
      "How do you feel about lunch stretch today?",
      lunchFreshness
    )!;
    const instruction = buildThreadFreshnessRepairInstruction({
      violation,
      freshness: lunchFreshness,
      originalBody: "How do you feel about lunch stretch today?",
    });
    expect(instruction).toMatch(/THREAD_FRESHNESS_REPAIR/);
    expect(instruction).toMatch(/Violation:/);
    expect(instruction).toMatch(/Return strict JSON/);
    expect(instruction).not.toMatch(/^How do you feel about/);
  });
});

describe("regression", () => {
  it("repeat guard word overlap threshold unchanged", () => {
    expect(REPEAT_GUARD_WORD_OVERLAP_THRESHOLD).toBe(0.45);
  });
});
