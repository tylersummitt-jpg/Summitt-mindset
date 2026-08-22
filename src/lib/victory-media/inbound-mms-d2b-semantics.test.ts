import { describe, expect, it, vi } from "vitest";

import { isValidInboundMmsD2bClarificationBody } from "@/lib/victory-media/inbound-mms-d2b-codes";
import {
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
