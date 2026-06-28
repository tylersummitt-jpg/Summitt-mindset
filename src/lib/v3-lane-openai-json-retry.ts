import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

export type LaneJsonRetryMeta = {
  lane_json_retry_attempted: boolean;
  lane_json_retry_succeeded: boolean;
  original_raw_preview: string;
  retry_raw_preview: string | null;
  writer_model: string;
  writer_finish_reason: string | null;
  writer_output_tokens: number | null;
  writer_prompt_tokens: number | null;
};

export function extractWriterUsageFromCompletion(
  model: string,
  completion: ChatCompletion
): Pick<
  LaneJsonRetryMeta,
  "writer_model" | "writer_finish_reason" | "writer_output_tokens" | "writer_prompt_tokens"
> {
  return {
    writer_model: model,
    writer_finish_reason: completion.choices[0]?.finish_reason ?? null,
    writer_output_tokens:
      typeof completion.usage?.completion_tokens === "number"
        ? completion.usage.completion_tokens
        : null,
    writer_prompt_tokens:
      typeof completion.usage?.prompt_tokens === "number" ? completion.usage.prompt_tokens : null,
  };
}

/**
 * One primary `chat.completions` JSON-object call; on invalid JSON from the model, one strict retry.
 * No deterministic fallback — OpenAI only.
 */
export async function runLaneOpenAiJsonWithOneRetry<T>(args: {
  client: OpenAI;
  model: string;
  temperature: number;
  maxTokens: number;
  primaryMessages: ChatCompletionMessageParam[];
  jsonSchemaReminder: string;
  parse: (raw: string) => T | null;
  /** When set, passed to OpenAI; abort ends the in-flight request. */
  signal?: AbortSignal;
  /** Default true. Interpreter lanes should pass false to stay within a single timeout budget. */
  allowRetry?: boolean;
}): Promise<{ value: T | null; raw: string; retryMeta: LaneJsonRetryMeta }> {
  const base = {
    model: args.model,
    temperature: args.temperature,
    max_tokens: args.maxTokens,
    response_format: { type: "json_object" as const },
    ...(args.signal ? { signal: args.signal } : {}),
  };

  const first = await args.client.chat.completions.create({
    ...base,
    messages: args.primaryMessages,
  });
  let raw = first.choices[0]?.message?.content?.trim() ?? "";
  const preview = (s: string) => s.slice(0, 200);

  const initialMeta: LaneJsonRetryMeta = {
    lane_json_retry_attempted: false,
    lane_json_retry_succeeded: false,
    original_raw_preview: preview(raw),
    retry_raw_preview: null,
    ...extractWriterUsageFromCompletion(args.model, first),
  };

  const firstParse = args.parse(raw);
  if (firstParse != null) {
    return { value: firstParse, raw, retryMeta: initialMeta };
  }

  if (args.allowRetry === false) {
    return { value: null, raw, retryMeta: initialMeta };
  }

  const retryMessages: ChatCompletionMessageParam[] = [
    ...args.primaryMessages,
    { role: "assistant", content: raw.slice(0, 8000) },
    {
      role: "user",
      content: `Your previous response was invalid JSON or did not parse. ${args.jsonSchemaReminder}

Return valid JSON only. No markdown code fences, no commentary before or after the JSON.`,
    },
  ];

  const second = await args.client.chat.completions.create({
    ...base,
    messages: retryMessages,
  });
  const rawRetry = second.choices[0]?.message?.content?.trim() ?? "";
  const retryParse = args.parse(rawRetry);

  const retryMeta: LaneJsonRetryMeta = {
    lane_json_retry_attempted: true,
    lane_json_retry_succeeded: retryParse != null,
    original_raw_preview: preview(raw),
    retry_raw_preview: preview(rawRetry),
    ...extractWriterUsageFromCompletion(
      args.model,
      retryParse != null ? second : first
    ),
  };

  if (retryParse != null) {
    return { value: retryParse, raw: rawRetry, retryMeta };
  }

  return { value: null, raw, retryMeta };
}
