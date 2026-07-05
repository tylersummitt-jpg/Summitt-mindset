import type { TylerTextOverviewWriterOpenAiMessage } from "@/lib/tyler-text-overview-writer-capture";

export type TylerTextOverviewNotebookFamily =
  | "daily_sms_writing_brief_v1"
  | "legacy_relationship_packet_v1"
  | "writer_skipped"
  | "unknown";

export type TylerTextOverviewNotebookDisplayMode =
  | "exact_primary_input"
  | "writer_skipped_intentional"
  | "writer_skipped_unknown"
  | "writer_ran_send_blocked";

const DAILY_BRIEF_MARKER = "DAILY_SMS_WRITING_BRIEF_V1";
const LEGACY_PACKET_MARKER = "RELATIONSHIP_PACKET_V1";

function messagesContainMarker(
  messages: TylerTextOverviewWriterOpenAiMessage[],
  marker: string
): boolean {
  return messages.some((m) => m.content.includes(marker));
}

function isSilenceCadenceSkip(args: {
  machineNoSendReason: string | null;
  skipSource: string | null;
}): boolean {
  const reason = args.machineNoSendReason ?? "";
  if (reason.startsWith("silence_cadence")) return true;
  const skip = args.skipSource ?? "";
  return skip.includes("silence_cadence");
}

export function deriveNotebookFamily(args: {
  messageCount: number;
  writerPromptPath: string | null;
  messages: TylerTextOverviewWriterOpenAiMessage[];
}): TylerTextOverviewNotebookFamily {
  if (args.messageCount === 0) return "writer_skipped";
  if (
    args.writerPromptPath === "daily_writing_brief_v1" ||
    messagesContainMarker(args.messages, DAILY_BRIEF_MARKER)
  ) {
    return "daily_sms_writing_brief_v1";
  }
  if (
    args.writerPromptPath === "legacy_packet_v1" ||
    messagesContainMarker(args.messages, LEGACY_PACKET_MARKER)
  ) {
    return "legacy_relationship_packet_v1";
  }
  return "unknown";
}

export function deriveNotebookDisplayMode(args: {
  messageCount: number;
  machineShouldSend: boolean | null;
  machineNoSendReason: string | null;
  capturePresent: boolean | null;
  intentionalSpace: boolean | null;
  skipSource: string | null;
}): TylerTextOverviewNotebookDisplayMode {
  if (args.messageCount > 0) {
    return args.machineShouldSend === true
      ? "exact_primary_input"
      : "writer_ran_send_blocked";
  }

  if (args.intentionalSpace === true) return "writer_skipped_intentional";
  if (isSilenceCadenceSkip(args)) return "writer_skipped_intentional";

  return "writer_skipped_unknown";
}

export function notebookFamilyLabel(family: TylerTextOverviewNotebookFamily): string {
  switch (family) {
    case "daily_sms_writing_brief_v1":
      return "Daily SMS Writing Brief v1";
    case "legacy_relationship_packet_v1":
      return "Legacy relationship packet v1";
    case "writer_skipped":
      return "Writer skipped (no notebook)";
    default:
      return "Unknown notebook family";
  }
}

export function notebookDisplayHeadline(mode: TylerTextOverviewNotebookDisplayMode): string {
  switch (mode) {
    case "exact_primary_input":
      return "Exact primary OpenAI input";
    case "writer_ran_send_blocked":
      return "Writer ran, but send was blocked later";
    case "writer_skipped_intentional":
      return "OpenAI writer was intentionally skipped";
    default:
      return "OpenAI writer was not called";
  }
}

export function notebookDisplaySubtext(mode: TylerTextOverviewNotebookDisplayMode): string {
  switch (mode) {
    case "exact_primary_input":
      return "This is the persisted system + user input captured before the writer call. It does not include model output or JSON-retry follow-ups.";
    case "writer_ran_send_blocked":
      return "OpenAI received the notebook below, but the generated SMS was not marked sendable.";
    case "writer_skipped_intentional":
      return "No notebook exists because this draft was an intentional no-send, usually silence cadence space.";
    default:
      return "No writer input was stored. Check machine_no_send_reason and generation metadata.";
  }
}
