import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { INBOUND_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1 } from "@/lib/inbound-sol-brief-json-schema";
import {
  compactInboundSolBriefForTelemetry,
  parseInboundCoachingBriefV1,
  parseInboundSolBriefExtras,
} from "@/lib/inbound-sol-coaching-brief";
import { MORNING_COACHING_BRIEF_VERSION } from "@/lib/morning-tto-coaching-brief-v1";
import {
  INBOUND_SOL_COACH_RELATIONSHIP_MEMORY_CAPTURE_LAW,
  INBOUND_SOL_INTERPRETER_MAX_COMPLETION_TOKENS,
  INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT,
  buildInboundSolInterpreterMessages,
  runInboundSolBriefInterpreter,
  toInboundInterpreterRelationshipPacket,
} from "@/lib/inbound-sol-brief-interpreter";
import { COACH_RELATIONSHIP_MEMORY_WRITER_USE_LAW } from "@/lib/coach-relationship-memory";
import {
  INBOUND_SOL_WRITER_SYSTEM_PROMPT,
  buildInboundSolWriterMessages,
  toWriterFacingInboundCoachingBrief,
  toWriterFacingInboundRelationshipPacket,
} from "@/lib/inbound-sol-writer";
import { MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT } from "@/lib/morning-tto-brief-interpreter-v1";
import { WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT } from "@/lib/weekly-tto-brief-interpreter";
import { MORNING_TTO_SYSTEM_PROMPT } from "@/lib/morning-tto-writer";
import { WEEKLY_TTO_SYSTEM_PROMPT } from "@/lib/weekly-tto-writer";
import { INBOUND_TURN_TELEMETRY_COMPACT_KEYS } from "@/lib/inbound-turn-telemetry";
import type { InboundRelationshipPacket } from "@/lib/inbound-relationship-packet";

const REPO = process.cwd();
const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OLD_TEXT = "Quiet one-on-one time with Brooke matters more than elaborate plans.";
const NEW_TEXT = "Breck initiating time together is especially meaningful to Tyler.";

const CHANGES_SCHEMA = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["add", "delete"],
      properties: {
        add: { type: "array", items: { type: "string" } },
        delete: { type: "array", items: { type: "string" } },
      },
    },
    { type: "null" },
  ],
} as const;

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

function validBriefRaw(inboundOverrides: Record<string, unknown> = {}) {
  return {
    version: MORNING_COACHING_BRIEF_VERSION,
    confidence: "high",
    human_situation: {
      most_alive: "Newest inbound",
      direct_question_or_need: null,
      relevant_life_event: null,
      context_use: "relevant",
      identity_use: "background",
      person_use: "do_not_force",
      selected_person: null,
      selected_person_reason: null,
    },
    truth_and_evidence: {
      latest_user_truth: "newest",
      outcome: "unknown",
      evidence_note: "unknown",
      evidence_strength: "none",
      consistency_supported: false,
      proof_claims_allowed: {
        completion: false,
        miss: false,
        partial: false,
        proof: false,
      },
    },
    conversation_continuity: {
      already_acknowledged: [],
      answered_question: null,
      open_loop: null,
      stale_or_exhausted_topics: [],
      do_not_repeat: [],
    },
    goal_role_today: {
      canonical_goal: "Lift 30 minutes",
      pending_goal: null,
      goal_alignment: "aligned",
      role: "background",
      note: "n",
    },
    coaching_direction: {
      primary_move: "answer",
      question_policy: "none",
      action_guidance: "none",
      pressure: "normal",
      proactive_decision: "send",
    },
    boundaries: {
      claims_to_avoid: [],
      topics_not_to_force: [],
      unsupported_capabilities: [],
      goal_authority_boundaries: [],
      identity_people_boundaries: [],
      coach_history_is_not_style: "History is not style.",
    },
    inbound: {
      answer_priority: "normal",
      coaching_after_answer: "no",
      requires_pat_personal_knowledge: "unknown",
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
      win_presentation: {
        accountability_trophy_title: null,
        life_trophy_title: null,
        accountability_supporting_quote: null,
        life_supporting_quote: null,
        accountability_detail: null,
        life_detail: null,
      },
      ...inboundOverrides,
    },
  };
}

