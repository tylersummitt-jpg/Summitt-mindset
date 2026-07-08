"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  ADMIN_INTERPRETATION_LINE,
  RAW_NOTEBOOK_SECTION_HEADING,
  buildProvenanceExplanationBlocks,
  getRawNotebookSectionCopy,
} from "@/lib/tyler-text-overview-dashboard-sections";
import { notebookFamilyLabel } from "@/lib/tyler-text-overview-notebook-display";
import type {
  TylerTextOverviewAdminCounts,
  TylerTextOverviewAdminDraftRow,
  TylerTextOverviewRowState,
} from "@/lib/tyler-text-overview-types";
import { SMS_DAILY_EVENING_PREVIEW_SEND_SLOT } from "@/lib/tyler-text-overview-types";

type EditState = Record<string, string>;
type SendSlotTab = "morning" | typeof SMS_DAILY_EVENING_PREVIEW_SEND_SLOT;

const EVENING_PREVIEW_BANNER_TITLE = "Evening check-in — manual send enabled for admin.";
const EVENING_PREVIEW_BANNER_BODY =
  "Review evening previews here, then send one row at a time via Twilio. Morning / primary daily SMS is unchanged.";

function isEveningDraftSent(row: TylerTextOverviewAdminDraftRow): boolean {
  return row.draftStatus === "sent" || row.sentAt != null;
}

function rowListKey(row: TylerTextOverviewAdminDraftRow): string {
  return `${row.clerkUserId}:${row.sendSlot}:${row.draftForDayKey}:${row.draftId ?? "no-draft"}`;
}

function rowStateLabel(rowState: TylerTextOverviewRowState): string {
  switch (rowState) {
    case "no_draft_yet":
      return "No draft yet";
    case "draft_current":
      return "Current draft";
    case "draft_sent":
      return "Sent";
    case "draft_skipped":
      return "Skipped / no-send";
    default:
      return "Other";
  }
}

function isMorningDraftSent(row: TylerTextOverviewAdminDraftRow): boolean {
  return row.rowState === "draft_sent" || row.draftStatus === "sent" || row.sentAt != null;
}

function canEditMorningDraft(row: TylerTextOverviewAdminDraftRow): boolean {
  return row.rowState === "draft_current" && Boolean(row.draftId);
}

function canSendEveningRow(row: TylerTextOverviewAdminDraftRow): boolean {
  if (!row.draftId) return false;
  if (!isEveningPreviewRow(row)) return false;
  if (isEveningDraftSent(row)) return false;
  if (row.draftStatus !== "current") return false;
  if (row.machineShouldSend !== true) return false;
  const body = row.currentBodyToSend?.trim();
  return Boolean(body);
}

function resolveSendSlotTab(raw: string | null): SendSlotTab {
  if (raw === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT) {
    return SMS_DAILY_EVENING_PREVIEW_SEND_SLOT;
  }
  return "morning";
}

