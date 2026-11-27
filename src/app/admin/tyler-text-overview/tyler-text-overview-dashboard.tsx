"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  adminCountLabel,
  buildSiblingTylerTextOverviewPageHref,
  EVENING_TTO_NON_TODAY_WARNING,
  EVENING_TTO_NO_PREVIEW_COPY,
  EVENING_TTO_SAVE_ONLY_COPY,
  TTO_BODY_SOFT_LENGTH_WARNING,
  formatEveningEmptyBodyPanelCopy,
  formatTtoBodyCharCount,
  formatTtoBodyOverTransportMaxCopy,
  ttoDraftBodyExceedsTransportMax,
  ttoDraftBodyShouldSoftWarnLength,
  formatTtoBulkApplyConfirm,
  formatTtoBulkBlankConfirm,
  formatEveningBulkResultMessage,
  formatMorningBulkResultMessage,
  formatMorningTtoSaveToast,
  formatMorningTtoSendabilityCopy,
  formatTtoGenerateAllConfirm,
  formatTtoGenerateAllProgressLine,
  formatTtoGenerateAllResultMessage,
  isEveningDashboardSendSlot,
  isTylerBlankedMorningDraftRow,
  matchesTylerTextOverviewSearchQuery,
  ttoBulkActionsHeading,
  ttoBulkApplyEmptyHint,
  ttoBulkSaveEndpoint,
  ttoBulkSearchWarning,
  ttoBulkSelectDayHint,
  ttoGenerateAllButtonLabel,
  ttoGenerateAllEndpoint,
  ttoGenerateAllSessionStorageKey,
  TTO_GENERATE_ALL_SEARCH_WARNING,
  TTO_GENERATE_ALL_SELECT_DAY_HINT,
  MORNING_MISSING_DRAFT_BANNER,
  MORNING_MISSING_DRAFT_SUPPORTING_COPY,
  MORNING_SAVE_FAILED_COPY,
  MORNING_SAVE_RELOAD_FAILED_COPY,
  MORNING_TTO_AUTHORITY_BANNER,
  MORNING_TYLER_BLANK_SAVED_COPY,
  MORNING_TYLER_BLOCKED_LABEL,
  MORNING_UNSAVED_COPY,
  resolveEveningTtoInitialSelectedDayKey,
  resolveMorningTtoInitialSelectedDayKey,
  shouldShowEveningNonTodayWarning,
  rowStateLabel,
  TTO_DATA_STALE_OR_INCOMPLETE_BANNER,
  TTO_FILTERED_ROWS_LABEL,
  TTO_MANIFEST_INCOMPLETE_BANNER,
  TTO_MANIFEST_SELECT_DAY_COPY,
  type TylerTextOverviewDashboardSendSlot,
} from "@/lib/tyler-text-overview-dashboard-copy";
import {
  ADMIN_INTERPRETATION_LINE,
  EVENING_CURRENT_BODY_BLANK,
  EVENING_CURRENT_BODY_HEADING,
  EVENING_CURRENT_BODY_LABEL,
  MORNING_BODY_COMPARISON_HEADING,
  MORNING_BRIEF_INTERPRETER_INPUT_HEADING,
  MORNING_BRIEF_INTERPRETER_OUTPUT_HEADING,
  MORNING_BRIEF_OBSERVATION_STATUS,
  MORNING_BRIEF_PERSONAL_CONTEXT_HEADING,
  MORNING_COACHING_BRIEF_HEADING,
  MORNING_CURRENT_BODY_BLANK,
  MORNING_CURRENT_BODY_HEADING,
  MORNING_CURRENT_BODY_LABEL,
  MORNING_GENERATION_PROVENANCE_HEADING,
  MORNING_GENERATION_PROVENANCE_LABEL,
  MORNING_ORIGINAL_MACHINE_DRAFT_HEADING,
  MORNING_ORIGINAL_MACHINE_DRAFT_LABEL,
  MORNING_RAW_PRIMARY_INPUT_HEADING,
  MORNING_RAW_PRIMARY_INPUT_LABEL,
  RAW_NOTEBOOK_SECTION_HEADING,
  TTO_MESSAGE_FOR_HEADING,
  TTO_MESSAGE_FOR_UNAVAILABLE,
  TTO_PERSISTED_EXACT_THREAD_HEADING,
  TTO_PERSISTED_EXACT_THREAD_UNAVAILABLE,
  TTO_PERSISTED_PACKET_HEADING,
  TTO_PERSISTED_PACKET_UNAVAILABLE,
  TTO_CURRENT_BODY_COPY_PASTE_LABEL,
  TTO_INTERPRETER_OPENAI_ERROR_HEADING,
  TTO_WRITER_OPENAI_ERROR_HEADING,
  buildProvenanceExplanationBlocks,
  formatMorningCurrentBodySourceLabel,
  formatPersistedMessageForLine,
  getMorningBodyComparisonStatus,
  getMorningMachineDraftUnavailableReason,
  getMorningTechnicalRetrySectionCopy,
  getPersistedExactThreadMessages,
  getRawNotebookSectionCopy,
  openAiErrorForensicLines,
  shouldShowEveningMorningAnchorPanel,
  shouldShowMorningDualBodyPanels,
  shouldShowSolForensicPanels,
} from "@/lib/tyler-text-overview-dashboard-sections";
import {
  shouldShowTtoBackgroundRefreshing,
  resolveTtoDashboardSelectionView,
  shouldShowTtoFullPageLoader,
  shouldSkipMorningTtoFocusRefresh,
} from "@/lib/tyler-text-overview-dashboard-refresh";
import { notebookFamilyLabel } from "@/lib/tyler-text-overview-notebook-display";
import type {
  TtoBatchStatistics,
  TtoGenerationOutcomeCounts,
  TylerTextOverviewAdminCounts,
  TylerTextOverviewAdminDraftRow,
  TylerTextOverviewManifestIntegrity,
  TylerTextOverviewOpenAiErrorPanel,
} from "@/lib/tyler-text-overview-types";
import {
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";

type EditState = Record<string, string>;
type SaveFailureState = Record<string, string>;

export type TylerTextOverviewDashboardProps = {
  sendSlot: TylerTextOverviewDashboardSendSlot;
};

function isEveningDraftSent(row: TylerTextOverviewAdminDraftRow): boolean {
  return row.draftStatus === "sent" || row.sentAt != null;
}

function rowListKey(row: TylerTextOverviewAdminDraftRow): string {
  if (row.occurrenceKey) return `occurrence:${row.sendSlot}:${row.occurrenceKey}`;
  if (row.rowRole === "historical_legacy") {
    return `historical:${row.clerkUserId}:${row.sendSlot}:${row.draftForDayKey}:${row.draftId ?? "no-draft"}`;
  }
  return `${row.clerkUserId}:${row.sendSlot}:${row.draftForDayKey}:${row.draftId ?? "no-draft"}`;
}

function formatEasternAdminClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    d.toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }) + " ET"
  );
}

