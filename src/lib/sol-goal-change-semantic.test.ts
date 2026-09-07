import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));
import {
  applySolGoalChangeSemanticAuthorityLaws,
  buildSolGoalChangeSemanticInput,
  hasCanonicalGoalChangeMutationAuthority,
  inboundHasMaterialGoalChangeConfirmationQualification,
  parseSolGoalChangeSemanticJson,
  parseSolGoalChangeSemanticResult,
  SOL_GOAL_CHANGE_INTENTS,
  SOL_GOAL_CHANGE_SEMANTIC_VERSION,
  type SolGoalChangeAuthoritativePending,
  type SolGoalChangeSemanticResult,
} from "@/lib/sol-goal-change-semantic";
import {
  SOL_GOAL_CHANGE_SEMANTIC_JSON_SCHEMA_NAME,
  SOL_GOAL_CHANGE_SEMANTIC_OPENAI_JSON_SCHEMA_V1,
  SOL_GOAL_CHANGE_SEMANTIC_RESPONSE_FORMAT,
  buildSolGoalChangeSemanticExactContractPromptAppendix,
} from "@/lib/sol-goal-change-semantic-json-schema";
import {
  SOL_GOAL_CHANGE_SEMANTIC_AUTHORITY_LAW,
  SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT,
  buildSolGoalChangeSemanticInterpreterUserPayload,
} from "@/lib/sol-goal-change-semantic-interpreter";

const ANGELA_CANONICAL = "I will be in bed by 9:30 pm nightly.";
const ANGELA_TURN_1 =
  "You're right. 9:30 isn't going to happen tonight because im out of town visiting family.\nAdditionally I think im so off 9:30 I need to revise to 10:30";
const PENDING_1030: SolGoalChangeAuthoritativePending = {
  actionable: true,
  kind: "commitment_replace",
  sms_state: "awaiting_confirmation",
  candidate_behavior_statement: "10:30",
};

function input(overrides: Parameters<typeof buildSolGoalChangeSemanticInput>[0]) {
  return buildSolGoalChangeSemanticInput({
    canonicalSavedBehaviorStatement: ANGELA_CANONICAL,
    latestInboundText: overrides.latestInboundText,
    ...overrides,
  });
}

function modelJson(
  overrides: Partial<SolGoalChangeSemanticResult["goal_change"]> & {
    concurrent?: Partial<SolGoalChangeSemanticResult["concurrent_meaning"]>;
  }
): SolGoalChangeSemanticResult {
  const { concurrent, ...goal } = overrides;
  return {
    version: SOL_GOAL_CHANGE_SEMANTIC_VERSION,
    goal_change: {
      intent: "none",
      candidate_behavior_statement: null,
      needs_clarification: false,
      requires_confirmation: false,
      confirms_existing_pending: false,
      rejects_existing_pending: false,
      modifies_existing_pending_candidate: false,
      member_meaning_summary: null,
      ...goal,
    },
    concurrent_meaning: {
      planned_interruption: false,
      accountability_update: false,
      ...concurrent,
    },
  };
}

describe("sol goal change semantic schema", () => {
  it("strict schema matches the typed result contract", () => {
    const schema = SOL_GOAL_CHANGE_SEMANTIC_OPENAI_JSON_SCHEMA_V1;
    expect(SOL_GOAL_CHANGE_SEMANTIC_JSON_SCHEMA_NAME).toBe("sol_goal_change_semantic_v1");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["version", "goal_change", "concurrent_meaning"]);
    expect(schema.properties.goal_change.properties.intent.enum).toEqual([
      ...SOL_GOAL_CHANGE_INTENTS,
    ]);
    expect(schema.properties.goal_change.required).toEqual(
      expect.arrayContaining([
        "confirms_existing_pending",
        "rejects_existing_pending",
        "modifies_existing_pending_candidate",
        "candidate_behavior_statement",
      ])
    );
    expect(schema.properties.concurrent_meaning.required).toEqual([
      "planned_interruption",
      "accountability_update",
    ]);
    expect(SOL_GOAL_CHANGE_SEMANTIC_RESPONSE_FORMAT.type).toBe("json_schema");
    expect(SOL_GOAL_CHANGE_SEMANTIC_RESPONSE_FORMAT.json_schema.strict).toBe(true);
  });

  it("prompt appendix forbids SMS body keys", () => {
    const appendix = buildSolGoalChangeSemanticExactContractPromptAppendix();
    expect(appendix).toContain("Do not invent keys like body, sms_body");
    expect(appendix).toContain(`version must be "${SOL_GOAL_CHANGE_SEMANTIC_VERSION}"`);
  });
});

