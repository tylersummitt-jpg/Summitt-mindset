import { describe, expect, it, vi } from "vitest";
import {
  extractWriterUsageFromCompletion,
  runLaneOpenAiJsonWithOneRetry,
} from "@/lib/v3-lane-openai-json-retry";
import type OpenAI from "openai";

function mockCompletion(args: {
  content: string;
  finish_reason?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
}) {
  return {
    choices: [
      {
        message: { content: args.content },
        finish_reason: args.finish_reason ?? "stop",
      },
    ],
    usage:
      args.prompt_tokens != null || args.completion_tokens != null
        ? {
            prompt_tokens: args.prompt_tokens ?? null,
            completion_tokens: args.completion_tokens ?? null,
          }
        : undefined,
  };
}

describe("extractWriterUsageFromCompletion", () => {
  it("captures finish_reason and usage when present", () => {
    const meta = extractWriterUsageFromCompletion(
      "gpt-4o-mini",
      mockCompletion({
        content: "{}",
        finish_reason: "length",
        prompt_tokens: 100,
        completion_tokens: 50,
      }) as never
    );
    expect(meta.writer_model).toBe("gpt-4o-mini");
    expect(meta.writer_finish_reason).toBe("length");
    expect(meta.writer_output_tokens).toBe(50);
    expect(meta.writer_prompt_tokens).toBe(100);
  });

  it("fails safe when usage/finish_reason missing", () => {
    const meta = extractWriterUsageFromCompletion(
      "gpt-4o-mini",
      { choices: [{ message: { content: "{}" } }] } as never
    );
    expect(meta.writer_finish_reason).toBeNull();
    expect(meta.writer_output_tokens).toBeNull();
    expect(meta.writer_prompt_tokens).toBeNull();
  });
});

describe("runLaneOpenAiJsonWithOneRetry", () => {
  it("returns writer usage metadata on successful first parse", async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(
            mockCompletion({
              content: '{"body":"Hello"}',
              finish_reason: "stop",
              prompt_tokens: 12,
              completion_tokens: 8,
            })
          ),
        },
      },
    } as unknown as OpenAI;

    const out = await runLaneOpenAiJsonWithOneRetry<{ body: string }>({
      client,
      model: "gpt-4o-mini",
      temperature: 0.35,
      maxTokens: 220,
      primaryMessages: [{ role: "user", content: "hi" }],
      jsonSchemaReminder: "json",
      parse: (raw) => {
        try {
          return JSON.parse(raw) as { body: string };
        } catch {
          return null;
        }
      },
    });

    expect(out.value?.body).toBe("Hello");
    expect(out.retryMeta.writer_finish_reason).toBe("stop");
    expect(out.retryMeta.writer_output_tokens).toBe(8);
    expect(out.retryMeta.writer_prompt_tokens).toBe(12);
    expect(out.retryMeta.writer_model).toBe("gpt-4o-mini");
    expect(out.retryFollowUpMessages).toBeNull();
  });

  it("uses retry completion usage when retry succeeds", async () => {
    const client = {
      chat: {
        completions: {
          create: vi
            .fn()
            .mockResolvedValueOnce(
              mockCompletion({ content: "not json", finish_reason: "stop", prompt_tokens: 5, completion_tokens: 3 })
            )
            .mockResolvedValueOnce(
              mockCompletion({
                content: '{"body":"Retry ok"}',
                finish_reason: "length",
                prompt_tokens: 20,
                completion_tokens: 15,
              })
            ),
        },
      },
    } as unknown as OpenAI;

    const out = await runLaneOpenAiJsonWithOneRetry<{ body: string }>({
      client,
      model: "gpt-4o-mini",
      temperature: 0.35,
      maxTokens: 220,
      primaryMessages: [{ role: "user", content: "hi" }],
      jsonSchemaReminder: "json",
      parse: (raw) => {
        try {
          return JSON.parse(raw) as { body: string };
        } catch {
          return null;
        }
      },
    });

    expect(out.value?.body).toBe("Retry ok");
    expect(out.retryMeta.lane_json_retry_attempted).toBe(true);
    expect(out.retryMeta.writer_finish_reason).toBe("length");
    expect(out.retryMeta.writer_output_tokens).toBe(15);
    expect(out.retryFollowUpMessages).toEqual([
      { role: "assistant", content: "not json" },
      {
        role: "user",
        content: expect.stringContaining("Your previous response was invalid JSON"),
      },
    ]);
    expect(out.retryFollowUpMessages?.[1]?.content).toContain("json");
  });

  it("passes AbortSignal as RequestOptions second arg, never in request body", async () => {
    const create = vi.fn().mockResolvedValue(
      mockCompletion({ content: '{"body":"Hello"}', finish_reason: "stop" })
    );
    const client = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    const controller = new AbortController();

    await runLaneOpenAiJsonWithOneRetry<{ body: string }>({
      client,
      model: "gpt-4o-mini",
      temperature: 0.35,
      maxTokens: 220,
      primaryMessages: [{ role: "user", content: "hi" }],
      jsonSchemaReminder: "json",
      signal: controller.signal,
      parse: (raw) => {
        try {
          return JSON.parse(raw) as { body: string };
        } catch {
          return null;
        }
      },
    });

    expect(create).toHaveBeenCalledTimes(1);
    const [body, options] = create.mock.calls[0] ?? [];
    expect(body).toMatchObject({
      model: "gpt-4o-mini",
      temperature: 0.35,
      max_tokens: 220,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: "hi" }],
    });
    expect(body).not.toHaveProperty("signal");
    expect(options).toEqual({ signal: controller.signal });
  });

  it("retry also places signal only in the second RequestOptions argument", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(mockCompletion({ content: "not json", finish_reason: "stop" }))
      .mockResolvedValueOnce(
        mockCompletion({ content: '{"body":"Retry ok"}', finish_reason: "stop" })
      );
    const client = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    const controller = new AbortController();

    const out = await runLaneOpenAiJsonWithOneRetry<{ body: string }>({
      client,
      model: "gpt-4o-mini",
      temperature: 0.35,
      maxTokens: 220,
      primaryMessages: [{ role: "user", content: "hi" }],
      jsonSchemaReminder: "json",
      signal: controller.signal,
      parse: (raw) => {
        try {
          return JSON.parse(raw) as { body: string };
        } catch {
          return null;
        }
      },
    });

    expect(out.value?.body).toBe("Retry ok");
    expect(create).toHaveBeenCalledTimes(2);
    for (const call of create.mock.calls) {
      const [body, options] = call;
      expect(body).not.toHaveProperty("signal");
      expect(options).toEqual({ signal: controller.signal });
    }
  });

  it("omits RequestOptions when no signal is supplied", async () => {
    const create = vi.fn().mockResolvedValue(
      mockCompletion({ content: '{"body":"Hello"}', finish_reason: "stop" })
    );
    const client = {
      chat: { completions: { create } },
    } as unknown as OpenAI;

    await runLaneOpenAiJsonWithOneRetry<{ body: string }>({
      client,
      model: "gpt-4o-mini",
      temperature: 0.35,
      maxTokens: 220,
      primaryMessages: [{ role: "user", content: "hi" }],
      jsonSchemaReminder: "json",
      parse: (raw) => {
        try {
          return JSON.parse(raw) as { body: string };
        } catch {
          return null;
        }
      },
    });

    expect(create).toHaveBeenCalledTimes(1);
    const [body, options] = create.mock.calls[0] ?? [];
    expect(body).not.toHaveProperty("signal");
    expect(options).toBeUndefined();
  });
});
