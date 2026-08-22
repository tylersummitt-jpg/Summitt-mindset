import { describe, expect, it, vi } from "vitest";

import {
  buildInboundMmsD2aSemanticUserPayload,
  parseInboundMmsD2aSemanticOutput,
  runInboundMmsD2aSemantics,
  type InboundMmsD2aSemanticFacts,
} from "@/lib/victory-media/inbound-mms-d2a-semantics";

const WIN_A = "cccccccc-3333-4333-8333-333333333333";
const WIN_UNKNOWN = "dddddddd-4444-4444-8444-444444444444";

function facts(
  partial: Partial<InboundMmsD2aSemanticFacts> = {}
): InboundMmsD2aSemanticFacts {
  return {
    pending_photo: {
      job_id: "aaaaaaaa-1111-4111-8111-111111111111",
      age_seconds: 120,
      message_sid: "SMdddddddddddddddddddddddddddddddd",
    },
    recent_thread: [
      { at: "2026-08-22T11:56:00.000Z", role: "user", body: "Breck hit his first home run!" },
    ],
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

describe("parseInboundMmsD2aSemanticOutput", () => {
  const allowed = new Set([WIN_A]);

  it("accepts attach_existing_win with a supplied candidate UUID", () => {
    expect(
      parseInboundMmsD2aSemanticOutput(
        { decision: "attach_existing_win", target_win_id: WIN_A },
        allowed
      )
    ).toEqual({
      ok: true,
      decision: "attach_existing_win",
      target_win_id: WIN_A,
    });
  });

  it("unknown UUID becomes no_attach instead of inventing a target", () => {
    expect(
      parseInboundMmsD2aSemanticOutput(
        { decision: "attach_existing_win", target_win_id: WIN_UNKNOWN },
        allowed
      )
    ).toEqual({ ok: true, decision: "no_attach", target_win_id: null });
  });

  it("no_attach requires null target", () => {
    expect(
      parseInboundMmsD2aSemanticOutput(
        { decision: "no_attach", target_win_id: WIN_A },
        allowed
      )
    ).toEqual({ ok: true, decision: "no_attach", target_win_id: null });
  });

  it("rejects ask_clarification / wait_for_user as invalid", () => {
    expect(
      parseInboundMmsD2aSemanticOutput(
        { decision: "ask_clarification", target_win_id: null },
        allowed
      )
    ).toEqual({ ok: false, reason: "invalid_decision" });
  });
});

describe("runInboundMmsD2aSemantics", () => {
  it("empty candidates skip OpenAI", async () => {
    const create = vi.fn();
    const r = await runInboundMmsD2aSemantics(facts({ candidate_wins: [] }), {
      client: { chat: { completions: { create } } } as never,
    });
    expect(r).toEqual({ ok: true, decision: "no_attach", target_win_id: null });
    expect(create).not.toHaveBeenCalled();
  });

  it("uses injected client JSON and does not send image bytes", async () => {
    const create = vi.fn(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              decision: "attach_existing_win",
              target_win_id: WIN_A,
            }),
          },
        },
      ],
    }));
    const r = await runInboundMmsD2aSemantics(facts(), {
      client: { chat: { completions: { create } } } as never,
    });
    expect(r).toEqual({
      ok: true,
      decision: "attach_existing_win",
      target_win_id: WIN_A,
    });
    const arg = create.mock.calls[0]![0] as {
      messages: Array<{ content: unknown }>;
    };
    const payload = JSON.stringify(arg.messages);
    expect(payload).not.toContain("image_url");
    expect(payload).not.toContain("data:image");
    expect(payload).not.toContain("mms-norm/");
  });

  it("user payload has no storage path or signed URL", () => {
    const raw = buildInboundMmsD2aSemanticUserPayload(facts());
    expect(raw).not.toContain("storage");
    expect(raw).not.toContain("signed");
    expect(raw).not.toContain("https://");
    expect(raw).toContain(WIN_A);
    expect(raw).toContain("Breck hit his first home run");
  });
});