describe("sol goal change semantic prompt laws", () => {
  it("states authority law: conversation cannot manufacture server pending", () => {
    expect(SOL_GOAL_CHANGE_SEMANTIC_AUTHORITY_LAW).toContain(
      "Conversation context can explain what the member means. It cannot manufacture server state."
    );
    expect(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT).toContain(
      SOL_GOAL_CHANGE_SEMANTIC_AUTHORITY_LAW
    );
    expect(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT).toContain(
      "Do you want 10:30 to replace 9:30 every night going forward?"
    );
    expect(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT).toContain(
      "confirms_existing_pending = true REQUIRES authoritative_pending"
    );
    expect(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT).toContain(
      "Exact thread alone may never create that authority"
    );
  });

  it("allows dual meaning: interruption plus saved replace", () => {
    const prompt = SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT;
    expect(prompt).toContain("NOT mutually exclusive");
    expect(prompt).toContain("revise the goal to 10:30");
    expect(prompt).toContain("Do not drop saved replace because travel is present");
    expect(prompt).toContain("I think I need to revise it to 10:30");
    expect(prompt).toContain("Keep my normal goal, but this week let's do 10:30");
  });

  it("awaiting_candidate hallway is not a yes/no confirmation question", () => {
    const prompt = SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT;
    expect(prompt).toContain("awaiting_candidate with no candidate");
    expect(prompt).toContain("NOT a yes/no confirmation");
    expect(prompt).toContain("Never mind");
    expect(prompt).toContain("Keep the old goal");
  });

  it("user payload repeats authority flags and does not send a full relationship packet", () => {
    const payload = buildSolGoalChangeSemanticInterpreterUserPayload(
      input({ latestInboundText: ANGELA_TURN_1, plannedInterruptionKnown: true })
    );
    expect(payload).not.toHaveProperty("personal_context");
    expect(payload).not.toHaveProperty("historical_evidence");
    expect(payload.authority).toEqual({
      conversation_cannot_manufacture_server_state: true,
      confirms_existing_pending_requires_authoritative_pending: true,
      prior_coach_confirmation_question_is_not_pending: true,
    });
    expect(payload.planned_interruption_known).toBe(true);
    expect(payload.latest_inbound_text).toBe(ANGELA_TURN_1);
  });
});

