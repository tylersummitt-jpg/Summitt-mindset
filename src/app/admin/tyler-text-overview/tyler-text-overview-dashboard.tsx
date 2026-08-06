"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  adminCountLabel,
  buildSiblingTylerTextOverviewPageHref,
  buildTylerTextOverviewEveningPageHref,
  eveningGenerateButtonLabel,
  eveningSendButtonLabel,
  EVENING_PROACTIVE_SEND_DISABLED_UI_COPY,
  EVENING_TTO_MANUAL_BANNER,
  EVENING_TTO_NON_TODAY_WARNING,
  EVENING_TTO_NO_PREVIEW_COPY,
  EVENING_TTO_REGENERATE_OVERWRITE_COPY,
  EVENING_TTO_SAVE_BEFORE_SEND_COPY,
  EVENING_TTO_SAVE_ONLY_COPY,
  formatEveningEmptyBodyPanelCopy,
  formatEveningPreviewGenerateSuccessToast,
  formatMorningTtoSaveToast,
  formatMorningTtoSendabilityCopy,
  isEveningDashboardSendSlot,
  isEveningSendBusy,
  isTylerBlankedMorningDraftRow,
  matchesTylerTextOverviewSearchQuery,
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
  tylerTextOverviewNavPages,
  type TylerTextOverviewDashboardSendSlot,
} from "@/lib/tyler-text-overview-dashboard-copy";
import {
  ADMIN_INTERPRETATION_LINE,
  MORNING_BODY_COMPARISON_HEADING,
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
  buildProvenanceExplanationBlocks,
  formatMorningCurrentBodySourceLabel,
  getMorningBodyComparisonStatus,
  getMorningMachineDraftUnavailableReason,
  getMorningTechnicalRetrySectionCopy,
  getRawNotebookSectionCopy,
  isMorningRelationshipNotebookRow,
  shouldShowMorningDualBodyPanels,
} from "@/lib/tyler-text-overview-dashboard-sections";
import {
  shouldShowTtoBackgroundRefreshing,
  shouldShowTtoFullPageLoader,
  shouldSkipMorningTtoFocusRefresh,
} from "@/lib/tyler-text-overview-dashboard-refresh";
import { notebookFamilyLabel } from "@/lib/tyler-text-overview-notebook-display";
import type {
  TylerTextOverviewAdminCounts,
  TylerTextOverviewAdminDraftRow,
  TylerTextOverviewManifestIntegrity,
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
  return `${row.clerkUserId}:${row.sendSlot}:${row.draftForDayKey}:${row.draftId ?? "no-draft"}`;
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

/** Option A: editable only when current, unsent, and machine_should_send=true. */
function canEditEveningDraft(row: TylerTextOverviewAdminDraftRow): boolean {
  if (!row.draftId) return false;
  if (!isEveningPreviewRow(row)) return false;
  if (isEveningDraftSent(row)) return false;
  if (row.draftStatus !== "current") return false;
  if (row.machineShouldSend !== true) return false;
  return true;
}

function canSendEveningRow(row: TylerTextOverviewAdminDraftRow): boolean {
  if (!canEditEveningDraft(row)) return false;
  const body = row.currentBodyToSend?.trim();
  return Boolean(body);
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
  if (isEveningPreviewRow(row)) {
    if (isEveningDraftSent(row)) return "Sent";
    if (row.machineShouldSend === true) return "Would send if evening were live";
    if (row.machineShouldSend === false) return "Would skip";
    return "—";
  }
  return formatOptional(row.machineShouldSend);
}

function NotebookProvenancePanel({ row }: { row: TylerTextOverviewAdminDraftRow }) {
  const explanationBlocks = buildProvenanceExplanationBlocks(row);
  const evening = isEveningPreviewRow(row);
  const morning = isMorningRelationshipNotebookRow(row);

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
            {morning ? "Authoritative generation" : "Current generation"}
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
        {morning ? (
          <>
            <div>
              <dt className="font-medium text-gray-500">writer model</dt>
              <dd className="font-mono break-all">
                {formatOptional(row.authoritativeWriterModel)}
              </dd>
            </div>
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
          <dt className="font-medium text-gray-500">
            {evening ? "Would send" : "machine_should_send"}
          </dt>
          <dd>{formatMachineShouldSend(row)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">
            {evening ? "Would skip because…" : "machine_no_send_reason"}
          </dt>
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
          <dd>{formatOptional(row.intentionalSpace)}</dd>
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const isEveningPage = isEveningDashboardSendSlot(sendSlot);

  const [rows, setRows] = useState<TylerTextOverviewAdminDraftRow[]>([]);
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
  const [generatingUserId, setGeneratingUserId] = useState<string | null>(null);
  const [sendingDraftId, setSendingDraftId] = useState<string | null>(null);
  const [confirmSendRow, setConfirmSendRow] = useState<TylerTextOverviewAdminDraftRow | null>(
    null
  );
  const [toast, setToast] = useState<string | null>(null);
  const [serverChangedWhileDirty, setServerChangedWhileDirty] = useState(false);

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
          setDataStale(true);
          setLastFailedRefreshAt(new Date().toISOString());
          setManifestLoadError(errMsg);
          // Keep prior rows with stale banner — do not invent zeros.
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
        setRows(nextRows);
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
        setManifestLoadError("Could not load drafts.");
        setDataStale(true);
        setLastFailedRefreshAt(new Date().toISOString());
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

  async function saveDraft(row: TylerTextOverviewAdminDraftRow) {
    if (!row.draftId) return;
    const draftId = row.draftId;
    const submittedBody = editsRef.current[draftId] ?? "";
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

  async function generateEveningPreview(row: TylerTextOverviewAdminDraftRow) {
    if (!row.clerkUserId?.trim()) {
      return;
    }

    // Evening page: explicit filter/URL day wins; blank "All current days" omits day so
    // the server resolves user-local today (never pass a stale/tomorrow row day).
    // Morning page (legacy path): keep prior row → filter precedence.
    const dayKey = isEveningPage
      ? selectedDayKey.trim() || undefined
      : row.draftForDayKey?.trim() || selectedDayKey.trim() || undefined;

    setGeneratingUserId(row.clerkUserId);
    try {
      const res = await fetch("/api/admin/tyler-text-overview/evening-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clerk_user_id: row.clerkUserId,
          ...(dayKey ? { draft_for_day_key: dayKey } : {}),
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        showToast(json.error || json.reason || "Evening preview generation failed.");
        return;
      }

      showToast(
        formatEveningPreviewGenerateSuccessToast({
          machineShouldSend: json.machine_should_send,
          machineDraftBody: json.machine_draft_body,
          machineNoSendReason: json.machine_no_send_reason,
        })
      );
      const effectiveDayKey = selectedDayKey || dayKey || "";
      if (isEveningPage) {
        await load(effectiveDayKey, sendSlot, { preserveUnsaved: true });
      } else {
        router.push(buildTylerTextOverviewEveningPageHref(effectiveDayKey));
      }
    } catch (err) {
      console.error("Failed to generate evening preview", err);
      showToast("Evening preview generation failed.");
    } finally {
      setGeneratingUserId(null);
    }
  }

  async function sendEveningDraft(row: TylerTextOverviewAdminDraftRow) {
    if (!row.draftId) return;
    setSendingDraftId(row.draftId);
    setConfirmSendRow(null);
    try {
      const res = await fetch("/api/admin/tyler-text-overview/evening-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft_id: row.draftId }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        showToast(json.message || json.error || json.refusalCode || "Evening send failed.");
        return;
      }

      showToast("Evening text sent.");
      await load(selectedDayKey, sendSlot, { preserveUnsaved: true });
    } catch (err) {
      console.error("Failed to send evening draft", err);
      showToast("Evening send failed.");
    } finally {
      setSendingDraftId(null);
    }
  }

  const siblingPageHref = buildSiblingTylerTextOverviewPageHref({
    page: isEveningPage ? "morning" : "evening",
    draftForDayKey: selectedDayKey,
  });
  const siblingPageLabel = isEveningPage ? "Morning Text Overview →" : "Evening Text Overview →";
  const navPages = tylerTextOverviewNavPages(isEveningPage ? "evening" : "morning");
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

  const visibleRows = useMemo(
    () =>
      searchQuery.trim()
        ? rows.filter((row) => matchesTylerTextOverviewSearchQuery(row, searchQuery))
        : rows,
    [rows, searchQuery]
  );

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
    Boolean(manifestLoadError) ||
    dataStale ||
    Boolean(selectedDayKey.trim() && manifest && !manifest.manifestComplete);

  return (
    <div className="space-y-6">
      {isEveningPage && confirmSendRow ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="evening-send-confirm-title"
        >
          <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-5 shadow-lg space-y-4">
            <h2 id="evening-send-confirm-title" className="text-lg font-semibold text-gray-900">
              Send evening check-in?
            </h2>
            <p className="text-sm text-gray-700">
              Send this evening check-in to{" "}
              <span className="font-mono">{confirmSendRow.clerkUserId}</span> for{" "}
              <span className="font-mono">{confirmSendRow.draftForDayKey}</span>? This sends a real
              SMS via Twilio. It cannot be unsent.
            </p>
            <pre className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-mono whitespace-pre-wrap">
              {confirmSendRow.currentBodyToSend ?? "—"}
            </pre>
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900"
                onClick={() => setConfirmSendRow(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={isEveningSendBusy({
                  draftId: confirmSendRow.draftId,
                  sendingDraftId,
                })}
                onClick={() => sendEveningDraft(confirmSendRow)}
              >
                {eveningSendButtonLabel(
                  isEveningSendBusy({
                    draftId: confirmSendRow.draftId,
                    sendingDraftId,
                  })
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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

      {isEveningPage ? (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="alert"
        >
          <p>{EVENING_TTO_MANUAL_BANNER}</p>
        </div>
      ) : (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="alert"
        >
          <p>{MORNING_TTO_AUTHORITY_BANNER}</p>
        </div>
      )}

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
        {navPages
          .filter((p) => p.page === "weekly")
          .map((p) => (
            <Link key={p.page} href={p.href} className="ml-3 font-medium text-gray-900 underline">
              Weekly Text Overview →
            </Link>
          ))}
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

      {counts ? (
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

      {showFullPageLoader ? (
        <p className="text-sm text-gray-500">Loading sendable users…</p>
      ) : visibleRows.length === 0 ? (
        isEveningPage ? (
          <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-700 space-y-3">
            <p>No sendable users match this filter.</p>
            <p>{EVENING_TTO_NO_PREVIEW_COPY}</p>
            <p>
              <Link href={siblingPageHref} className="font-medium text-gray-900 underline">
                Morning Text Overview →
              </Link>
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No sendable users match this filter.</p>
        )
      ) : (
        <ul className="space-y-8">
          {visibleRows.map((row) => {
            const eveningRow = isEveningPreviewRow(row);
            const eveningSent = eveningRow && isEveningDraftSent(row);
            const morningSent = !eveningRow && isMorningDraftSent(row);
            const eveningEditable = isEveningPage && canEditEveningDraft(row);
            const morningEditable = !isEveningPage && canEditMorningDraft(row) && !morningSent;
            const canEditBody = eveningEditable || morningEditable;
            const eveningDirty = eveningEditable && isEveningDraftDirty(row, edits);
            const morningDirty = morningEditable && isMorningDraftDirty(row, edits);
            const isDirty = eveningDirty || morningDirty;
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
            const isSendingThisEvening = isEveningSendBusy({
              draftId: row.draftId,
              sendingDraftId,
            });
            const isGeneratingThisEvening =
              Boolean(row.clerkUserId?.trim()) && generatingUserId === row.clerkUserId;
            const eveningSendDisabledReason = EVENING_PROACTIVE_SEND_DISABLED_UI_COPY;
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
            const morningRelationshipNotebook =
              !isEveningPage && isMorningRelationshipNotebookRow(row);
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
              <li
                key={rowListKey(row)}
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
                          ) : (
                            <>
                              {" "}
                              · <span className="font-semibold text-amber-800">PREVIEW</span>
                            </>
                          )}
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
                      {morningDualBody ? MORNING_CURRENT_BODY_HEADING : "current_body_to_send"}
                    </p>
                    {morningDualBody ? (
                      <div className="mt-1 mb-2 space-y-1">
                        <p className="text-xs text-gray-600">{MORNING_CURRENT_BODY_LABEL}</p>
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
                          <p className="font-medium">{MORNING_CURRENT_BODY_BLANK}</p>
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
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [row.draftId as string]: e.target.value,
                            }))
                          }
                        />
                        {morningDualBody &&
                        !(edits[row.draftId as string]?.trim() ?? row.currentBodyToSend?.trim() ?? "") ? (
                          <p className="mt-1 text-xs text-amber-800">{MORNING_CURRENT_BODY_BLANK}</p>
                        ) : null}
                        {eveningEditable ? (
                          <p className="mt-1 text-xs text-gray-600">{EVENING_TTO_SAVE_ONLY_COPY}</p>
                        ) : null}
                        {eveningDirty ? (
                          <p className="mt-1 text-xs font-medium text-amber-800">
                            {EVENING_TTO_SAVE_BEFORE_SEND_COPY}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          className="mt-2 rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                          disabled={isSavingThis || (!isDirty && !saveFailedMsg)}
                          onClick={() => saveDraft(row)}
                        >
                          {isSavingThis
                            ? "Saving…"
                            : saveFailedMsg
                              ? "Save failed — retry"
                              : isDirty
                                ? eveningEditable
                                  ? "Save Evening Text (unsaved)"
                                  : "Save (unsaved)"
                                : eveningEditable
                                  ? "Saved"
                                  : "Saved"}
                        </button>
                      </>
                    )}
                  </div>
                  {isEveningPage &&
                  eveningRow &&
                  !eveningSent &&
                  row.clerkUserId?.trim() ? (
                    <>
                      <button
                        type="button"
                        className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 disabled:opacity-50"
                        disabled={isGeneratingThisEvening}
                        onClick={() => generateEveningPreview(row)}
                      >
                        {eveningGenerateButtonLabel({
                          isGenerating: isGeneratingThisEvening,
                          hasPreview: row.rowState !== "no_draft_yet",
                        })}
                      </button>
                      {row.rowState !== "no_draft_yet" ? (
                        <p className="text-xs text-gray-600">
                          {EVENING_TTO_REGENERATE_OVERWRITE_COPY}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                        disabled
                        title={eveningSendDisabledReason}
                      >
                        {eveningSendButtonLabel(false)}
                      </button>
                      <p className="text-xs text-gray-600">{eveningSendDisabledReason}</p>
                    </>
                  ) : null}
                </section>

                {isEveningPage && eveningRow ? (
                  <section className="space-y-3 border-t border-gray-100 pt-5">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                      Morning anchor (context only)
                    </h2>
                    <MorningAnchorPanel row={row} />
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

                <section className="space-y-3 border-t border-gray-100 pt-5">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                    {morningRelationshipNotebook || morningDualBody
                      ? MORNING_GENERATION_PROVENANCE_HEADING
                      : "Notebook provenance"}
                  </h2>
                  <p className="text-xs text-gray-600">{ADMIN_INTERPRETATION_LINE}</p>
                  {morningRelationshipNotebook || morningDualBody ? (
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
                    {morningRelationshipNotebook
                      ? MORNING_RAW_PRIMARY_INPUT_HEADING
                      : RAW_NOTEBOOK_SECTION_HEADING}
                  </h2>
                  {morningRelationshipNotebook ? (
                    <p className="text-xs text-gray-600">{MORNING_RAW_PRIMARY_INPUT_LABEL}</p>
                  ) : null}
                  <NotebookMessagesSection row={row} />
                </section>

                {morningRelationshipNotebook ? (
                  <MorningTechnicalRetryPanel row={row} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
