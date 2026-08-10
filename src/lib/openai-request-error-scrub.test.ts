import { describe, expect, it } from "vitest";
import { scrubOpenAiRequestErrorForCapture } from "@/lib/openai-request-error-scrub";

describe("scrubOpenAiRequestErrorForCapture", () => {
  it("captures status/code/type/message/request_id when present", () => {
    const scrubbed = scrubOpenAiRequestErrorForCapture({
      name: "APIError",
      message: "Rate limit exceeded for gpt-5.6-sol",
      status: 429,
      code: "rate_limit_exceeded",
      type: "insufficient_quota",
      request_id: "req_abc123",
      headers: { authorization: "Bearer sk-secret", "x-request-id": "hdr" },
      stack: "Error: secret stack\n    at Object.<anonymous>",
      body: { huge: "payload" },
      apiKey: "sk-leak",
    });
    expect(scrubbed).toEqual({
      name: "APIError",
      message: "Rate limit exceeded for gpt-5.6-sol",
      status: 429,
      code: "rate_limit_exceeded",
      type: "insufficient_quota",
      request_id: "req_abc123",
    });
    expect(JSON.stringify(scrubbed)).not.toContain("sk-secret");
    expect(JSON.stringify(scrubbed)).not.toContain("sk-leak");
    expect(JSON.stringify(scrubbed)).not.toContain("secret stack");
    expect(JSON.stringify(scrubbed)).not.toContain("huge");
  });

  it("reads nested error.type/code and requestID alias", () => {
    expect(
      scrubOpenAiRequestErrorForCapture({
        name: "Error",
        message: "Bad request",
        status: 400,
        requestID: "req_nested",
        error: { type: "invalid_request_error", code: "unsupported_parameter" },
      })
    ).toEqual({
      name: "Error",
      message: "Bad request",
      status: 400,
      code: "unsupported_parameter",
      type: "invalid_request_error",
      request_id: "req_nested",
    });
  });

  it("truncates long messages and ignores non-objects safely", () => {
    const long = "x".repeat(600);
    expect(scrubOpenAiRequestErrorForCapture(new Error(long)).message?.length).toBeLessThanOrEqual(
      500
    );
    expect(scrubOpenAiRequestErrorForCapture("plain boom").message).toBe("plain boom");
    expect(scrubOpenAiRequestErrorForCapture(null).message).toBeNull();
  });
});