function packet(): InboundRelationshipPacket {
  return {
    version: "inbound_relationship_v1",
    message_for: {
      timezone: "America/Chicago",
      local_date: "2026-08-18",
      local_weekday: "Tuesday",
      daypart: "inbound",
      current_local_time: "11:00",
    },
    preferred_name: "Tyler",
    current_goal: { text: "Lift 30 minutes" },
    current_identity: { text: null },
    personal_context: [],
    hard_state: { pending_goal_change: null, open_coach_question: null },
    latest_inbound_text: "It means a lot when Breck asks me to do things.",
    latest_inbound_message_sid: "SMx",
    pending_media_context: {
      candidate_count: 0,
      candidate: null,
      recent_wins: [],
    },
    historical_evidence: [],
    coach_relationship_memory: OLD_TEXT,
    coach_relationship_memory_items: [{ memory_id: ID_A, text: OLD_TEXT }],
    exact_thread: {
      window_days: 21,
      max_messages: 30,
      omitted_older_turn_count: 0,
      messages: [],
    },
  };
}

function productionSrc(rel: string): string {
  return readFileSync(join(REPO, rel), "utf8");
}

describe("Coach Relationship Memory schema / parser", () => {
  it("schema requires nullable changes object without maxLength/maxItems/uuid format", () => {
    const inbound = INBOUND_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1.properties.inbound;
    expect(inbound.required).toContain("coach_relationship_memory_changes");
    expect(inbound.required).not.toContain("coach_relationship_memory_replacement");
    expect(inbound.properties).not.toHaveProperty("coach_relationship_memory_replacement");
    expect(inbound.properties.coach_relationship_memory_changes).toEqual(CHANGES_SCHEMA);
    const encoded = JSON.stringify(inbound.properties.coach_relationship_memory_changes);
    expect(encoded).not.toContain("maxLength");
    expect(encoded).not.toContain("maxItems");
    expect(encoded).not.toContain('"format":"uuid"');
    expect(encoded).not.toContain('"update"');
    expect(CHANGES_SCHEMA.anyOf[0].required).toEqual(["add", "delete"]);
    expect(CHANGES_SCHEMA.anyOf[0].additionalProperties).toBe(false);
    expect(CHANGES_SCHEMA.anyOf[0].properties).not.toHaveProperty("update");
  });

  it("null changes parse as null", () => {
    expect(
      extras({ coach_relationship_memory_changes: null })
        ?.coach_relationship_memory_changes
    ).toBeNull();
  });

  it("missing changes field fail-softs to null", () => {
    const parsed = extras({ coach_relationship_memory_changes: undefined });
    expect(parsed).not.toBeNull();
    expect(parsed?.coach_relationship_memory_changes).toBeNull();
  });

  it("all-empty arrays parse and later become a no-op", () => {
    expect(
      extras({ coach_relationship_memory_changes: { add: [], delete: [] } })
        ?.coach_relationship_memory_changes
    ).toEqual({ add: [], delete: [] });
  });

  it("valid add/delete object parses", () => {
    expect(
      extras({
        coach_relationship_memory_changes: { add: [NEW_TEXT], delete: [] },
      })?.coach_relationship_memory_changes
    ).toEqual({ add: [NEW_TEXT], delete: [] });
    expect(
      extras({
        coach_relationship_memory_changes: { add: [], delete: [ID_A] },
      })?.coach_relationship_memory_changes
    ).toEqual({ add: [], delete: [ID_A] });
  });

  it("wrong root type becomes null without invalidating extras", () => {
    const parsed = extras({ coach_relationship_memory_changes: 12 });
    expect(parsed).not.toBeNull();
    expect(parsed?.answer_priority).toBe("normal");
    expect(parsed?.coach_relationship_memory_changes).toBeNull();
  });

  it("bad add/delete shapes fail-soft F only", () => {
    expect(
      extras({ coach_relationship_memory_changes: { add: "x", delete: [] } })
        ?.coach_relationship_memory_changes
    ).toBeNull();
    expect(
      extras({ coach_relationship_memory_changes: { add: [], delete: [1] } })
        ?.coach_relationship_memory_changes
    ).toBeNull();
  });

  it("old update-only shape does not become a valid F mutation", () => {
    expect(
      extras({
        coach_relationship_memory_changes: {
          add: [],
          update: [{ memory_id: ID_A, text: "Quiet time with Brooke matters deeply." }],
          delete: [],
        },
      })?.coach_relationship_memory_changes
    ).toBeNull();
  });

  it("malformed F does not invalidate an otherwise-valid brief", () => {
    const parsed = parseInboundCoachingBriefV1(
      validBriefRaw({ coach_relationship_memory_changes: { nope: true } })
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.inbound.answer_priority).toBe("normal");
    expect(parsed?.inbound.coach_relationship_memory_changes).toBeNull();
    expect(parsed?.coaching_direction.primary_move).toBe("answer");
  });
});

