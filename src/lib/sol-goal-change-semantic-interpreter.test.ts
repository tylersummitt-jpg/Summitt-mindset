import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_MODEL,
  SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_REASONING_EFFORT,
  SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SCHEMA_RETRY_USER,
  SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT,
  buildSolGoalChangeSemanticInterpreterMessages,
  runSolGoalChangeSemanticInterpreter,
} from "@/lib/sol-goal-change-semantic-interpreter";
import { SOL_GOAL_CHANGE_SEMANTIC_RESPONSE_FORMAT } from "@/lib/sol-goal-change-semantic-json-schema";
import {
  SOL_GOAL_CHANGE_SEMANTIC_VERSION,
  buildSolGoalChangeSemanticInput,
  hasCanonicalGoalChangeMutationAuthority,
} from "@/lib/sol-goal-change-semantic";

function mockClient(contents: string[]): OpenAI {
  let i = 0;
  return {
    chat: {
      completions: {
        create: vi.fn(async () => {
          const content = contents[Math.min(i, contents.length - 1)] ?? "";
          i += 1;
          return { choices: [{ message: { content } }] };
        }),
      },
    },
  } as unknown as OpenAI;
}

const angelaInput = buildSolGoalChangeSemanticInput({
  canonicalSavedBehaviorStatement: "I will be in bed by 9:30 pm nightly.",
  latestInboundText:
    "You're right. 9:30 isn't going to happen tonight because im out of town visiting family. Additionally I think im so off 9:30 I need to revise to 10:30",
  plannedInterruptionKnown: true,
});

const angelaModelJson = JSON.stringify({
  version: SOL_GOAL_CHANGE_SEMANTIC_VERSION,
  goal_change: {
    intent: "saved_replace",
    candidate_behavior_statement: "10:30",
    needs_clarification: false,
    requires_confirmation: true,
    confirms_existing_pending: false,
    rejects_existing_pending: false,
    modifies_existing_pending_candidate: false,
    member_meaning_summary: "Travel tonight and wants saved bedtime revised to 10:30.",
  },
  concurrent_meaning: {
    planned_interruption: true,
    accountability_update: true,
  },
});

