import {
  buildWriterOpenAiCapture,
  hashWriterOpenAiMessages,
  type TylerTextOverviewWriterOpenAiMessage,
} from "@/lib/tyler-text-overview-writer-capture";

export type InboundWriterOpenAiMessageRole = "system" | "user" | "assistant";

export type InboundWriterOpenAiMessage = {
  role: InboundWriterOpenAiMessageRole;
  content: string;
};

export type InboundWriterOpenAiCapture = {
  messages: InboundWriterOpenAiMessage[];
  model?: string;
  writer_prompt_path?: string;
  messages_hash?: string;
  relationship_packet_char_count?: number;
};

export function buildInboundWriterOpenAiCapture(args: {
  messages: InboundWriterOpenAiMessage[];
  model?: string;
  writer_prompt_path?: string | null;
  relationship_packet_char_count?: number | null;
}): InboundWriterOpenAiCapture {
  const messages = args.messages.map((m) => ({ role: m.role, content: m.content }));
  return {
    messages,
    ...(args.model ? { model: args.model } : {}),
    ...(args.writer_prompt_path ? { writer_prompt_path: args.writer_prompt_path } : {}),
    messages_hash: hashWriterOpenAiMessages(
      messages as TylerTextOverviewWriterOpenAiMessage[]
    ),
    ...(args.relationship_packet_char_count != null
      ? { relationship_packet_char_count: args.relationship_packet_char_count }
      : {}),
  };
}

export { hashWriterOpenAiMessages };

export function compactInboundWriterCaptureTelemetry(
  capture: InboundWriterOpenAiCapture | null | undefined
): Record<string, unknown> {
  if (!capture?.messages?.length) return {};
  return {
    inbound_writer_prompt_path: capture.writer_prompt_path ?? null,
    inbound_writer_openai_messages_hash: capture.messages_hash ?? null,
    inbound_relationship_packet_char_count: capture.relationship_packet_char_count ?? null,
    inbound_writer_capture_message_count: capture.messages.length,
  };
}