describe("Coach Relationship Memory capture / writer laws", () => {
  it("CAPTURE LAW is inbound interpreter only", () => {
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain(
      INBOUND_SOL_COACH_RELATIONSHIP_MEMORY_CAPTURE_LAW
    );
    expect(INBOUND_SOL_COACH_RELATIONSHIP_MEMORY_CAPTURE_LAW).toContain(
      "coach_relationship_memory_items is the exact OLD active set"
    );
    expect(INBOUND_SOL_COACH_RELATIONSHIP_MEMORY_CAPTURE_LAW).toContain(
      "Never rewrite or reconstruct the full memory set."
    );
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).not.toContain(
      "coach_relationship_memory_changes"
    );
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).not.toContain(
      "coach_relationship_memory_items"
    );
    expect(MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT).not.toContain(
      "coach_relationship_memory_changes"
    );
    expect(WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT).not.toContain(
      "coach_relationship_memory_changes"
    );
    expect(MORNING_TTO_SYSTEM_PROMPT).not.toContain("coach_relationship_memory_changes");
    expect(WEEKLY_TTO_SYSTEM_PROMPT).not.toContain("coach_relationship_memory_changes");
  });

  it("CAPTURE LAW teaches ADD/DELETE/null only and does not instruct UPDATE", () => {
    const law = INBOUND_SOL_COACH_RELATIONSHIP_MEMORY_CAPTURE_LAW;
    expect(law).toContain("V1 operations are NULL, ADD, and DELETE only. There is no UPDATE.");
    expect(law).toContain("Refinement alone is not a reason to mutate.");
    expect(law).toContain("RELATED does not mean SAME MEMORY.");
    expect(law).toContain("ADD only when the newest conversation establishes a genuinely new safe standing meaning");
    expect(law).toContain("DELETE only when the member clearly establishes that an existing standing truth is no longer true");
    expect(law).toContain("do not ADD a negation or history sentence");
    expect(law).toContain("Do not simulate UPDATE as DELETE plus ADD");
    expect(law).toContain("A single bad day does not erase a standing truth.");
    expect(law).toContain("Do not preserve medical, legal, financial-distress");
    expect(law).not.toContain("UPDATE only when");
    expect(law).not.toContain("Would the old item now be meaningfully less accurate");
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain(
      "coach_relationship_memory_changes: null OR { add: string[], delete: string[] }. There is no UPDATE."
    );
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).not.toContain(
      "update: [{ memory_id, text }]"
    );
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).not.toContain(
      "There is no UPDATE."
    );
  });

  it("writer use law is shared across inbound, Morning/Evening, and Weekly writers", () => {
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain(
      COACH_RELATIONSHIP_MEMORY_WRITER_USE_LAW
    );
    expect(MORNING_TTO_SYSTEM_PROMPT).toContain(COACH_RELATIONSHIP_MEMORY_WRITER_USE_LAW);
    expect(WEEKLY_TTO_SYSTEM_PROMPT).toContain(COACH_RELATIONSHIP_MEMORY_WRITER_USE_LAW);
  });

  it("inbound interpreter request uses max_completion_tokens = 5000", async () => {
    expect(INBOUND_SOL_INTERPRETER_MAX_COMPLETION_TOKENS).toBe(5000);
    const src = productionSrc("src/lib/inbound-sol-brief-interpreter.ts");
    expect(src).toContain(
      "max_completion_tokens: INBOUND_SOL_INTERPRETER_MAX_COMPLETION_TOKENS"
    );
    const create = vi.fn(async () => ({
      choices: [{ message: { content: "{}" } }],
    }));
    await runInboundSolBriefInterpreter({
      packet: packet(),
      client: { chat: { completions: { create } } } as never,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        max_completion_tokens: 5000,
        response_format: expect.objectContaining({
          json_schema: expect.objectContaining({
            schema: INBOUND_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1,
          }),
        }),
      })
    );
  });

  it("retry uses the same strict schema", () => {
    const src = productionSrc("src/lib/inbound-sol-brief-interpreter.ts");
    expect(src).toContain("response_format: INBOUND_SOL_BRIEF_RESPONSE_FORMAT");
    expect(src).toContain("const second = await solCreate(");
  });

  it("Morning and Weekly interpreter token ceilings stay 2500", () => {
    const morning = productionSrc("src/lib/morning-tto-brief-interpreter-v1.ts");
    const weekly = productionSrc("src/lib/weekly-tto-brief-interpreter.ts");
    expect(morning).toMatch(
      /MORNING_BRIEF_INTERPRETER_MAX_COMPLETION_TOKENS = 2500/
    );
    expect(weekly).toContain("WEEKLY_BRIEF_INTERPRETER_MAX_COMPLETION_TOKENS =");
    expect(weekly).toContain("MORNING_BRIEF_INTERPRETER_MAX_COMPLETION_TOKENS");
    expect(weekly).not.toMatch(
      /WEEKLY_BRIEF_INTERPRETER_MAX_COMPLETION_TOKENS = 5000/
    );
  });
});

