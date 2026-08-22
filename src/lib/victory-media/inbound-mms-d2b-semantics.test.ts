import { describe, expect, it, vi } from "vitest";

import { isValidInboundMmsD2bClarificationBody } from "@/lib/victory-media/inbound-mms-d2b-codes";
import {
  INBOUND_MMS_D2B_SEMANTIC_RESPONSE_FORMAT,
  INBOUND_MMS_D2B_SEMANTIC_SYSTEM_PROMPT,
  parseInboundMmsD2bSemanticOutput,
  runInboundMmsD2bSemantics,
  type InboundMmsD2bSemanticFacts,
} from "@/lib/victory-media/inbound-mms-d2b-semantics";

const WIN_A = "cccccccc-3333-4333-8333-333333333333";
const WIN_UNKNOWN = "dddddddd-4444-4444-8444-444444444444";
const QUESTION = "What made this one a win for you?";

function facts(
  partial: Partial<InboundMmsD2bSemanticFacts> = {}
): InboundMmsD2bSemanticFacts {
  return {
    pending_photo: {
      job_id: "aaaaaaaa-1111-4111-8111-111111111111",
      age_seconds: 600,
      message_sid: "SMdddddddddddddddddddddddddddddddd",
    },
    recent_thread: [],
    candidate_wins: [
      {
        id: WIN_A,
        text: "Breck hit his first home run",
        occurred_at: "2026-08-22T11:56:00.000Z",
        relationship_type: "whole_life",
        commitment_id: null,
      },
    ],
    current_goal: null,
    identity: null,
    open_coach_question: null,
    ...partial,
  };
}

describe("D2b semantic contract", () => {
  it("schema allows only attach_existing_win | ask_clarification", () => {
    const decision =
      INBOUND_MMS_D2B_SEMANTIC_RESPONSE_FORMAT.json_schema.schema.properties
        .decision;
    expect(decision.enum).toEqual(["attach_existing_win", "ask_clarification"]);
    expect(decision.enum).not.toContain("no_action");
    expect(INBOUND_MMS_D2B_SEMANTIC_SYSTEM_PROMPT).not.toMatch(
      /no_action: still unclear/
    );
    expect(INBOUND_MMS_D2B_SEMANTIC_SYSTEM_PROMPT).toContain(
      "Sparse or empty thread is exactly when a question is useful"
    );
  });
});

describe("isValidInboundMmsD2bClarificationBody", () => {
  it("accepts one short natural question", () => {
    expect(isValidInboundMmsD2bClarificationBody(QUESTION)).toBe(true);
  });

  it("rejects a fake saved-photo claim", () => {
    expect(
      isValidInboundMmsD2bClarificationBody(
        "I saved your photo — what made this a win?"
      )
    ).toBe(false);
    expect(
      isValidInboundMmsD2bClarificationBody(
        "It's in your Victory Room. What made this a win?"
      )
    ).toBe(false);
  });

  it("rejects menus, type questions, and multiple questions", () => {
    expect(
      isValidInboundMmsD2bClarificationBody(
        "Is this an Overall Win or Current Goal?"
      )
    ).toBe(false);
    expect(
      isValidInboundMmsD2bClarificationBody("What type of win is this?")
    ).toBe(false);
    expect(
      isValidInboundMmsD2bClarificationBody(
        "What made this a win? Want it on the goal?"
      )
    ).toBe(false);
  });
});

describe("parseInboundMmsD2bSemanticOutput", () => {
  const allowed = new Set([WIN_A]);

  it("accepts attach_existing_win with a candidate UUID", () => {
    expect(
      parseInboundMmsD2bSemanticOutput(
        {
          decision: "attach_existing_win",
          target_win_id: WIN_A,
          clarification_body: null,
        },
        allowed
      )
    ).toEqual({
      ok: true,
      decision: "attach_existing_win",
      target_win_id: WIN_A,
      clarification_body: null,
    });
  });

  it("rejects unknown attach UUID", () => {
    expect(
      parseInboundMmsD2bSemanticOutput(
        {
          decision: "attach_existing_win",
          target_win_id: WIN_UNKNOWN,
          clarification_body: null,
        },
        allowed
      )
    ).toEqual({ ok: false, reason: "unknown_target" });
  });

  it("accepts one natural ask_clarification", () => {
    expect(
      parseInboundMmsD2bSemanticOutput(
        {
          decision: "ask_clarification",
          target_win_id: null,
          clarification_body: QUESTION,
        },
        allowed
      )
    ).toEqual({
      ok: true,
      decision: "ask_clarification",
      target_win_id: null,
      clarification_body: QUESTION,
    });
  });

  it("fail-closes a saved-claim question", () => {
    expect(
      parseInboundMmsD2bSemanticOutput(
        {
          decision: "ask_clarification",
          target_win_id: null,
          clarification_body: "I added your picture. What was this?",
        },
        allowed
      )
    ).toEqual({ ok: false, reason: "invalid_clarification_body" });
  });

  it("treats legacy no_action as invalid model output, not a product decision", () => {
    expect(
      parseInboundMmsD2bSemanticOutput(
        {
          decision: "no_action",
          target_win_id: null,
          clarification_body: null,
        },
        allowed
      )
    ).toEqual({ ok: false, reason: "invalid_decision" });
  });

  it("sparse/empty thread still accepts ask_clarification", () => {
    expect(
      parseInboundMmsD2bSemanticOutput(
        {
          decision: "ask_clarification",
          target_win_id: null,
          clarification_body: QUESTION,
        },
        new Set()
      )
    ).toEqual({
      ok: true,
      decision: "ask_clarification",
      target_win_id: null,
      clarification_body: QUESTION,
    });
  });
});

describe("runInboundMmsD2bSemantics", () => {
  it("uses injected client JSON and does not send image bytes", async () => {
    const create = vi.fn(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              decision: "ask_clarification",
              target_win_id: null,
              clarification_body: QUESTION,
            }),
          },
        },
      ],
    }));
    const r = await runInboundMmsD2bSemantics(facts(), {
      client: { chat: { completions: { create } } } as never,
    });
    expect(r).toEqual({
      ok: true,
      decision: "ask_clarification",
      target_win_id: null,
      clarification_body: QUESTION,
    });
    const arg = create.mock.calls[0]![0] as {
      messages: Array<{ content: unknown }>;
    };
    const payload = JSON.stringify(arg.messages);
    expect(payload).not.toContain("image_url");
    expect(payload).not.toContain("data:image");
    expect(payload).not.toContain("/master.jpg");
  });
});
