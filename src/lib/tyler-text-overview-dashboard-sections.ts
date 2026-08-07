import {
  hasExactPrimaryWriterInput,
  isLegacyAssistantOnlyWriterCapture,
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

/** Morning historical writer-record section copy (exact persisted strings). */
export const MORNING_CURRENT_BODY_HEADING = "CURRENT BODY THAT WILL SEND";
export const MORNING_CURRENT_BODY_LABEL =
  "This is the authoritative body Twilio will send after send-path trimming.";
export const MORNING_CURRENT_BODY_BLANK =
  "Blank current body — fail-closed: no Morning text will send.";

export const MORNING_ORIGINAL_MACHINE_DRAFT_HEADING = "ORIGINAL MACHINE DRAFT";
export const MORNING_ORIGINAL_MACHINE_DRAFT_LABEL =
  "This is the body produced by the OpenAI Morning writer for the authoritative generation.";

export const MORNING_BODY_COMPARISON_HEADING = "BODY COMPARISON";
export const MORNING_BODY_COMPARISON_MATCH =
  "Current body matches the original machine draft.";
export const MORNING_BODY_COMPARISON_DIFFERS =
  "Current body differs from the original machine draft.";
export const MORNING_BODY_COMPARISON_GENERATION_FAILED =
  "No machine draft was produced because this generation failed.";
export const MORNING_BODY_COMPARISON_HISTORICAL_UNAVAILABLE =
  "The linked historical machine draft is unavailable.";
export const MORNING_BODY_COMPARISON_GENERATION_MISSING =
  "The authoritative generation linkage is missing.";
export const MORNING_BODY_COMPARISON_TYLER_SAVE_MATCHES =
  "Tyler saved this body; text currently matches original machine draft.";
export const MORNING_BODY_COMPARISON_SOURCE_UNKNOWN =
  "Historical edit source unavailable.";

export const MORNING_SOURCE_TYLER_EDITED = "Tyler edited";
export const MORNING_SOURCE_ORIGINAL_MACHINE = "Original machine body";
export const MORNING_SOURCE_UNKNOWN = "Historical edit source unavailable";

export const MORNING_RAW_PRIMARY_INPUT_HEADING = "RAW PRIMARY OPENAI INPUT";
export const MORNING_RAW_PRIMARY_INPUT_LABEL =
  "These are the exact original system and user messages sent to OpenAI.";

export const MORNING_BRIEF_OBSERVATION_STATUS =
  "COACHING BRIEF WAS INCLUDED IN THIS WRITER INPUT.";

export const MORNING_COACHING_BRIEF_HEADING = "COACHING BRIEF";
export const MORNING_BRIEF_PERSONAL_CONTEXT_HEADING = "PERSONAL CONTEXT OBSERVABILITY";
export const MORNING_BRIEF_INTERPRETER_INPUT_HEADING = "INTERPRETER RAW INPUT";
export const MORNING_BRIEF_INTERPRETER_OUTPUT_HEADING = "INTERPRETER RAW OUTPUT";

export const MORNING_TECHNICAL_RETRY_HEADING = "TECHNICAL RETRY CONTEXT";
export const MORNING_TECHNICAL_RETRY_LABEL =
  "Technical JSON retry context — also sent to OpenAI after the first response failed validation.";
export const MORNING_TECHNICAL_RETRY_DETAIL =
  "These additional messages were sent only because the first OpenAI response failed JSON validation.";

export const MORNING_GENERATION_PROVENANCE_HEADING = "GENERATION PROVENANCE";
export const MORNING_GENERATION_PROVENANCE_LABEL =
  "Metadata about the authoritative generation — not writer input.";

/** Evening dual-body labels (Morning copy stays Morning-specific). */
export const EVENING_CURRENT_BODY_HEADING = "CURRENT AUTHORITATIVE BODY";
export const EVENING_CURRENT_BODY_LABEL =
  "This is the authoritative saved body. Evening sending is not enabled yet.";
export const EVENING_CURRENT_BODY_BLANK =
  "Blank current body — no Evening text will send when sending is enabled.";

export const TTO_MESSAGE_FOR_HEADING = "THIS MESSAGE IS FOR";
export const TTO_MESSAGE_FOR_UNAVAILABLE = "Target not captured";
export const TTO_PERSISTED_PACKET_HEADING = "PERSISTED RELATIONSHIP PACKET";
export const TTO_PERSISTED_EXACT_THREAD_HEADING = "PERSISTED EXACT THREAD";
export const TTO_PERSISTED_PACKET_UNAVAILABLE =
  "Relationship packet was not captured for this generation.";
export const TTO_PERSISTED_EXACT_THREAD_UNAVAILABLE =
  "Exact thread was not captured in the persisted packet.";

/**
 * Shared Sol coaching rows (Morning or Evening) — gate on persisted Sol metadata,
 * never on page alone.
 */
export function isSharedSolCoachingRow(row: TylerTextOverviewAdminDraftRow): boolean {
  if (row.coachingStack === "shared_sol_v1") return true;
  if (row.writerPromptPath === "morning_brief_writer_v1") return true;
  if (row.morningCoachingBriefV1 != null) return true;
  if (row.morningBriefInterpreterV1 != null) return true;
  if (row.morningWriterCaptureV1 != null) return true;
  if (row.morningRelationshipPacketV1 != null) return true;
  return false;
}

/** Morning page morning drafts, or Evening shared-Sol drafts — always show dual body. */
export function shouldShowMorningDualBodyPanels(
  row: TylerTextOverviewAdminDraftRow,
  isEveningPage: boolean
): boolean {
  if (!row.draftId) return false;
  if (!isEveningPage) {
    return row.sendSlot === "morning";
  }
  return row.sendSlot === "evening_checkin" && isSharedSolCoachingRow(row);
}

export function isMorningRelationshipNotebookRow(
  row: TylerTextOverviewAdminDraftRow
): boolean {
  return (
    row.notebookFamily === "morning_relationship_v1" ||
    row.writerPromptPath === "morning_relationship_v1" ||
    row.writerPromptPath === "morning_brief_writer_v1"
  );
}

/** Forensic Sol panels: Brief / interpreter / writer / retry — data-gated. */
export function shouldShowSolForensicPanels(row: TylerTextOverviewAdminDraftRow): boolean {
  return isSharedSolCoachingRow(row) || isMorningRelationshipNotebookRow(row);
}

/**
 * Legacy Evening Morning-anchor panel only when real legacy metadata exists and
 * the row is not shared-Sol (E3 Sol rows must not show a stale anchor panel).
 */
export function shouldShowEveningMorningAnchorPanel(
  row: TylerTextOverviewAdminDraftRow,
  isEveningPage: boolean
): boolean {
  if (!isEveningPage) return false;
  if (isSharedSolCoachingRow(row)) return false;
  return Boolean(
    row.morningAnchorSource ||
      row.morningAnchorSent != null ||
      row.morningAnchorBodyPreview
  );
}

/** Persisted message_for only — never derive from admin day selector. */
export function formatPersistedMessageForLine(
  messageFor: TylerTextOverviewAdminDraftRow["messageFor"]
): string | null {
  if (!messageFor) return null;
  const daypartLabel = messageFor.daypart === "evening" ? "Evening" : "Morning";
  return `${messageFor.local_weekday}, ${messageFor.local_date} · ${daypartLabel} · ${messageFor.timezone}`;
}

export function getPersistedExactThreadMessages(
  packet: TylerTextOverviewAdminDraftRow["morningRelationshipPacketV1"]
): Array<Record<string, unknown>> | null {
  if (!packet) return null;
  const exact = packet.exact_thread;
  if (!exact || typeof exact !== "object" || Array.isArray(exact)) return null;
  const messages = (exact as Record<string, unknown>).messages;
  if (!Array.isArray(messages)) return null;
  return messages.filter(
    (m): m is Record<string, unknown> =>
      !!m && typeof m === "object" && !Array.isArray(m)
  );
}

export function formatMorningCurrentBodySourceLabel(
  row: TylerTextOverviewAdminDraftRow
): string {
  if (row.editedByTyler === true || row.currentBodySource === "tyler_edit") {
    return `Source: ${MORNING_SOURCE_TYLER_EDITED}`;
  }
  if (row.currentBodySource === "machine") {
    return `Source: ${MORNING_SOURCE_ORIGINAL_MACHINE}`;
  }
  if (row.currentBodySource) {
    return `Source: ${row.currentBodySource}`;
  }
  return `Source: ${MORNING_SOURCE_UNKNOWN}`;
}

export function getMorningMachineDraftUnavailableReason(
  row: TylerTextOverviewAdminDraftRow
): string {
  switch (row.authoritativeMachineDraftStatus) {
    case "generation_failed": {
      const reason = row.machineNoSendReason?.trim();
      return reason
        ? `${MORNING_BODY_COMPARISON_GENERATION_FAILED} Reason: ${reason}`
        : MORNING_BODY_COMPARISON_GENERATION_FAILED;
    }
    case "generation_missing":
      return MORNING_BODY_COMPARISON_GENERATION_MISSING;
    case "historical_unavailable":
      return MORNING_BODY_COMPARISON_HISTORICAL_UNAVAILABLE;
    default:
      return MORNING_BODY_COMPARISON_HISTORICAL_UNAVAILABLE;
  }
}

/**
 * Body comparison label only. Never used to show/hide body panels.
 * Equality affects this string alone.
 */
export function getMorningBodyComparisonStatus(
  row: TylerTextOverviewAdminDraftRow
): string {
  const status = row.authoritativeMachineDraftStatus;
  if (status === "generation_failed") return MORNING_BODY_COMPARISON_GENERATION_FAILED;
  if (status === "generation_missing") return MORNING_BODY_COMPARISON_GENERATION_MISSING;
  if (status === "historical_unavailable" || status == null) {
    return MORNING_BODY_COMPARISON_HISTORICAL_UNAVAILABLE;
  }

  const machine = row.authoritativeMachineDraftBody;
  const current = row.currentBodyToSend;
  const textsMatch = machine === current;
  const tylerSaved =
    row.editedByTyler === true || row.currentBodySource === "tyler_edit";

  if (textsMatch) {
    if (tylerSaved) return MORNING_BODY_COMPARISON_TYLER_SAVE_MATCHES;
    return MORNING_BODY_COMPARISON_MATCH;
  }
  return MORNING_BODY_COMPARISON_DIFFERS;
}

export function getMorningTechnicalRetrySectionCopy(
  row: TylerTextOverviewAdminDraftRow
): {
  show: boolean;
  heading: string;
  label: string;
  detail: string;
  messages: TylerTextOverviewAdminDraftRow["authoritativeRetryMessages"];
} {
  const messages = row.authoritativeRetryMessages ?? [];
  const show = row.authoritativeRetryOccurred === true || messages.length > 0;
  return {
    show,
    heading: MORNING_TECHNICAL_RETRY_HEADING,
    label: MORNING_TECHNICAL_RETRY_LABEL,
    detail: MORNING_TECHNICAL_RETRY_DETAIL,
    messages,
  };
}

/** Weekly legacy rows stored assistant output; do not claim exact writer input. */
export const WEEKLY_RAW_NOTEBOOK_LEGACY_OR_MISSING_MESSAGE =
  "No exact writer input was persisted for this generation.";

export const WEEKLY_EXACT_WRITER_INPUT_HEADING = "Exact weekly writer input";

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
  if (row.rowState === "no_draft_yet") {
    return [
      {
        kind: "headline",
        text: "MISSING MORNING DRAFT — GENERATION INCOMPLETE",
      },
      {
        kind: "detail",
        text: "No live Morning draft exists for this user, day, and slot. This row cannot send. No generation provenance is available because no draft overlay was loaded.",
      },
    ];
  }

  if (row.generationLinkageError === true) {
    return [
      {
        kind: "warning",
        text: "GENERATION LINKAGE ERROR — draft exists but current_generation_id could not be loaded.",
      },
      {
        kind: "detail",
        text: `Draft id: ${row.draftId ?? "—"}. Generation id: ${row.currentGenerationId ?? "—"}. This is not a missing-draft state.`,
      },
    ];
  }

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

/**
 * Weekly TTO raw notebook copy.
 * Only surfaces messages when they are exact system+user primary input.
 * Legacy assistant-only captures degrade without claiming exactness.
 */
export function getWeeklyRawNotebookSectionCopy(row: TylerTextOverviewAdminDraftRow): {
  heading: string;
  label: string | null;
  emptyMessage: string | null;
  messages: TylerTextOverviewAdminDraftRow["writerOpenAiMessages"];
  isExactPrimaryInput: boolean;
} {
  const messages = getRawNotebookMessages(row);
  if (hasExactPrimaryWriterInput(messages)) {
    return {
      heading: WEEKLY_EXACT_WRITER_INPUT_HEADING,
      label: RAW_NOTEBOOK_SECTION_LABEL,
      emptyMessage: null,
      messages,
      isExactPrimaryInput: true,
    };
  }
  return {
    heading: RAW_NOTEBOOK_SECTION_HEADING,
    label: null,
    emptyMessage: WEEKLY_RAW_NOTEBOOK_LEGACY_OR_MISSING_MESSAGE,
    messages: [],
    isExactPrimaryInput: false,
  };
}

/** Weekly provenance: avoid "exact primary input" headlines for legacy assistant-only rows. */
export function buildWeeklyProvenanceExplanationBlocks(
  row: TylerTextOverviewAdminDraftRow
): ProvenanceExplanationBlock[] {
  const messages = row.writerOpenAiMessages ?? [];
  if (isLegacyAssistantOnlyWriterCapture(messages) || !hasExactPrimaryWriterInput(messages)) {
    const blocks: ProvenanceExplanationBlock[] = [
      {
        kind: "headline",
        text: WEEKLY_RAW_NOTEBOOK_LEGACY_OR_MISSING_MESSAGE,
      },
      {
        kind: "detail",
        text: `writer_prompt_path: ${formatOptional(row.writerPromptPath)}`,
      },
      {
        kind: "detail",
        text: `machine_should_send: ${formatOptional(row.machineShouldSend)}`,
      },
      {
        kind: "detail",
        text: `machine_no_send_reason: ${formatOptional(row.machineNoSendReason)}`,
      },
    ];
    if (row.isLatestGeneration === false) {
      blocks.push({
        kind: "warning",
        text: `Showing notebook from the current draft generation, not the latest machine generation. Current generation: #${formatOptional(row.currentGenerationNumber)}. Latest generation: #${formatOptional(row.latestGenerationNumber)}.`,
      });
    }
    return blocks;
  }
  return buildProvenanceExplanationBlocks(row);
}

export function rawNotebookSectionContainsForbiddenAdminCopy(text: string): string | null {
  for (const forbidden of RAW_NOTEBOOK_FORBIDDEN_ADMIN_STRINGS) {
    if (text.includes(forbidden)) return forbidden;
  }
  return null;
}
