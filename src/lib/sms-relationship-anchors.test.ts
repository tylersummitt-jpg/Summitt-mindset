import { describe, expect, it } from "vitest";
import {
  RELATIONSHIP_ANCHOR_MUST_NOT_DO_LINES,
  RELATIONSHIP_ANCHOR_OPTIONAL_MUST_DO,
  applyRelationshipAnchorStrategyBoundaries,
  buildRelationshipAnchors,
  buildRelationshipAndScheduleAnchors,
  buildRelationshipAnchorsPromptGuidance,
  detectRecentlyUsedRelationshipAnchorKeys,
  isStaleTemporaryContextHint,
  relationshipAnchorAvoidRepeatingFingerprints,
  stableRelationshipAnchorKey,
} from "@/lib/sms-relationship-anchors";
import { finalizeStrategyCardWithRelationshipAnchorBoundaries } from "@/lib/coaching-strategy-card-v1";
import { STRATEGY_CARD_V1_VERSION } from "@/lib/coaching-strategy-card-v1";

describe("buildRelationshipAnchors", () => {
  it("builds compact anchors from important_people onboarding names", () => {
    const anchors = buildRelationshipAnchors({
      sources: {
        important_people: [
          { display_name: "Callie", relationship_type: "child", source: "onboarding" },
          { display_name: "Kaiya", relationship_type: "child", source: "onboarding" },
        ],
        people_summary: "Showing up for 2 children",
      },
      timezone: "America/New_York",
      now: new Date("2026-06-15T14:00:00.000Z"),
    });

    expect(anchors).toHaveLength(2);
    expect(anchors[0]?.display_label).toBe("Callie");
    expect(anchors[0]?.source).toBe("onboarding");
    expect(anchors[0]?.confidence).toBe("user_provided");
    expect(anchors[0]).not.toHaveProperty("RELATIONSHIP_PACKET_V1");
    expect(JSON.stringify(anchors)).not.toContain("prompt");
  });

  it("returns empty when no important_people", () => {
    expect(
      buildRelationshipAnchors({
        sources: { important_people: [], people_summary: null },
        timezone: "America/New_York",
      })
    ).toEqual([]);
  });

  it("attaches context_hint when people_summary confirms and mentions the person", () => {
    const anchors = buildRelationshipAnchors({
      sources: {
        important_people: [{ display_name: "Callie", relationship_type: "child", source: "onboarding" }],
        people_summary: "Callie is on summer break this month",
        people_summary_updated_at: "2026-06-10T12:00:00.000Z",
      },
      timezone: "America/New_York",
      now: new Date("2026-06-15T14:00:00.000Z"),
    });

    expect(anchors[0]?.context_hint).toContain("summer break");
    expect(anchors[0]?.source).toBe("sms_confirmed");
    expect(anchors[0]?.confidence).toBe("user_confirmed");
  });

  it("omits stale summer break hint in December", () => {
    const anchors = buildRelationshipAnchors({
      sources: {
        important_people: [{ display_name: "Callie", relationship_type: "child", source: "onboarding" }],
        people_summary: "Callie is on summer break",
        people_summary_updated_at: "2026-06-10T12:00:00.000Z",
      },
      timezone: "America/New_York",
      now: new Date("2026-12-15T14:00:00.000Z"),
    });

    expect(anchors[0]?.context_hint).toBeUndefined();
  });
});

describe("isStaleTemporaryContextHint", () => {
  it("flags summer break outside summer months", () => {
    expect(
      isStaleTemporaryContextHint({
        contextHint: "Callie is on summer break",
        lastUserUpdateAt: "2026-06-10T12:00:00.000Z",
        todayDayKey: "2026-12-15",
      })
    ).toBe(true);
  });
});

describe("relationship anchor DNR fingerprints", () => {
  it("uses anchor_key not raw display names", () => {
    const key = stableRelationshipAnchorKey("Callie", "child");
    const fps = relationshipAnchorAvoidRepeatingFingerprints([key]);
    expect(fps[0]).toBe(`relationship_anchor_recently_used:${key}`);
    expect(fps[0]).not.toContain("Callie");
  });

  it("detects recently used anchors from coach bodies", () => {
    const anchors = buildRelationshipAnchors({
      sources: {
        important_people: [{ display_name: "Callie", relationship_type: "child", source: "onboarding" }],
        people_summary: null,
      },
      timezone: "America/New_York",
    });
    const used = detectRecentlyUsedRelationshipAnchorKeys({
      anchors,
      coachBodies: ["How did your walk with Callie go yesterday?"],
    });
    expect(used).toHaveLength(1);
    expect(used[0]).toBe(anchors[0]?.anchor_key);
  });
});