describe("sol goal change semantic cases", () => {
  it("1 Angela Turn 1: travel + revise to 10:30 can be interruption AND saved replace", () => {
    const ctx = input({
      latestInboundText: ANGELA_TURN_1,
      plannedInterruptionKnown: true,
    });
    const parsed = parseSolGoalChangeSemanticResult(
      modelJson({
        intent: "saved_replace",
        candidate_behavior_statement: "10:30",
        requires_confirmation: true,
        member_meaning_summary:
          "Out of town tonight so 9:30 will miss; also wants saved bedtime revised to 10:30.",
        concurrent: { planned_interruption: true, accountability_update: true },
      }),
      ctx
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.concurrent_meaning.planned_interruption).toBe(true);
    expect(parsed.result.goal_change.intent).toBe("saved_replace");
    expect(parsed.result.goal_change.candidate_behavior_statement).toContain("10:30");
    expect(parsed.result.goal_change.confirms_existing_pending).toBe(false);
    expect(hasCanonicalGoalChangeMutationAuthority(parsed.result)).toBe(false);
  });

  it("2 I need to revise my goal to 10:30 → saved replace", () => {
    const parsed = parseSolGoalChangeSemanticResult(
      modelJson({
        intent: "saved_replace",
        candidate_behavior_statement: "10:30",
        requires_confirmation: true,
        member_meaning_summary: "Wants saved goal revised to 10:30.",
      }),
      input({ latestInboundText: "I need to revise my goal to 10:30" })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.intent).toBe("saved_replace");
    expect(parsed.result.concurrent_meaning.planned_interruption).toBe(false);
  });

  it("3 9:30 isn't realistic anymore. Let's do 10:30 → saved replace", () => {
    const parsed = parseSolGoalChangeSemanticResult(
      modelJson({
        intent: "saved_replace",
        candidate_behavior_statement: "10:30",
        requires_confirmation: true,
        member_meaning_summary: "9:30 no longer realistic; wants 10:30 saved.",
      }),
      input({ latestInboundText: "9:30 isn't realistic anymore. Let's do 10:30" })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.intent).toBe("saved_replace");
  });

  it("4 traveling tonight, 9:30 won't happen → interruption, not necessarily saved replace", () => {
    const parsed = parseSolGoalChangeSemanticResult(
      modelJson({
        intent: "none",
        member_meaning_summary: "Traveling tonight; 9:30 will miss.",
        concurrent: { planned_interruption: true, accountability_update: true },
      }),
      input({
        latestInboundText: "I'm traveling tonight, 9:30 won't happen",
        plannedInterruptionKnown: true,
      })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.concurrent_meaning.planned_interruption).toBe(true);
    expect(parsed.result.goal_change.intent).toBe("none");
    expect(parsed.result.goal_change.confirms_existing_pending).toBe(false);
  });

  it("5 keep normal goal, this week 10:30 → temporary adjustment", () => {
    const parsed = parseSolGoalChangeSemanticResult(
      modelJson({
        intent: "temporary_adjustment",
        candidate_behavior_statement: "10:30 this week",
        member_meaning_summary: "Keep saved 9:30; temporary 10:30 this week.",
        concurrent: { planned_interruption: false, accountability_update: false },
      }),
      input({
        latestInboundText: "Keep my normal goal, but this week let's do 10:30",
      })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.intent).toBe("temporary_adjustment");
    expect(parsed.result.goal_change.intent).not.toBe("saved_replace");
  });

  it("6 existing pending 10:30 + Yes → confirms existing pending", () => {
    const ctx = input({
      latestInboundText: "Yes",
      authoritativePending: PENDING_1030,
    });
    const parsed = parseSolGoalChangeSemanticResult(
      modelJson({
        intent: "saved_replace",
        candidate_behavior_statement: "10:30",
        confirms_existing_pending: true,
        member_meaning_summary: "Confirms pending 10:30.",
      }),
      ctx
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.confirms_existing_pending).toBe(true);
    expect(hasCanonicalGoalChangeMutationAuthority(parsed.result)).toBe(true);
  });

  it("7 existing pending 10:30 + Absolutely → confirms existing pending", () => {
    const parsed = parseSolGoalChangeSemanticResult(
      modelJson({
        intent: "saved_replace",
        confirms_existing_pending: true,
        member_meaning_summary: "Confirms pending 10:30.",
      }),
      input({
        latestInboundText: "Absolutely",
        authoritativePending: PENDING_1030,
      })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.confirms_existing_pending).toBe(true);
    expect(parsed.result.goal_change.candidate_behavior_statement).toBe("10:30");
  });

  it("8 existing pending 10:30 + Yes, but make it 10:15 → modification, not clean confirm", () => {
    const parsed = parseSolGoalChangeSemanticResult(
      modelJson({
        intent: "saved_replace",
        candidate_behavior_statement: "10:15",
        confirms_existing_pending: true,
        modifies_existing_pending_candidate: true,
        member_meaning_summary: "Wants 10:15 instead of pending 10:30.",
      }),
      input({
        latestInboundText: "Yes, but make it 10:15",
        authoritativePending: PENDING_1030,
      })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.modifies_existing_pending_candidate).toBe(true);
    expect(parsed.result.goal_change.confirms_existing_pending).toBe(false);
    expect(parsed.result.goal_change.candidate_behavior_statement).toBe("10:15");
    expect(hasCanonicalGoalChangeMutationAuthority(parsed.result)).toBe(false);
  });

  it("9 existing pending 10:30 + Actually keep 9:30 → reject", () => {
    const parsed = parseSolGoalChangeSemanticResult(
      modelJson({
        intent: "none",
        confirms_existing_pending: true,
        rejects_existing_pending: true,
        candidate_behavior_statement: "10:30",
        member_meaning_summary: "Keep current 9:30; reject pending.",
      }),
      input({
        latestInboundText: "Actually keep 9:30",
        authoritativePending: PENDING_1030,
      })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.rejects_existing_pending).toBe(true);
    expect(parsed.result.goal_change.confirms_existing_pending).toBe(false);
    expect(parsed.result.goal_change.candidate_behavior_statement).toBeNull();
  });

  it("10 NO pending + prior Coach confirmation question + Yes → must not confirm pending", () => {
    const ctx = input({
      latestInboundText: "Yes",
      recentExactThread: [
        {
          sender: "coach",
          body: "Do you want 10:30 to replace 9:30 every night going forward?",
        },
        { sender: "user", body: "Yes" },
      ],
    });
    const parsed = parseSolGoalChangeSemanticJson(
      JSON.stringify(
        modelJson({
          intent: "saved_replace",
          candidate_behavior_statement: "10:30",
          confirms_existing_pending: true,
          member_meaning_summary: "Agreed with Coach's 10:30 question.",
        })
      ),
      ctx
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.confirms_existing_pending).toBe(false);
    expect(parsed.result.goal_change.intent).toBe("none");
    expect(hasCanonicalGoalChangeMutationAuthority(parsed.result)).toBe(false);
  });

  it("11 NO pending + Yes → no canonical mutation authority", () => {
    const parsed = parseSolGoalChangeSemanticResult(
      modelJson({
        intent: "saved_replace",
        confirms_existing_pending: true,
        candidate_behavior_statement: "10:30",
      }),
      input({ latestInboundText: "Yes" })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.confirms_existing_pending).toBe(false);
    expect(parsed.result.goal_change.rejects_existing_pending).toBe(false);
    expect(parsed.result.goal_change.modifies_existing_pending_candidate).toBe(false);
    expect(hasCanonicalGoalChangeMutationAuthority(parsed.result)).toBe(false);
  });

  it("12 Make it harder → possible/clarification without a concrete durable bar", () => {
    const parsed = parseSolGoalChangeSemanticResult(
      modelJson({
        intent: "possible_saved_replace",
        needs_clarification: true,
        requires_confirmation: false,
        member_meaning_summary: "Wants a harder saved bar; no concrete replacement yet.",
      }),
      input({ latestInboundText: "Make it harder" })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.intent).toBe("possible_saved_replace");
    expect(parsed.result.goal_change.needs_clarification).toBe(true);
    expect(parsed.result.goal_change.candidate_behavior_statement).toBeNull();
  });

  it("authority overlay never makes interruption and saved replace exclusive", () => {
    const ctx = input({
      latestInboundText: ANGELA_TURN_1,
      plannedInterruptionKnown: true,
    });
    const applied = applySolGoalChangeSemanticAuthorityLaws(
      modelJson({
        intent: "saved_replace",
        candidate_behavior_statement: "10:30",
        requires_confirmation: true,
        concurrent: { planned_interruption: true, accountability_update: true },
      }),
      ctx
    );
    expect(applied.goal_change.intent).toBe("saved_replace");
    expect(applied.concurrent_meaning.planned_interruption).toBe(true);
  });

  it("invalid JSON is classified without calling OpenAI", () => {
    expect(parseSolGoalChangeSemanticJson("not-json", input({ latestInboundText: "Yes" }))).toEqual({
      ok: false,
      result: null,
      error: "invalid_json",
    });
  });
});

