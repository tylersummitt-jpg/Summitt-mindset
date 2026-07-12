import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("@/lib/clerk-rest", () => ({
  getClerkUser: vi.fn(),
}));

import { mapBuiltToTylerTextOverviewGenerationRow } from "@/lib/tyler-text-overview-generate";
import { builtFromWeeklyLane } from "@/lib/tyler-text-overview-weekly-generate";
import { WEEKLY_TTO_WRITER_PROMPT_PATH } from "@/lib/tyler-text-overview-weekly-period";
import {
  buildWriterOpenAiCapture,
  hashWriterOpenAiMessages,
} from "@/lib/tyler-text-overview-writer-capture";
import { SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT } from "@/lib/tyler-text-overview-types";
import type { WeeklyV3RelationshipLaneResult } from "@/lib/v3-weekly-outbound-relationship-lane";

const REPO = process.cwd();

const EXACT_CAPTURE = buildWriterOpenAiCapture({
  messages: [
    { role: "system", content: "Weekly system rules." },
    {
      role: "user",
      content: "RELATIONSHIP_PACKET_V1 (facts only; not copyable prose):\n{\"week\":true}",
    },
  ],
  model: "gpt-4o-mini",
  writer_prompt_path: WEEKLY_TTO_WRITER_PROMPT_PATH,
});

function laneResult(
  overrides: Partial<WeeklyV3RelationshipLaneResult> = {}
): WeeklyV3RelationshipLaneResult {
  return {
    body: "Four mornings protected — what is one guardrail for next week?",
    shouldSend: true,
    noSendReason: null,
    replySource: "v3_weekly_relationship_lane",
    routePurpose: "weekly_proof_v2",
    voiceConfidence: 0.8,
    usedFacts: [],
    safetyNotes: [],
    metadata: {
      v3_candidate_body: "Four mornings protected — what is one guardrail for next week?",
      openai_ok: true,
    },
    openAiOk: true,
    writerOpenAiCapture: EXACT_CAPTURE,
    ...overrides,
  };
}

describe("builtFromWeeklyLane / weekly writer capture persistence", () => {
  it("persists exact system/user capture into generation row writer_openai_messages", () => {
    const built = builtFromWeeklyLane({
      lane: laneResult(),
      commitmentId: "cmt_1",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const row = mapBuiltToTylerTextOverviewGenerationRow({
      clerkUserId: "user_1",
      draftForDayKey: "2026-07-12",
      generationNumber: 1,
      generationReason: "manual_regenerate",
      built,
      commitmentId: "cmt_1",
      timezone: "America/Chicago",
      sendPrefSnapshot: "clerk:morning",
      sendSlot: SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
      generationMetadataExtra: {
        week_key: "2026-W28",
        week_start: "2026-07-06",
        week_end: "2026-07-12",
      },
    });

    expect(row.writer_openai_messages).toEqual(EXACT_CAPTURE.messages);
    expect(row.writer_prompt_path).toBe(WEEKLY_TTO_WRITER_PROMPT_PATH);
    expect(row.notebook_hash).toBe(hashWriterOpenAiMessages(EXACT_CAPTURE.messages));
    expect(row.machine_should_send).toBe(true);
    expect(row.machine_draft_body).toBe(built.smsBody);
    expect(row.writer_openai_messages.some((m) => m.role === "assistant")).toBe(false);
  });

  it("adding capture does not change body or machine_should_send for no-send lanes", () => {
    const lane = laneResult({
      body: "",
      shouldSend: false,
      noSendReason: "model_no_send",
      metadata: {
        v3_candidate_body: "",
        openai_ok: true,
        lane_stage: "model_no_send",
      },
    });
    const built = builtFromWeeklyLane({ lane, commitmentId: "cmt_1" });
    expect(built.ok).toBe(false);
    if (built.ok) return;

    const row = mapBuiltToTylerTextOverviewGenerationRow({
      clerkUserId: "user_1",
      draftForDayKey: "2026-07-12",
      generationNumber: 1,
      generationReason: "manual_regenerate",
      built,
      commitmentId: "cmt_1",
      timezone: "America/Chicago",
      sendPrefSnapshot: "clerk:morning",
      sendSlot: SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
    });

    expect(row.machine_should_send).toBe(false);
    expect(row.machine_draft_body).toBeNull();
    expect(row.machine_no_send_reason).toBe("model_no_send");
    expect(row.writer_openai_messages).toEqual(EXACT_CAPTURE.messages);
    expect(row.writer_openai_messages.every((m) => m.role !== "assistant")).toBe(true);
  });

  it("null lane capture persists empty writer_openai_messages (no assistant fabrication)", () => {
    const built = builtFromWeeklyLane({
      lane: laneResult({
        writerOpenAiCapture: null,
        openAiOk: false,
        shouldSend: false,
        body: "",
        noSendReason: "openai_unavailable",
      }),
      commitmentId: "cmt_1",
    });
    expect(built.writerOpenAiCapture).toBeNull();
    const row = mapBuiltToTylerTextOverviewGenerationRow({
      clerkUserId: "user_1",
      draftForDayKey: "2026-07-12",
      generationNumber: 1,
      built,
      commitmentId: "cmt_1",
      timezone: "America/Chicago",
      sendPrefSnapshot: "clerk:morning",
      sendSlot: SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
    });
    expect(row.writer_openai_messages).toEqual([]);
  });
});

describe("weekly generate source contracts", () => {
  it("does not fabricate assistant-output-as-input", () => {
    const src = readFileSync(
      join(REPO, "src/lib/tyler-text-overview-weekly-generate.ts"),
      "utf8"
    );
    expect(src).not.toContain("weeklyLaneCapture");
    expect(src).not.toContain('role: "assistant"');
    expect(src).toContain("lane.writerOpenAiCapture");
    expect(src).toContain("persistTylerTextOverviewDraftFromBuilt");
  });

  it("generate-all reuses one-row generation (inherits exact capture)", () => {
    const src = readFileSync(
      join(REPO, "src/lib/tyler-text-overview-weekly-generate-all.ts"),
      "utf8"
    );
    expect(src).toContain("generateTylerTextOverviewWeeklyDraftForUser");
    expect(src).not.toContain("weeklyLaneCapture");
    expect(src).not.toContain('role: "assistant"');
  });
});
