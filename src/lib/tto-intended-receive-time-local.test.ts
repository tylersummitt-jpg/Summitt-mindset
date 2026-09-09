import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { buildMorningMessageFor } from "@/lib/morning-tto-relationship-packet";
import {
  EVENING_LANE_WINDOW_END_MINUTE_EXCLUSIVE,
  EVENING_LANE_WINDOW_START_MINUTE,
  formatLaneWindowStartHhMm,
  formatMinuteOfDayAsHhMm,
  MORNING_LANE_WINDOW_END_MINUTE_EXCLUSIVE,
  MORNING_LANE_WINDOW_START_MINUTE,
} from "@/lib/daily-sms-scheduling";
import { formatLocalHourMinute } from "@/lib/timezone";
import { WEEKLY_INTENDED_RECEIVE_TIME_LOCAL } from "@/lib/weekly-tto-relationship-packet";
import { assembleMorningBriefInterpreterInputV1 } from "@/lib/morning-tto-brief-canonical-input-v1";
import { buildMorningBriefInterpreterMessages } from "@/lib/morning-tto-brief-interpreter-v1";
import { buildMorningWriterMessages } from "@/lib/morning-tto-writer";

const REPO = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(join(REPO, rel), "utf8");
}

describe("tto intended / current local time contracts", () => {
  it("A: Morning live packet and interpreter input are 07:00 from window start", () => {
    expect(formatMinuteOfDayAsHhMm(MORNING_LANE_WINDOW_START_MINUTE)).toBe("07:00");
    expect(formatLaneWindowStartHhMm("morning")).toBe("07:00");
    const packetFor = buildMorningMessageFor({
      timezone: "America/New_York",
      draftForDayKey: "2026-08-03",
    });
    expect(packetFor.intended_receive_time_local).toBe("07:00");
    const assembled = assembleMorningBriefInterpreterInputV1({
      timezone: "America/New_York",
      localDate: "2026-08-03",
      localWeekday: "Monday",
      daypart: "morning",
      daysSinceLastUserResponse: 1,
      neverReplied: false,
      recentUnansweredOutboundCount: 0,
      canonicalGoalText: "Walk",
      pendingGoalChange: null,
      identityAnchorText: null,
      identitySource: null,
      importantPeople: [],
      lifeContextProfile: {},
      latestOutcome: null,
      latestOutcomeAt: null,
      latestOutcomeMessage: null,
      matchingOutcomeCount: 0,
      hasVerifiedProofMetadata: false,
      threadMemoryHint: null,
      exactThreadMessages: [],
      omittedOlderTurnCount: 0,
    });
    expect(assembled).not.toHaveProperty("ok");
    if ("ok" in assembled) throw new Error("unexpected");
    expect(assembled.message_for.intended_receive_time_local).toBe("07:00");
    expect(assembled.message_for.intended_receive_time_local).toBe(
      packetFor.intended_receive_time_local
    );
    const interpreterUser = String(
      buildMorningBriefInterpreterMessages(assembled)[1]?.content
    );
    expect(interpreterUser).toContain('"intended_receive_time_local":"07:00"');
  });

  it("B: Evening live packet and interpreter input are 19:00 from window start", () => {
    expect(formatMinuteOfDayAsHhMm(EVENING_LANE_WINDOW_START_MINUTE)).toBe("19:00");
    expect(formatLaneWindowStartHhMm("evening")).toBe("19:00");
    const packetFor = buildMorningMessageFor({
      timezone: "America/New_York",
      draftForDayKey: "2026-08-07",
      daypart: "evening",
    });
    expect(packetFor.intended_receive_time_local).toBe("19:00");
    const assembled = assembleMorningBriefInterpreterInputV1({
      timezone: "America/New_York",
      localDate: "2026-08-07",
      localWeekday: "Friday",
      daypart: "evening",
      daysSinceLastUserResponse: 1,
      neverReplied: false,
      recentUnansweredOutboundCount: 0,
      canonicalGoalText: "Walk",
      pendingGoalChange: null,
      identityAnchorText: null,
      identitySource: null,
      importantPeople: [],
      lifeContextProfile: {},
      latestOutcome: null,
      latestOutcomeAt: null,
      latestOutcomeMessage: null,
      matchingOutcomeCount: 0,
      hasVerifiedProofMetadata: false,
      threadMemoryHint: null,
      exactThreadMessages: [],
      omittedOlderTurnCount: 0,
    });
    expect(assembled).not.toHaveProperty("ok");
    if ("ok" in assembled) throw new Error("unexpected");
    expect(assembled.message_for.intended_receive_time_local).toBe("19:00");
    expect(assembled.message_for.intended_receive_time_local).toBe(
      packetFor.intended_receive_time_local
    );
    const interpreterUser = String(
      buildMorningBriefInterpreterMessages(assembled)[1]?.content
    );
    expect(interpreterUser).toContain('"intended_receive_time_local":"19:00"');
  });

  it("C: Weekly exposes intended_receive_time_local 12:00", () => {
    expect(WEEKLY_INTENDED_RECEIVE_TIME_LOCAL).toBe("12:00");
    const weeklyPacket = readSrc("src/lib/weekly-tto-relationship-packet.ts");
    expect(weeklyPacket).toContain(
      "intended_receive_time_local: WEEKLY_INTENDED_RECEIVE_TIME_LOCAL"
    );
    expect(weeklyPacket).toMatch(/daypart:\s*"weekly"/);
  });

  it("D: Morning/Evening writer JSON matches packet slot time", () => {
    const morningPacket = {
      version: "morning_relationship_v1" as const,
      message_for: buildMorningMessageFor({
        timezone: "America/New_York",
        draftForDayKey: "2026-08-03",
      }),
      last_user_response: {
        at_utc: null,
        at_local: null,
        days_since: null,
        never_replied: true,
      },
      preferred_name: null,
      current_goal: { text: "Walk" },
      current_identity: { text: null },
      personal_context: [],
      hard_state: { pending_goal_change: null },
      historical_evidence: [],
      exact_thread: {
        window_days: 21 as const,
        max_messages: 30 as const,
        omitted_older_turn_count: 0,
        messages: [],
      },
      answered_user_message_links: [],
    };
    const brief = {
      version: "morning_coaching_brief_v1" as const,
      confidence: "low" as const,
      human_situation: {
        most_alive: "unknown",
        direct_question_or_need: "unknown",
        relevant_life_event: "unknown",
        context_use: "unknown",
        identity_use: "unknown",
        person_use: "unknown",
        selected_person: null,
        selected_person_reason: null,
      },
      truth_and_evidence: {
        latest_user_truth: null,
        outcome: "no_recent_evidence" as const,
        evidence_note: "unknown",
        evidence_strength: "none" as const,
        consistency_supported: false,
        proof_claims_allowed: {
          completion: false,
          miss: false,
          partial: false,
          proof: false,
        },
      },
      conversation_continuity: {
        already_acknowledged: "unknown",
        answered_question: "unknown",
        open_loop: "unknown",
        stale_or_exhausted_topics: "unknown",
        do_not_repeat: "unknown",
      },
      goal_role_today: {
        canonical_goal: "Walk",
        pending_goal: null,
        goal_alignment: "unknown" as const,
        role: "unknown" as const,
        note: "unknown",
      },
      coaching_direction: {
        primary_move: "unknown" as const,
        question_policy: "unknown" as const,
        action_guidance: "unknown" as const,
        pressure: "unknown" as const,
        proactive_decision: "send" as const,
      },
      boundaries: {
        claims_to_avoid: [],
        topics_not_to_force: [],
        unsupported_capabilities: [],
        goal_authority_boundaries: [],
        identity_people_boundaries: [],
        coach_history_is_not_style: "history",
      },
    };
    const morningUser = String(buildMorningWriterMessages(morningPacket, brief)[1]?.content);
    expect(morningUser).toContain('"intended_receive_time_local":"07:00"');
    const eveningPacket = {
      ...morningPacket,
      message_for: buildMorningMessageFor({
        timezone: "America/New_York",
        draftForDayKey: "2026-08-07",
        daypart: "evening",
      }),
    };
    const eveningUser = String(buildMorningWriterMessages(eveningPacket, brief)[1]?.content);
    expect(eveningUser).toContain('"intended_receive_time_local":"19:00"');
  });

  it("E: inbound current_local_time uses the receive clock, not a slot constant", () => {
    expect(
      formatLocalHourMinute(new Date("2026-08-18T16:30:00.000Z"), "America/Chicago")
    ).toBe("11:30");
    expect(
      formatLocalHourMinute(new Date("2026-08-19T01:43:00.000Z"), "America/Chicago")
    ).toBe("20:43");
    const inboundPacket = readSrc("src/lib/inbound-relationship-packet.ts");
    expect(inboundPacket).toContain("current_local_time: formatLocalHourMinute(receivedAt, tz)");
    expect(inboundPacket).not.toContain("intended_receive_time_local");
    expect(readSrc("src/lib/inbound-sol-brief-interpreter.ts")).toContain(
      "JSON.stringify(packet)"
    );
    expect(readSrc("src/lib/inbound-sol-writer.ts")).toContain(
      "JSON.stringify(toWriterFacingInboundRelationshipPacket(packet))"
    );
    const cron = readSrc("src/app/api/cron/sms-inbound-coach/route.ts");
    const solCalls = cron.split("await runInboundSolRelationshipTurn({");
    expect(solCalls.length - 1).toBe(2);
    expect(solCalls[1]).toContain("receivedAt: job.created_at ?? null");
    expect(solCalls[2]).toContain("receivedAt: job.created_at ?? null");
  });

  it("F: scheduling window constants are unchanged", () => {
    expect(MORNING_LANE_WINDOW_START_MINUTE).toBe(7 * 60);
    expect(MORNING_LANE_WINDOW_END_MINUTE_EXCLUSIVE).toBe(9 * 60);
    expect(EVENING_LANE_WINDOW_START_MINUTE).toBe(19 * 60);
    expect(EVENING_LANE_WINDOW_END_MINUTE_EXCLUSIVE).toBe(21 * 60);
    const weeklyCron = readSrc("src/app/api/cron/weekly-sms/route.ts");
    expect(weeklyCron).toContain("Sunday 12:00–12:14 user-local");
    expect(weeklyCron).toContain("local.getHours() === 12");
    expect(weeklyCron).toContain("local.getMinutes() < 15");
    expect(readSrc("src/lib/daily-sms-scheduling.ts")).not.toContain(
      "intended_receive_time_local"
    );
  });

  it("G: freshness logic does not reference intended_receive_time_local", () => {
    const freshnessFiles = [
      "src/lib/tto-draft-fresh-for-send.ts",
      "src/lib/tyler-text-overview-refresh-stale.ts",
      "src/lib/tyler-text-overview-generate.ts",
    ];
    for (const rel of freshnessFiles) {
      const src = readSrc(rel);
      expect(src).not.toContain("intended_receive_time_local");
      expect(src).not.toContain("current_local_time");
    }
    const generate = readSrc("src/lib/tyler-text-overview-generate.ts");
    expect(generate).toContain("generationEffectiveAsk: packet.current_goal.text");
  });

  it("H: no DB migration/schema change for the new field", () => {
    const migrationsDir = join(REPO, "supabase/migrations");
    const names = readdirSync(migrationsDir);
    for (const name of names) {
      const sql = readFileSync(join(migrationsDir, name), "utf8");
      expect(sql).not.toContain("intended_receive_time_local");
      expect(sql).not.toContain("current_local_time");
    }
  });

  it("no Weekly compatibility object invents Morning 07:00", () => {
    expect(readSrc("src/lib/weekly-tto-relationship-packet.ts")).not.toContain('"07:00"');
    expect(readSrc("src/lib/weekly-tto-brief-interpreter.ts")).not.toContain('"07:00"');
    expect(readSrc("src/lib/weekly-tto-brief-interpreter.ts")).not.toContain(
      "intended_receive_time_local: MORNING"
    );
    expect(readSrc("src/lib/weekly-tto-relationship-packet.ts")).not.toMatch(
      /daypart:\s*"morning"[\s\S]{0,80}intended_receive_time_local/
    );
    const omitted = assembleMorningBriefInterpreterInputV1({
      timezone: "America/New_York",
      localDate: "2026-07-12",
      localWeekday: "Sunday",
      daypart: "morning",
      daysSinceLastUserResponse: 1,
      neverReplied: false,
      recentUnansweredOutboundCount: 0,
      canonicalGoalText: "Walk",
      pendingGoalChange: null,
      identityAnchorText: null,
      identitySource: null,
      importantPeople: [],
      lifeContextProfile: {},
      latestOutcome: null,
      latestOutcomeAt: null,
      latestOutcomeMessage: null,
      matchingOutcomeCount: 0,
      hasVerifiedProofMetadata: false,
      threadMemoryHint: null,
      exactThreadMessages: [],
      omittedOlderTurnCount: 0,
      intendedReceiveTimeLocal: false,
    });
    expect(omitted).not.toHaveProperty("ok");
    if ("ok" in omitted) throw new Error("unexpected");
    expect(omitted.message_for).not.toHaveProperty("intended_receive_time_local");
    expect(JSON.stringify(omitted.message_for)).not.toContain("07:00");
  });
});
