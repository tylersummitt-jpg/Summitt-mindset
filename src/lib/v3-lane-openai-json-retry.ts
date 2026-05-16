import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export type LaneJsonRetryMeta = {
  lane_json_retry_attempted: boolean;
  lane_json_retry_succeeded: boolean;
  original_raw_preview: string;
  retry_raw_preview: string | null;
};

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
}): Promise<{ value: T | null; raw: string; retryMeta: LaneJsonRetryMeta }> {
  const base = {
    model: args.model,
    temperature: args.temperature,
    max_tokens: args.maxTokens,
    response_format: { type: "json_object" as const },
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
  };

  const firstParse = args.parse(raw);
  if (firstParse != null) {
    return { value: firstParse, raw, retryMeta: initialMeta };
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
  };

  if (retryParse != null) {
    return { value: retryParse, raw: rawRetry, retryMeta };
  }

  return { value: null, raw, retryMeta };
}
