"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  adminCountLabel,
  formatWeeklyEmptyBodyPanelCopy,
  formatWeeklyGenerateSuccessToast,
  isWeeklyManualSendEligible,
  isWeeklySendBusy,
  resolveWeeklyTtoInitialSelectedDayKey,
  rowStateLabel,
  tylerTextOverviewNavPages,
  weeklyGenerateButtonLabel,
  weeklyGenerateMissingButtonLabel,
  weeklySendButtonLabel,
  WEEKLY_TTO_AUTHORITY_BANNER,
  WEEKLY_TTO_FOOTER_AT_SEND_COPY,
  WEEKLY_TTO_GENERATE_ALL_SESSION_KEY,
  WEEKLY_TTO_GENERATE_MISSING_CONFIRM_COPY,
  WEEKLY_TTO_GENERATE_MISSING_CONFIRM_TITLE,
  WEEKLY_TTO_GENERATE_MISSING_HELP_COPY,
  WEEKLY_TTO_MANUAL_SEND_NOTE,
  WEEKLY_TTO_NEXT_CUTOVER_COPY,
  WEEKLY_TTO_REGENERATE_OVERWRITE_COPY,
  WEEKLY_TTO_SAVE_BEFORE_SEND_COPY,
  WEEKLY_TTO_SAVE_ONLY_COPY,
  WEEKLY_TTO_STALE_DRAFT_GUIDANCE,
  formatTtoGenerateAllProgressLine,
} from "@/lib/tyler-text-overview-dashboard-copy";
import {
  ADMIN_INTERPRETATION_LINE,
  buildWeeklyProvenanceExplanationBlocks,
  formatPersistedMessageForLine,
  getWeeklyRawNotebookSectionCopy,
} from "@/lib/tyler-text-overview-dashboard-sections";
import { notebookFamilyLabel } from "@/lib/tyler-text-overview-notebook-display";
import type {
  TylerTextOverviewAdminCounts,
  TylerTextOverviewAdminDraftRow,
} from "@/lib/tyler-text-overview-types";
import { SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT } from "@/lib/tyler-text-overview-types";

type EditState = Record<string, string>;

const COUNT_KEYS: Array<keyof TylerTextOverviewAdminCounts> = [
  "sendableUsers",
  "noDraftYet",
  "draftCurrent",
  "draftSent",
  "draftSkipped",
  "machineShouldSendTrue",
  "machineShouldSendFalse",
];

function formatOptional(value: string | null | undefined): string {
  const t = value?.trim();
  return t ? t : "—";
}

function notebookRoleLabel(role: string): string {
  return role.toUpperCase();
}

function isWeeklyDraftSent(row: TylerTextOverviewAdminDraftRow): boolean {
  return row.rowState === "draft_sent" || row.draftStatus === "sent";
}

function canEditWeeklyDraft(row: TylerTextOverviewAdminDraftRow): boolean {
  return (
    row.rowState === "draft_current" &&
    row.draftStatus === "current" &&
    Boolean(row.draftId) &&
    row.sendSlot === SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT &&
    !isWeeklyDraftSent(row)
  );
}

function isWeeklyDraftDirty(row: TylerTextOverviewAdminDraftRow, edits: EditState): boolean {
  if (!row.draftId) return false;
  const edited = edits[row.draftId] ?? "";
  const saved = row.currentBodyToSend ?? "";
  return edited !== saved;
}