describe("qualified / modified confirmation safety veto", () => {
  const lyingConfirm = {
    intent: "saved_replace" as const,
    candidate_behavior_statement: "10:15",
    confirms_existing_pending: true,
    modifies_existing_pending_candidate: false,
    rejects_existing_pending: false,
  };

  function parseWithPending(latestInboundText: string, goal = lyingConfirm) {
    return parseSolGoalChangeSemanticResult(
      modelJson(goal),
      input({
        latestInboundText,
        authoritativePending: PENDING_1030,
      })
    );
  }

  const vetoInbounds = [
    "Yes, but make it 10:15",
    "Yes but 10:15 instead",
    "Yes, weekdays only",
    "Yes, except Fridays",
    "Sure, but make it four days",
    "Absolutely, just not weekends",
    "Okay, change it to 10:15 instead",
    "Actually make it 10:15",
    "10:15 instead",
  ];

  it.each(vetoInbounds)(
    "lying model confirm is vetoed for qualified inbound: %s",
    (latestInboundText) => {
      expect(inboundHasMaterialGoalChangeConfirmationQualification(latestInboundText)).toBe(
        true
      );
      const parsed = parseWithPending(latestInboundText);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.result.goal_change.confirms_existing_pending).toBe(false);
      expect(hasCanonicalGoalChangeMutationAuthority(parsed.result)).toBe(false);
    }
  );

  const cleanInbounds = [
    "Yes",
    "Absolutely",
    "Sounds good",
    "Yes, that sounds perfect",
    "Absolutely, let's do it",
  ];

  it.each(cleanInbounds)(
    "does not veto ordinary confirmation: %s",
    (latestInboundText) => {
      expect(inboundHasMaterialGoalChangeConfirmationQualification(latestInboundText)).toBe(
        false
      );
      const parsed = parseWithPending(latestInboundText, {
        intent: "saved_replace",
        candidate_behavior_statement: "10:30",
        confirms_existing_pending: true,
        modifies_existing_pending_candidate: false,
        rejects_existing_pending: false,
      });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.result.goal_change.confirms_existing_pending).toBe(true);
      expect(hasCanonicalGoalChangeMutationAuthority(parsed.result)).toBe(true);
    }
  );

  it("15 no pending + Absolutely → confirm false", () => {
    const parsed = parseSolGoalChangeSemanticResult(
      modelJson({
        intent: "saved_replace",
        confirms_existing_pending: true,
        candidate_behavior_statement: "10:30",
      }),
      input({ latestInboundText: "Absolutely" })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.confirms_existing_pending).toBe(false);
    expect(hasCanonicalGoalChangeMutationAuthority(parsed.result)).toBe(false);
  });

  it("awaiting_candidate + Yes cannot confirm — hallway is not a protocol yes/no", () => {
    const parsed = parseSolGoalChangeSemanticResult(
      modelJson({
        intent: "saved_replace",
        confirms_existing_pending: true,
        candidate_behavior_statement: null,
      }),
      input({
        latestInboundText: "Yes",
        authoritativePending: {
          actionable: true,
          kind: "commitment_replace",
          sms_state: "awaiting_candidate",
          candidate_behavior_statement: null,
          source: "sms_inbound",
        },
      })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.confirms_existing_pending).toBe(false);
    expect(hasCanonicalGoalChangeMutationAuthority(parsed.result)).toBe(false);
  });

  it("16 no pending + Sounds good → confirm false", () => {
    const parsed = parseSolGoalChangeSemanticResult(
      modelJson({
        intent: "saved_replace",
        confirms_existing_pending: true,
        candidate_behavior_statement: "10:30",
      }),
      input({ latestInboundText: "Sounds good" })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.confirms_existing_pending).toBe(false);
    expect(hasCanonicalGoalChangeMutationAuthority(parsed.result)).toBe(false);
  });

  it("17 no pending + Let's do it → confirm false; may remain saved_replace", () => {
    const parsed = parseSolGoalChangeSemanticResult(
      modelJson({
        intent: "saved_replace",
        confirms_existing_pending: true,
        candidate_behavior_statement: "10:30",
      }),
      input({ latestInboundText: "Let's do it" })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.confirms_existing_pending).toBe(false);
    expect(hasCanonicalGoalChangeMutationAuthority(parsed.result)).toBe(false);
    expect(parsed.result.goal_change.intent).toBe("saved_replace");
  });
});

describe("sol goal change semantic module isolation", () => {
  it("does not mutate state or send SMS", () => {
    const dir = path.join(process.cwd(), "src/lib");
    const files = [
      "sol-goal-change-semantic.ts",
      "sol-goal-change-semantic-json-schema.ts",
      "sol-goal-change-semantic-interpreter.ts",
    ];
    for (const file of files) {
      const src = readFileSync(path.join(dir, file), "utf8");
      expect(src).not.toContain("applyCanonicalGoalChangeWithSeasonMutation");
      expect(src).not.toContain("setPendingResolution");
      expect(src).not.toContain("sendSms");
      expect(src).not.toContain("from(\"sms_inbound_coach_jobs\")");
    }
    const route = readFileSync(
      path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts"),
      "utf8"
    );
    expect(route).not.toContain("runSolGoalChangeSemanticInterpreter");
  });
});