describe("inbound interpreter vs writer representation", () => {
  it("inbound interpreter receives items with IDs and not the rendered string", () => {
    const projected = toInboundInterpreterRelationshipPacket(packet());
    expect(projected).toHaveProperty("coach_relationship_memory_items");
    expect(projected.coach_relationship_memory_items).toEqual([
      { memory_id: ID_A, text: OLD_TEXT },
    ]);
    expect(projected).not.toHaveProperty("coach_relationship_memory");
    const user = String(buildInboundSolInterpreterMessages(packet())[1]?.content ?? "");
    expect(user).toContain("coach_relationship_memory_items");
    expect(user).toContain(ID_A);
    expect(user).toContain('"text":');
    expect(user).not.toMatch(/"coach_relationship_memory":/);
  });

  it("writer-facing packet keeps OLD rendered F and strips items", () => {
    const writerPacket = toWriterFacingInboundRelationshipPacket(packet());
    expect(writerPacket.coach_relationship_memory).toBe(OLD_TEXT);
    expect(writerPacket).not.toHaveProperty("coach_relationship_memory_items");
    const user = String(buildInboundSolWriterMessages(packet(), parseInboundCoachingBriefV1(validBriefRaw())!)[1]?.content ?? "");
    expect(user).toContain(OLD_TEXT);
    expect(user).not.toContain("coach_relationship_memory_items");
    expect(user).not.toContain(ID_A);
  });

  it("writer-facing Brief omits coach_relationship_memory_changes", () => {
    const changes = { add: [NEW_TEXT], delete: [] };
    const brief = parseInboundCoachingBriefV1(
      validBriefRaw({ coach_relationship_memory_changes: changes })
    );
    expect(brief?.inbound.coach_relationship_memory_changes).toEqual(changes);
    const writerBrief = toWriterFacingInboundCoachingBrief(brief!);
    expect(writerBrief.inbound).not.toHaveProperty("coach_relationship_memory_changes");
    const user = String(buildInboundSolWriterMessages(packet(), brief!)[1]?.content ?? "");
    expect(user).not.toContain("coach_relationship_memory_changes");
    expect(user).not.toContain(NEW_TEXT);
    expect(user).toContain(OLD_TEXT);
  });
});