function formatElapsedDuration(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatLocalMinuteLabel(minute: number): string {
  const hours = Math.floor(minute / 60);
  const mins = minute % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

function formatMemberLocalDay(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return dateKey;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function shortTimezoneLabel(timeZone: string): string {
  if (!timeZone.trim()) return "Unknown timezone";
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortGeneric",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    if (name) return name.replace(/ Time$/, "");
  } catch {
    return timeZone;
  }
  return timeZone;
}

function displayedDeliveryFromRow(row: TylerTextOverviewAdminDraftRow) {
  const delivery = row.scheduledDelivery;
  if (!delivery) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(delivery.memberLocalDate)) return null;
  if (!Number.isInteger(delivery.effectiveLocalMinute)) return null;
  if (!delivery.timeZone.trim()) return null;
  return {
    clerkUserId: row.clerkUserId,
    memberLocalDate: delivery.memberLocalDate,
    effectiveLocalMinute: delivery.effectiveLocalMinute,
    timeZone: delivery.timeZone,
  };
}

function formatScheduledDeliveryLine(row: TylerTextOverviewAdminDraftRow): string | null {
  const delivery = row.scheduledDelivery;
  if (!delivery?.memberLocalDate || !delivery.timeZone) return null;
  return `Scheduled: ${formatMemberLocalDay(delivery.memberLocalDate)}, ${formatLocalMinuteLabel(delivery.effectiveLocalMinute)} ${shortTimezoneLabel(delivery.timeZone)}`;
}

function formatGeneratedDeliveryLine(row: TylerTextOverviewAdminDraftRow): string | null {
  const delivery = row.generatedDelivery;
  if (!delivery?.memberLocalDate || delivery.effectiveLocalMinute == null || !delivery.timeZone) {
    return null;
  }
  return `Generated for: ${formatMemberLocalDay(delivery.memberLocalDate)}, ${formatLocalMinuteLabel(delivery.effectiveLocalMinute)} ${shortTimezoneLabel(delivery.timeZone)}`;
}

function outcomeSummary(counts: TtoGenerationOutcomeCounts | null): string {
  if (!counts) return "—";
  return `generated ${counts.generated}, intentional space ${counts.intentionalSpace}, protected ${counts.protected}, failed ${counts.failed}, pending ${counts.pending}, claimed ${counts.claimed}, sent ${counts.sent}`;
}

function batchStatusLabel(status: TtoBatchStatistics["status"]): string {
  switch (status) {
    case "not_started":
      return "Not started";
    case "in_progress":
      return "Pending or claimed work remains inside the generation window";
    case "started_idle":
      return "Started — nothing is pending or claimed";
    case "completed":
      return "Initial pass completed";
    case "completed_with_blocked":
      return "Initial pass completed with failures or blocked outcomes";
    case "incomplete_after_window":
      return "Incomplete after the generation window closed";
    case "unavailable":
      return "Statistics unavailable";
  }
}

function isMorningDraftSent(row: TylerTextOverviewAdminDraftRow): boolean {
  return row.rowState === "draft_sent" || row.draftStatus === "sent" || row.sentAt != null;
}

function canEditMorningDraft(row: TylerTextOverviewAdminDraftRow): boolean {
  return row.rowState === "draft_current" && Boolean(row.draftId);
}

function isMorningDraftDirty(
  row: TylerTextOverviewAdminDraftRow,
  edits: EditState
): boolean {
  if (!row.draftId) return false;
  const local = edits[row.draftId] ?? "";
  const saved = row.currentBodyToSend ?? "";
  return local !== saved;
}

function formatLastRefreshedAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function verifyPersistedSaveRow(
  updated: TylerTextOverviewAdminDraftRow,
  expectedDraftId: string,
  submittedBody: string
): string | null {
  if (!updated.draftId || updated.draftId !== expectedDraftId) {
    return "Save response missing draft id.";
  }
  if (!("currentBodyToSend" in updated)) {
    return "Save response missing current_body_to_send.";
  }
  if (!("currentBodySource" in updated) || updated.currentBodySource == null) {
    return "Save response missing current_body_source.";
  }
  if (updated.editedByTyler !== true) {
    return "Save response missing edited_by_tyler.";
  }
  if (!updated.editedAt) {
    return "Save response missing edited_at.";
  }
  const persisted = updated.currentBodyToSend?.trim() ?? "";
  const submitted = submittedBody.trim();
  if (persisted !== submitted) {
    return "Save response body does not match submitted body.";
  }
  if (!submitted) {
    if ((updated.currentBodyToSend?.trim() ?? "") !== "") {
      return "Blank save did not persist a blank body.";
    }
    if (updated.currentBodySource !== "tyler_edit") {
      return "Blank save did not set tyler_edit source.";
    }
  }
  return null;
}

function isEveningPreviewRow(row: TylerTextOverviewAdminDraftRow): boolean {
  return row.sendSlot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT || row.previewOnly === true;
}

/** Editable when current + unsent. Tyler authority is independent of machine_should_send. */
function canEditEveningDraft(row: TylerTextOverviewAdminDraftRow): boolean {
  if (!row.draftId) return false;
  if (!isEveningPreviewRow(row)) return false;
  if (isEveningDraftSent(row)) return false;
  if (row.draftStatus !== "current") return false;
  return true;
}

function isEveningDraftDirty(
  row: TylerTextOverviewAdminDraftRow,
  edits: EditState
): boolean {
  if (!row.draftId) return false;
  const local = edits[row.draftId] ?? "";
  const saved = row.currentBodyToSend ?? "";
  return local !== saved;
}

function hasAnyUnsavedEdits(
  rows: TylerTextOverviewAdminDraftRow[],
  edits: EditState,
  isEveningPage: boolean
): boolean {
  return rows.some((row) => {
    if (!row.draftId) return false;
    if (isEveningPage) {
      return canEditEveningDraft(row) && isEveningDraftDirty(row, edits);
    }
    return canEditMorningDraft(row) && isMorningDraftDirty(row, edits);
  });
}

function notebookLabel(role: string): string {
  return role.toUpperCase();
}

function formatOptional(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function formatMachineShouldSend(row: TylerTextOverviewAdminDraftRow): string {
  return formatOptional(row.machineShouldSend);
}

function NotebookProvenancePanel({ row }: { row: TylerTextOverviewAdminDraftRow }) {
  const explanationBlocks = buildProvenanceExplanationBlocks(row);
  const solForensics = shouldShowSolForensicPanels(row);

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-3 text-xs text-gray-700">
      {explanationBlocks.map((block, index) => {
        if (block.kind === "warning") {
          return (
            <p
              key={`${row.draftId ?? row.clerkUserId}-prov-${index}`}
              className="rounded border border-amber-200 bg-amber-50 px-2 py-2 text-amber-900"
            >
              {block.text}
            </p>
          );
        }
        if (block.kind === "detail") {
          return (
            <p key={`${row.draftId ?? row.clerkUserId}-prov-${index}`} className="text-gray-700">
              {block.text}
            </p>
          );
        }
        return (
          <p
            key={`${row.draftId ?? row.clerkUserId}-prov-${index}`}
            className={index === 0 ? "font-semibold text-gray-900" : "text-gray-600"}
          >
            {block.text}
          </p>
        );
      })}

      <dl className="grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="font-medium text-gray-500">Notebook family</dt>
          <dd>{notebookFamilyLabel(row.notebookFamily)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">writer_prompt_path</dt>
          <dd className="font-mono break-all">{formatOptional(row.writerPromptPath)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">Messages stored</dt>
          <dd>{row.notebookMessageCount}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">capture_present</dt>
          <dd>{formatOptional(row.capturePresent)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">
            {solForensics ? "Authoritative generation" : "Current generation"}
          </dt>
          <dd className="font-mono break-all">
            #{formatOptional(row.currentGenerationNumber)} ({formatOptional(row.currentGenerationId)})
          </dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">Latest generation</dt>
          <dd className="font-mono break-all">
            #{formatOptional(row.latestGenerationNumber)} ({formatOptional(row.latestGenerationId)})
          </dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">Is latest generation</dt>
          <dd>{formatOptional(row.isLatestGeneration)}</dd>
        </div>
        {solForensics ? (
          <>
            <div>
              <dt className="font-medium text-gray-500">writer model</dt>
              <dd className="font-mono break-all">
                {formatOptional(row.authoritativeWriterModel)}
              </dd>
            </div>
            {row.morningWriterCaptureV1 ? (
              <>
                <div>
                  <dt className="font-medium text-gray-500">writer reasoning_effort</dt>
                  <dd className="font-mono break-all">
                    {formatOptional(row.morningWriterCaptureV1.reasoningEffort)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-gray-500">writer max_completion_tokens</dt>
                  <dd className="font-mono break-all">
                    {formatOptional(row.morningWriterCaptureV1.maxCompletionTokens)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-gray-500">writer temperature</dt>
                  <dd className="font-mono break-all">
                    {row.morningWriterCaptureV1.temperature === null
                      ? "null (not sent)"
                      : formatOptional(row.morningWriterCaptureV1.temperature)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-gray-500">writer latency_ms</dt>
                  <dd className="font-mono break-all">
                    {formatOptional(row.morningWriterCaptureV1.latencyMs)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-gray-500">writer capture error</dt>
                  <dd className="font-mono break-all">
                    {formatOptional(row.morningWriterCaptureV1.error)}
                  </dd>
                </div>
              </>
            ) : null}
            {row.morningWriterCaptureV1?.openaiError ||
            row.morningBriefInterpreterV1?.openaiError ? (
              <div className="sm:col-span-2 space-y-2">
                <OpenAiErrorForensicBlock
                  heading={TTO_WRITER_OPENAI_ERROR_HEADING}
                  error={row.morningWriterCaptureV1?.openaiError}
                />
                <OpenAiErrorForensicBlock
                  heading={TTO_INTERPRETER_OPENAI_ERROR_HEADING}
                  error={row.morningBriefInterpreterV1?.openaiError}
                />
              </div>
            ) : null}
            <div>
              <dt className="font-medium text-gray-500">technical retry occurred</dt>
              <dd>{formatOptional(row.authoritativeRetryOccurred)}</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-500">machine generation timestamp</dt>
              <dd className="font-mono break-all">
                {formatOptional(row.authoritativeGeneratedAt)}
              </dd>
            </div>
          </>
        ) : null}
        <div>
          <dt className="font-medium text-gray-500">current_body_source</dt>
          <dd className="font-mono">{formatOptional(row.currentBodySource)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">edited_by_tyler</dt>
          <dd>{formatOptional(row.editedByTyler)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">edited_at</dt>
          <dd className="font-mono break-all">{formatOptional(row.editedAt)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">coaching_stack</dt>
          <dd className="font-mono break-all">{formatOptional(row.coachingStack)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">machine_should_send</dt>
          <dd>{formatMachineShouldSend(row)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">machine_no_send_reason</dt>
          <dd className="font-mono break-all">{formatOptional(row.machineNoSendReason)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">silence_cadence_route</dt>
          <dd className="font-mono break-all">{formatOptional(row.silenceCadenceRoute)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">silence_day</dt>
          <dd>{formatOptional(row.silenceDay)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">intentional_space</dt>
          <dd>
            {row.intentionalSpace === true
              ? "INTENTIONAL SPACE"
              : formatOptional(row.intentionalSpace)}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">required_touch</dt>
          <dd>
            {row.messageRequiredToday === true
              ? "REQUIRED TOUCH"
              : formatOptional(row.messageRequiredToday)}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">quiet_relationship_eligible</dt>
          <dd>{formatOptional(row.quietRelationshipEligible)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">interpreter proactive_decision</dt>
          <dd className="font-mono break-all">
            {formatOptional(row.interpreterProactiveDecision)}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">final proactive_decision</dt>
          <dd className="font-mono break-all">
            {formatOptional(row.clampedProactiveDecision)}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">clock_lookup_failed</dt>
          <dd>{formatOptional(row.clockLookupFailed)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">clock_lookup_error</dt>
          <dd className="font-mono break-all">{formatOptional(row.clockLookupError)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">
            days_since_last_successful_proactive_send
          </dt>
          <dd>{formatOptional(row.daysSinceLastSuccessfulProactiveSend)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">lane_stage</dt>
          <dd className="font-mono break-all">{formatOptional(row.laneStage)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-medium text-gray-500">notebook_hash</dt>
          <dd className="font-mono break-all">{formatOptional(row.notebookHash)}</dd>
        </div>
      </dl>
    </div>
  );
}

function MorningOriginalMachineDraftPanel({ row }: { row: TylerTextOverviewAdminDraftRow }) {
  const body = row.authoritativeMachineDraftBody;
  const available = row.authoritativeMachineDraftStatus === "available" && typeof body === "string";
  const writerError = row.morningWriterCaptureV1?.openaiError ?? null;
  const interpreterError = row.morningBriefInterpreterV1?.openaiError ?? null;
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-600">{MORNING_ORIGINAL_MACHINE_DRAFT_LABEL}</p>
      {available ? (
        <pre className="overflow-x-auto rounded bg-gray-50 p-3 text-xs text-gray-800 whitespace-pre-wrap font-mono border border-gray-200">
          {body}
        </pre>
      ) : (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-2 text-xs text-amber-900">
          {getMorningMachineDraftUnavailableReason(row)}
        </p>
      )}
      <OpenAiErrorForensicBlock
        heading={TTO_WRITER_OPENAI_ERROR_HEADING}
        error={writerError}
      />
      <OpenAiErrorForensicBlock
        heading={TTO_INTERPRETER_OPENAI_ERROR_HEADING}
        error={interpreterError}
      />
    </div>
  );
}

function OpenAiErrorForensicBlock({
  heading,
  error,
}: {
  heading: string;
  error: TylerTextOverviewOpenAiErrorPanel | null | undefined;
}) {
  const lines = openAiErrorForensicLines(error);
  if (lines.length === 0) return null;
  return (
    <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-rose-900">{heading}</p>
      <dl className="space-y-1">
        {lines.map((line) => (
          <div key={`${heading}-${line.label}`}>
            <dt className="text-[11px] font-medium text-rose-800">{line.label}:</dt>
            <dd className="whitespace-pre-wrap break-words font-mono text-xs text-rose-950">
              {line.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function MorningBodyComparisonPanel({ row }: { row: TylerTextOverviewAdminDraftRow }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-gray-800">{getMorningBodyComparisonStatus(row)}</p>
      <p className="text-xs text-gray-600">{formatMorningCurrentBodySourceLabel(row)}</p>
    </div>
  );
}

function formatBriefValue(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (value === "unknown") return "unknown";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return "none";
    return value.map((v) => `- ${formatBriefValue(v)}`).join("\n");
  }
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function BriefField({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <pre className="whitespace-pre-wrap text-sm text-gray-900">{formatBriefValue(value)}</pre>
    </div>
  );
}

function MorningCoachingBriefObservationPanels({
  row,
}: {
  row: TylerTextOverviewAdminDraftRow;
}) {
  const brief = row.morningCoachingBriefV1;
  const interpreter = row.morningBriefInterpreterV1;
  if (!brief && !interpreter) return null;

  const hs =
    brief?.human_situation && typeof brief.human_situation === "object"
      ? (brief.human_situation as Record<string, unknown>)
      : null;
  const te =
    brief?.truth_and_evidence && typeof brief.truth_and_evidence === "object"
      ? (brief.truth_and_evidence as Record<string, unknown>)
      : null;
  const cc =
    brief?.conversation_continuity && typeof brief.conversation_continuity === "object"
      ? (brief.conversation_continuity as Record<string, unknown>)
      : null;
  const gr =
    brief?.goal_role_today && typeof brief.goal_role_today === "object"
      ? (brief.goal_role_today as Record<string, unknown>)
      : null;
  const cd =
    brief?.coaching_direction && typeof brief.coaching_direction === "object"
      ? (brief.coaching_direction as Record<string, unknown>)
      : null;
  const bd =
    brief?.boundaries && typeof brief.boundaries === "object"
      ? (brief.boundaries as Record<string, unknown>)
      : null;
  const inputObj = interpreter?.exactInputObject ?? null;
  const availableIdentity = inputObj?.available_identity ?? null;
  const availablePeople = inputObj?.available_important_people ?? null;

  return (
    <div className="space-y-5">
      <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
        {MORNING_BRIEF_OBSERVATION_STATUS}
      </p>

      {brief ? (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            {MORNING_COACHING_BRIEF_HEADING}
          </h3>
          <BriefField label="Confidence" value={brief.confidence} />
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-gray-500">Human situation</p>
            <BriefField label="Most alive" value={hs?.most_alive} />
            <BriefField label="Direct question or need" value={hs?.direct_question_or_need} />
            <BriefField label="Relevant life event" value={hs?.relevant_life_event} />
            <BriefField label="Context use" value={hs?.context_use} />
            <BriefField label="Identity use" value={hs?.identity_use} />
            <BriefField label="Person use" value={hs?.person_use} />
            <BriefField label="Selected person" value={hs?.selected_person} />
            <BriefField label="Selected person reason" value={hs?.selected_person_reason} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-gray-500">Truth and evidence</p>
            <BriefField label="Latest user truth" value={te?.latest_user_truth} />
            <BriefField label="Outcome" value={te?.outcome} />
            <BriefField label="Evidence note" value={te?.evidence_note} />
            <BriefField label="Evidence strength" value={te?.evidence_strength} />
            <BriefField label="Consistency supported" value={te?.consistency_supported} />
            <BriefField label="Proof claims allowed" value={te?.proof_claims_allowed} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-gray-500">Conversation continuity</p>
            <BriefField label="Already acknowledged" value={cc?.already_acknowledged} />
            <BriefField label="Answered question" value={cc?.answered_question} />
            <BriefField label="Open loop" value={cc?.open_loop} />
            <BriefField label="Stale or exhausted topics" value={cc?.stale_or_exhausted_topics} />
            <BriefField label="Do not repeat" value={cc?.do_not_repeat} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-gray-500">Goal role today</p>
            <BriefField label="Canonical goal" value={gr?.canonical_goal} />
            <BriefField label="Pending goal" value={gr?.pending_goal} />
            <BriefField label="Goal alignment" value={gr?.goal_alignment} />
            <BriefField label="Role" value={gr?.role} />
            <BriefField label="Note" value={gr?.note} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-gray-500">Coaching direction</p>
            <BriefField label="Primary move" value={cd?.primary_move} />
            <BriefField label="Question policy" value={cd?.question_policy} />
            <BriefField label="Action guidance" value={cd?.action_guidance} />
            <BriefField label="Pressure" value={cd?.pressure} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-gray-500">Boundaries</p>
            <BriefField label="Claims to avoid" value={bd?.claims_to_avoid} />
            <BriefField label="Topics not to force" value={bd?.topics_not_to_force} />
            <BriefField label="Unsupported capabilities" value={bd?.unsupported_capabilities} />
            <BriefField label="Goal authority" value={bd?.goal_authority_boundaries} />
            <BriefField label="Identity/people boundaries" value={bd?.identity_people_boundaries} />
            <BriefField label="Coach history note" value={bd?.coach_history_is_not_style} />
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          {MORNING_BRIEF_PERSONAL_CONTEXT_HEADING}
        </h3>
        <BriefField label="Available identity" value={availableIdentity} />
        <BriefField label="Available important people" value={availablePeople} />
        <BriefField label="Identity use" value={hs?.identity_use} />
        <BriefField label="Person use" value={hs?.person_use} />
        <BriefField label="Context use" value={hs?.context_use} />
        <BriefField label="Selected person" value={hs?.selected_person} />
        <BriefField label="Why selected" value={hs?.selected_person_reason} />
      </div>

      {interpreter ? (
        <>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              {MORNING_BRIEF_INTERPRETER_INPUT_HEADING}
            </h3>
            <BriefField label="Exact canonical input" value={interpreter.exactInputObject} />
            <BriefField label="Exact system message" value={interpreter.exactSystemMessage} />
            <BriefField label="Exact user message" value={interpreter.exactUserMessage} />
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              {MORNING_BRIEF_INTERPRETER_OUTPUT_HEADING}
            </h3>
            <BriefField label="Model" value={interpreter.model} />
            <BriefField label="Reasoning effort" value={interpreter.reasoningEffort} />
            <BriefField label="Max completion tokens" value={interpreter.maxCompletionTokens} />
            <BriefField label="Temperature (actual)" value={interpreter.temperature} />
            <BriefField label="Latency ms" value={interpreter.latencyMs} />
            <BriefField label="Error" value={interpreter.error} />
            <BriefField label="Fallback brief used" value={interpreter.fallbackBriefUsed} />
            <BriefField label="Retry occurred" value={interpreter.retryOccurred} />
            <BriefField label="Retry succeeded" value={interpreter.retrySucceeded} />
            <BriefField label="Raw response" value={interpreter.rawResponse} />
            <BriefField label="Raw retry response" value={interpreter.rawRetryResponse} />
            <BriefField label="Parsed brief" value={interpreter.parsedBrief} />
          </div>
          <OpenAiErrorForensicBlock
            heading={TTO_INTERPRETER_OPENAI_ERROR_HEADING}
            error={interpreter.openaiError}
          />
        </>
      ) : null}

      {row.morningWriterCaptureV1 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            WRITER RAW RESPONSE
          </h3>
          <BriefField label="Model" value={row.morningWriterCaptureV1.model} />
          <BriefField
            label="Reasoning effort"
            value={row.morningWriterCaptureV1.reasoningEffort}
          />
          <BriefField
            label="Max completion tokens"
            value={row.morningWriterCaptureV1.maxCompletionTokens}
          />
          <BriefField
            label="Temperature (actual)"
            value={
              row.morningWriterCaptureV1.temperature === null
                ? "null (not sent)"
                : row.morningWriterCaptureV1.temperature
            }
          />
          <BriefField label="Latency ms" value={row.morningWriterCaptureV1.latencyMs} />
          <BriefField label="Error" value={row.morningWriterCaptureV1.error} />
          <BriefField label="Retry occurred" value={row.morningWriterCaptureV1.retryOccurred} />
          <BriefField label="Retry succeeded" value={row.morningWriterCaptureV1.retrySucceeded} />
          <BriefField label="Raw primary response" value={row.morningWriterCaptureV1.rawResponse} />
          <BriefField
            label="Raw retry response"
            value={row.morningWriterCaptureV1.rawRetryResponse}
          />
          <OpenAiErrorForensicBlock
            heading={TTO_WRITER_OPENAI_ERROR_HEADING}
            error={row.morningWriterCaptureV1.openaiError}
          />
        </div>
      ) : null}
    </div>
  );
}

function MorningTechnicalRetryPanel({ row }: { row: TylerTextOverviewAdminDraftRow }) {
  const retry = getMorningTechnicalRetrySectionCopy(row);
  if (!retry.show) return null;

  return (
    <section className="space-y-3 border-t border-gray-100 pt-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
        {retry.heading}
      </h2>
      <p className="text-xs font-medium text-amber-900">{retry.label}</p>
      <p className="text-xs text-gray-600">{retry.detail}</p>
      {retry.messages.length === 0 ? (
        <p className="text-sm text-gray-600">Retry occurred, but no retry messages were persisted.</p>
      ) : (
        <div className="space-y-3">
          {retry.messages.map((message, index) => (
            <div key={`${row.draftId ?? row.clerkUserId}-retry-${index}`}>
              <p className="text-xs font-semibold text-gray-600">{notebookLabel(message.role)}</p>
              <pre className="mt-1 overflow-x-auto rounded bg-amber-50 p-3 text-xs text-gray-800 whitespace-pre-wrap border border-amber-100">
                {message.content}
              </pre>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MorningAnchorPanel({ row }: { row: TylerTextOverviewAdminDraftRow }) {
  const hasAnchor =
    row.morningAnchorSource ||
    row.morningAnchorSent != null ||
    row.morningAnchorBodyPreview;

  if (!hasAnchor) {
    return (
      <p className="text-sm text-gray-600">
        No morning anchor metadata for this preview (generation may predate anchor capture).
      </p>
    );
  }

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-3 text-xs text-gray-700">
      <dl className="grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="font-medium text-gray-500">morning_anchor_source</dt>
          <dd className="font-mono">{formatOptional(row.morningAnchorSource)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">morning_anchor_sent</dt>
          <dd>{formatOptional(row.morningAnchorSent)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-medium text-gray-500">morning_anchor_body_preview</dt>
          <dd className="font-mono whitespace-pre-wrap break-words">
            {formatOptional(row.morningAnchorBodyPreview)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function PersistedMessageForPanel({ row }: { row: TylerTextOverviewAdminDraftRow }) {
  const line = formatPersistedMessageForLine(row.messageFor);
  const generated = formatGeneratedDeliveryLine(row);
  const scheduled = formatScheduledDeliveryLine(row);
  const original = row.morningRelationshipPacketV1?.existing_saved_text;
  const originalDelivery =
    original && typeof original === "object" && !Array.isArray(original)
      ? (original as { original_model_delivery?: { status?: string; describes_saved_body?: boolean } })
          .original_model_delivery
      : null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {TTO_MESSAGE_FOR_HEADING}
      </p>
      {line ? (
        <p className="text-sm text-gray-900">Stored generation context: {line}</p>
      ) : (
        <p className="text-sm text-gray-600">{TTO_MESSAGE_FOR_UNAVAILABLE}</p>
      )}
      {generated ? <p className="text-sm text-gray-700">{generated}</p> : null}
      {scheduled ? <p className="text-sm text-gray-700">Current {scheduled}</p> : null}
      {originalDelivery?.status === "known" ? (
        <p className="text-sm text-gray-700">
          Original model clock is stored on this generation
          {originalDelivery.describes_saved_body === false ? " and does not describe the saved body" : ""}.
        </p>
      ) : originalDelivery?.status === "unavailable" ? (
        <p className="text-sm text-gray-700">Original model clock is unavailable.</p>
      ) : null}
      {row.editedByTyler || row.currentBodySource === "tyler_edit" ? (
        <p className="text-sm text-gray-700">Current body is a Tyler edit. The Notebook remains the original writer input.</p>
      ) : null}
      {row.reconsiderationRecord ? (
        <p className="text-sm text-gray-700">{row.reconsiderationRecord}</p>
      ) : null}
    </div>
  );
}

function PersistedRelationshipPacketPanel({ row }: { row: TylerTextOverviewAdminDraftRow }) {
  const packet = row.morningRelationshipPacketV1;
  const threadMessages = getPersistedExactThreadMessages(packet);
  if (!packet) {
    return <p className="text-sm text-gray-600">{TTO_PERSISTED_PACKET_UNAVAILABLE}</p>;
  }

  const messageFor =
    packet.message_for && typeof packet.message_for === "object"
      ? (packet.message_for as Record<string, unknown>)
      : null;
  const exactThread =
    packet.exact_thread && typeof packet.exact_thread === "object"
      ? (packet.exact_thread as Record<string, unknown>)
      : null;

  return (
    <div className="space-y-4 text-xs text-gray-700">
      <dl className="grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="font-medium text-gray-500">packet version</dt>
          <dd className="font-mono">{formatOptional(packet.version as string | null)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">packet daypart</dt>
          <dd className="font-mono">
            {formatOptional(
              messageFor && typeof messageFor.daypart === "string"
                ? messageFor.daypart
                : null
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">exact_thread omitted_older_turn_count</dt>
          <dd>
            {formatOptional(
              exactThread && typeof exactThread.omitted_older_turn_count === "number"
                ? exactThread.omitted_older_turn_count
                : null
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">exact_thread message count</dt>
          <dd>{formatOptional(threadMessages?.length ?? null)}</dd>
        </div>
      </dl>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {TTO_PERSISTED_EXACT_THREAD_HEADING}
        </p>
        {!threadMessages || threadMessages.length === 0 ? (
          <p className="text-sm text-gray-600">{TTO_PERSISTED_EXACT_THREAD_UNAVAILABLE}</p>
        ) : (
          <div className="space-y-2">
            {threadMessages.map((msg, index) => (
              <div
                key={`${row.draftId ?? row.clerkUserId}-thread-${index}`}
                className="rounded border border-gray-200 bg-gray-50 p-2 space-y-1"
              >
                <p className="font-mono text-[11px] text-gray-500">
                  {formatOptional(msg.sender as string | null)} ·{" "}
                  {formatOptional(msg.sent_at_local as string | null)} ·{" "}
                  {formatOptional(msg.local_weekday as string | null)}
                </p>
                <pre className="whitespace-pre-wrap font-mono text-xs text-gray-800">
                  {typeof msg.body === "string" ? msg.body : "—"}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NotebookMessagesSection({ row }: { row: TylerTextOverviewAdminDraftRow }) {
  const { label, emptyMessage, messages } = getRawNotebookSectionCopy(row);

  if (emptyMessage) {
    return <p className="text-sm text-gray-600">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-3">
      {label ? <p className="text-xs text-gray-500">{label}</p> : null}
      {messages.map((message, index) => (
        <div key={`${row.draftId ?? row.clerkUserId}-${index}`}>
          <p className="text-xs font-semibold text-gray-600">{notebookLabel(message.role)}</p>
          <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-3 text-xs text-gray-800 whitespace-pre-wrap">
            {message.content}
          </pre>
        </div>
      ))}
    </div>
  );
}

function SlotCoachingContextPanel({ row }: { row: TylerTextOverviewAdminDraftRow }) {
  const ctx = row.slotCoachingContext;
  if (!ctx) {
    return (
      <p className="text-sm text-gray-600">
        No slot coaching context for this generation (writer brief may not have run).
      </p>
    );
  }

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-3 text-xs text-gray-700">
      <p className="text-xs text-gray-600">
        Notebook context for the coaching thread — interpretive guidance only, not a mandatory send
        rule.
      </p>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="font-medium text-gray-500">current_slot</dt>
          <dd className="font-mono">{formatOptional(ctx.currentSlot)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">previous_slot</dt>
          <dd className="font-mono">{formatOptional(ctx.previousSlot)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-medium text-gray-500">active_coaching_thread</dt>
          <dd className="whitespace-pre-wrap">{formatOptional(ctx.activeCoachingThread)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">slot_role_recommendation</dt>
          <dd className="font-mono">{formatOptional(ctx.slotRoleRecommendation)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">checkin_focus</dt>
          <dd className="whitespace-pre-wrap">{formatOptional(ctx.checkinFocus)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-medium text-gray-500">user_replies_since_previous_outbound</dt>
          <dd className="whitespace-pre-wrap">
            {formatOptional(ctx.userRepliesSincePreviousOutbound)}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">should_send_recommendation</dt>
          <dd className="font-mono">{formatOptional(ctx.shouldSendRecommendation)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">skip_reason_hint</dt>
          <dd className="font-mono break-all">{formatOptional(ctx.skipReasonHint)}</dd>
        </div>
      </dl>
    </div>
  );
}

const ADMIN_COUNT_KEYS: (keyof TylerTextOverviewAdminCounts)[] = [
  "sendableUsers",
  "noDraftYet",
  "draftCurrent",
  "draftCurrentReady",
  "draftCurrentTylerBlanked",
  "draftSent",
  "draftsMarkedSentDayTotal",
  "twilioAcceptedDayTotal",
  "draftSkipped",
  "machineShouldSendTrue",
  "machineShouldSendFalse",
  "generationLinkageErrors",
];

export default function TylerTextOverviewDashboard({ sendSlot }: TylerTextOverviewDashboardProps) {
  const searchParams = useSearchParams();
  const { getToken } = useAuth();
  const isEveningPage = isEveningDashboardSendSlot(sendSlot);

  const [rows, setRows] = useState<TylerTextOverviewAdminDraftRow[]>([]);
  const [historicalRows, setHistoricalRows] = useState<TylerTextOverviewAdminDraftRow[]>([]);
  const [batchStatistics, setBatchStatistics] = useState<TtoBatchStatistics | null>(null);
  const [loadedSelection, setLoadedSelection] = useState<{
    dayKey: string;
    slot: TylerTextOverviewDashboardSendSlot;
  } | null>(null);
  const [selectionLoadFailed, setSelectionLoadFailed] = useState(false);
  const loadedSelectionRef = useRef<{
    dayKey: string;
    slot: TylerTextOverviewDashboardSendSlot;
  } | null>(null);
  const [counts, setCounts] = useState<TylerTextOverviewAdminCounts | null>(null);
  const [manifest, setManifest] = useState<TylerTextOverviewManifestIntegrity | null>(null);
  const [manifestLoadError, setManifestLoadError] = useState<string | null>(null);
  const [dataStale, setDataStale] = useState(false);
  const [lastSuccessfulRefreshAt, setLastSuccessfulRefreshAt] = useState<string | null>(null);
  const [lastFailedRefreshAt, setLastFailedRefreshAt] = useState<string | null>(null);
  const [availableDayKeys, setAvailableDayKeys] = useState<string[]>([]);
  const [selectedDayKey, setSelectedDayKey] = useState<string>(() => {
    const fromUrl = searchParams.get("draft_for_day_key");
    if (isEveningPage) {
      return resolveEveningTtoInitialSelectedDayKey({ searchParamDayKey: fromUrl });
    }
    return resolveMorningTtoInitialSelectedDayKey({ searchParamDayKey: fromUrl });
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [edits, setEdits] = useState<EditState>({});
  const [saveFailures, setSaveFailures] = useState<SaveFailureState>({});
  const [loading, setLoading] = useState(true);
  const [hasCompletedSuccessfulLoad, setHasCompletedSuccessfulLoad] = useState(false);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [serverChangedWhileDirty, setServerChangedWhileDirty] = useState(false);
  const [bulkApplyText, setBulkApplyText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResultMessage, setBulkResultMessage] = useState<string | null>(null);
  const [generateAllBusy, setGenerateAllBusy] = useState(false);
  const [generateAllResultMessage, setGenerateAllResultMessage] = useState<string | null>(null);
  const [generateAllResumeAvailable, setGenerateAllResumeAvailable] = useState(false);
  const generateAllChainAbortRef = useRef(false);

  const loadGenerationRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const loadInFlightRef = useRef(false);
  const lastSuccessfulRefreshAtMsRef = useRef<number | null>(null);
  const editsRef = useRef<EditState>({});
  const rowsRef = useRef<TylerTextOverviewAdminDraftRow[]>([]);
  const saveAttemptRef = useRef<Record<string, number>>({});

  useEffect(() => {
    editsRef.current = edits;
  }, [edits]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  useEffect(() => {
    if (!lastSuccessfulRefreshAt) {
      lastSuccessfulRefreshAtMsRef.current = null;
      return;
    }
    const ms = Date.parse(lastSuccessfulRefreshAt);
    lastSuccessfulRefreshAtMsRef.current = Number.isFinite(ms) ? ms : null;
  }, [lastSuccessfulRefreshAt]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  }

  const mergeEditsPreservingDirty = useCallback(
    (nextRows: TylerTextOverviewAdminDraftRow[], prev: EditState, forceOverwrite: boolean) => {
      const next: EditState = {};
      let dirtyKept = false;
      for (const row of nextRows) {
        if (!row.draftId) continue;
        const id = row.draftId;
        const serverBody = row.currentBodyToSend ?? "";
        if (!forceOverwrite && Object.prototype.hasOwnProperty.call(prev, id)) {
          const local = prev[id] ?? "";
          if (local !== serverBody) {
            next[id] = local;
            dirtyKept = true;
            continue;
          }
        }
        next[id] = serverBody;
      }
      return { next, dirtyKept };
    },
    []
  );

  const load = useCallback(
    async (
      dayKey: string,
      slot: TylerTextOverviewDashboardSendSlot,
      opts?: { preserveUnsaved?: boolean; forceOverwrite?: boolean }
    ): Promise<boolean> => {
      const forceOverwrite = opts?.forceOverwrite === true;
      const preserveUnsaved = opts?.preserveUnsaved === true && !forceOverwrite;
      const generation = ++loadGenerationRef.current;
      loadAbortRef.current?.abort();
      const abort = new AbortController();
      loadAbortRef.current = abort;

      loadInFlightRef.current = true;
      setLoading(true);
      const requested = { dayKey: dayKey.trim(), slot };
      const previous = loadedSelectionRef.current;
      const sameSelection =
        previous != null && previous.dayKey === requested.dayKey && previous.slot === requested.slot;
      if (!sameSelection) setSelectionLoadFailed(false);
      const failSelectionLoad = (message: string) => {
        if (sameSelection) {
          setDataStale(true);
          setLastFailedRefreshAt(new Date().toISOString());
          setManifestLoadError(message);
          return;
        }
        loadedSelectionRef.current = requested;
        setLoadedSelection(requested);
        setSelectionLoadFailed(true);
        setRows([]);
        setHistoricalRows([]);
        setBatchStatistics(null);
        setCounts(null);
        setManifest(null);
        setDataStale(false);
        setLastFailedRefreshAt(new Date().toISOString());
        setManifestLoadError(message);
      };
      try {
        const params = new URLSearchParams();
        params.set("send_slot", slot);
        if (dayKey) {
          params.set("draft_for_day_key", dayKey);
        }
        // Search is applied client-side against the complete manifest.
        const res = await fetch(`/api/admin/tyler-text-overview?${params.toString()}`, {
          signal: abort.signal,
          cache: "no-store",
        });
        const json = await res.json();

        if (generation !== loadGenerationRef.current) {
          return false;
        }

        if (!res.ok || !json.ok) {
          const errMsg = json.error || "Could not load drafts.";
          showToast(errMsg);
          failSelectionLoad(errMsg);
          return false;
        }

        const nextRows = (json.rows || []) as TylerTextOverviewAdminDraftRow[];
        const nextManifest =
          (json.manifest as TylerTextOverviewManifestIntegrity | undefined) ?? null;
        const refreshedAt = nextManifest?.lastRefreshedAt ?? new Date().toISOString();
        setManifestLoadError(null);
        setDataStale(false);
        setManifest(nextManifest);
        setLastSuccessfulRefreshAt(refreshedAt);
        setHasCompletedSuccessfulLoad(true);
        const refreshedMs = Date.parse(refreshedAt);
        lastSuccessfulRefreshAtMsRef.current = Number.isFinite(refreshedMs)
          ? refreshedMs
          : Date.now();
        loadedSelectionRef.current = requested;
        setLoadedSelection(requested);
        setSelectionLoadFailed(false);
        setRows(nextRows);
        setHistoricalRows((json.historicalRows || []) as TylerTextOverviewAdminDraftRow[]);
        setBatchStatistics((json.batchStatistics as TtoBatchStatistics | null | undefined) ?? null);
        setCounts((json.counts as TylerTextOverviewAdminCounts | undefined) ?? null);
        setAvailableDayKeys((json.availableDayKeys || []) as string[]);

        const { next, dirtyKept } = mergeEditsPreservingDirty(
          nextRows,
          editsRef.current,
          forceOverwrite
        );
        setEdits(next);
        if (preserveUnsaved && dirtyKept) {
          setServerChangedWhileDirty(true);
        } else if (forceOverwrite) {
          setServerChangedWhileDirty(false);
          setSaveFailures({});
        }
        return true;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return false;
        }
        if (generation !== loadGenerationRef.current) {
          return false;
        }
        console.error("Failed to load Tyler Text Overview drafts", err);
        showToast("Could not load drafts.");
        failSelectionLoad("Could not load drafts.");
        return false;
      } finally {
        if (generation === loadGenerationRef.current) {
          loadInFlightRef.current = false;
          setLoading(false);
        }
      }
    },
    [mergeEditsPreservingDirty]
  );

  useEffect(() => {
    void load(selectedDayKey, sendSlot, { forceOverwrite: true });
    return () => {
      loadAbortRef.current?.abort();
    };
  }, [load, selectedDayKey, sendSlot]);

  useEffect(() => {
    if (isEveningPage) return;

    function onFocusOrVisible() {
      const gate = shouldSkipMorningTtoFocusRefresh({
        visibilityState: document.visibilityState,
        hasUnsavedEdits: hasAnyUnsavedEdits(rowsRef.current, editsRef.current, isEveningPage),
        loadInFlight: loadInFlightRef.current,
        lastSuccessfulRefreshAtMs: lastSuccessfulRefreshAtMsRef.current,
        nowMs: Date.now(),
      });
      if (gate.skip) {
        if (gate.reason === "dirty") {
          setServerChangedWhileDirty(true);
        }
        return;
      }
      void load(selectedDayKey, sendSlot, { preserveUnsaved: true });
    }

    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);
    return () => {
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
    };
  }, [isEveningPage, load, selectedDayKey, sendSlot]);

  async function handleManualRefresh() {
    if (hasAnyUnsavedEdits(rowsRef.current, editsRef.current, isEveningPage)) {
      const ok = window.confirm(
        "You have unsaved edits. Refresh anyway and discard local unsaved changes?"
      );
      if (!ok) return;
      await load(selectedDayKey, sendSlot, { forceOverwrite: true });
      return;
    }
    await load(selectedDayKey, sendSlot, { forceOverwrite: true });
  }

  function requestSelectedDayChange(nextDay: string) {
    if (nextDay === selectedDayKey) return;
    if (hasAnyUnsavedEdits(rowsRef.current, editsRef.current, isEveningPage)) {
      const ok = window.confirm(
        "You have unsaved edits. Change draft day and discard local unsaved changes?"
      );
      if (!ok) return;
    }
    setSelectedDayKey(nextDay);
  }

  const bulkUiSlot = isEveningPage ? ("evening_checkin" as const) : ("morning" as const);
  const bulkSlotLabel = isEveningPage ? "Evening" : "Morning";
  const pageBatchBusy = bulkBusy || generateAllBusy;

  type GenerateAllChunkResult = {
    targeted: number;
    generated: number;
    generated_complete: number;
    generated_texts?: number;
    intentional_spaces?: number;
    protectedTylerAuthority: number;
    protected_complete: number;
    skippedAlreadySent: number;
    already_sent: number;
    skippedNonCurrent: number;
    noncurrent: number;
    failed: number;
    pending: number;
    remaining: number;
    processed_this_chunk: number;
    is_complete: boolean;
    audience_clerk_user_ids: string[];
    failures: Array<{
      clerkUserId: string;
      preferredName: string | null;
      error: string;
      memberLocalDate?: string | null;
    }>;
  };

  type GenerateAllSnapshot = {
    draftForDayKey: string;
    sendSlot: string;
    audienceClerkUserIds: string[];
  };

  function readGenerateAllSnapshot(dayKey: string): GenerateAllSnapshot | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem(
        ttoGenerateAllSessionStorageKey({ sendSlot: bulkUiSlot, draftForDayKey: dayKey })
      );
      if (!raw) return null;
      const parsed = JSON.parse(raw) as GenerateAllSnapshot;
      if (
        !parsed ||
        parsed.draftForDayKey !== dayKey ||
        parsed.sendSlot !== bulkUiSlot ||
        !Array.isArray(parsed.audienceClerkUserIds) ||
        parsed.audienceClerkUserIds.length === 0
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function writeGenerateAllSnapshot(snapshot: GenerateAllSnapshot) {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(
      ttoGenerateAllSessionStorageKey({
        sendSlot: bulkUiSlot,
        draftForDayKey: snapshot.draftForDayKey,
      }),
      JSON.stringify(snapshot)
    );
  }

  function clearGenerateAllSnapshot(dayKey: string) {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(
      ttoGenerateAllSessionStorageKey({ sendSlot: bulkUiSlot, draftForDayKey: dayKey })
    );
  }

  useEffect(() => {
    const dayKey = selectedDayKey.trim();
    if (!dayKey) {
      setGenerateAllResumeAvailable(false);
      return;
    }
    setGenerateAllResumeAvailable(Boolean(readGenerateAllSnapshot(dayKey)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute when day/slot changes
  }, [selectedDayKey, bulkUiSlot]);

  const bulkCurrentDraftCount = useMemo(() => {
    return rows.filter((row) => canEditMorningDraft(row)).length;
  }, [rows]);

  const sendableAudienceCount = counts?.sendableUsers ?? rows.length;

  const bulkApplyNormalized = bulkApplyText.trim();
  const bulkApplyHasText = bulkApplyNormalized.length > 0;
  const bulkApplyOverTransportMax = ttoDraftBodyExceedsTransportMax(bulkApplyNormalized);
  const bulkApplyEnabled = bulkApplyHasText && !bulkApplyOverTransportMax;

  function selectionIsCurrent() {
    return (
      resolveTtoDashboardSelectionView({
        selectedDayKey,
        selectedSlot: sendSlot,
        loadedDayKey: loadedSelection?.dayKey ?? null,
        loadedSlot: loadedSelection?.slot ?? null,
        loading,
        selectionLoadFailed,
      }) === "current"
    );
  }

  async function runGenerateAll() {
    const dayKey = selectedDayKey.trim();
    if (!dayKey || pageBatchBusy || !selectionIsCurrent()) return;

    const existingSnapshot = readGenerateAllSnapshot(dayKey);
    const resumeAvailable = Boolean(existingSnapshot);

    const confirmed = window.confirm(
      formatTtoGenerateAllConfirm({
        slot: bulkUiSlot,
        draftForDayKey: dayKey,
        audienceCount: sendableAudienceCount,
        searchActive: Boolean(searchQuery.trim()),
        resumeAvailable,
      })
    );
    if (!confirmed) return;

    setGenerateAllBusy(true);
    setGenerateAllResultMessage(null);
    generateAllChainAbortRef.current = false;

    const excludeOccurrenceKeys: string[] = [];
    let audienceClerkUserIds = existingSnapshot?.audienceClerkUserIds ?? null;
    let lastResult: GenerateAllChunkResult | null = null;

    try {
      for (;;) {
        if (generateAllChainAbortRef.current) break;

        const token = await getToken();
        if (typeof token !== "string" || token.trim().length === 0) {
          throw new Error("missing_clerk_session_token");
        }

        const res = await fetch(ttoGenerateAllEndpoint(bulkUiSlot), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            draft_for_day_key: dayKey,
            ...(audienceClerkUserIds
              ? { audience_clerk_user_ids: audienceClerkUserIds }
              : {}),
            ...(excludeOccurrenceKeys.length > 0
              ? { exclude_occurrence_keys: excludeOccurrenceKeys }
              : {}),
          }),
        });
        const json = await res.json();

        if (!res.ok || !json.result) {
          const msg = json.error || "Generate All failed.";
          setGenerateAllResultMessage(msg);
          showToast(msg);
          break;
        }

        const result = json.result as GenerateAllChunkResult;
        lastResult = result;
        audienceClerkUserIds = result.audience_clerk_user_ids;

        writeGenerateAllSnapshot({
          draftForDayKey: dayKey,
          sendSlot: bulkUiSlot,
          audienceClerkUserIds,
        });
        setGenerateAllResumeAvailable(true);

        for (const failure of result.failures) {
          if (!failure.memberLocalDate) continue;
          const key = `${failure.clerkUserId}|${failure.memberLocalDate}`;
          if (!excludeOccurrenceKeys.includes(key)) excludeOccurrenceKeys.push(key);
        }

        const progress = formatTtoGenerateAllProgressLine({
          generatedComplete: result.generated_complete,
          targeted: result.targeted,
          failed: result.failed,
          remaining: result.remaining,
          generatedTexts: result.generated_texts,
          intentionalSpaces: result.intentional_spaces,
        });
        setGenerateAllResultMessage(
          formatTtoGenerateAllResultMessage({
            slot: bulkUiSlot,
            targeted: result.targeted,
            generated_complete: result.generated_complete,
            generatedTexts: result.generated_texts,
            intentionalSpaces: result.intentional_spaces,
            protected_complete: result.protected_complete,
            already_sent: result.already_sent,
            noncurrent: result.noncurrent,
            failed: result.failed,
            pending: result.pending,
            remaining: result.remaining,
            failures: result.failures,
          })
        );
        showToast(progress);

        if (result.is_complete) {
          clearGenerateAllSnapshot(dayKey);
          setGenerateAllResumeAvailable(false);
          break;
        }

        // No work started this chunk — remaining users are excluded failures or budget-empty.
        // Do not endlessly re-attempt the same failures in this auto-chain.
        if (result.processed_this_chunk === 0) {
          break;
        }
      }

      await load(dayKey, sendSlot, { forceOverwrite: true });

      if (lastResult?.is_complete) {
        showToast(
          formatTtoGenerateAllProgressLine({
            generatedComplete: lastResult.generated_complete,
            targeted: lastResult.targeted,
            failed: lastResult.failed,
            remaining: lastResult.remaining,
            generatedTexts: lastResult.generated_texts,
            intentionalSpaces: lastResult.intentional_spaces,
          })
        );
      } else if (lastResult && lastResult.remaining > 0) {
        showToast(
          `Generate All paused: ${formatTtoGenerateAllProgressLine({
            generatedComplete: lastResult.generated_complete,
            targeted: lastResult.targeted,
            failed: lastResult.failed,
            remaining: lastResult.remaining,
            generatedTexts: lastResult.generated_texts,
            intentionalSpaces: lastResult.intentional_spaces,
          })}`
        );
      }
    } catch (err) {
      console.error(`${bulkSlotLabel} Generate All failed`, err);
      const msg = "Generate All failed.";
      setGenerateAllResultMessage(msg);
      showToast(msg);
    } finally {
      setGenerateAllBusy(false);
    }
  }

  async function runFailedOnlyRetry() {
    const dayKey = selectedDayKey.trim();
    const failureCount = batchStatistics?.confirmedFailureCount ?? 0;
    if (!dayKey || pageBatchBusy || !selectionIsCurrent() || batchStatistics?.retrieval !== "ok" || failureCount < 1) return;
    const confirmed = window.confirm(
      `Retry ${failureCount} failed generation${failureCount === 1 ? "" : "s"}? This does not generate pending texts, replace saved texts, or change the original batch time.`
    );
    if (!confirmed) return;

    setGenerateAllBusy(true);
    setGenerateAllResultMessage(null);
    const excludeOccurrenceKeys: string[] = [];
    let lastFailed = 0;
    let attempted = 0;
    try {
      for (;;) {
        const token = await getToken();
        if (typeof token !== "string" || token.trim().length === 0) {
          throw new Error("missing_clerk_session_token");
        }
        const res = await fetch(ttoGenerateAllEndpoint(bulkUiSlot), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            draft_for_day_key: dayKey,
            failed_only: true,
            ...(excludeOccurrenceKeys.length > 0
              ? { exclude_occurrence_keys: excludeOccurrenceKeys }
              : {}),
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.result) {
          const msg = json.error || "Failed-generation retry failed.";
          setGenerateAllResultMessage(msg);
          showToast(msg);
          break;
        }
        const result = json.result as GenerateAllChunkResult;
        attempted += result.processed_this_chunk;
        lastFailed = result.failures.length;
        for (const failure of result.failures) {
          if (!failure.memberLocalDate) continue;
          const key = `${failure.clerkUserId}|${failure.memberLocalDate}`;
          if (!excludeOccurrenceKeys.includes(key)) excludeOccurrenceKeys.push(key);
        }
        if (result.processed_this_chunk === 0) break;
      }
      await load(dayKey, sendSlot, { forceOverwrite: true });
      const message = `Failed-generation retry finished. Work recorded this run: ${attempted}. Failures still reported in the last step: ${lastFailed}. Original batch clocks stay unchanged.`;
      setGenerateAllResultMessage(message);
      showToast("Failed-generation retry finished.");
    } catch (err) {
      console.error(`${bulkSlotLabel} failed-only retry failed`, err);
      const msg = "Failed-generation retry failed.";
      setGenerateAllResultMessage(msg);
      showToast(msg);
    } finally {
      setGenerateAllBusy(false);
    }
  }

  async function runBulkSave(args: {
    operation: "blank_all" | "apply_all";
    body?: string;
  }) {
    const dayKey = selectedDayKey.trim();
    if (!dayKey || pageBatchBusy || !selectionIsCurrent()) return;

    setBulkBusy(true);
    setBulkResultMessage(null);
    try {
      const res = await fetch(ttoBulkSaveEndpoint(bulkUiSlot), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft_for_day_key: dayKey,
          operation: args.operation,
          ...(args.operation === "apply_all" ? { body: args.body ?? "" } : {}),
          displayed_deliveries: rows.flatMap((row) => {
            const displayed = displayedDeliveryFromRow(row);
            return displayed ? [displayed] : [];
          }),
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.result) {
        const msg = json.error || "Bulk save failed.";
        setBulkResultMessage(msg);
        showToast(msg);
        return;
      }

      const result = json.result as {
        updated: number;
        skippedNonCurrent: number;
        skippedMissing: number;
        failed: Array<{ clerkUserId: string; preferredName: string | null; error: string }>;
        textsSentByThisAction: number;
      };
      const message = isEveningPage
        ? formatEveningBulkResultMessage(result)
        : formatMorningBulkResultMessage(result);
      setBulkResultMessage(message);
      showToast(
        result.failed.length > 0
          ? `Bulk save partial: ${result.updated} updated, ${result.failed.length} failed.`
          : `Bulk save: ${result.updated} ${bulkSlotLabel} drafts updated.`
      );

      await load(dayKey, sendSlot, { forceOverwrite: true });
    } catch (err) {
      console.error(`${bulkSlotLabel} bulk save failed`, err);
      const msg = "Bulk save failed.";
      setBulkResultMessage(msg);
      showToast(msg);
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleBlankAllTexts() {
    const dayKey = selectedDayKey.trim();
    if (!dayKey || pageBatchBusy) return;
    const ok = window.confirm(
      formatTtoBulkBlankConfirm({
        slot: bulkUiSlot,
        draftForDayKey: dayKey,
        currentDraftCount: bulkCurrentDraftCount,
      })
    );
    if (!ok) return;
    await runBulkSave({ operation: "blank_all" });
  }

  async function handleApplyTextToAll() {
    const dayKey = selectedDayKey.trim();
    if (!dayKey || pageBatchBusy || !bulkApplyEnabled) return;
    const ok = window.confirm(
      formatTtoBulkApplyConfirm({
        slot: bulkUiSlot,
        draftForDayKey: dayKey,
        currentDraftCount: bulkCurrentDraftCount,
        body: bulkApplyNormalized,
      })
    );
    if (!ok) return;
    await runBulkSave({ operation: "apply_all", body: bulkApplyText });
  }

  async function saveDraft(row: TylerTextOverviewAdminDraftRow) {
    if (!row.draftId) return;
    if (pageBatchBusy || !selectionIsCurrent()) return;
    const draftId = row.draftId;
    const submittedBody = editsRef.current[draftId] ?? "";
    const submittedTransportBody = submittedBody.trim();
    if (ttoDraftBodyExceedsTransportMax(submittedTransportBody)) {
      const msg = formatTtoBodyOverTransportMaxCopy(submittedTransportBody.length);
      setSaveFailures((prev) => ({ ...prev, [draftId]: msg }));
      showToast(msg);
      return;
    }
    const attempt = (saveAttemptRef.current[draftId] ?? 0) + 1;
    saveAttemptRef.current[draftId] = attempt;
    setSavingDraftId(draftId);
    setSaveFailures((prev) => {
      const next = { ...prev };
      delete next[draftId];
      return next;
    });
    try {
      const res = await fetch(`/api/admin/tyler-text-overview/${encodeURIComponent(draftId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentBodyToSend: submittedBody,
          displayedDelivery: displayedDeliveryFromRow(row),
        }),
      });
      const json = await res.json();

      if (saveAttemptRef.current[draftId] !== attempt) {
        return;
      }

      if (!res.ok || !json.ok || !json.row) {
        const msg = json.error || "Save failed.";
        setSaveFailures((prev) => ({ ...prev, [draftId]: msg }));
        showToast(msg);
        return;
      }

      const updated = json.row as TylerTextOverviewAdminDraftRow;
      const verifyError = verifyPersistedSaveRow(updated, draftId, submittedBody);
      if (verifyError) {
        setSaveFailures((prev) => ({ ...prev, [draftId]: verifyError }));
        showToast(verifyError);
        return;
      }

      const persistedBody = updated.currentBodyToSend ?? "";
      const localNow = editsRef.current[draftId] ?? "";
      const concurrentEdit = localNow !== submittedBody;

      setEdits((prev) => {
        const next = { ...prev };
        if (concurrentEdit) {
          // Keep newer local text; baseline conceptually moves to persistedBody via row refresh.
          next[draftId] = localNow;
        } else {
          next[draftId] = persistedBody;
        }
        return next;
      });

      const reloaded = await load(selectedDayKey, sendSlot, {
        preserveUnsaved: true,
        forceOverwrite: false,
      });

      if (saveAttemptRef.current[draftId] !== attempt) {
        return;
      }

      if (!reloaded) {
        setSaveFailures((prev) => ({
          ...prev,
          [draftId]: MORNING_SAVE_RELOAD_FAILED_COPY,
        }));
        setDataStale(true);
        setManifestLoadError(MORNING_SAVE_RELOAD_FAILED_COPY);
        showToast(MORNING_SAVE_RELOAD_FAILED_COPY);
        return;
      }

      if (concurrentEdit) {
        setServerChangedWhileDirty(true);
        showToast("Saved on server, but you have newer unsaved local edits.");
        return;
      }

      if (!isEveningPage) {
        showToast(formatMorningTtoSaveToast(updated.currentBodyToSend));
      } else {
        showToast("Saved.");
      }
    } catch (err) {
      console.error("Failed to save draft", err);
      setSaveFailures((prev) => ({ ...prev, [draftId]: "Save failed." }));
      showToast("Save failed.");
    } finally {
      if (saveAttemptRef.current[draftId] === attempt) {
        setSavingDraftId(null);
      }
    }
  }

  const siblingPageHref = buildSiblingTylerTextOverviewPageHref({
    page: isEveningPage ? "morning" : "evening",
    draftForDayKey: selectedDayKey,
  });
  const siblingPageLabel = isEveningPage ? "Morning Text Overview →" : "Evening Text Overview →";
  const showEveningNonTodayWarning =
    isEveningPage && shouldShowEveningNonTodayWarning(selectedDayKey);
  const dayFilterOptions = (() => {
    const keys = [...availableDayKeys];
    const selected = selectedDayKey.trim();
    if (selected && !keys.includes(selected)) {
      keys.push(selected);
      keys.sort((a, b) => b.localeCompare(a));
    }
    return keys;
  })();

  const selectionView = resolveTtoDashboardSelectionView({
    selectedDayKey,
    selectedSlot: sendSlot,
    loadedDayKey: loadedSelection?.dayKey ?? null,
    loadedSlot: loadedSelection?.slot ?? null,
    loading,
    selectionLoadFailed,
  });
  const showLoadedDashboard = selectionView === "current";

  const visibleRows = useMemo(() => {
    const match = (row: TylerTextOverviewAdminDraftRow) =>
      !searchQuery.trim() || matchesTylerTextOverviewSearchQuery(row, searchQuery);
    return [...rows.filter(match), ...historicalRows.filter(match)];
  }, [historicalRows, rows, searchQuery]);

  const showFullPageLoader = shouldShowTtoFullPageLoader({
    loading,
    rowCount: rows.length,
    hasCompletedSuccessfulLoad,
  });
  const backgroundRefreshing = shouldShowTtoBackgroundRefreshing({
    loading,
    showFullPageLoader,
  });

  const showTrustBanner =
    selectionView !== "loading_selection" &&
    (Boolean(manifestLoadError) ||
      dataStale ||
      Boolean(selectedDayKey.trim() && manifest && !manifest.manifestComplete));

  return (
    <div className="space-y-6">
      {toast ? (
        <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {toast}
        </p>
      ) : null}

      {showTrustBanner ? (
        <div
          className="rounded-md border border-red-400 bg-red-50 px-4 py-3 text-sm text-red-950"
          role="alert"
        >
          <p className="font-semibold">
            {dataStale || manifestLoadError
              ? TTO_DATA_STALE_OR_INCOMPLETE_BANNER
              : TTO_MANIFEST_INCOMPLETE_BANNER}
          </p>
          {manifestLoadError ? (
            <p className="mt-1 font-mono text-xs break-all">{manifestLoadError}</p>
          ) : null}
          {manifest?.incompletenessReason ? (
            <p className="mt-1 font-mono text-xs">{manifest.incompletenessReason}</p>
          ) : null}
          {dataStale && showLoadedDashboard ? (
            <p className="mt-2 text-xs">
              Stale data for {loadedSelection?.dayKey || "all current days"} ({sendSlot}). It is not
              another date.
            </p>
          ) : null}
          <p className="mt-2 text-xs">
            Last successful refresh (Eastern):{" "}
            {formatLastRefreshedAt(lastSuccessfulRefreshAt ?? manifest?.lastRefreshedAt)}
            {lastFailedRefreshAt
              ? ` · Last failed refresh: ${formatLastRefreshedAt(lastFailedRefreshAt)}`
              : ""}
          </p>
          <button
            type="button"
            className="mt-2 rounded border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-950"
            onClick={() => void handleManualRefresh()}
          >
            Retry
          </button>
        </div>
      ) : null}

      {!isEveningPage && !selectedDayKey.trim() ? (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="status"
        >
          <p>{TTO_MANIFEST_SELECT_DAY_COPY}</p>
        </div>
      ) : null}

      {serverChangedWhileDirty ? (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="status"
        >
          <p>
            Server data may have changed while you have unsaved edits. Unsaved local text was kept.
            Save or discard edits, then Refresh.
          </p>
        </div>
      ) : null}

      <div
        className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        role="alert"
      >
        <p>{MORNING_TTO_AUTHORITY_BANNER}</p>
      </div>

      {showEveningNonTodayWarning ? (
        <div
          className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-950"
          role="alert"
        >
          <p>{EVENING_TTO_NON_TODAY_WARNING}</p>
        </div>
      ) : null}

      <p className="text-sm">
        <Link href={siblingPageHref} className="font-medium text-gray-900 underline">
          {siblingPageLabel}
        </Link>
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="font-medium text-gray-700">Draft day</span>
          <select
            className="mt-1 block rounded border border-gray-300 bg-white px-3 py-2 text-sm"
            value={selectedDayKey}
            onChange={(e) => requestSelectedDayChange(e.target.value)}
          >
            <option value="">All current days</option>
            {dayFilterOptions.map((dayKey) => (
              <option key={dayKey} value={dayKey}>
                {dayKey}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm min-w-[220px] flex-1">
          <span className="font-medium text-gray-700">Search</span>
          <input
            type="search"
            className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
            placeholder="Name, phone, or clerk_user_id"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">
            Last refreshed (Eastern): {formatLastRefreshedAt(manifest?.lastRefreshedAt)}
            {backgroundRefreshing ? " · Refreshing…" : ""}
          </span>
          <button
            type="button"
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 disabled:opacity-50"
            disabled={loading}
            onClick={() => void handleManualRefresh()}
          >
            {backgroundRefreshing || loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {showLoadedDashboard && selectedDayKey.trim() && batchStatistics ? (
        <div className="rounded-md border border-gray-300 bg-white px-4 py-4 space-y-2">
          <h2 className="text-sm font-semibold text-gray-900">Generation statistics</h2>
          <p className="text-sm text-gray-900">{batchStatusLabel(batchStatistics.status)}</p>
          {batchStatistics.retrieval === "unavailable" ? (
            <p className="text-sm text-red-900">
              The batch record could not be read{batchStatistics.error ? `: ${batchStatistics.error}` : ""}.
              Counts are not shown.
            </p>
          ) : batchStatistics.retrieval === "missing" ? (
            <p className="text-sm text-gray-600">No generation batch has been opened for this day.</p>
          ) : (
            <>
              <p className="text-xs text-gray-700">
                Started ({batchStatistics.openedTrigger === "manual_schedule" ? "manual" : "automatic"}
                ): {formatEasternAdminClock(batchStatistics.startedAt)}
                {" · "}
                Initial pass completed: {formatEasternAdminClock(batchStatistics.initialCompletedAt)}
                {" · "}
                Duration: {formatElapsedDuration(batchStatistics.elapsedMs) ?? "not completed"}
              </p>
              <p className="text-xs text-gray-700">
                Relevant members: {batchStatistics.relevantMemberCount ?? "—"}
                {" · "}
                Scheduled members: initial {batchStatistics.initialScheduledMemberCount ?? "—"}, current{" "}
                {batchStatistics.currentScheduledMemberCount ?? "—"}
                {" · "}
                Occurrences: initial {batchStatistics.initialScheduledOccurrenceCount ?? "—"}, current{" "}
                {batchStatistics.currentScheduledOccurrenceCount ?? "—"}
              </p>
              <p className="text-xs text-gray-700">
                Initial pass: {outcomeSummary(batchStatistics.initialOutcomes)}
              </p>
              <p className="text-xs text-gray-700">
                Current results: {outcomeSummary(batchStatistics.currentOutcomes)}
              </p>
              <p className="text-xs text-gray-700">
                Unscheduled members: {batchStatistics.unscheduledMemberCount}
                {" · "}
                Unresolved scheduling: {batchStatistics.unresolvedMemberCount}
                {batchStatistics.latePendingOrClaimedCount > 0
                  ? ` · Later pending or claimed work: ${batchStatistics.latePendingOrClaimedCount}`
                  : ""}
              </p>
              {batchStatistics.currentOutcomes &&
              batchStatistics.currentOutcomes.legacyConflict +
                batchStatistics.currentOutcomes.expired +
                batchStatistics.currentOutcomes.ineligible >
                0 ? (
                <p className="text-xs text-gray-700">
                  Other blocked outcomes: legacy conflicts {batchStatistics.currentOutcomes.legacyConflict}
                  , expired {batchStatistics.currentOutcomes.expired}, ineligible{" "}
                  {batchStatistics.currentOutcomes.ineligible}
                </p>
              ) : null}
              {batchStatistics.confirmedFailureCount > 0 ? (
                <button
                  type="button"
                  className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 disabled:opacity-50"
                  disabled={pageBatchBusy || loading}
                  onClick={() => void runFailedOnlyRetry()}
                >
                  {generateAllBusy
                    ? "Working…"
                    : `Retry ${batchStatistics.confirmedFailureCount} failed generation${batchStatistics.confirmedFailureCount === 1 ? "" : "s"}`}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {showLoadedDashboard ? (
      <div className="rounded-md border border-gray-300 bg-white px-4 py-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">
          Generate {bulkSlotLabel} for selected day
        </h2>
        {!selectedDayKey.trim() ? (
          <p className="text-sm text-amber-900">{TTO_GENERATE_ALL_SELECT_DAY_HINT}</p>
        ) : (
          <>
            {searchQuery.trim() ? (
              <p className="text-xs text-amber-900">{TTO_GENERATE_ALL_SEARCH_WARNING}</p>
            ) : null}
            <p className="text-xs text-gray-600">
              Creates/refreshes drafts for the full sendable audience ({sendableAudienceCount}) on{" "}
              <span className="font-mono">{selectedDayKey}</span> in resumable chunks (concurrency 2).
              Does not send texts. Search does not narrow generation. Already-completed machine drafts,
              Tyler-protected edits/blanks, already-sent, and non-current slots are skipped on Resume.
              {" "}
              {"Delivery follows each member's saved schedule. Morning and Evening are the batch labels, not the delivery clock."}
            </p>
            <button
              type="button"
              className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={pageBatchBusy || !selectedDayKey.trim() || loading}
              onClick={() => void runGenerateAll()}
            >
              {ttoGenerateAllButtonLabel({
                slot: bulkUiSlot,
                draftForDayKey: selectedDayKey,
                isBusy: generateAllBusy,
                resumeAvailable: generateAllResumeAvailable,
              })}
            </button>
            {generateAllResultMessage ? (
              <pre
                className={`whitespace-pre-wrap rounded border px-3 py-2 text-xs ${
                  generateAllResultMessage.includes("Failed")
                    ? "border-amber-300 bg-amber-50 text-amber-950"
                    : "border-green-200 bg-green-50 text-green-900"
                }`}
              >
                {generateAllResultMessage}
              </pre>
            ) : null}
          </>
        )}
      </div>
      ) : null}

      {showLoadedDashboard ? (
      <div className="rounded-md border border-gray-300 bg-white px-4 py-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">
          {ttoBulkActionsHeading(bulkUiSlot)}
        </h2>
        {!selectedDayKey.trim() ? (
          <p className="text-sm text-amber-900">{ttoBulkSelectDayHint(bulkUiSlot)}</p>
        ) : (
          <>
            {searchQuery.trim() ? (
              <p className="text-xs text-amber-900">{ttoBulkSearchWarning(bulkUiSlot)}</p>
            ) : null}
            <p className="text-xs text-gray-600">
              Targets all {bulkCurrentDraftCount} current unsent {bulkSlotLabel} drafts for{" "}
              <span className="font-mono">{selectedDayKey}</span>. Already-sent and missing drafts
              are skipped. Does not send texts. Delivery follows each member&apos;s saved schedule.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 disabled:opacity-50"
                disabled={pageBatchBusy || !selectedDayKey.trim() || loading}
                onClick={() => void handleBlankAllTexts()}
              >
                {bulkBusy ? "Working…" : "Blank all texts"}
              </button>
            </div>
            <div className="space-y-2">
              <label className="block text-sm">
                <span className="font-medium text-gray-700">Apply same text to all</span>
                <textarea
                  className="mt-1 block w-full min-h-[88px] rounded border border-gray-300 bg-white px-3 py-2 text-sm font-mono"
                  value={bulkApplyText}
                  disabled={pageBatchBusy || !selectedDayKey.trim()}
                  onChange={(e) => setBulkApplyText(e.target.value)}
                  placeholder={`Exact text to save for every current ${bulkSlotLabel} draft`}
                />
              </label>
              {bulkApplyHasText ? (
                <p className="text-xs text-gray-600">
                  {formatTtoBodyCharCount(bulkApplyNormalized.length)}
                </p>
              ) : null}
              {ttoDraftBodyShouldSoftWarnLength(bulkApplyNormalized) ? (
                <p className="text-xs text-amber-800">{TTO_BODY_SOFT_LENGTH_WARNING}</p>
              ) : null}
              {bulkApplyOverTransportMax ? (
                <p className="text-xs text-red-800">
                  {formatTtoBodyOverTransportMaxCopy(bulkApplyNormalized.length)}
                </p>
              ) : null}
              {!bulkApplyHasText ? (
                <p className="text-xs text-gray-600">{ttoBulkApplyEmptyHint(bulkUiSlot)}</p>
              ) : null}
              <button
                type="button"
                className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={pageBatchBusy || !selectedDayKey.trim() || loading || !bulkApplyEnabled}
                onClick={() => void handleApplyTextToAll()}
              >
                {bulkBusy ? "Working…" : "Apply text to all"}
              </button>
            </div>
            {bulkResultMessage ? (
              <pre
                className={`whitespace-pre-wrap rounded border px-3 py-2 text-xs ${
                  bulkResultMessage.includes("\nFailed:")
                    ? "border-amber-300 bg-amber-50 text-amber-950"
                    : "border-green-200 bg-green-50 text-green-900"
                }`}
              >
                {bulkResultMessage}
              </pre>
            ) : null}
          </>
        )}
      </div>
      ) : null}

      {showLoadedDashboard && counts ? (
        <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800">
          <p className="font-medium text-gray-900">Sendable audience (global manifest)</p>
          <dl className="mt-2 grid gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {ADMIN_COUNT_KEYS.map((key) => (
              <div key={key}>
                <dt className="text-xs text-gray-500">{adminCountLabel(key, sendSlot)}</dt>
                <dd className={key === "sendableUsers" ? "font-semibold" : undefined}>
                  {key === "twilioAcceptedDayTotal" && counts[key] == null
                    ? "Unavailable"
                    : counts[key]}
                </dd>
              </div>
            ))}
          </dl>
          {searchQuery.trim() ? (
            <p className="mt-3 text-xs text-gray-600">
              {TTO_FILTERED_ROWS_LABEL}: {visibleRows.length} (search does not change global counts)
            </p>
          ) : null}
        </div>
      ) : null}

      {selectionView === "loading_selection" ? (
        <p className="text-sm text-gray-500">Loading sendable users…</p>
      ) : selectionView === "unavailable" ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-950">
          This date could not be loaded. Statistics and drafts are not shown.
        </p>
      ) : showFullPageLoader ? (
        <p className="text-sm text-gray-500">Loading sendable users…</p>
      ) : visibleRows.length === 0 ? (
        <p className="text-sm text-gray-500">No sendable users match this filter.</p>
      ) : (
        <ul className="space-y-8">
          {visibleRows.map((row, index) => {
            const showHistoricalHeading =
              row.rowRole === "historical_legacy" &&
              visibleRows[index - 1]?.rowRole !== "historical_legacy";
            const eveningRow = isEveningPreviewRow(row);
            const eveningSent = eveningRow && isEveningDraftSent(row);
            const morningSent = !eveningRow && isMorningDraftSent(row);
            const eveningEditable = isEveningPage && canEditEveningDraft(row);
            const morningEditable = !isEveningPage && canEditMorningDraft(row) && !morningSent;
            const canEditBody = eveningEditable || morningEditable;
            const eveningDirty = eveningEditable && isEveningDraftDirty(row, edits);
            const morningDirty = morningEditable && isMorningDraftDirty(row, edits);
            const isDirty = eveningDirty || morningDirty;
            const editorBody = canEditBody ? (edits[row.draftId as string] ?? "") : "";
            const editorTransportBody = editorBody.trim();
            const editorOverTransportMax =
              ttoDraftBodyExceedsTransportMax(editorTransportBody);
            const saveFailedMsg =
              row.draftId && saveFailures[row.draftId] ? saveFailures[row.draftId] : null;
            const isSavingThis = Boolean(row.draftId) && savingDraftId === row.draftId;
            const tylerBlanked =
              !isEveningPage &&
              isTylerBlankedMorningDraftRow({
                rowState: row.rowState,
                editedByTyler: row.editedByTyler,
                currentBodySource: row.currentBodySource,
                currentBodyToSend: row.currentBodyToSend,
              });
            const missingMorningDraft =
              !isEveningPage && row.rowState === "no_draft_yet" && !row.draftId;
            const readOnlyBody =
              (eveningSent || morningSent) && row.finalBodySent?.trim()
                ? row.finalBodySent
                : row.currentBodyToSend;
            const eveningEmptyBodyCopy =
              isEveningPage &&
              eveningRow &&
              !(
                readOnlyBody?.trim() ||
                (row.draftId ? edits[row.draftId]?.trim() : "")
              )
                ? row.rowState === "no_draft_yet"
                  ? { primary: EVENING_TTO_NO_PREVIEW_COPY, secondary: null }
                  : formatEveningEmptyBodyPanelCopy({
                      machineShouldSend: row.machineShouldSend,
                      machineNoSendReason: row.machineNoSendReason,
                    })
                : null;
            const morningDualBody = shouldShowMorningDualBodyPanels(row, isEveningPage);
            const solForensicPanels = shouldShowSolForensicPanels(row);
            const showEveningMorningAnchor = shouldShowEveningMorningAnchorPanel(
              row,
              isEveningPage
            );
            const currentBodyHeading = morningDualBody
              ? isEveningPage
                ? EVENING_CURRENT_BODY_HEADING
                : MORNING_CURRENT_BODY_HEADING
              : "current_body_to_send";
            const currentBodyLabel = isEveningPage
              ? EVENING_CURRENT_BODY_LABEL
              : MORNING_CURRENT_BODY_LABEL;
            const currentBodyBlank = isEveningPage
              ? EVENING_CURRENT_BODY_BLANK
              : MORNING_CURRENT_BODY_BLANK;
            const morningSendabilityCopy =
              !isEveningPage && !morningSent && !missingMorningDraft && !isDirty
                ? formatMorningTtoSendabilityCopy({
                    editedByTyler: row.editedByTyler,
                    currentBodySource: row.currentBodySource,
                    currentBodyToSend: row.currentBodyToSend,
                    machineShouldSend: row.machineShouldSend,
                  })
                : null;

            return (
              <Fragment key={rowListKey(row)}>
              {showHistoricalHeading ? (
                <li className="list-none rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                  <h2 className="text-sm font-semibold text-gray-900">Historical drafts</h2>
                  <p className="mt-1 text-xs text-gray-600">
                    These drafts are not part of this scheduled batch. Batch bulk save and
                    failed-only retry do not include them.
                  </p>
                </li>
              ) : null}
              <li
                className={`rounded-xl border p-5 shadow-sm space-y-5 ${
                  missingMorningDraft
                    ? "border-red-300 bg-red-50/40"
                    : tylerBlanked
                      ? "border-amber-300 bg-amber-50/30"
                      : "border-gray-200 bg-white"
                }`}
              >
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                      Admin only
                    </h2>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">
                      {rowStateLabel(row.rowState, sendSlot)}
                    </span>
                    {missingMorningDraft ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">
                        {MORNING_MISSING_DRAFT_BANNER}
                      </span>
                    ) : null}
                    {tylerBlanked && !isDirty ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-950">
                        {MORNING_TYLER_BLOCKED_LABEL}
                      </span>
                    ) : null}
                    {row.generationLinkageError ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">
                        GENERATION LINKAGE ERROR
                      </span>
                    ) : null}
                    {isDirty ? (
                      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-950">
                        UNSAVED
                      </span>
                    ) : null}
                    {morningSent ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                        SENT
                      </span>
                    ) : null}
                  </div>
                  {missingMorningDraft ? (
                    <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-950 space-y-1">
                      <p className="font-semibold">{MORNING_MISSING_DRAFT_BANNER}</p>
                      <p>{MORNING_MISSING_DRAFT_SUPPORTING_COPY}</p>
                    </div>
                  ) : null}
                  {isDirty && morningEditable ? (
                    <p className="rounded border border-orange-200 bg-orange-50 px-2 py-2 text-xs font-medium text-orange-950">
                      {MORNING_UNSAVED_COPY}
                    </p>
                  ) : null}
                  {saveFailedMsg ? (
                    <p className="rounded border border-red-200 bg-red-50 px-2 py-2 text-xs font-medium text-red-950">
                      {MORNING_SAVE_FAILED_COPY}
                      {saveFailedMsg ? ` (${saveFailedMsg})` : ""}
                    </p>
                  ) : null}
                  {tylerBlanked && !isDirty && !saveFailedMsg ? (
                    <p className="rounded border border-amber-200 bg-amber-50 px-2 py-2 text-xs font-medium text-amber-950">
                      {MORNING_TYLER_BLANK_SAVED_COPY}
                    </p>
                  ) : null}
                  {row.preferredName ? (
                    <div>
                      <p className="text-xs font-medium text-gray-500">preferred_name</p>
                      <p className="mt-1 text-sm font-medium text-gray-900">{row.preferredName}</p>
                    </div>
                  ) : null}
                  <div>
                    <p className="text-xs font-medium text-gray-500">clerk_user_id</p>
                    <p className="mt-1 font-mono text-sm text-gray-900 break-all">
                      {row.clerkUserId}
                    </p>
                  </div>
                  {row.phoneNumber ? (
                    <div>
                      <p className="text-xs font-medium text-gray-500">phone_number</p>
                      <p className="mt-1 font-mono text-sm text-gray-900">{row.phoneNumber}</p>
                    </div>
                  ) : null}
                  <div>
                    <p className="text-xs font-medium text-gray-500">Send slot</p>
                    <p className="mt-1 text-sm text-gray-900">
                      {eveningRow ? (
                        <>
                          evening_checkin
                          {eveningSent ? (
                            <>
                              {" "}
                              · <span className="font-semibold text-green-800">SENT</span>
                            </>
                          ) : null}
                        </>
                      ) : row.sendSlot === SMS_DAILY_PRODUCTION_SEND_SLOT ? (
                        "morning / primary daily"
                      ) : (
                        row.sendSlot
                      )}
                    </p>
                  </div>
                  {row.draftForDayKey ? (
                    <div>
                      <p className="text-xs font-medium text-gray-500">draft_for_day_key</p>
                      <p className="mt-1 font-mono text-sm text-gray-900">{row.draftForDayKey}</p>
                    </div>
                  ) : null}
                  {formatScheduledDeliveryLine(row) ? (
                    <div>
                      <p className="text-xs font-medium text-gray-500">Scheduled delivery</p>
                      <p className="mt-1 text-sm text-gray-900">{formatScheduledDeliveryLine(row)}</p>
                      {row.occurrenceState ? (
                        <p className="mt-1 text-xs text-gray-600">Occurrence: {row.occurrenceState}</p>
                      ) : null}
                      {formatGeneratedDeliveryLine(row) ? (
                        <p className="mt-1 text-xs text-amber-900">{formatGeneratedDeliveryLine(row)}</p>
                      ) : null}
                    </div>
                  ) : null}
                  {eveningSent || morningSent ? (
                    <dl className="grid gap-2 text-xs text-gray-700 sm:grid-cols-2">
                      <div>
                        <dt className="font-medium text-gray-500">sent_at</dt>
                        <dd className="font-mono">{formatOptional(row.sentAt)}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-gray-500">sms_send_event_id</dt>
                        <dd className="font-mono break-all">
                          {formatOptional(row.sourceSmsSendEventId)}
                        </dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="font-medium text-gray-500">twilio_message_sid</dt>
                        <dd className="font-mono break-all">
                          {formatOptional(row.twilioMessageSid)}
                        </dd>
                      </div>
                    </dl>
                  ) : null}
                  <div>
                    <p className="text-xs font-medium text-gray-500">
                      {currentBodyHeading}
                    </p>
                    {morningDualBody ? (
                      <div className="mt-1 mb-2 space-y-1">
                        <p className="text-xs text-gray-600">{currentBodyLabel}</p>
                        <p className="text-xs font-medium text-gray-700">
                          {formatMorningCurrentBodySourceLabel(row)}
                        </p>
                      </div>
                    ) : null}
                    {morningSendabilityCopy ? (
                      <p
                        className={`mt-1 mb-2 rounded border px-2 py-2 text-xs ${
                          morningSendabilityCopy.includes("will not send") ||
                          morningSendabilityCopy.startsWith("Blank") ||
                          morningSendabilityCopy.startsWith("Blocked by machine")
                            ? "border-amber-200 bg-amber-50 text-amber-900"
                            : "border-green-200 bg-green-50 text-green-900"
                        }`}
                      >
                        {morningSendabilityCopy}
                      </p>
                    ) : null}
                    {!canEditBody ? (
                      missingMorningDraft ? (
                        <div className="mt-1 w-full min-h-[96px] rounded border border-dashed border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950 space-y-1">
                          <p className="font-medium">{MORNING_MISSING_DRAFT_BANNER}</p>
                          <p className="text-xs">{MORNING_MISSING_DRAFT_SUPPORTING_COPY}</p>
                        </div>
                      ) : eveningEmptyBodyCopy ? (
                        <div className="mt-1 w-full min-h-[96px] rounded border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-600 space-y-1">
                          <p className="font-medium text-gray-800">{eveningEmptyBodyCopy.primary}</p>
                          {eveningEmptyBodyCopy.secondary ? (
                            <p className="text-xs text-gray-600 font-mono break-all">
                              {eveningEmptyBodyCopy.secondary}
                            </p>
                          ) : null}
                        </div>
                      ) : morningDualBody && !(readOnlyBody?.trim() ?? "") ? (
                        <div className="mt-1 w-full min-h-[96px] rounded border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 space-y-2">
                          <p className="font-medium">{currentBodyBlank}</p>
                          <pre className="font-mono whitespace-pre-wrap text-xs text-gray-800">
                            {readOnlyBody ?? ""}
                          </pre>
                        </div>
                      ) : (
                        <pre className="mt-1 w-full min-h-[96px] rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-mono whitespace-pre-wrap">
                          {readOnlyBody ?? "—"}
                        </pre>
                      )
                    ) : (
                      <>
                        <textarea
                          id={`body-${row.draftId}`}
                          className={`mt-1 w-full min-h-[96px] rounded border px-3 py-2 text-sm font-mono ${
                            isDirty
                              ? "border-orange-400 bg-orange-50/40"
                              : "border-gray-300"
                          }`}
                          value={edits[row.draftId as string] ?? ""}
                          disabled={pageBatchBusy}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [row.draftId as string]: e.target.value,
                            }))
                          }
                        />
                        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                          {TTO_CURRENT_BODY_COPY_PASTE_LABEL}
                        </p>
                        <pre
                          data-testid="tto-current-body-copy"
                          className="mt-1 w-full min-h-[96px] rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-mono whitespace-pre-wrap"
                        >{edits[row.draftId as string] ?? ""}</pre>
                        <p className="mt-1 text-xs text-gray-600">
                          {formatTtoBodyCharCount(editorTransportBody.length)}
                        </p>
                        {ttoDraftBodyShouldSoftWarnLength(editorTransportBody) ? (
                          <p className="mt-1 text-xs text-amber-800">
                            {TTO_BODY_SOFT_LENGTH_WARNING}
                          </p>
                        ) : null}
                        {editorOverTransportMax ? (
                          <p className="mt-1 text-xs text-red-800">
                            {formatTtoBodyOverTransportMaxCopy(editorTransportBody.length)}
                          </p>
                        ) : null}
                        {morningDualBody &&
                        !(edits[row.draftId as string]?.trim() ?? row.currentBodyToSend?.trim() ?? "") ? (
                          <p className="mt-1 text-xs text-amber-800">{currentBodyBlank}</p>
                        ) : null}
                        {eveningEditable ? (
                          <p className="mt-1 text-xs text-gray-600">{EVENING_TTO_SAVE_ONLY_COPY}</p>
                        ) : null}
                        <button
                          type="button"
                          className="mt-2 rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                          disabled={
                            isSavingThis ||
                            pageBatchBusy ||
                            editorOverTransportMax ||
                            (!isDirty && !saveFailedMsg)
                          }
                          onClick={() => saveDraft(row)}
                        >
                          {isSavingThis
                            ? "Saving…"
                            : pageBatchBusy
                              ? "Batch action in progress…"
                              : saveFailedMsg
                                ? "Save failed — retry"
                                : isDirty
                                  ? "Save (unsaved)"
                                  : "Saved"}
                        </button>
                      </>
                    )}
                  </div>
                </section>

                {showEveningMorningAnchor ? (
                  <section className="space-y-3 border-t border-gray-100 pt-5">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                      Morning anchor (context only)
                    </h2>
                    <MorningAnchorPanel row={row} />
                  </section>
                ) : null}

                {solForensicPanels ? (
                  <section className="space-y-3 border-t border-gray-100 pt-5">
                    <PersistedMessageForPanel row={row} />
                  </section>
                ) : null}

                {morningDualBody ? (
                  <section className="space-y-3 border-t border-gray-100 pt-5">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                      {MORNING_ORIGINAL_MACHINE_DRAFT_HEADING}
                    </h2>
                    <MorningOriginalMachineDraftPanel row={row} />
                  </section>
                ) : null}

                {morningDualBody ? (
                  <section className="space-y-3 border-t border-gray-100 pt-5">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                      {MORNING_BODY_COMPARISON_HEADING}
                    </h2>
                    <MorningBodyComparisonPanel row={row} />
                  </section>
                ) : null}

                {(row.morningCoachingBriefV1 || row.morningBriefInterpreterV1) &&
                solForensicPanels ? (
                  <section className="space-y-3 border-t border-gray-100 pt-5">
                    <MorningCoachingBriefObservationPanels row={row} />
                  </section>
                ) : null}

                {solForensicPanels ? (
                  <section className="space-y-3 border-t border-gray-100 pt-5">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                      {TTO_PERSISTED_PACKET_HEADING}
                    </h2>
                    <PersistedRelationshipPacketPanel row={row} />
                  </section>
                ) : null}

                <section className="space-y-3 border-t border-gray-100 pt-5">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                    {solForensicPanels || morningDualBody
                      ? MORNING_GENERATION_PROVENANCE_HEADING
                      : "Notebook provenance"}
                  </h2>
                  <p className="text-xs text-gray-600">{ADMIN_INTERPRETATION_LINE}</p>
                  {solForensicPanels || morningDualBody ? (
                    <p className="text-xs text-gray-600">{MORNING_GENERATION_PROVENANCE_LABEL}</p>
                  ) : null}
                  <NotebookProvenancePanel row={row} />
                </section>

                <section className="space-y-3 border-t border-gray-100 pt-5">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                    Slot coaching context
                  </h2>
                  <SlotCoachingContextPanel row={row} />
                </section>

                <section className="space-y-3 border-t border-gray-100 pt-5">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                    {solForensicPanels
                      ? MORNING_RAW_PRIMARY_INPUT_HEADING
                      : RAW_NOTEBOOK_SECTION_HEADING}
                  </h2>
                  {solForensicPanels ? (
                    <p className="text-xs text-gray-600">{MORNING_RAW_PRIMARY_INPUT_LABEL}</p>
                  ) : null}
                  <NotebookMessagesSection row={row} />
                </section>

                {solForensicPanels ? (
                  <MorningTechnicalRetryPanel row={row} />
                ) : null}
              </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </div>
  );
}
