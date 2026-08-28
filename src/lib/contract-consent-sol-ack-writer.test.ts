import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

const createMock = vi.hoisted(() => vi.fn());

vi.mock("openai", () => {
  class OpenAI {
    chat = {
      completions: {
        create: createMock,
      },
    };
    constructor(_opts?: { apiKey?: string }) {}
  }
  return { default: OpenAI };
});

import { buildContractConsentAckIntent } from "@/lib/v2-contract-consent-ack-send";
import {
  CONTRACT_CONSENT_SOL_ACK_SYSTEM_PROMPT,
  CONTRACT_CONSENT_SOL_ACK_WRITER_MODEL,
  CONTRACT_CONSENT_SOL_ACK_WRITER_PROMPT_PATH,
  CONTRACT_CONSENT_SOL_ACK_WRITER_REASONING_EFFORT,
  buildContractConsentSolAckWriterMessages,
  writeContractConsentSolAckBody,
} from "@/lib/contract-consent-sol-ack-writer";

function sampleIntent() {
  return buildContractConsentAckIntent({
    consentParse: "user_yes",
    messageSid: "SM_sol_ack_001",
    proposalText: "This is the standard for the next 7 days: workout daily.",
    contractKind: "recommit_same",
    behaviorStatement: "Workout daily",
    effectiveAsk: "Workout daily",
    contractConsentFacts: {
      overlay_action: "activated",
      rpc_result: "applied",
      proposal_text_digest: "This is the standard...",
      required_meaning_summary: "Acknowledge acceptance for the next 7 days.",
    },
    optionalBindingHint: "workout daily",
  });
}

function completion(content: string) {
  return { choices: [{ message: { content } }] };
}

describe("writeContractConsentSolAckBody", () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.OPENAI_API_KEY = "sk-test";
  });

  it("uses gpt-5.6-sol, low reasoning, json_object, no temperature", async () => {
    createMock.mockResolvedValue(
      completion('{"body":"Good — that standard holds for the next week. Show me the rep."}')
    );

    const result = await writeContractConsentSolAckBody({
      intent: sampleIntent(),
      inboundRaw: "Yes",
      latestOutboundBody: "Want me to hold you to that tighter ask?",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toContain("week");
    const req = createMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(req.model).toBe("gpt-5.6-sol");
    expect(req.reasoning_effort).toBe("low");
    expect(req.response_format).toEqual({ type: "json_object" });
    expect(req).not.toHaveProperty("temperature");
    expect(req).not.toHaveProperty("max_tokens");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(result.capture.model).toBe(CONTRACT_CONSENT_SOL_ACK_WRITER_MODEL);
    expect(result.capture.prompt_path).toBe(CONTRACT_CONSENT_SOL_ACK_WRITER_PROMPT_PATH);
    expect(result.capture.reasoning_effort).toBe(CONTRACT_CONSENT_SOL_ACK_WRITER_REASONING_EFFORT);
    expect(result.capture.temperature).toBeNull();
  });

  it("one JSON retry then success", async () => {
    createMock
      .mockResolvedValueOnce(completion("not-json"))
      .mockResolvedValueOnce(completion('{"body":"Alright — we keep the current bar."}'));

    const result = await writeContractConsentSolAckBody({
      intent: sampleIntent(),
      inboundRaw: "No",
      latestOutboundBody: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toContain("current bar");
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[1]?.[0].model).toBe("gpt-5.6-sol");
    expect(result.capture.retry_occurred).toBe(true);
    expect(result.capture.retry_succeeded).toBe(true);
  });

  it("empty body fails closed with no fallback English", async () => {
    createMock
      .mockResolvedValueOnce(completion('{"body":"   "}'))
      .mockResolvedValueOnce(completion('{"body":""}'));

    const result = await writeContractConsentSolAckBody({
      intent: sampleIntent(),
      inboundRaw: "Yes",
      latestOutboundBody: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("empty_body");
    expect(result.body).toBeNull();
  });

  it("openai unavailable fails closed", async () => {
    const result = await writeContractConsentSolAckBody({
      intent: sampleIntent(),
      inboundRaw: "Yes",
      latestOutboundBody: null,
      client: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("openai_unavailable");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("prompt forbids Current Goal pivot, mini, and menu language", () => {
    expect(CONTRACT_CONSENT_SOL_ACK_SYSTEM_PROMPT).toMatch(/Current Goal/i);
    expect(CONTRACT_CONSENT_SOL_ACK_SYSTEM_PROMPT).toMatch(/Reply YES/i);
    expect(CONTRACT_CONSENT_SOL_ACK_SYSTEM_PROMPT).not.toMatch(/gpt-4o-mini/);
    const messages = buildContractConsentSolAckWriterMessages({
      intent: sampleIntent(),
      inboundRaw: "Yes",
      latestOutboundBody: "Want the tighter ask?",
    });
    expect(messages[0]?.content).toBe(CONTRACT_CONSENT_SOL_ACK_SYSTEM_PROMPT);
    expect(String(messages[1]?.content)).toContain('"user_said":"yes"');
    expect(String(messages[1]?.content)).toContain("NON-SPEAKABLE");
  });

  it("source has no mini model, V2 conversation-brain fallback, or deterministic English router", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/contract-consent-sol-ack-writer.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/gpt-4o-mini/);
    expect(src).not.toMatch(/V2_SMS_CONVERSATION_BRAIN_MODEL/);
    expect(src).not.toMatch(/produceInboundV3RelationshipSms/);
    expect(src).not.toMatch(/writeInboundSolBody/);
    expect(src).not.toMatch(/runInboundSolBriefInterpreter/);
    expect(src).toMatch(/gpt-5\.6-sol/);
  });
});
