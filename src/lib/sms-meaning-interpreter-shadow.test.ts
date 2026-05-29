import { beforeEach, describe, expect, it, vi } from "vitest";

const openAiCreate = vi.fn();
vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: (...args: unknown[]) => openAiCreate(...args),
      },
    };
  },
}));

const insertMock = vi.fn(async () => ({ error: null }));
const lookupMock = vi.fn(async () => ({ data: null, error: null }));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table === "v2_sms_meaning_interpretation_shadow") {
        return { insert: insertMock };
      }
      if (table === "sms_inbound_messages") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: lookupMock,
            }),
          }),
        };
      }
      return { insert: insertMock };
    },
  },
}));

vi.mock("@/lib/sms-pattern-correction", () => ({
  listApprovedSmsPatternCorrectionsForShadowPrompt: vi.fn(async () => ({ ok: true, rows: [] })),
}));

import {
  getSmsMeaningInterpreterSampleRate,
  isSmsMeaningInterpreterShadowEnabled,
  shouldLogMeaningInterpreterSkipped,
  shouldSampleMeaningInterpreter,
} from "@/lib/sms-meaning-interpreter-flags";
import { parseAndValidateMeaningInterpreterShadow } from "@/lib/sms-meaning-interpreter-schema";
import {
  buildMeaningShadowScheduleArgs,
  callMeaningInterpreterOpenAI,
  computeMeaningInterpreterDisagreement,
  finalizeMeaningInterpreterShadowForInboundJob,
  isEligibleForMeaningInterpreterShadow,
  recordMeaningInterpreterSkippedShadow,
  runMeaningInterpreterShadowPipeline,
  shouldRunMeaningInterpreterShadow,
} from "@/lib/sms-meaning-interpreter-shadow";
import { buildMeaningInterpreterShadowFinalizeFromSchedule } from "@/lib/sms-meaning-interpreter-context";
import { MEANING_INTERPRETER_ROUTES } from "@/lib/sms-meaning-interpreter-routes";

const validShadowJson = {
  version: 1,
  primary_intent: "accountability_answer",
  secondary_intents: [],
  emotional_tone: "neutral",
  answered_open_question: "not_applicable",
  open_question_answer_summary: null,
  signals: {
    goal_change: false,
    pause_or_cadence: false,
    completion_or_proof: false,
    blocker: false,
    resistance_or_shame: false,
    substitution_counts: false,
  },
  safety_hint: "none",
  confidence: 0.82,
  disagrees_with_deterministic_route: false,
  disagreement_reason: null,
  explanation_short: "User appears to confirm they did the daily bar.",
  recommended_followup_kind: "acknowledge",
};

describe("sms-meaning-interpreter flags", () => {
  beforeEach(() => {
    delete process.env.SMS_MEANING_INTERPRETER_SHADOW_ENABLED;
    delete process.env.SMS_MEANING_INTERPRETER_SAMPLE_RATE;
  });

  it("defaults shadow off", () => {
    expect(isSmsMeaningInterpreterShadowEnabled()).toBe(false);
  });

  it("defaults LOG_SKIPPED off", () => {
    expect(shouldLogMeaningInterpreterSkipped()).toBe(false);
  });

  it("defaults sample rate to 0.1", () => {
    expect(getSmsMeaningInterpreterSampleRate()).toBe(0.1);
  });

  it("sample rate 0 never samples", () => {
    process.env.SMS_MEANING_INTERPRETER_SAMPLE_RATE = "0";
    expect(shouldSampleMeaningInterpreter("SM123", getSmsMeaningInterpreterSampleRate())).toBe(
      false
    );
  });

  it("sample rate 1 always samples", () => {
    expect(shouldSampleMeaningInterpreter("SM123", 1)).toBe(true);
  });
});

describe("meaning interpreter schema", () => {
  it("parses valid JSON", () => {
    const parsed = parseAndValidateMeaningInterpreterShadow(validShadowJson);
    expect(parsed?.primary_intent).toBe("accountability_answer");
    expect(parsed?.signals.completion_or_proof).toBe(false);
  });

  it("rejects invalid primary_intent", () => {
    expect(
      parseAndValidateMeaningInterpreterShadow({
        ...validShadowJson,
        primary_intent: "mark_complete",
      })
    ).toBeNull();
  });
});