describe("Coach Relationship Memory telemetry", () => {
  it("null/empty changes emit returned=false without logging text", () => {
    const none = compactInboundSolBriefForTelemetry(
      parseInboundCoachingBriefV1(validBriefRaw({ coach_relationship_memory_changes: null }))!
    );
    expect(none.inbound_sol_coach_relationship_memory_returned).toBe(false);
    const empty = compactInboundSolBriefForTelemetry(
      parseInboundCoachingBriefV1(
        validBriefRaw({
          coach_relationship_memory_changes: { add: [], delete: [] },
        })
      )!
    );
    expect(empty.inbound_sol_coach_relationship_memory_returned).toBe(false);
  });

  it("emits returned boolean without logging the body or IDs", () => {
    const withChanges = parseInboundCoachingBriefV1(
      validBriefRaw({
        coach_relationship_memory_changes: { add: [NEW_TEXT], delete: [] },
      })
    );
    const compact = compactInboundSolBriefForTelemetry(withChanges!);
    expect(compact.inbound_sol_coach_relationship_memory_returned).toBe(true);
    expect(JSON.stringify(compact)).not.toContain("Breck initiating");
    expect(JSON.stringify(compact)).not.toContain(ID_A);
    expect(compact).not.toHaveProperty("coach_relationship_memory_changes");
    expect(compact).not.toHaveProperty("memory_body");
    expect(INBOUND_TURN_TELEMETRY_COMPACT_KEYS).toContain(
      "inbound_sol_coach_relationship_memory_returned"
    );
    expect(INBOUND_TURN_TELEMETRY_COMPACT_KEYS).toContain(
      "inbound_sol_coach_relationship_memory_persist_status"
    );
    expect(INBOUND_TURN_TELEMETRY_COMPACT_KEYS).toContain(
      "inbound_sol_coach_relationship_memory_add_count"
    );
    expect(INBOUND_TURN_TELEMETRY_COMPACT_KEYS).toContain(
      "inbound_sol_coach_relationship_memory_update_count"
    );
  });
});