function isEveningPreviewRow(row: TylerTextOverviewAdminDraftRow): boolean {
  return row.sendSlot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT || row.previewOnly === true;
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
          <dt className="font-medium text-gray-500">Current generation</dt>
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

function buildTabHref(sendSlot: SendSlotTab, draftForDayKey: string): string {
  const params = new URLSearchParams();
  params.set("send_slot", sendSlot);
  if (draftForDayKey) {
    params.set("draft_for_day_key", draftForDayKey);
  }
  return `/admin/tyler-text-overview?${params.toString()}`;
}

export default function TylerTextOverviewDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeSendSlot = resolveSendSlotTab(searchParams.get("send_slot"));
  const isEveningTab = activeSendSlot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT;

  const [rows, setRows] = useState<TylerTextOverviewAdminDraftRow[]>([]);
  const [counts, setCounts] = useState<TylerTextOverviewAdminCounts | null>(null);
  const [availableDayKeys, setAvailableDayKeys] = useState<string[]>([]);
  const [selectedDayKey, setSelectedDayKey] = useState<string>(
    () => searchParams.get("draft_for_day_key") ?? ""
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [edits, setEdits] = useState<EditState>({});
  const [loading, setLoading] = useState(true);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [generatingUserId, setGeneratingUserId] = useState<string | null>(null);
  const [sendingDraftId, setSendingDraftId] = useState<string | null>(null);
  const [confirmSendRow, setConfirmSendRow] = useState<TylerTextOverviewAdminDraftRow | null>(
    null
  );
  const [toast, setToast] = useState<string | null>(null);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  }

  const load = useCallback(
    async (dayKey: string, sendSlot: SendSlotTab, query: string) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("send_slot", sendSlot);
        if (dayKey) {
          params.set("draft_for_day_key", dayKey);
        }
        if (query.trim()) {
          params.set("q", query.trim());
        }
        const res = await fetch(`/api/admin/tyler-text-overview?${params.toString()}`);
        const json = await res.json();

        if (!res.ok || !json.ok) {
          showToast(json.error || "Could not load drafts.");
          setRows([]);
          setCounts(null);
          setAvailableDayKeys([]);
          return;
        }

        const nextRows = (json.rows || []) as TylerTextOverviewAdminDraftRow[];
        setRows(nextRows);
        setCounts((json.counts as TylerTextOverviewAdminCounts | undefined) ?? null);
        setAvailableDayKeys((json.availableDayKeys || []) as string[]);
        setEdits(
          Object.fromEntries(
            nextRows
              .filter((row) => row.draftId)
              .map((row) => [row.draftId as string, row.currentBodyToSend ?? ""])
          )
        );
      } catch (err) {
        console.error("Failed to load Tyler Text Overview drafts", err);
        showToast("Could not load drafts.");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    load(selectedDayKey, activeSendSlot, searchQuery);
  }, [load, selectedDayKey, activeSendSlot, searchQuery]);

  async function saveDraft(row: TylerTextOverviewAdminDraftRow) {
    if (!row.draftId) return;
    setSavingDraftId(row.draftId);
    try {
      const res = await fetch(`/api/admin/tyler-text-overview/${encodeURIComponent(row.draftId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentBodyToSend: edits[row.draftId] ?? "",
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        showToast(json.error || "Save failed.");
        return;
      }

      const updated = json.row as TylerTextOverviewAdminDraftRow;
      setRows((prev) => prev.map((r) => (r.draftId === updated.draftId ? updated : r)));
      if (updated.draftId) {
        setEdits((prev) => ({
          ...prev,
          [updated.draftId as string]: updated.currentBodyToSend ?? "",
        }));
      }
      showToast("Saved.");
    } catch (err) {
      console.error("Failed to save draft", err);
      showToast("Save failed.");
    } finally {
      setSavingDraftId(null);
    }
  }

  async function generateEveningPreview(row: TylerTextOverviewAdminDraftRow) {
    if (!row.clerkUserId?.trim()) {
      return;
    }

    const dayKey = row.draftForDayKey?.trim() || selectedDayKey.trim() || undefined;

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

      showToast("Evening preview generated.");
      const params = new URLSearchParams();
      params.set("send_slot", SMS_DAILY_EVENING_PREVIEW_SEND_SLOT);
      if (selectedDayKey || dayKey) {
        params.set("draft_for_day_key", selectedDayKey || dayKey || "");
      }
      router.push(`/admin/tyler-text-overview?${params.toString()}`);
      await load(selectedDayKey || dayKey || "", SMS_DAILY_EVENING_PREVIEW_SEND_SLOT, searchQuery);
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
      await load(selectedDayKey, activeSendSlot, searchQuery);
    } catch (err) {
      console.error("Failed to send evening draft", err);
      showToast("Evening send failed.");
    } finally {
      setSendingDraftId(null);
    }
  }

  const morningTabHref = buildTabHref("morning", selectedDayKey);
  const eveningTabHref = buildTabHref(SMS_DAILY_EVENING_PREVIEW_SEND_SLOT, selectedDayKey);

  return (
    <div className="space-y-6">
      {confirmSendRow ? (
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
                disabled={sendingDraftId === confirmSendRow.draftId}
                onClick={() => sendEveningDraft(confirmSendRow)}
              >
                {sendingDraftId === confirmSendRow.draftId ? "Sending…" : "Send Evening Text"}
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

      <div
        className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1"
        role="tablist"
        aria-label="Send slot"
      >
        <Link
          href={morningTabHref}
          role="tab"
          aria-selected={!isEveningTab}
          className={`rounded-md px-4 py-2 text-sm font-medium ${
            !isEveningTab
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          Morning / Primary Daily
        </Link>
        <Link
          href={eveningTabHref}
          role="tab"
          aria-selected={isEveningTab}
          className={`rounded-md px-4 py-2 text-sm font-medium ${
            isEveningTab
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          Evening Preview
        </Link>
      </div>

      {isEveningTab ? (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="alert"
        >
          <p className="font-semibold">{EVENING_PREVIEW_BANNER_TITLE}</p>
          <p className="mt-1">{EVENING_PREVIEW_BANNER_BODY}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="font-medium text-gray-700">Draft day</span>
          <select
            className="mt-1 block rounded border border-gray-300 bg-white px-3 py-2 text-sm"
            value={selectedDayKey}
            onChange={(e) => setSelectedDayKey(e.target.value)}
          >
            <option value="">All current days</option>
            {availableDayKeys.map((dayKey) => (
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
      </div>

      {counts ? (
        <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800">
          <p className="font-medium text-gray-900">Sendable audience</p>
          <dl className="mt-2 grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <div>
              <dt className="text-xs text-gray-500">Sendable</dt>
              <dd className="font-semibold">{counts.sendableUsers}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">No draft</dt>
              <dd>{counts.noDraftYet}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Current</dt>
              <dd>{counts.draftCurrent}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Sent</dt>
              <dd>{counts.draftSent}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Skipped</dt>
              <dd>{counts.draftSkipped}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Would send</dt>
              <dd>{counts.machineShouldSendTrue}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Would skip</dt>
              <dd>{counts.machineShouldSendFalse}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-gray-500">Loading sendable users…</p>
      ) : rows.length === 0 ? (
        isEveningTab ? (
          <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-700 space-y-3">
            <p>No sendable users match this filter.</p>
            <p>
              Evening previews can be generated from the{" "}
              <Link href={morningTabHref} className="font-medium text-gray-900 underline">
                Morning / Primary Daily
              </Link>{" "}
              tab or on rows here once a user appears.
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No sendable users match this filter.</p>
        )
      ) : (
        <ul className="space-y-8">
          {rows.map((row) => {
            const eveningRow = isEveningPreviewRow(row);
            const eveningSent = eveningRow && isEveningDraftSent(row);
            const morningSent = !eveningRow && isMorningDraftSent(row);
            const readOnlyBody =
              (eveningSent || morningSent) && row.finalBodySent?.trim()
                ? row.finalBodySent
                : row.currentBodyToSend;
            const showReadOnlyBody = eveningRow || morningSent || !canEditMorningDraft(row);

            return (
              <li
                key={rowListKey(row)}
                className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-5"
              >
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                      Admin only
                    </h2>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">
                      {rowStateLabel(row.rowState)}
                    </span>
                    {morningSent ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                        SENT
                      </span>
                    ) : null}
                  </div>
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
                      ) : row.sendSlot === "morning" ? (
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
                    <p className="text-xs font-medium text-gray-500">current_body_to_send</p>
                    {showReadOnlyBody ? (
                      <pre className="mt-1 w-full min-h-[96px] rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-mono whitespace-pre-wrap">
                        {readOnlyBody ?? (row.rowState === "no_draft_yet" ? "—" : "—")}
                      </pre>
                    ) : (
                      <>
                        <textarea
                          id={`body-${row.draftId}`}
                          className="mt-1 w-full min-h-[96px] rounded border border-gray-300 px-3 py-2 text-sm font-mono"
                          value={edits[row.draftId as string] ?? ""}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [row.draftId as string]: e.target.value,
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="mt-2 rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                          disabled={savingDraftId === row.draftId}
                          onClick={() => saveDraft(row)}
                        >
                          {savingDraftId === row.draftId ? "Saving…" : "Save"}
                        </button>
                      </>
                    )}
                  </div>
                  {!isEveningTab && row.clerkUserId?.trim() ? (
                    <button
                      type="button"
                      className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 disabled:opacity-50"
                      disabled={generatingUserId === row.clerkUserId}
                      onClick={() => generateEveningPreview(row)}
                    >
                      {generatingUserId === row.clerkUserId
                        ? "Generating…"
                        : "Generate Evening Preview"}
                    </button>
                  ) : null}
                  {isEveningTab &&
                  eveningRow &&
                  !eveningSent &&
                  row.clerkUserId?.trim() ? (
                    <>
                      <button
                        type="button"
                        className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 disabled:opacity-50"
                        disabled={generatingUserId === row.clerkUserId}
                        onClick={() => generateEveningPreview(row)}
                      >
                        {generatingUserId === row.clerkUserId
                          ? "Regenerating…"
                          : "Regenerate Evening Preview"}
                      </button>
                      <button
                        type="button"
                        className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                        disabled={!canSendEveningRow(row) || sendingDraftId === row.draftId}
                        onClick={() => setConfirmSendRow(row)}
                      >
                        {sendingDraftId === row.draftId ? "Sending…" : "Send Evening Text"}
                      </button>
                    </>
                  ) : null}
                </section>

                {eveningRow ? (
                  <section className="space-y-3 border-t border-gray-100 pt-5">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                      Morning anchor
                    </h2>
                    <MorningAnchorPanel row={row} />
                  </section>
                ) : null}

                <section className="space-y-3 border-t border-gray-100 pt-5">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                    Notebook provenance
                  </h2>
                  <p className="text-xs text-gray-600">{ADMIN_INTERPRETATION_LINE}</p>
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
                    {RAW_NOTEBOOK_SECTION_HEADING}
                  </h2>
                  <NotebookMessagesSection row={row} />
                </section>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
