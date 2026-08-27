import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  assembleMorningBriefInterpreterInputFromPacket,
  countMatchingLeadingOutcomesFromNewest,
  countRecentUnansweredOutboundFromExactThread,
  deriveOutcomeSpineFromEvents,
  loadMorningBriefCanonicalExtrasV1,
} from "@/lib/morning-tto-brief-canonical-load-v1";
import type { MorningRelationshipPacket } from "@/lib/morning-tto-relationship-packet";

const peopleSelectMock = vi.hoisted(() => vi.fn());
const eventsSelectMock = vi.hoisted(() => vi.fn());
const threadMemoryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table === "important_people") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  limit: () => peopleSelectMock(),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "v2_commitment_event") {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: () => ({
                  limit: () => eventsSelectMock(),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

vi.mock("@/lib/v2-commitment-sms-thread-memory", () => ({
  loadV2CommitmentSmsThreadMemory: threadMemoryMock,
}));

function samplePacket(
  overrides: Partial<MorningRelationshipPacket> = {}
): MorningRelationshipPacket {
  return {
    version: "morning_relationship_v1",
    message_for: {
      timezone: "America/New_York",
      local_date: "2026-08-07",
      local_weekday: "Friday",
      daypart: "morning",
    },
    last_user_response: {
      at_utc: "2026-08-06T15:00:00.000Z",
      at_local: "2026-08-06 11:00",
      days_since: 1,
      never_replied: false,
    },
    preferred_name: "Tyler",
    current_goal: { text: "Dictate one story before noon" },
    current_identity: { text: "I am a father who keeps his word" },
    personal_context: [
      { type: "work_challenge", value: "Launching a product" },
      { type: "important_person", value: "Brooke (spouse_partner)" },
    ],
    hard_state: { pending_goal_change: null },
    historical_evidence: [],
    exact_thread: {
      window_days: 21,
      max_messages: 30,
      omitted_older_turn_count: 0,
      messages: [
        {
          sender: "user",
          sent_at_utc: "2026-08-06T12:00:00.000Z",
          sent_at_local: "2026-08-06 08:00",
          local_day_key: "2026-08-06",
          local_weekday: "Thursday",
          day_relation_to_message: "1_day_before",
          body: "Got it done",
        },
        {
          sender: "coach",
          sent_at_utc: "2026-08-06T16:00:00.000Z",
          sent_at_local: "2026-08-06 12:00",
          local_day_key: "2026-08-06",
          local_weekday: "Thursday",
          day_relation_to_message: "1_day_before",
          body: "Nice work.",
        },
        {
          sender: "coach",
          sent_at_utc: "2026-08-07T12:00:00.000Z",
          sent_at_local: "2026-08-07 08:00",
          local_day_key: "2026-08-07",
          local_weekday: "Friday",
          day_relation_to_message: "same_day",
          body: "Checking in.",
        },
      ],
    },
    ...overrides,
  };
}

describe("morning-tto-brief-canonical-load-v1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    peopleSelectMock.mockResolvedValue({
      data: [
        {
          display_name: "Brooke",
          relationship_type: "spouse_partner",
          is_active: true,
          removed_at: null,
        },
        {
          display_name: "Gone",
          relationship_type: "child",
          is_active: false,
          removed_at: null,
        },
      ],
      error: null,
    });
    eventsSelectMock.mockResolvedValue({
      data: [
        {
          event_type: "user_yes",
          occurred_at: "2026-08-06T15:00:00.000Z",
          payload_json: { message: "Got it done" },
        },
        {
          event_type: "user_yes",
          occurred_at: "2026-08-05T15:00:00.000Z",
          payload_json: { message: "Done again" },
        },
      ],
      error: null,
    });
    threadMemoryMock.mockResolvedValue({
      open_question_pending: false,
      open_question_text: "What will you dictate?",
      open_question_answer_text: "Sunday School",
    });
  });

  it("counts unanswered outbound mechanically from exact thread", () => {
    expect(
      countRecentUnansweredOutboundFromExactThread([
        { sender: "user" },
        { sender: "coach" },
        { sender: "coach" },
      ])
    ).toBe(2);
    expect(
      countRecentUnansweredOutboundFromExactThread([
        { sender: "coach" },
        { sender: "user" },
      ])
    ).toBe(0);
    expect(countRecentUnansweredOutboundFromExactThread([{ sender: "coach" }])).toBe(1);
  });

  it("counts matching leading outcomes without English interpretation", () => {
    expect(
      countMatchingLeadingOutcomesFromNewest([
        { event_type: "user_yes" },
        { event_type: "user_yes" },
        { event_type: "user_no" },
      ])
    ).toBe(2);
    expect(
      deriveOutcomeSpineFromEvents([
        {
          event_type: "user_yes",
          occurred_at: "2026-08-06T15:00:00.000Z",
          payload_json: { message: "Got it done", proof_moment: true },
        },
      ]).hasVerifiedProofMetadata
    ).toBe(false);
  });

  it("loads active people only and excludes inactive", async () => {
    const extras = await loadMorningBriefCanonicalExtrasV1({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
    });
    expect(extras.importantPeople).toEqual([
      {
        display_name: "Brooke",
        relationship_type: "spouse_partner",
        is_active: true,
        removed_at: null,
      },
    ]);
    expect(extras.outcomeSpine.latestOutcome).toBe("user_yes");
    expect(extras.outcomeSpine.matchingOutcomeCount).toBe(2);
    expect(extras.outcomeSpine.hasVerifiedProofMetadata).toBe(false);
    expect(extras.threadMemoryHint?.open_question_text).toMatch(/dictate/i);
    expect(threadMemoryMock).toHaveBeenCalledWith({ commitmentId: "cmt_1" });
  });

  it("assembles interpreter input from packet without mutating packet", () => {
    const packet = samplePacket();
    const before = JSON.stringify(packet);
    const extras = {
      importantPeople: [
        {
          display_name: "Brooke",
          relationship_type: "spouse_partner",
          is_active: true,
          removed_at: null,
        },
      ],
      outcomeSpine: {
        latestOutcome: "user_yes" as const,
        latestOutcomeAt: "2026-08-06T15:00:00.000Z",
        latestOutcomeMessage: "Got it done",
        matchingOutcomeCount: 1,
        hasVerifiedProofMetadata: false as const,
      },
      threadMemoryHint: null,
    };
    const input = assembleMorningBriefInterpreterInputFromPacket({ packet, extras });
    expect(JSON.stringify(packet)).toBe(before);
    expect(input).not.toHaveProperty("ok");
    if ("ok" in input) throw new Error("unexpected");
    expect(input.canonical_goal.text).toBe("Dictate one story before noon");
    expect(input.historical_evidence).toBe(packet.historical_evidence);
    expect(input.historical_evidence).toEqual([]);
    expect(input.available_identity?.text).toMatch(/father/);
    expect(input.available_identity).toEqual({
      text: "I am a father who keeps his word",
    });
    expect(input.available_identity).not.toHaveProperty("source");
    expect(JSON.stringify(input)).not.toMatch(/onboarding_identity_anchor_v1/);
    expect(JSON.stringify(input)).not.toMatch(/identity_source|identitySource|user_edited/);
    expect(input.available_important_people).toEqual([
      { name: "Brooke", relationship: "spouse/partner" },
    ]);
    expect(input.mechanical.recent_unanswered_outbound_count).toBe(2);
    expect(input.truth_spine.latest_outcome).toBe("user_yes");
    expect(input.truth_spine.consistency_supported).toBe(false);
    expect(input.available_life_context.some((x) => x.type === "work_challenge")).toBe(true);
    expect(input.available_life_context.some((x) => x.type === "important_person")).toBe(false);
  });

  it("packet identity null stays null without inventing provenance", () => {
    const packet = samplePacket({
      current_identity: { text: null },
    });
    const extras = {
      importantPeople: [],
      outcomeSpine: {
        latestOutcome: null as const,
        latestOutcomeAt: null,
        latestOutcomeMessage: null,
        matchingOutcomeCount: 0,
        hasVerifiedProofMetadata: false as const,
      },
      threadMemoryHint: null,
    };
    const input = assembleMorningBriefInterpreterInputFromPacket({ packet, extras });
    if ("ok" in input) throw new Error("unexpected");
    expect(input.available_identity).toBeNull();
    expect(JSON.stringify(input)).not.toMatch(/onboarding_identity_anchor_v1/);
  });

  it("production adapter does not invent onboarding identity_source or re-read identity", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/morning-tto-brief-canonical-load-v1.ts"),
      "utf8"
    );
    expect(src).toMatch(/identityAlreadyQuotableGated:\s*true/);
    expect(src).toMatch(/identitySource:\s*null/);
    expect(src).not.toMatch(/ONBOARDING_IDENTITY_ANCHOR_SOURCE/);
    expect(src).not.toMatch(/from\([`'"]profiles[`'"]\)/);
    expect(src).not.toMatch(/select\([^)]*identity_source/);
    expect(src).not.toMatch(/identitySource:\s*identityText\s*\?/);
  });

  it("source module has no write helpers", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/morning-tto-brief-canonical-load-v1.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/upsertCommitmentSmsThreadMemory/);
    expect(src).not.toMatch(/recomputeV2CoachingMemory/);
    expect(src).not.toMatch(/inbound.*persist/i);
    expect(src).not.toMatch(/\.insert\(/);
    expect(src).not.toMatch(/\.update\(/);
    expect(src).toMatch(/loadV2CommitmentSmsThreadMemory/);
  });
});
