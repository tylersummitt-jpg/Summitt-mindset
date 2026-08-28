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

import {
  CONTRACT_CONSENT_SOL_CLARIFY_SYSTEM_PROMPT,
  CONTRACT_CONSENT_SOL_CLARIFY_WRITER_MODEL,
  CONTRACT_CONSENT_SOL_CLARIFY_WRITER_PROMPT_PATH,
  CONTRACT_CONSENT_SOL_CLARIFY_WRITER_REASONING_EFFORT,
  buildContractConsentSolClarifyWriterMessages,
  writeContractConsentSolClarifyBody,
  type ContractConsentSolClarifyWriterInput,
} from "@/lib/contract-consent-sol-clarify-writer";

function sampleInput(
  overrides: Partial<ContractConsentSolClarifyWriterInput> = {}
): ContractConsentSolClarifyWriterInput {
  return {
    inboundRaw: "maybe",
    proposalText: "Walk ten minutes daily",
    currentBar: "Walk thirty minutes daily",
    inboundParse: "ambiguous",
    preferredName: "Robin",
    requiredMeaning:
      "Ask whether they want the adjusted ask or to keep their current bar. Make clear the current bar has not changed yet.",
    latestOutboundBody: "Want me to hold you to a smaller walk, or keep the current bar?",
    ...overrides,
  };
}

function completion(content: string) {
  return { choices: [{ message: { content } }] };
}

describe("writeContractConsentSolClarifyBody", () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.OPENAI_API_KEY = "sk-test";
  });

  it("uses gpt-5.6-sol, low reasoning, json_object, no temperature", async () => {
    createMock.mockResolvedValue(
      completion(
        '{"body":"I want to be sure — do you want the ten-minute walk, or keep the current bar?"}'
      )
    );

    const result = await writeContractConsentSolClarifyBody({ input: sampleInput() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatch(/current bar/i);
    const req = createMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(req.model).toBe("gpt-5.6-sol");
    expect(req.reasoning_effort).toBe("low");
    expect(req.response_format).toEqual({ type: "json_object" });
    expect(req).not.toHaveProperty("temperature");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(result.capture.model).toBe(CONTRACT_CONSENT_SOL_CLARIFY_WRITER_MODEL);
    expect(result.capture.prompt_path).toBe(CONTRACT_CONSENT_SOL_CLARIFY_WRITER_PROMPT_PATH);
    expect(result.capture.reasoning_effort).toBe(CONTRACT_CONSENT_SOL_CLARIFY_WRITER_REASONING_EFFORT);
  });

  it("one JSON retry then success", async () => {
    createMock
      .mockResolvedValueOnce(completion("not-json"))
      .mockResolvedValueOnce(
        completion('{"body":"Just checking — adjusted ask, or keep the current bar?"}')
      );

    const result = await writeContractConsentSolClarifyBody({ input: sampleInput() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[1]?.[0].model).toBe("gpt-5.6-sol");
    expect(result.capture.retry_occurred).toBe(true);
    expect(result.capture.retry_succeeded).toBe(true);
  });

  it("retry fails closed with no fallback English", async () => {
    createMock
      .mockResolvedValueOnce(completion("not json"))
      .mockResolvedValueOnce(completion("still bad"));

    const result = await writeContractConsentSolClarifyBody({ input: sampleInput() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_json");
    expect(result.body).toBeNull();
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("empty body fails closed", async () => {
    createMock
      .mockResolvedValueOnce(completion('{"body":"   "}'))
      .mockResolvedValueOnce(completion('{"body":""}'));

    const result = await writeContractConsentSolClarifyBody({ input: sampleInput() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("empty_body");
  });

  it("openai unavailable fails closed", async () => {
    const result = await writeContractConsentSolClarifyBody({
      input: sampleInput(),
      client: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("openai_unavailable");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("prompt forbids accept/decline claims, Current Goal pivot, and mini", () => {
    expect(CONTRACT_CONSENT_SOL_CLARIFY_SYSTEM_PROMPT).toMatch(/still pending/i);
    expect(CONTRACT_CONSENT_SOL_CLARIFY_SYSTEM_PROMPT).toMatch(/Current Goal/i);
    expect(CONTRACT_CONSENT_SOL_CLARIFY_SYSTEM_PROMPT).toMatch(/Reply YES/i);
    expect(CONTRACT_CONSENT_SOL_CLARIFY_SYSTEM_PROMPT).not.toMatch(/gpt-4o-mini/);
    const messages = buildContractConsentSolClarifyWriterMessages(sampleInput());
    expect(String(messages[1]?.content)).toContain('"proposal_still_pending":true');
    expect(String(messages[1]?.content)).toContain('"server_action_taken":"none"');
    expect(String(messages[1]?.content)).toContain("Walk ten minutes daily");
  });

  it("source has no mini, V3, FVG, or relationship Sol writer", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/contract-consent-sol-clarify-writer.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/gpt-4o-mini/);
    expect(src).not.toMatch(/V2_SMS_CONVERSATION_BRAIN_MODEL/);
    expect(src).not.toMatch(/produceInboundV3RelationshipSms/);
    expect(src).not.toMatch(/writeInboundSolBody/);
    expect(src).not.toMatch(/runInboundSolBriefInterpreter/);
    expect(src).not.toMatch(/applyFinalVoiceOwnershipGate/);
    expect(src).toMatch(/gpt-5\.6-sol/);
  });
});