describe("schedule anchors", () => {
  it("builds schedule anchor from timing_anchor_memory", () => {
    const result = buildRelationshipAndScheduleAnchors({
      sources: null,
      timezone: "America/New_York",
      timingAnchorMemory: {
        active: true,
        anchor_phrase_hint: "after work",
        anchor_key: "after_work",
        recurrence_confidence: "low",
        confidence_level: "mentioned_once",
        mention_count_45d: 1,
        user_confirmed: false,
        outcome_success_after_mention_count: 0,
        first_seen_day_key: "2026-06-01",
        last_seen_day_key: "2026-06-10",
        source: "recent_user_plan",
        safe_usage_allowed: [],
        safe_usage_forbidden: [],
      },
    });
    expect(result.schedule_anchors).toHaveLength(1);
    expect(result.schedule_anchors[0]?.source).toBe("timing_anchor_memory");
  });
});

describe("Strategy Card relationship anchor boundaries", () => {
  it("adds anti-force / anti-guilt boundaries when anchors available", () => {
    const must_do = ["Existing must do"];
    const must_not_do = ["Do not invent proof."];
    const avoid_repeating: string[] = [];
    applyRelationshipAnchorStrategyBoundaries({
      must_do,
      must_not_do,
      avoid_repeating,
      relationshipAnchorCount: 2,
      scheduleAnchorCount: 0,
      recentlyUsedAnchorKeys: ["abc123"],
    });
    expect(must_do).toContain(RELATIONSHIP_ANCHOR_OPTIONAL_MUST_DO);
    for (const line of RELATIONSHIP_ANCHOR_MUST_NOT_DO_LINES) {
      expect(must_not_do).toContain(line);
    }
    expect(avoid_repeating.some((a) => a.startsWith("relationship_anchor_recently_used:"))).toBe(
      true
    );
  });

  it("finalizeStrategyCard preserves critical must_not_do within cap", () => {
    const card = finalizeStrategyCardWithRelationshipAnchorBoundaries(
      {
        version: STRATEGY_CARD_V1_VERSION,
        generated_at: new Date().toISOString(),
        surface: "inbound",
        route_kind: "normal_inbound_reply",
        turn_kind: "check_in",
        server_truth_summary: { outcome: "none" },
        move: { type: "daily_check_in", priority: "normal", confidence: "high", reason: "test" },
        must_do: ["Check in on today."],
        must_not_do: ["Do not invent proof.", "Do not claim completion."],
        allowed_claims: {
          completion: false,
          miss: false,
          partial: false,
          proof: false,
          victory_room: false,
          praise: false,
        },
        writer_constraints: { max_questions: 1, avoid_repeating: [], tone_posture: "warm_direct" },
        meta: { generation_source: "server_strategy_card_v1" },
      },
      { relationshipAnchorCount: 2, scheduleAnchorCount: 1 }
    );
    expect(card.must_not_do).toContain("Do not invent proof.");
    expect(card.must_do.some((m) => m.includes("one user-provided relationship"))).toBe(true);
  });
});

describe("prompt guidance", () => {
  it("frames anchors as optional context not commands", () => {
    const guidance = buildRelationshipAnchorsPromptGuidance();
    expect(guidance).toMatch(/optional user-provided/i);
    expect(guidance).toMatch(/at most one anchor/i);
    expect(guidance).not.toMatch(/Ask how/i);
  });
});

describe("telemetry safety", () => {
  it("telemetry counts omit raw names", () => {
    const result = buildRelationshipAndScheduleAnchors({
      sources: {
        important_people: [{ display_name: "Callie", relationship_type: "child", source: "onboarding" }],
        people_summary: null,
      },
      timezone: "America/New_York",
    });
    const serialized = JSON.stringify(result.telemetry);
    expect(serialized).not.toContain("Callie");
    expect(result.telemetry.relationship_anchor_available_count).toBe(1);
    expect(result.telemetry.strategy_card_relationship_anchor_boundary_present).toBe(true);
  });
});
