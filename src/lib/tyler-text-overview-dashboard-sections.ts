import {
  notebookDisplayHeadline,
  notebookDisplaySubtext,
} from "@/lib/tyler-text-overview-notebook-display";
import type { TylerTextOverviewAdminDraftRow } from "@/lib/tyler-text-overview-types";

export const ADMIN_INTERPRETATION_LINE = "Admin interpretation — not sent to OpenAI.";

export const RAW_NOTEBOOK_SECTION_HEADING = "Raw persisted OpenAI input";

export const RAW_NOTEBOOK_SECTION_LABEL =
  "Raw system/user messages stored for this generation.";

export const RAW_NOTEBOOK_EMPTY_MESSAGE =
  "No raw OpenAI input exists for this generation because the writer was not called.";

/** Admin-only strings that must not appear in the raw notebook message area. */
export const RAW_NOTEBOOK_FORBIDDEN_ADMIN_STRINGS = [
  "Exact primary OpenAI input",
  "Persisted system + user input captured before the writer call",
  "Writer ran, but send was blocked later",
  "OpenAI writer was intentionally skipped",
  "OpenAI writer was not called",
  "No writer input was stored for this generation",
  "Showing notebook from the current draft generation",
  "machine_should_send",
  "silence_cadence_route",
  ADMIN_INTERPRETATION_LINE,
] as const;

export type ProvenanceExplanationBlock = {
  kind: "headline" | "detail" | "warning";
  text: string;
};

function formatOptional(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function buildProvenanceExplanationBlocks(
  row: TylerTextOverviewAdminDraftRow
): ProvenanceExplanationBlock[] {
  const blocks: ProvenanceExplanationBlock[] = [
    {
      kind: "headline",
      text: notebookDisplayHeadline(row.notebookDisplayMode),
    },
    {
      kind: "headline",
      text: notebookDisplaySubtext(row.notebookDisplayMode),
    },
  ];

  const hasMessages = row.writerOpenAiMessages.length > 0;

  if (hasMessages && row.machineShouldSend === false) {
    blocks.push({
      kind: "detail",
      text: `Writer ran, but send was blocked later. Reason: ${row.machineNoSendReason ?? "unknown"}`,
    });
  }

  if (!hasMessages && row.notebookDisplayMode === "writer_skipped_intentional") {
    blocks.push(
      {
        kind: "detail",
        text: `OpenAI writer was intentionally skipped. Reason: ${row.machineNoSendReason ?? "unknown"}`,
      },
      {
        kind: "detail",
        text: `Route: ${row.silenceCadenceRoute ?? "—"}`,
      },
      {
        kind: "detail",
        text: `Silence day: ${formatOptional(row.silenceDay)}`,
      },
      {
        kind: "detail",
        text: `Intentional space: ${formatOptional(row.intentionalSpace)}`,
      }
    );
  }

  if (!hasMessages && row.notebookDisplayMode === "writer_skipped_unknown") {
    blocks.push({
      kind: "detail",
      text: `OpenAI writer was not called. No writer input was stored for this generation. Reason: ${row.machineNoSendReason ?? "unknown"}`,
    });
  }

  if (row.isLatestGeneration === false) {
    blocks.push({
      kind: "warning",
      text: `Showing notebook from the current draft generation, not the latest machine generation. Current generation: #${formatOptional(row.currentGenerationNumber)}. Latest generation: #${formatOptional(row.latestGenerationNumber)}.`,
    });
  }

  return blocks;
}

export function getRawNotebookMessages(
  row: TylerTextOverviewAdminDraftRow
): TylerTextOverviewAdminDraftRow["writerOpenAiMessages"] {
  return row.writerOpenAiMessages;
}

export function getRawNotebookSectionCopy(row: TylerTextOverviewAdminDraftRow): {
  label: string | null;
  emptyMessage: string | null;
  messages: TylerTextOverviewAdminDraftRow["writerOpenAiMessages"];
} {
  const messages = getRawNotebookMessages(row);
  if (messages.length === 0) {
    return {
      label: null,
      emptyMessage: RAW_NOTEBOOK_EMPTY_MESSAGE,
      messages: [],
    };
  }
  return {
    label: RAW_NOTEBOOK_SECTION_LABEL,
    emptyMessage: null,
    messages,
  };
}

export function rawNotebookSectionContainsForbiddenAdminCopy(text: string): string | null {
  for (const forbidden of RAW_NOTEBOOK_FORBIDDEN_ADMIN_STRINGS) {
    if (text.includes(forbidden)) return forbidden;
  }
  return null;
}