describe("runSolGoalChangeSemanticInterpreter", () => {
  it("uses gpt-5.6-sol, low reasoning, strict json_schema, no temperature", async () => {
    const client = mockClient([angelaModelJson]);
    const result = await runSolGoalChangeSemanticInterpreter({
      input: angelaInput,
      client,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.goal_change.intent).toBe("saved_replace");
    expect(result.result.concurrent_meaning.planned_interruption).toBe(true);
    expect(result.capture.model).toBe("gpt-5.6-sol");
    expect(result.capture.reasoning_effort).toBe("low");
    expect(result.capture.temperature).toBeNull();
    expect(result.capture.retry_occurred).toBe(false);

    const req = (client.chat.completions.create as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(req.model).toBe(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_MODEL);
    expect(req.reasoning_effort).toBe(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_REASONING_EFFORT);
    expect(req.response_format).toEqual(SOL_GOAL_CHANGE_SEMANTIC_RESPONSE_FORMAT);
    expect(req).not.toHaveProperty("temperature");
    expect(req).not.toHaveProperty("max_tokens");
    expect(req.max_completion_tokens).toBe(1200);
  });

  it("one schema retry then success", async () => {
    const client = mockClient(["not-json", angelaModelJson]);
    const result = await runSolGoalChangeSemanticInterpreter({
      input: angelaInput,
      client,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.retry_occurred).toBe(true);
    expect(result.capture.retry_succeeded).toBe(true);
    expect(client.chat.completions.create).toHaveBeenCalledTimes(2);
    const retryReq = (client.chat.completions.create as ReturnType<typeof vi.fn>).mock
      .calls[1]?.[0] as { messages: Array<{ content: string }> };
    expect(retryReq.messages.at(-1)?.content).toBe(
      SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SCHEMA_RETRY_USER
    );
  });

  it("clamps false pending confirmation on bare Yes with no pending even if the model claims it", async () => {
    const noPendingYes = buildSolGoalChangeSemanticInput({
      canonicalSavedBehaviorStatement: "I will be in bed by 9:30 pm nightly.",
      latestInboundText: "Yes",
      recentExactThread: [
        {
          sender: "coach",
          body: "Do you want 10:30 to replace 9:30 every night going forward?",
        },
      ],
    });
    const lyingModel = JSON.stringify({
      version: SOL_GOAL_CHANGE_SEMANTIC_VERSION,
      goal_change: {
        intent: "saved_replace",
        candidate_behavior_statement: "10:30",
        needs_clarification: false,
        requires_confirmation: false,
        confirms_existing_pending: true,
        rejects_existing_pending: false,
        modifies_existing_pending_candidate: false,
        member_meaning_summary: "Said yes to Coach's 10:30 question.",
      },
      concurrent_meaning: { planned_interruption: false, accountability_update: false },
    });
    const client = mockClient([lyingModel]);
    const result = await runSolGoalChangeSemanticInterpreter({
      input: noPendingYes,
      client,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.goal_change.confirms_existing_pending).toBe(false);
    expect(hasCanonicalGoalChangeMutationAuthority(result.result)).toBe(false);
    expect(result.result.goal_change.intent).toBe("none");
    expect(result.result.goal_change.reverts_active_temporary_overlay).toBe(false);
  });

  it("clamps revert when the model sets the flag without an active overlay", async () => {
    const lyingModel = JSON.stringify({
      version: SOL_GOAL_CHANGE_SEMANTIC_VERSION,
      goal_change: {
        intent: "none",
        candidate_behavior_statement: null,
        needs_clarification: false,
        requires_confirmation: false,
        confirms_existing_pending: false,
        rejects_existing_pending: false,
        modifies_existing_pending_candidate: false,
        reverts_active_temporary_overlay: true,
        member_meaning_summary: "Wants the temporary overlay ended.",
      },
      concurrent_meaning: { planned_interruption: false, accountability_update: false },
    });
    const client = mockClient([lyingModel]);
    const result = await runSolGoalChangeSemanticInterpreter({
      input: angelaInput,
      client,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.goal_change.reverts_active_temporary_overlay).toBe(false);
  });

  it("teaches live overlay + make-permanent as saved_replace copying overlay_behavior_statement", () => {
    expect(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT).toContain(
      "copy overlay_behavior_statement into candidate_behavior_statement"
    );
    expect(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT).toContain(
      "If they named a different saved target, use that candidate instead"
    );
    expect(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT).toContain("make this permanent");
    expect(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT).toContain(
      "keep this as my regular goal"
    );
    expect(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT).toContain(
      "make the temporary one my real goal"
    );
    expect(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT).toContain(
      "I want this going forward"
    );
    expect(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT).toContain("saved_replace");
    expect(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT).not.toContain(
      "modifies_active_temporary_overlay"
    );
  });

  it("messages are interpreter-only: Sol system prompt, compact input, no SMS instruction to write", () => {
    const messages = buildSolGoalChangeSemanticInterpreterMessages(angelaInput);
    expect(messages[0]?.content).toBe(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT);
    expect(String(messages[1]?.content)).toContain("SOL_GOAL_CHANGE_SEMANTIC_INPUT_V1");
    expect(String(messages[1]?.content)).toContain("Return JSON only. No SMS body.");
    expect(String(messages[1]?.content)).not.toContain("Write ONE SMS");
    expect(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_MODEL).toBe("gpt-5.6-sol");
    expect(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_REASONING_EFFORT).toBe("low");
  });

  it("openai_unavailable when no client and no key", async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const result = await runSolGoalChangeSemanticInterpreter({
      input: angelaInput,
      client: null,
    });
    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("openai_unavailable");
  });
});
