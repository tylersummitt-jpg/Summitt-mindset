import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { INBOUND_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1 } from "@/lib/inbound-sol-brief-json-schema";
import {
  DURABLE_USER_EVIDENCE_PARSER_MAX_CHARS,
  parseInboundSolBriefExtras,
} from "@/lib/inbound-sol-coaching-brief";
import {
  INBOUND_SOL_DURABLE_USER_EVIDENCE_CAPTURE_LAW,
  INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT,
} from "@/lib/inbound-sol-brief-interpreter";
import { INBOUND_SOL_WRITER_SYSTEM_PROMPT } from "@/lib/inbound-sol-writer";
import { MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT } from "@/lib/morning-tto-brief-interpreter-v1";
import { WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT } from "@/lib/weekly-tto-brief-interpreter";
import { MORNING_TTO_SYSTEM_PROMPT } from "@/lib/morning-tto-writer";
import { WEEKLY_TTO_SYSTEM_PROMPT } from "@/lib/weekly-tto-writer";

function extras(overrides: Record<string, unknown> = {}) {
  return parseInboundSolBriefExtras({
    answer_priority: "normal",
    coaching_after_answer: "no",
    user_is_correcting_coach: false,
    accountability_interpretation: {
      relevance: "unrelated",
      outcome: "not_applicable",
      confidence: "high",
      evidence: "hello",
    },
    meaningful_win: null,
    pending_photo_relation: { relation: "none", target_win_id: null },
    durable_user_evidence: null,
    ...overrides,
  });
}

describe("durable user evidence capture schema and CAPTURE LAW", () => {
  it("schema requires nullable durable_user_evidence with only exact_user_evidence", () => {
    const inbound = INBOUND_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1.properties.inbound;
    expect(inbound.required).toContain("durable_user_evidence");
    expect(inbound.additionalProperties).toBe(false);
    const shape = inbound.properties.durable_user_evidence;
    expect(shape.anyOf).toEqual(
      expect.arrayContaining([
        { type: "null" },
        expect.objectContaining({
          type: "object",
          additionalProperties: false,
          required: ["exact_user_evidence"],
        }),
      ])
    );
    const objectShape = shape.anyOf.find(
      (entry: { type?: string }) => entry.type === "object"
    ) as { properties: Record<string, unknown> };
    expect(Object.keys(objectShape.properties)).toEqual(["exact_user_evidence"]);
  });

  it("CAPTURE LAW is inbound interpreter only", () => {
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain(
      INBOUND_SOL_DURABLE_USER_EVIDENCE_CAPTURE_LAW
    );
    expect(INBOUND_SOL_DURABLE_USER_EVIDENCE_CAPTURE_LAW).toContain(
      "verbatim contiguous substring of latest_inbound_text"
    );
    expect(INBOUND_SOL_DURABLE_USER_EVIDENCE_CAPTURE_LAW).toContain("When unsure");
    expect(INBOUND_SOL_DURABLE_USER_EVIDENCE_CAPTURE_LAW).toContain(
      "Do not select evidence from exact_thread"
    );
    expect(INBOUND_SOL_DURABLE_USER_EVIDENCE_CAPTURE_LAW).toContain("user_is_correcting_coach");
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).not.toContain("DURABLE USER EVIDENCE");
    expect(MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT).not.toContain("DURABLE USER EVIDENCE");
    expect(WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT).not.toContain("DURABLE USER EVIDENCE");
    expect(MORNING_TTO_SYSTEM_PROMPT).not.toContain("DURABLE USER EVIDENCE");
    expect(WEEKLY_TTO_SYSTEM_PROMPT).not.toContain("DURABLE USER EVIDENCE");
  });

  it("CAPTURE LAW names temporary vs lasting vs ordinary vs goal vs correction cases without forcing a model classification", () => {
    const law = INBOUND_SOL_DURABLE_USER_EVIDENCE_CAPTURE_LAW;
    expect(law).toContain("this-turn-only");
    expect(law).toContain("lasting instructions about how Coach should coach them");
    expect(law).toContain("foundational values");
    expect(law).toContain("ordinary updates");
    expect(law).toContain("Current Goal restatements");
    expect(law).toContain("accountability outcomes or Wins");
    expect(law).toContain("user_is_correcting_coach");
  });

  it("missing field defaults to null so older extras objects still parse", () => {
    const parsed = extras({ durable_user_evidence: undefined });
    expect(parsed?.durable_user_evidence).toBeNull();
  });

  it("null capture is valid", () => {
    expect(extras({ durable_user_evidence: null })?.durable_user_evidence).toBeNull();
  });

  it("exact excerpt object is accepted", () => {
    const excerpt = "I like when you challenge me directly. Don't sugarcoat it.";
    expect(
      extras({ durable_user_evidence: { exact_user_evidence: excerpt } })
        ?.durable_user_evidence
    ).toEqual({ exact_user_evidence: excerpt });
  });

  it("empty excerpt fails the capture field only", () => {
    const parsed = extras({ durable_user_evidence: { exact_user_evidence: "" } });
    expect(parsed).not.toBeNull();
    expect(parsed?.durable_user_evidence).toBeNull();
  });

  it(">400 excerpt fails the capture field and does not slice", () => {
    const tooLong = "Being present with my kids. ".repeat(20);
    expect(tooLong.length).toBeGreaterThan(DURABLE_USER_EVIDENCE_PARSER_MAX_CHARS);
    const parsed = extras({ durable_user_evidence: { exact_user_evidence: tooLong } });
    expect(parsed).not.toBeNull();
    expect(parsed?.durable_user_evidence).toBeNull();
    expect(parsed?.answer_priority).toBe("normal");
  });
});
