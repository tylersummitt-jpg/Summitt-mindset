import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  buildDailySmsRelationshipReadV1,
  DAILY_RELATIONSHIP_READ_AUTHORITY,
} from "@/lib/sms-daily-relationship-read-v1";
import type { RecentExactThreadBriefMessage } from "@/lib/sms-recent-exact-thread-72h";

type TestSuggestedMove = {
  move: string;
  reason: string;
  max_questions: 0 | 1;
};

function thread(messages: RecentExactThreadBriefMessage[]) {
  return messages;
}

function suggestedMove(overrides?: Partial<TestSuggestedMove>): TestSuggestedMove {
  return {
    move: "hold_standard",
    max_questions: 1,
    reason: "Weak stale proof.",
    ...overrides,
  };
}

function baseArgs(overrides?: Partial<Parameters<typeof buildDailySmsRelationshipReadV1>[0]>) {
  return {
    messages: thread([]),
    effectiveAsk: "One hour of distribution",
    behaviorStatement: "One hour of distribution",
    localDaypart: "morning" as const,
    targetDate: "2026-06-20",
    isNewAccountabilityDay: true,
    timingCopyGuidance: ["Morning send: do not ask as if today's outcome already happened."],
    silenceRoute: null,
    freshnessPhrases: [],
    openLoops: {},
    suggestedMove: suggestedMove(),
    praiseAllowedLevel: "capability_only",
    anchorNames: [],
    routeKind: "main_active_accountability",
    ...overrides,
  };
}

describe("buildDailySmsRelationshipReadV1", () => {
  it("sets interpretive authority only", () => {
    const read = buildDailySmsRelationshipReadV1(baseArgs());
    expect(read.authority).toBe(DAILY_RELATIONSHIP_READ_AUTHORITY);
    const blob = JSON.stringify(read);
    expect(blob).not.toMatch(/can_claim_proof|victory_room|state_changed|goal_change/i);
  });

  it("latest_user_signal comes from latest user message, not coach", () => {
    const read = buildDailySmsRelationshipReadV1(
      baseArgs({
        messages: thread([
          { at_local: "Thu 8:00 AM", role: "coach", body: "Did you protect focus today?" },
          {
            at_local: "Thu 8:05 AM",
            role: "user",
            body: "Not yet — let's wrap this up so I can eat lunch.",
          },
        ]),
      })
    );
    expect(read.latest_user_signal).toMatch(/lunch/i);
    expect(read.latest_user_signal).not.toMatch(/protect focus/i);
  });

  it("meal callback populates callback_worth_using", () => {
    const read = buildDailySmsRelationshipReadV1(
      baseArgs({
        messages: thread([
          {
            at_local: "Thu 8:05 AM",
            role: "user",
            body: "Gotta run — eating lunch now.",
          },
        ]),
      })
    );
    expect(read.callback_worth_using).toMatch(/lunch/i);
    expect(read.what_would_make_user_feel_known).toBe("light_meal_callback");
  });

  it("user correction vs current_standard populates conflict and avoid", () => {
    const read = buildDailySmsRelationshipReadV1(
      baseArgs({
        effectiveAsk: "Daily family connection",
        behaviorStatement: "Connect with family",
        messages: thread([
          {
            at_local: "Wed 6:00 PM",
            role: "user",
            body: "No more family connections — we finished that goal.",
          },
        ]),
      })
    );
    expect(read.possible_current_standard_conflict).toMatch(/family/i);
    expect(read.avoid_because_user_corrected_us).toContain("correction:do_not_repeat");
  });

  it("bad_old_coach_copy_warning when freshness phrases exist", () => {
    const read = buildDailySmsRelationshipReadV1(
      baseArgs({
        freshnessPhrases: [
          {
            phrase: "one hour of distribution",
            source_body_preview: "Aim for one hour of distribution today.",
            at_local: "Thu 8:00 AM",
          },
        ],
      })
    );
    expect(read.bad_old_coach_copy_warning).toMatch(/stale wording/i);
  });

  it("today_best_move is a compact coaching focus token, not the raw move token", () => {
    const read = buildDailySmsRelationshipReadV1(
      baseArgs({
        suggestedMove: suggestedMove({ move: "hold_standard", reason: "Hold bar." }),
        praiseAllowedLevel: "none",
      })
    );
    expect(read.today_best_move).toBe("hold_standard_no_hype");
  });

  it("silence cadence day5 populates silence_route_human_read and today_best_move", () => {
    const read = buildDailySmsRelationshipReadV1(
      baseArgs({
        silenceRoute: "cant_coach_silence_day5",
      })
    );
    expect(read.silence_route_human_read).toBe("confirm_still_in");
    expect(read.today_best_move).toBe("confirm_still_in");
  });

  it("weekly reflection in thread on normal daily warns in today_best_move", () => {
    const read = buildDailySmsRelationshipReadV1(
      baseArgs({
        silenceRoute: "normal_daily",
        messages: thread([
          {
            at_local: "Mon 9:00 AM",
            role: "coach",
            body: "Quick weekly reflection — how did this week go?",
          },
        ]),
      })
    );
    expect(read.today_best_move).toBe("daily_not_weekly");
  });

  it("send_target_day_context warns about target day and morning framing", () => {
    const read = buildDailySmsRelationshipReadV1(baseArgs());
    expect(read.send_target_day_context).toMatch(/accountability day/i);
    expect(read.send_target_day_context).toMatch(/Morning|outcome already happened/i);
  });

  it("assembled TU coaching_fit semantics elevate repair posture without phrase regex", () => {
    const read = buildDailySmsRelationshipReadV1(
      baseArgs({
        assembledTurnSemantics: {
          relationship_meaning: "coaching_fit_feedback",
          response_intent: "repair_coaching_fit",
          evidence_preview: "You're missing what I actually need.",
        },
      })
    );
    expect(read.latest_user_signal).toBe("You're missing what I actually need.");
    expect(read.today_best_move).toBe("repair_fit_before_accountability");
    expect(read.what_would_make_user_feel_known).toBe("repair_fit");
    expect(read.avoid_because_user_corrected_us).toContain("coaching_fit:unresolved");
  });

  it("assembled TU ambiguous_related_progress elevates clarify_before_drift posture", () => {
    const read = buildDailySmsRelationshipReadV1(
      baseArgs({
        assembledTurnSemantics: {
          relationship_meaning: "ambiguous_related_progress",
          response_intent: "clarify_completion_or_concretize_action",
          evidence_preview: "I spent the afternoon working on ideas for the shirts.",
        },
      })
    );
    expect(read.latest_user_signal).toMatch(/working on ideas for the shirts/i);
    expect(read.today_best_move).toBe("clarify_before_drift");
    expect(read.what_would_make_user_feel_known).toBe("concretize_related_effort");
  });
});
