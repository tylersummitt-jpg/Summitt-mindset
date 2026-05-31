import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  buildRelationshipMemory30d,
  RELATIONSHIP_MEMORY_30D_WINDOW_DAYS,
  trimRelationshipMemory30dData,
} from "@/lib/sms-relationship-memory-30d";
import type { V2EventRowForAi } from "@/lib/v2-commitment";

const NOW = new Date("2026-05-18T12:00:00.000Z");
const COMMITMENT_ID = "cmt_30d";

function event(
  event_type: string,
  occurred_at: string,
  payload_json: Record<string, unknown> = {}
): V2EventRowForAi {
  return { event_type, occurred_at, payload_json };
}

describe("buildRelationshipMemory30d", () => {
  it("excludes recurring blockers with evidence_count < 2", () => {
    const result = buildRelationshipMemory30d({
      commitmentId: COMMITMENT_ID,
      now: NOW,
      preloadedEvents30d: [
        event("blocker_captured", "2026-05-18T10:00:00.000Z", { message: "scrolling on phone" }),
      ],
    });
    expect(result.recurring_blockers).toHaveLength(0);
  });

  it("includes recurring blockers when evidence_count >= 2", () => {
    const result = buildRelationshipMemory30d({
      commitmentId: COMMITMENT_ID,
      now: NOW,
      preloadedEvents30d: [
        event("blocker_captured", "2026-05-18T10:00:00.000Z", { message: "scrolling on phone" }),
        event("blocker_captured", "2026-05-17T10:00:00.000Z", { message: "phone distraction again" }),
      ],
    });
    expect(result.recurring_blockers).toHaveLength(1);
    expect(result.recurring_blockers[0]?.canonical).toBe("phone_pull");
    expect(result.recurring_blockers[0]?.evidence_count).toBeGreaterThanOrEqual(2);
    expect(result.recurring_blockers[0]?.examples[0]?.commitment_id).toBe(COMMITMENT_ID);
  });

  it("includes proof moments only when payload.proof_moment === true", () => {
    const withProof = buildRelationshipMemory30d({
      commitmentId: COMMITMENT_ID,
      now: NOW,
      preloadedEvents30d: [
        event("user_yes", "2026-05-18T10:00:00.000Z", {
          proof_moment: true,
          proof_moment_type: "first_completion",
        }),
        event("user_no", "2026-05-17T10:00:00.000Z", { proof_moment: false }),
      ],
    });
    expect(withProof.meaningful_proof).toHaveLength(1);
    expect(withProof.meaningful_proof[0]?.proof_type).toBe("first_completion");
    expect(withProof.meaningful_proof[0]?.is_exact_body).toBe(false);
  });

  it("excludes events older than 30 days", () => {
    const result = buildRelationshipMemory30d({
      commitmentId: COMMITMENT_ID,
      now: NOW,
      preloadedEvents30d: [
        event("user_yes", "2026-04-01T10:00:00.000Z"),
        event("user_yes", "2026-05-17T10:00:00.000Z"),
      ],
    });
    expect(result.outcome_counts_30d.yes).toBe(1);
  });

  it("counts contract overlay activated and declined", () => {
    const result = buildRelationshipMemory30d({
      commitmentId: COMMITMENT_ID,
      now: NOW,
      preloadedEvents30d: [
        event("contract_overlay_activated", "2026-05-18T10:00:00.000Z", { contract_kind: "shrink_ask" }),
        event("contract_overlay_declined", "2026-05-17T10:00:00.000Z"),
      ],
    });
    expect(result.outcome_counts_30d.overlay_activated).toBe(1);
    expect(result.outcome_counts_30d.overlay_declined).toBe(1);
    expect(result.adjustments.length).toBeGreaterThanOrEqual(2);
  });

  it("creates adjustment from coaching_refresh_resolved", () => {
    const result = buildRelationshipMemory30d({
      commitmentId: COMMITMENT_ID,
      now: NOW,
      preloadedEvents30d: [
        event("coaching_refresh_resolved", "2026-05-16T10:00:00.000Z", { resolution: "tighten" }),
      ],
    });
    expect(result.adjustments).toHaveLength(1);
    expect(result.adjustments[0]?.kind).toBe("coaching_refresh_resolved");
    expect(result.adjustments[0]?.source).toContain("coaching_refresh");
  });

  it("detects comeback across 30d chain", () => {
    const result = buildRelationshipMemory30d({
      commitmentId: COMMITMENT_ID,
      now: NOW,
      preloadedEvents30d: [
        event("user_no", "2026-05-10T09:00:00.000Z"),
        event("user_yes", "2026-05-18T10:00:00.000Z"),
      ],
    });
    expect(result.comebacks).toHaveLength(1);
    expect(result.comebacks[0]?.summary).toBe("comeback_after_miss_or_partial");
  });

  it("includes goal change from wave12 sms_memory_signal proof", () => {
    const result = buildRelationshipMemory30d({
      commitmentId: COMMITMENT_ID,
      now: NOW,
      preloadedEvents30d: [
        event("sms_memory_signal", "2026-05-15T10:00:00.000Z", {
          memory_signal: { wave12_commitment_change_proof: true },
          proof_moment: true,
          proof_moment_type: "commitment_tightened",
        }),
      ],
    });
    expect(result.goal_changes).toHaveLength(1);
    expect(result.goal_changes[0]?.kind).toBe("commitment_tightened");
  });

  it("does not include coaching_summary prose", () => {
    const result = buildRelationshipMemory30d({
      commitmentId: COMMITMENT_ID,
      now: NOW,
      preloadedEvents30d: [event("user_yes", "2026-05-18T10:00:00.000Z")],
      coachingMemory: {
        effective_ask_text: "Two hours",
        coaching_state: "steady",
        silence_tier_snapshot: "none",
        unanswered_checks_snapshot: 0,
        days_since_last_user_outcome_snapshot: 0,
        cadence_level: "standard",
        cadence_reason_code: "default",
        next_move_type: "hold_standard",
        next_move_reason_code: "default",
        overlay_active: false,
        overlay_expires_at: null,
        yes_streak_14d: 1,
        no_count_14d: 0,
        partial_count_14d: 0,
        latest_blocker_preview: null,
        blocker_tags: [],
        coaching_summary: "NON-AUTHORITATIVE prose blob about the user always failing",
        accountability_phase: "active_accountability",
        reactivation_entered_at: null,
        reactivation_last_sent_at: null,
      },
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain("coaching_summary");
    expect(json).not.toContain("always failing");
  });

  it("marks pat_read_snapshot with is_ai_snapshot true", () => {
    const result = buildRelationshipMemory30d({
      commitmentId: COMMITMENT_ID,
      now: NOW,
      preloadedEvents30d: [],
      victoryBackground: {
        active_season_label: "Spring Focus",
        active_season_started_at: "2026-01-01T00:00:00Z",
        pat_read_strength: "Steady effort",
        pat_read_pattern: "Evening drift",
        pat_read_next_move: "Protect morning block",
      },
    });
    expect(result.window_days).toBe(RELATIONSHIP_MEMORY_30D_WINDOW_DAYS);
    expect(result.season?.label).toBe("Spring Focus");
    expect(result.pat_read_snapshot.length).toBeGreaterThan(0);
    for (const snap of result.pat_read_snapshot) {
      expect(snap.is_ai_snapshot).toBe(true);
      expect(snap.source).toBe("v2_victory_pat_read_snapshot");
    }
  });

  it("scopes all items to the provided commitment_id", () => {
    const result = buildRelationshipMemory30d({
      commitmentId: COMMITMENT_ID,
      now: NOW,
      preloadedEvents30d: [
        event("blocker_captured", "2026-05-18T10:00:00.000Z", { message: "scrolling on phone" }),
        event("blocker_captured", "2026-05-17T10:00:00.000Z", { message: "phone again" }),
        event("user_yes", "2026-05-16T10:00:00.000Z", {
          proof_moment: true,
          proof_moment_type: "followed_through",
        }),
      ],
    });
    expect(result.commitment_id).toBe(COMMITMENT_ID);
    expect(result.recurring_blockers[0]?.commitment_id).toBe(COMMITMENT_ID);
    expect(result.meaningful_proof[0]?.commitment_id).toBe(COMMITMENT_ID);
  });
});

describe("trimRelationshipMemory30dData", () => {
  it("preserves outcome_counts_30d while trimming categories", () => {
    const base = buildRelationshipMemory30d({
      commitmentId: COMMITMENT_ID,
      now: NOW,
      preloadedEvents30d: Array.from({ length: 4 }, (_, i) =>
        event("blocker_captured", new Date(NOW.getTime() - i * 86_400_000).toISOString(), {
          message: `phone scroll issue number ${i} with extra padding ${"x".repeat(80)}`,
        })
      ),
    });
    const { data, truncated } = trimRelationshipMemory30dData(base, 200);
    expect(truncated).toBe(true);
    expect(data.outcome_counts_30d).toEqual(base.outcome_counts_30d);
    expect(data.recurring_blockers.length).toBeLessThanOrEqual(base.recurring_blockers.length);
  });
});