describe("proactive lanes read F and do not write", () => {
  it("Morning, Evening, and Weekly production files do not persist F or receive IDs/changes", () => {
    const files = [
      "src/lib/morning-tto-writer.ts",
      "src/lib/morning-tto-brief-interpreter-v1.ts",
      "src/lib/weekly-tto-writer.ts",
      "src/lib/weekly-tto-brief-interpreter.ts",
      "src/lib/tyler-text-overview-generate.ts",
      "src/lib/tyler-text-overview-weekly-generate.ts",
    ];
    for (const file of files) {
      const src = productionSrc(file);
      expect(src).not.toContain("persistSolCoachRelationshipMemory");
      expect(src).not.toContain("coach_relationship_memory_replacement");
      expect(src).not.toContain("coach_relationship_memory_changes");
      expect(src).not.toContain("coach_relationship_memory_items");
      expect(src).not.toContain("v2_apply_coach_relationship_memory_mutations");
    }
  });

  it("Morning interpreter input is rendered F only, not a Gold Question quarry of IDs", () => {
    expect(MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT).toContain(
      "It is not a quarry of names, people, or standing memories to search for something to ask about."
    );
    const morningInput = productionSrc("src/lib/morning-tto-brief-canonical-input-v1.ts");
    const morningLoad = productionSrc("src/lib/morning-tto-brief-canonical-load-v1.ts");
    expect(morningInput).toContain("coach_relationship_memory: string | null");
    expect(morningInput).not.toContain("coach_relationship_memory_items");
    expect(morningInput).not.toContain("memory_id");
    expect(morningLoad).toContain("coachRelationshipMemory: packet.coach_relationship_memory");
    expect(morningLoad).not.toContain("coach_relationship_memory_items");
  });

  it("Weekly interpreter input keeps coaching_summary and rendered F without IDs", () => {
    const weekly = productionSrc("src/lib/weekly-tto-brief-interpreter.ts");
    expect(weekly).toContain("coach_relationship_memory: args.packet.coach_relationship_memory");
    expect(weekly).toContain("coaching_memory_projection");
    expect(weekly).not.toContain("coach_relationship_memory_items");
    expect(weekly).not.toContain("coach_relationship_memory_changes");
  });

  it("legacy Weekly coaching_summary loader and recompute stay unchanged by F", () => {
    const weeklyEvents = productionSrc("src/lib/weekly-tto-accountability-events.ts");
    const memory = productionSrc("src/lib/v2-coaching-memory.ts");
    expect(weeklyEvents).toContain('.select("coaching_summary")');
    expect(memory).not.toContain("v2_coach_relationship_memory");
    expect(memory).not.toContain("coach_relationship_memory");
  });
});

describe("source search", () => {
  it("production F code has zero replacement-body writes and RPC-only mutations", () => {
    const files = [
      "src/lib/coach-relationship-memory.ts",
      "src/lib/coach-relationship-memory-load.ts",
      "src/lib/inbound-sol-coach-relationship-memory.ts",
      "src/lib/inbound-sol-brief-json-schema.ts",
      "src/lib/inbound-sol-coaching-brief.ts",
      "src/lib/inbound-sol-brief-interpreter.ts",
      "src/lib/inbound-sol-relationship-turn.ts",
      "src/lib/inbound-sol-writer.ts",
      "src/lib/inbound-turn-telemetry.ts",
      "src/lib/inbound-relationship-packet.ts",
      "src/lib/morning-tto-relationship-packet.ts",
      "src/lib/weekly-tto-relationship-packet.ts",
    ];
    for (const file of files) {
      const src = productionSrc(file);
      expect(src).not.toContain("coach_relationship_memory_replacement");
      expect(src).not.toContain("memory_body");
    }
    const persist = productionSrc("src/lib/inbound-sol-coach-relationship-memory.ts");
    expect(persist).toContain("v2_apply_coach_relationship_memory_mutations");
    expect(persist).toContain("p_updates: []");
    expect(persist).not.toContain("p_updates: validated.changes.update");
    expect(persist).not.toContain('.from("v2_coach_relationship_memory")');
    expect(persist).not.toContain(".insert(");
    expect(persist).not.toContain(".upsert(");
    const types = productionSrc("src/lib/coach-relationship-memory.ts");
    expect(types).toContain("export type CoachRelationshipMemoryChanges");
    expect(types).not.toContain("update: CoachRelationshipMemoryUpdate");
    expect(types).not.toContain("changes.update");
    expect(types).not.toContain("duplicate_update_id");
    const schema = productionSrc("src/lib/inbound-sol-brief-json-schema.ts");
    expect(schema).not.toContain('required: ["add", "update", "delete"]');
    expect(schema).not.toContain("update: [{ memory_id, text }]");
    const interpreter = productionSrc("src/lib/inbound-sol-brief-interpreter.ts");
    expect(interpreter).not.toContain("UPDATE only when");
    expect(interpreter).toContain("There is no UPDATE");
    expect(persist).not.toContain(".insert(");
    expect(persist).not.toContain(".upsert(");
    const loader = productionSrc("src/lib/coach-relationship-memory-load.ts");
    expect(loader).toContain('.from("v2_coach_relationship_memory")');
    expect(loader).toContain("memory_id, memory_text, created_at");
  });
});
