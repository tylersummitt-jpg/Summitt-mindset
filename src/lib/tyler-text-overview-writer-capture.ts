import crypto from "crypto";

export type TylerTextOverviewWriterOpenAiMessageRole = "system" | "user" | "assistant";

export type TylerTextOverviewWriterOpenAiMessage = {
  role: TylerTextOverviewWriterOpenAiMessageRole;
  content: string;
};

export type TylerTextOverviewWriterOpenAiCapture = {
  messages: TylerTextOverviewWriterOpenAiMessage[];
  model?: string;
  writer_prompt_path?: string;
  notebook_hash?: string;
};

export function hashWriterOpenAiMessages(
  messages: TylerTextOverviewWriterOpenAiMessage[]
): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(messages), "utf8")
    .digest("hex");
}

export function buildWriterOpenAiCapture(args: {
  messages: TylerTextOverviewWriterOpenAiMessage[];
  model?: string;
  writer_prompt_path?: string | null;
}): TylerTextOverviewWriterOpenAiCapture {
  const messages = args.messages.map((m) => ({ role: m.role, content: m.content }));
  return {
    messages,
    ...(args.model ? { model: args.model } : {}),
    ...(args.writer_prompt_path ? { writer_prompt_path: args.writer_prompt_path } : {}),
    notebook_hash: hashWriterOpenAiMessages(messages),
  };
}