describe("eligibility and shouldRun", () => {
  beforeEach(() => {
    delete process.env.SMS_MEANING_INTERPRETER_SHADOW_ENABLED;
    delete process.env.SMS_MEANING_INTERPRETER_SAMPLE_RATE;
  });

  it("excludes STOP compliance turns", () => {
    expect(isEligibleForMeaningInterpreterShadow({ rawBody: "STOP" })).toBe(false);
  });

  it("excludes empty messages", () => {
    expect(isEligibleForMeaningInterpreterShadow({ rawBody: "   " })).toBe(false);
  });

  it("flag off does not run", () => {
    expect(
      shouldRunMeaningInterpreterShadow({
        inboundMessageSid: "SM1",
        rawBody: "Yes I did it",
      })
    ).toBe(false);
  });

  it("flag on with sample rate 1 runs for eligible message", () => {
    process.env.SMS_MEANING_INTERPRETER_SHADOW_ENABLED = "true";
    process.env.SMS_MEANING_INTERPRETER_SAMPLE_RATE = "1";
    expect(
      shouldRunMeaningInterpreterShadow({
        inboundMessageSid: "SM1",
        rawBody: "Yes I did it",
      })
    ).toBe(true);
  });

  it("sample rate 0 does not run even when enabled", () => {
    process.env.SMS_MEANING_INTERPRETER_SHADOW_ENABLED = "true";
    process.env.SMS_MEANING_INTERPRETER_SAMPLE_RATE = "0";
    expect(
      shouldRunMeaningInterpreterShadow({
        inboundMessageSid: "SM1",
        rawBody: "Yes I did it",
      })
    ).toBe(false);
  });
});

describe("disagreement calculation", () => {
  it("flags commitment_change vs normal_accountability", () => {
    const parsed = parseAndValidateMeaningInterpreterShadow({
      ...validShadowJson,
      primary_intent: "commitment_change",
    });
    expect(parsed).not.toBeNull();
    const cmp = computeMeaningInterpreterDisagreement({
      deterministicRoute: "normal_accountability",
      deterministicFacts: {},
      shadow: parsed!,
    });
    expect(cmp.disagreement).toBe(true);
    expect(cmp.flags).toContain("shadow_commitment_change_vs_normal_accountability");
  });

  it("flags pending/contract meta_or_confusion disagreements", () => {
    const parsed = parseAndValidateMeaningInterpreterShadow({
      ...validShadowJson,
      primary_intent: "meta_or_confusion",
      confidence: 0.9,
    });
    const pending = computeMeaningInterpreterDisagreement({
      deterministicRoute: "pending_resolution_commitment_replace",
      deterministicFacts: {},
      shadow: parsed!,
    });
    expect(pending.flags).toContain("shadow_meta_confusion_vs_pending_resolution");

    const contract = computeMeaningInterpreterDisagreement({
      deterministicRoute: "contract_consent",
      deterministicFacts: {},
      shadow: parsed!,
    });
    expect(contract.flags).toContain("shadow_meta_confusion_vs_contract_consent");
  });

  it("flags new open-question / contract / support disagreement slices", () => {
    const timeParsed = parseAndValidateMeaningInterpreterShadow({
      ...validShadowJson,
      version: 2,
      primary_intent: "open_question_answer",
      secondary_intents: ["short_numeric_time_answer", "time_answer_to_prior_question"],
      answer_type: "time_or_schedule",
      answered_prior_open_question: "yes",
    });
    expect(timeParsed).not.toBeNull();
    const timeCmp = computeMeaningInterpreterDisagreement({
      deterministicRoute: "normal_accountability",
      deterministicFacts: {
        open_question_text: "What time will you do it?",
        open_question_routing_miss: true,
      },
      shadow: timeParsed!,
      outcomeSent: false,
      jobStatus: "cancelled",
    });
    expect(timeCmp.flags).toContain("shadow_answered_prior_question_but_cancelled");
    expect(timeCmp.flags).toContain("shadow_time_answer_vs_open_question_routing_miss");

    const contractParsed = parseAndValidateMeaningInterpreterShadow({
      ...validShadowJson,
      version: 2,
      secondary_intents: ["contract_yes_answer"],
      answer_type: "contract_yes_no",
    });
    const contractCmp = computeMeaningInterpreterDisagreement({
      deterministicRoute: "normal_accountability",
      deterministicFacts: { contract_consent_gate_miss: true, gate_reason: "stale_outbound" },
      shadow: contractParsed!,
      outcomeSent: false,
    });
    expect(contractCmp.flags).toContain("shadow_contract_yes_vs_gate_miss");
  });
});