export default function TylerTextOverviewWeeklyDashboard() {
  const searchParams = useSearchParams();
  const sendSlot = SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT;

  const [rows, setRows] = useState<TylerTextOverviewAdminDraftRow[]>([]);
  const [counts, setCounts] = useState<TylerTextOverviewAdminCounts | null>(null);
  const [availableDayKeys, setAvailableDayKeys] = useState<string[]>([]);
  const [selectedDayKey, setSelectedDayKey] = useState(() =>
    resolveWeeklyTtoInitialSelectedDayKey({
      searchParamDayKey: searchParams.get("draft_for_day_key"),
    })
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [edits, setEdits] = useState<EditState>({});
  const [loading, setLoading] = useState(true);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [generatingUserId, setGeneratingUserId] = useState<string | null>(null);
  const [generatingMissingAll, setGeneratingMissingAll] = useState(false);
  const [generateAllResumeAvailable, setGenerateAllResumeAvailable] = useState(false);
  const [confirmGenerateMissing, setConfirmGenerateMissing] = useState(false);
  const [sendingDraftId, setSendingDraftId] = useState<string | null>(null);
  const [confirmSendRow, setConfirmSendRow] = useState<TylerTextOverviewAdminDraftRow | null>(
    null
  );
  const [toast, setToast] = useState<string | null>(null);

  type WeeklyGenerateAllSnapshot = {
    audienceClerkUserIds: string[];
  };

  function readWeeklyGenerateAllSnapshot(): WeeklyGenerateAllSnapshot | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem(WEEKLY_TTO_GENERATE_ALL_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as WeeklyGenerateAllSnapshot;
      if (!parsed || !Array.isArray(parsed.audienceClerkUserIds) || parsed.audienceClerkUserIds.length === 0) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function writeWeeklyGenerateAllSnapshot(snapshot: WeeklyGenerateAllSnapshot) {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(WEEKLY_TTO_GENERATE_ALL_SESSION_KEY, JSON.stringify(snapshot));
  }

  function clearWeeklyGenerateAllSnapshot() {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(WEEKLY_TTO_GENERATE_ALL_SESSION_KEY);
  }

  useEffect(() => {
    setGenerateAllResumeAvailable(Boolean(readWeeklyGenerateAllSnapshot()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2800);
  }

  const load = useCallback(async (dayKey: string, query: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("send_slot", sendSlot);
      if (dayKey) params.set("draft_for_day_key", dayKey);
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`/api/admin/tyler-text-overview?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        showToast(json.error || "Could not load weekly drafts.");
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
      console.error("Failed to load Weekly TTO drafts", err);
      showToast("Could not load weekly drafts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(selectedDayKey, searchQuery);
  }, [load, selectedDayKey, searchQuery]);

  const blankBodyCount = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.rowState === "draft_current" && !(r.currentBodyToSend?.trim() ?? "")
      ).length,
    [rows]
  );

  const navPages = tylerTextOverviewNavPages("weekly");

  async function saveDraft(row: TylerTextOverviewAdminDraftRow) {
    if (!row.draftId) return;
    setSavingDraftId(row.draftId);
    try {
      const res = await fetch(`/api/admin/tyler-text-overview/${encodeURIComponent(row.draftId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentBodyToSend: edits[row.draftId] ?? "" }),
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
      showToast("Saved. Draft only — did not send.");
    } catch (err) {
      console.error("Failed to save weekly draft", err);
      showToast("Save failed.");
    } finally {
      setSavingDraftId(null);
    }
  }

  async function generateWeeklyDraft(row: TylerTextOverviewAdminDraftRow) {
    if (!row.clerkUserId?.trim()) return;
    if (isWeeklyDraftSent(row)) return;
    if (canEditWeeklyDraft(row) && isWeeklyDraftDirty(row, edits)) {
      showToast("Save or discard edits before regenerating.");
      return;
    }
    setGeneratingUserId(row.clerkUserId);
    try {
      const res = await fetch("/api/admin/tyler-text-overview/weekly-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clerk_user_id: row.clerkUserId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        showToast(json.error || json.reason || "Weekly draft generation failed.");
        return;
      }
      showToast(
        formatWeeklyGenerateSuccessToast({
          machineShouldSend: json.machine_should_send,
          machineDraftBody: json.machine_draft_body,
          machineNoSendReason: json.machine_no_send_reason,
          weekKey: json.week_key,
          currentDraftProtected: json.current_draft_protected === true,
        })
      );
      await load(selectedDayKey, searchQuery);
    } catch (err) {
      console.error("Failed to generate weekly draft", err);
      showToast("Weekly draft generation failed.");
    } finally {
      setGeneratingUserId(null);
    }
  }

  async function generateMissingWeeklyDrafts() {
    setConfirmGenerateMissing(false);
    setGeneratingMissingAll(true);
    const existingSnapshot = readWeeklyGenerateAllSnapshot();
    const excludeClerkUserIds: string[] = [];
    let audienceClerkUserIds = existingSnapshot?.audienceClerkUserIds ?? null;
    try {
      for (;;) {
        const res = await fetch("/api/admin/tyler-text-overview/weekly-generate-all", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(audienceClerkUserIds
              ? { audience_clerk_user_ids: audienceClerkUserIds }
              : {}),
            ...(excludeClerkUserIds.length > 0
              ? { exclude_clerk_user_ids: excludeClerkUserIds }
              : {}),
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.result) {
          showToast(json.error || "Generate missing weekly drafts failed.");
          break;
        }
        const result = json.result as {
          targeted: number;
          generated_complete: number;
          protected_complete: number;
          already_sent: number;
          failed: number;
          remaining: number;
          processed_this_chunk: number;
          is_complete: boolean;
          audience_clerk_user_ids: string[];
          failures: Array<{ clerkUserId: string; preferredName: string | null; error: string }>;
        };
        audienceClerkUserIds = result.audience_clerk_user_ids;
        writeWeeklyGenerateAllSnapshot({ audienceClerkUserIds });
        setGenerateAllResumeAvailable(true);
        for (const f of result.failures ?? []) {
          if (!excludeClerkUserIds.includes(f.clerkUserId)) {
            excludeClerkUserIds.push(f.clerkUserId);
          }
        }
        showToast(
          formatTtoGenerateAllProgressLine({
            generatedComplete: result.generated_complete,
            targeted: result.targeted,
            failed: result.failed,
            remaining: result.remaining,
          })
        );
        if (result.is_complete) {
          clearWeeklyGenerateAllSnapshot();
          setGenerateAllResumeAvailable(false);
          break;
        }
        if (result.processed_this_chunk === 0) {
          break;
        }
      }
      await load(selectedDayKey, searchQuery);
    } catch (err) {
      console.error("Failed to generate missing weekly drafts", err);
      showToast("Generate missing weekly drafts failed.");
    } finally {
      setGeneratingMissingAll(false);
    }
  }

  async function sendWeeklyDraft(row: TylerTextOverviewAdminDraftRow) {
    if (!row.draftId) return;
    setSendingDraftId(row.draftId);
    setConfirmSendRow(null);
    try {
      const res = await fetch("/api/admin/tyler-text-overview/weekly-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft_id: row.draftId,
          ...(row.weekKey?.trim() ? { week_key: row.weekKey.trim() } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        showToast(json.message || json.error || json.refusalCode || "Weekly send failed.");
        return;
      }
      showToast("Weekly text sent.");
      await load(selectedDayKey, searchQuery);
    } catch (err) {
      console.error("Failed to send weekly draft", err);
      showToast("Weekly send failed.");
    } finally {
      setSendingDraftId(null);
    }
  }

  const dayFilterOptions = (() => {
    const keys = [...availableDayKeys];
    const selected = selectedDayKey.trim();
    if (selected && !keys.includes(selected)) {
      keys.push(selected);
      keys.sort((a, b) => b.localeCompare(a));
    }
    return keys;
  })();

  return (
    <div className="space-y-6">
      {confirmGenerateMissing ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="weekly-generate-missing-confirm-title"
        >
          <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-5 shadow-lg space-y-4">
            <h2
              id="weekly-generate-missing-confirm-title"
              className="text-lg font-semibold text-gray-900"
            >
              {WEEKLY_TTO_GENERATE_MISSING_CONFIRM_TITLE}
            </h2>
            <p className="text-sm text-gray-700">{WEEKLY_TTO_GENERATE_MISSING_CONFIRM_COPY}</p>
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900"
                onClick={() => setConfirmGenerateMissing(false)}
                disabled={generatingMissingAll}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded border border-gray-900 bg-white px-4 py-2 text-sm font-medium text-gray-900 disabled:opacity-50"
                disabled={generatingMissingAll}
                onClick={() => generateMissingWeeklyDrafts()}
              >
                {weeklyGenerateMissingButtonLabel(
              generatingMissingAll,
              generateAllResumeAvailable
            )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmSendRow ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="weekly-send-confirm-title"
        >
          <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-5 shadow-lg space-y-4">
            <h2 id="weekly-send-confirm-title" className="text-lg font-semibold text-gray-900">
              Send weekly text?
            </h2>
            <p className="text-sm text-gray-700">
              Send this saved Weekly TTO draft to{" "}
              <span className="font-mono">{confirmSendRow.clerkUserId}</span>
              {confirmSendRow.weekKey?.trim() ? (
                <>
                  {" "}
                  for <span className="font-mono">{confirmSendRow.weekKey}</span>
                </>
              ) : null}
              ? This sends a real SMS via Twilio. It cannot be unsent.
            </p>
            <p className="text-sm text-gray-700">{WEEKLY_TTO_MANUAL_SEND_NOTE}</p>
            <p className="text-sm font-medium text-gray-800">{WEEKLY_TTO_FOOTER_AT_SEND_COPY}</p>
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
                disabled={isWeeklySendBusy({
                  draftId: confirmSendRow.draftId,
                  sendingDraftId,
                })}
                onClick={() => sendWeeklyDraft(confirmSendRow)}
              >
                {weeklySendButtonLabel(
                  isWeeklySendBusy({
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

      <div
        className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 space-y-2"
        role="alert"
      >
        <p>{WEEKLY_TTO_AUTHORITY_BANNER}</p>
        <p className="font-medium">{WEEKLY_TTO_NEXT_CUTOVER_COPY}</p>
        <p>{WEEKLY_TTO_STALE_DRAFT_GUIDANCE}</p>
      </div>

      <nav className="flex flex-wrap gap-3 text-sm">
        {navPages.map((p) => (
          <Link key={p.page} href={p.href} className="font-medium text-gray-900 underline">
            {p.label} Text Overview →
          </Link>
        ))}
      </nav>

      <div className="rounded-md border border-gray-200 bg-white px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded border border-gray-900 bg-white px-4 py-2 text-sm font-medium text-gray-900 disabled:opacity-50"
            disabled={generatingMissingAll || Boolean(generatingUserId) || loading}
            onClick={() => setConfirmGenerateMissing(true)}
          >
            {weeklyGenerateMissingButtonLabel(
              generatingMissingAll,
              generateAllResumeAvailable
            )}
          </button>
        </div>
        <p className="text-sm text-gray-700">{WEEKLY_TTO_GENERATE_MISSING_HELP_COPY}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-gray-700">
          Week Sunday (draft_for_day_key)
          <select
            className="mt-1 block rounded border border-gray-300 px-3 py-2 text-sm"
            value={selectedDayKey}
            onChange={(e) => setSelectedDayKey(e.target.value)}
          >
            {dayFilterOptions.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-700">
          Search
          <input
            className="mt-1 block rounded border border-gray-300 px-3 py-2 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="name, phone, user id"
          />
        </label>
      </div>

      {counts ? (
        <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {COUNT_KEYS.map((key) => (
            <div key={key} className="rounded border border-gray-200 bg-white px-3 py-2">
              <dt className="text-xs text-gray-500">{adminCountLabel(key, sendSlot)}</dt>
              <dd className="text-lg font-semibold text-gray-900">{counts[key]}</dd>
            </div>
          ))}
          <div className="rounded border border-gray-200 bg-white px-3 py-2">
            <dt className="text-xs text-gray-500">Blank body (current)</dt>
            <dd className="text-lg font-semibold text-gray-900">{blankBodyCount}</dd>
          </div>
        </dl>
      ) : null}

      {loading ? (
        <p className="text-sm text-gray-500">Loading drafts…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-600">No sendable audience rows.</p>
      ) : (
        <ul className="space-y-8">
          {rows.map((row) => {
            const sent = isWeeklyDraftSent(row);
            const editable = canEditWeeklyDraft(row);
            const dirty = editable && isWeeklyDraftDirty(row, edits);
            const isGenerating =
              Boolean(row.clerkUserId?.trim()) && generatingUserId === row.clerkUserId;
            const isSending = isWeeklySendBusy({
              draftId: row.draftId,
              sendingDraftId,
            });
            const canSend = isWeeklyManualSendEligible({
              rowState: row.rowState,
              draftStatus: row.draftStatus,
              sendSlot: row.sendSlot,
              draftId: row.draftId,
              currentBodyToSend: row.currentBodyToSend,
              machineShouldSend: row.machineShouldSend,
              dirty,
              sending: isSending,
              editedByTyler: row.editedByTyler,
              currentBodySource: row.currentBodySource,
            });
            const hasDraft = row.rowState !== "no_draft_yet";
            const readOnlyBody =
              sent && row.finalBodySent?.trim()
                ? row.finalBodySent
                : row.currentBodyToSend;
            const emptyCopy =
              !(readOnlyBody?.trim() || (row.draftId ? edits[row.draftId]?.trim() : ""))
                ? row.rowState === "no_draft_yet"
                  ? { primary: "No weekly draft yet.", secondary: null }
                  : formatWeeklyEmptyBodyPanelCopy({
                      machineShouldSend: row.machineShouldSend,
                      machineNoSendReason: row.machineNoSendReason,
                    })
                : null;
            const provenance = buildWeeklyProvenanceExplanationBlocks(row);
            const rawNotebook = getWeeklyRawNotebookSectionCopy(row);

            return (
              <li
                key={`${row.clerkUserId}:${row.draftForDayKey}:${row.draftId ?? "none"}`}
                className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-5"
              >
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">
                      {rowStateLabel(row.rowState, sendSlot)}
                    </span>
                    {sent ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                        SENT
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">
                        weekly_review · MANUAL SEND
                      </span>
                    )}
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
                  <dl className="grid gap-2 text-xs text-gray-700 sm:grid-cols-2">
                    <div>
                      <dt className="font-medium text-gray-500">week_key</dt>
                      <dd className="font-mono">{formatOptional(row.weekKey)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">draft_for_day_key (Sunday)</dt>
                      <dd className="font-mono">{formatOptional(row.draftForDayKey)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">week_start</dt>
                      <dd className="font-mono">{formatOptional(row.weekStart)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">week_end</dt>
                      <dd className="font-mono">{formatOptional(row.weekEnd)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">timezone</dt>
                      <dd className="font-mono">{formatOptional(row.timezone)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">machine_should_send</dt>
                      <dd className="font-mono">
                        {row.machineShouldSend == null ? "—" : String(row.machineShouldSend)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">message_for</dt>
                      <dd className="font-mono">
                        {formatPersistedMessageForLine(row.messageFor) ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">interpreter_path</dt>
                      <dd className="font-mono break-all">
                        {formatOptional(
                          row.morningBriefInterpreterV1
                            ? "weekly_brief_interpreter_v1"
                            : row.coachingStack === "shared_sol_v1"
                              ? "weekly_brief_interpreter_v1"
                              : null
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">interpreter model</dt>
                      <dd className="font-mono">
                        {formatOptional(row.morningBriefInterpreterV1?.model)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">interpreter reasoning</dt>
                      <dd className="font-mono">
                        {formatOptional(row.morningBriefInterpreterV1?.reasoningEffort)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">writer model</dt>
                      <dd className="font-mono">
                        {formatOptional(
                          row.morningWriterCaptureV1?.model ?? row.authoritativeWriterModel
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">writer reasoning</dt>
                      <dd className="font-mono">
                        {formatOptional(row.morningWriterCaptureV1?.reasoningEffort)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">notebook_hash</dt>
                      <dd className="font-mono break-all">
                        {formatOptional(row.notebookHash)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">current_body_source</dt>
                      <dd className="font-mono">
                        {formatOptional(row.currentBodySource)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">Tyler edited</dt>
                      <dd className="font-mono">{row.editedByTyler ? "true" : "false"}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">blank</dt>
                      <dd className="font-mono">
                        {row.currentBodyToSend?.trim() ? "false" : "true"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">send status</dt>
                      <dd className="font-mono">{formatOptional(row.draftStatus)}</dd>
                    </div>
                  </dl>

                  <div>
                    <p className="text-xs font-medium text-gray-500">
                      {sent ? "final_body_sent / current_body_to_send" : "current_body_to_send"}
                    </p>
                    {!editable ? (
                      emptyCopy ? (
                        <div className="mt-1 w-full min-h-[96px] rounded border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-600 space-y-1">
                          <p className="font-medium text-gray-800">{emptyCopy.primary}</p>
                          {emptyCopy.secondary ? (
                            <p className="text-xs text-gray-600 font-mono break-all">
                              {emptyCopy.secondary}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <pre className="mt-1 w-full min-h-[96px] rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-mono whitespace-pre-wrap">
                          {readOnlyBody ?? "—"}
                        </pre>
                      )
                    ) : (
                      <>
                        <textarea
                          className="mt-1 w-full min-h-[96px] rounded border border-gray-300 px-3 py-2 text-sm font-mono"
                          value={edits[row.draftId as string] ?? ""}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [row.draftId as string]: e.target.value,
                            }))
                          }
                        />
                        <p className="mt-1 text-xs text-gray-600">{WEEKLY_TTO_SAVE_ONLY_COPY}</p>
                        <p className="mt-1 text-xs text-gray-600">{WEEKLY_TTO_MANUAL_SEND_NOTE}</p>
                        {dirty ? (
                          <p className="mt-1 text-xs font-medium text-amber-800">
                            {WEEKLY_TTO_SAVE_BEFORE_SEND_COPY}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          className="mt-2 rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                          disabled={savingDraftId === row.draftId}
                          onClick={() => saveDraft(row)}
                        >
                          {savingDraftId === row.draftId ? "Saving…" : "Save Weekly Text"}
                        </button>
                      </>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {canSend ? (
                      <button
                        type="button"
                        className="rounded bg-emerald-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                        disabled={isSending}
                        onClick={() => setConfirmSendRow(row)}
                      >
                        {weeklySendButtonLabel(isSending)}
                      </button>
                    ) : null}
                    {editable && dirty ? (
                      <p className="text-xs font-medium text-amber-800">
                        {WEEKLY_TTO_SAVE_BEFORE_SEND_COPY}
                      </p>
                    ) : null}
                  </div>

                  {row.clerkUserId?.trim() && !sent ? (
                    <div className="space-y-1">
                      <button
                        type="button"
                        className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 disabled:opacity-50"
                        disabled={isGenerating || dirty || isSending}
                        onClick={() => generateWeeklyDraft(row)}
                      >
                        {weeklyGenerateButtonLabel({
                          isGenerating,
                          hasDraft,
                        })}
                      </button>
                      {hasDraft ? (
                        <p className="text-xs text-gray-600">{WEEKLY_TTO_REGENERATE_OVERWRITE_COPY}</p>
                      ) : null}
                    </div>
                  ) : null}
                </section>

                {provenance.length > 0 ? (
                  <section className="space-y-2 border-t border-gray-100 pt-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Provenance
                    </h3>
                    <p className="text-xs text-gray-600">{ADMIN_INTERPRETATION_LINE}</p>
                    <ul className="space-y-2 text-xs text-gray-700">
                      {provenance.map((block, idx) => (
                        <li key={`${block.kind}-${idx}`}>
                          <p className="whitespace-pre-wrap">{block.text}</p>
                        </li>
                      ))}
                    </ul>
                    <dl className="grid gap-2 text-xs text-gray-700 sm:grid-cols-2">
                      <div>
                        <dt className="font-medium text-gray-500">writer_prompt_path</dt>
                        <dd className="font-mono break-all">
                          {formatOptional(row.writerPromptPath)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-gray-500">machine_should_send</dt>
                        <dd className="font-mono">
                          {row.machineShouldSend == null ? "—" : String(row.machineShouldSend)}
                        </dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="font-medium text-gray-500">machine_no_send_reason</dt>
                        <dd className="font-mono break-all">
                          {formatOptional(row.machineNoSendReason)}
                        </dd>
                      </div>
                    </dl>
                    <p className="text-xs text-gray-500">
                      Notebook family: {notebookFamilyLabel(row.notebookFamily)}
                    </p>
                  </section>
                ) : null}

                <section className="space-y-2 border-t border-gray-100 pt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {rawNotebook.heading}
                  </h3>
                  {rawNotebook.emptyMessage ? (
                    <p className="text-xs text-gray-600">{rawNotebook.emptyMessage}</p>
                  ) : (
                    <>
                      {rawNotebook.label ? (
                        <p className="text-xs text-gray-600">{rawNotebook.label}</p>
                      ) : null}
                      <div className="space-y-3">
                        {rawNotebook.messages.map((message, index) => (
                          <div key={`${row.draftId ?? row.clerkUserId}-nb-${index}`}>
                            <p className="text-xs font-semibold text-gray-600">
                              {notebookRoleLabel(message.role)}
                            </p>
                            <pre className="mt-1 max-h-64 overflow-auto rounded bg-gray-50 p-3 text-[11px] font-mono whitespace-pre-wrap text-gray-800">
                              {message.content}
                            </pre>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </section>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