describe("OpenAI call and insert pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SMS_MEANING_INTERPRETER_SHADOW_ENABLED;
    delete process.env.SMS_MEANING_INTERPRETER_SAMPLE_RATE;
    delete process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    process.env.SMS_MEANING_INTERPRETER_SHADOW_ENABLED = "true";
    process.env.SMS_MEANING_INTERPRETER_SAMPLE_RATE = "1";
    openAiCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(validShadowJson) } }],
    });
  });

  it("stores ok=true row on valid JSON", async () => {
    await runMeaningInterpreterShadowPipeline({
      ...buildMeaningShadowScheduleArgs({
        deterministicRoute: "normal_accountability",
        commitmentId: "commit-1",
        deterministicFacts: { classifier_event_type: "user_yes" },
      }),
      clerkUserId: "user_1",
      inboundMessageSid: "SM100",
      rawBody: "Yes done",
    });

    expect(openAiCreate).toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inbound_message_sid: "SM100",
        ok: true,
        primary_intent: "accountability_answer",
        shadow_status: "openai_ok",
        outcome_sent: true,
      })
    );
  });

  it("stores skipped row without OpenAI when sampled out", async () => {
    process.env.SMS_MEANING_INTERPRETER_SAMPLE_RATE = "0";
    await finalizeMeaningInterpreterShadowForInboundJob(
      buildMeaningInterpreterShadowFinalizeFromSchedule({
        clerkUserId: "user_1",
        inboundMessageSid: "SM_SKIP",
        rawBody: "Yes I did it",
        outcomeSent: false,
        jobStatus: "cancelled",
        deterministicRoute: MEANING_INTERPRETER_ROUTES.normal_accountability,
        deterministicFacts: {},
      })
    );
    expect(openAiCreate).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inbound_message_sid: "SM_SKIP",
        shadow_status: "skipped",
        skipped_reason: "sampled_out",
        error_code: "skipped_no_openai",
        outcome_sent: false,
        body_preview: "Yes I did it",
      })
    );
  });

  it("finalize writes facts for cancelled job when shadow enabled", async () => {
    process.env.SMS_MEANING_INTERPRETER_SAMPLE_RATE = "0";
    await finalizeMeaningInterpreterShadowForInboundJob(
      buildMeaningInterpreterShadowFinalizeFromSchedule({
        clerkUserId: "user_1",
        inboundMessageSid: "SM_CANCEL",
        commitmentId: "commit-1",
        rawBody: "8",
        outcomeSent: false,
        jobStatus: "cancelled",
        lastError: JSON.stringify({ tag: "inbound_relationship_lane_no_send" }),
        deterministicRoute: MEANING_INTERPRETER_ROUTES.normal_accountability,
        deterministicFacts: {
          open_question_text: "What specific time will you do it?",
          expected_reply_semantics: "time_or_schedule",
          open_question_routing_miss: true,
        },
      })
    );
    expect(openAiCreate).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inbound_message_sid: "SM_CANCEL",
        outcome_sent: false,
        deterministic_facts: expect.objectContaining({
          open_question_text: "What specific time will you do it?",
          expected_reply_semantics: "time_or_schedule",
          open_question_routing_miss: true,
        }),
      })
    );
  });

  it("successful sent job still records shadow with OpenAI when sampled", async () => {
    openAiCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(validShadowJson) } }],
    });
    insertMock.mockClear();
    await runMeaningInterpreterShadowPipeline({
      ...buildMeaningShadowScheduleArgs({
        deterministicRoute: "normal_accountability",
        commitmentId: "commit-1",
        deterministicFacts: { classifier_event_type: "user_yes" },
      }),
      clerkUserId: "user_1",
      inboundMessageSid: "SM_SENT",
      rawBody: "Yes done",
    });
    expect(openAiCreate).toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inbound_message_sid: "SM_SENT",
        ok: true,
        shadow_status: "openai_ok",
        outcome_sent: true,
      })
    );
  });

  it("stores ok=false on invalid JSON without throwing", async () => {
    openAiCreate.mockResolvedValue({
      choices: [{ message: { content: "{not-json" } }],
    });

    await expect(
      runMeaningInterpreterShadowPipeline({
        ...buildMeaningShadowScheduleArgs({
          deterministicRoute: "normal_accountability",
          deterministicFacts: {},
        }),
        clerkUserId: "user_1",
        inboundMessageSid: "SM101",
        rawBody: "hello",
      })
    ).resolves.toBeUndefined();

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inbound_message_sid: "SM101",
        ok: false,
        error_code: "invalid_json",
      })
    );
  });

  it("flag off skips OpenAI and insert", async () => {
    process.env.SMS_MEANING_INTERPRETER_SHADOW_ENABLED = "false";
    await runMeaningInterpreterShadowPipeline({
      ...buildMeaningShadowScheduleArgs({
        deterministicRoute: "normal_accountability",
        deterministicFacts: {},
      }),
      clerkUserId: "user_1",
      inboundMessageSid: "SM102",
      rawBody: "hello",
    });
    expect(openAiCreate).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("flag off finalize skips insert for cancelled jobs", async () => {
    process.env.SMS_MEANING_INTERPRETER_SHADOW_ENABLED = "false";
    insertMock.mockClear();
    await finalizeMeaningInterpreterShadowForInboundJob(
      buildMeaningInterpreterShadowFinalizeFromSchedule({
        clerkUserId: "user_1",
        inboundMessageSid: "SM102B",
        rawBody: "8",
        outcomeSent: false,
        jobStatus: "cancelled",
        deterministicRoute: MEANING_INTERPRETER_ROUTES.normal_accountability,
        deterministicFacts: {},
      })
    );
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("callMeaningInterpreterOpenAI without API key", () => {
  it("returns no_openai_key", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await callMeaningInterpreterOpenAI({
      ...buildMeaningShadowScheduleArgs({
        deterministicRoute: "normal_accountability",
        deterministicFacts: {},
      }),
      clerkUserId: "user_1",
      inboundMessageSid: "SM103",
      rawBody: "hello",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe("no_openai_key");
  });
});

describe("static safety: shadow module isolation", () => {
  it("shadow helper does not reference v2_commitment_event or V3 lane", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/sms-meaning-interpreter-shadow.ts", "utf8");
    expect(src).not.toContain("v2_commitment_event");
    expect(src).not.toContain("produceInboundV3RelationshipSms");
    expect(src).not.toMatch(/\breply_body\s*=/);
  });

  it("migration has RLS enabled and new telemetry columns", async () => {
    const fs = await import("node:fs/promises");
    const sql = await fs.readFile(
      "supabase/migrations/20260611120000_v2_sms_meaning_interpretation_shadow.sql",
      "utf8"
    );
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("shadow_status");
    expect(sql).toContain("reply_body_preview");
    expect(sql).toContain("idx_v2_sms_meaning_shadow_route_created");
    expect(sql.toLowerCase()).not.toContain("to authenticated");
    expect(sql.toLowerCase()).not.toContain("to anon");
  });

  it("coach route hook finalizes shadow after send, not in V3 facts builder", async () => {
    const fs = await import("node:fs/promises");
    const route = await fs.readFile("src/app/api/cron/sms-inbound-coach/route.ts", "utf8");
    expect(route).toContain("scheduleFinalizeMeaningInterpreterShadowForInboundJob");
    expect(route).toContain("finalizeMeaningShadowAfterJobTerminal");
    expect(route).not.toMatch(/buildInboundV3RelationshipFacts\([\s\S]{0,800}meaningShadow/);
  });

  it("pattern correction loader is shadow-prompt-only", async () => {
    const fs = await import("node:fs/promises");
    const shadow = await fs.readFile("src/lib/sms-meaning-interpreter-shadow.ts", "utf8");
    const pattern = await fs.readFile("src/lib/sms-pattern-correction.ts", "utf8");
    expect(shadow).toContain("listApprovedSmsPatternCorrectionsForShadowPrompt");
    expect(pattern).toContain('eq("usage_policy", "prompt_hint_only")');
    expect(shadow).not.toContain("listApprovedSmsPatternCorrectionsForReview");
  });
});
