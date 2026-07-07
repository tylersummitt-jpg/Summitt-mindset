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
import type { TylerTextOverviewAdminDraftRow } from "@/lib/tyler-text-overview-types";
import { SMS_DAILY_EVENING_PREVIEW_SEND_SLOT } from "@/lib/tyler-text-overview-types";

type EditState = Record<string, string>;
type SendSlotTab = "morning" | typeof SMS_DAILY_EVENING_PREVIEW_SEND_SLOT;

const EVENING_PREVIEW_BANNER_TITLE = "PREVIEW ONLY — NOT SENDABLE";
const EVENING_PREVIEW_BANNER_BODY =
  "Evening check-in previews are for review only. They cannot be sent, pinned, or protected. Production daily SMS remains the morning slot.";

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
              key={`${row.draftId}-prov-${index}`}
              className="rounded border border-amber-200 bg-amber-50 px-2 py-2 text-amber-900"
            >
              {block.text}
            </p>
          );
        }
        if (block.kind === "detail") {
          return (
            <p key={`${row.draftId}-prov-${index}`} className="text-gray-700">
              {block.text}
            </p>
          );
        }
        return (
          <p
            key={`${row.draftId}-prov-${index}`}
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
        <div key={`${row.draftId}-${index}`}>
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
  const [availableDayKeys, setAvailableDayKeys] = useState<string[]>([]);
  const [selectedDayKey, setSelectedDayKey] = useState<string>(
    () => searchParams.get("draft_for_day_key") ?? ""
  );
  const [edits, setEdits] = useState<EditState>({});
  const [loading, setLoading] = useState(true);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [generatingUserId, setGeneratingUserId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  }

  const load = useCallback(
    async (dayKey: string, sendSlot: SendSlotTab) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("send_slot", sendSlot);
        if (dayKey) {
          params.set("draft_for_day_key", dayKey);
        }
        const res = await fetch(`/api/admin/tyler-text-overview?${params.toString()}`);
        const json = await res.json();

        if (!res.ok || !json.ok) {
          showToast(json.error || "Could not load drafts.");
          setRows([]);
          setAvailableDayKeys([]);
          return;
        }

        const nextRows = (json.rows || []) as TylerTextOverviewAdminDraftRow[];
        setRows(nextRows);
        setAvailableDayKeys((json.availableDayKeys || []) as string[]);
        setEdits(
          Object.fromEntries(
            nextRows.map((row) => [row.draftId, row.currentBodyToSend ?? ""])
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
    load(selectedDayKey, activeSendSlot);
  }, [load, selectedDayKey, activeSendSlot]);

  async function saveDraft(row: TylerTextOverviewAdminDraftRow) {
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
      setEdits((prev) => ({ ...prev, [updated.draftId]: updated.currentBodyToSend ?? "" }));
      showToast("Saved.");
    } catch (err) {
      console.error("Failed to save draft", err);
      showToast("Save failed.");
    } finally {
      setSavingDraftId(null);
    }
  }

  async function generateEveningPreview(row: TylerTextOverviewAdminDraftRow) {
    if (!row.clerkUserId?.trim() || !row.draftForDayKey?.trim()) {
      return;
    }

    setGeneratingUserId(row.clerkUserId);
    try {
      const res = await fetch("/api/admin/tyler-text-overview/evening-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clerk_user_id: row.clerkUserId,
          draft_for_day_key: row.draftForDayKey,
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
      if (selectedDayKey || row.draftForDayKey) {
        params.set("draft_for_day_key", selectedDayKey || row.draftForDayKey);
      }
      router.push(`/admin/tyler-text-overview?${params.toString()}`);
    } catch (err) {
      console.error("Failed to generate evening preview", err);
      showToast("Evening preview generation failed.");
    } finally {
      setGeneratingUserId(null);
    }
  }

  const morningTabHref = buildTabHref("morning", selectedDayKey);
  const eveningTabHref = buildTabHref(SMS_DAILY_EVENING_PREVIEW_SEND_SLOT, selectedDayKey);

  return (
    <div className="space-y-6">
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
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading drafts…</p>
      ) : rows.length === 0 ? (
        isEveningTab ? (
          <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-700 space-y-3">
            <p>No evening previews for this day yet.</p>
            <p>
              Go to{" "}
              <Link href={morningTabHref} className="font-medium text-gray-900 underline">
                Morning / Primary Daily
              </Link>{" "}
              and click &ldquo;Generate Evening Preview&rdquo; on a user row.
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No current drafts found.</p>
        )
      ) : (
        <ul className="space-y-8">
          {rows.map((row) => {
            const eveningRow = isEveningPreviewRow(row);

            return (
              <li
                key={row.draftId}
                className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-5"
              >
                <section className="space-y-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                    Admin only
                  </h2>
                  <div>
                    <p className="text-xs font-medium text-gray-500">clerk_user_id</p>
                    <p className="mt-1 font-mono text-sm text-gray-900 break-all">
                      {row.clerkUserId}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500">Send slot</p>
                    <p className="mt-1 text-sm text-gray-900">
                      {eveningRow ? (
                        <>
                          evening_checkin ·{" "}
                          <span className="font-semibold text-amber-800">PREVIEW ONLY</span>
                        </>
                      ) : row.sendSlot === "morning" ? (
                        "morning / primary daily"
                      ) : (
                        row.sendSlot
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500">current_body_to_send</p>
                    {eveningRow ? (
                      <pre className="mt-1 w-full min-h-[96px] rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-mono whitespace-pre-wrap">
                        {row.currentBodyToSend ?? "—"}
                      </pre>
                    ) : (
                      <>
                        <textarea
                          id={`body-${row.draftId}`}
                          className="mt-1 w-full min-h-[96px] rounded border border-gray-300 px-3 py-2 text-sm font-mono"
                          value={edits[row.draftId] ?? ""}
                          onChange={(e) =>
                            setEdits((prev) => ({ ...prev, [row.draftId]: e.target.value }))
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
                  {!isEveningTab &&
                  row.clerkUserId?.trim() &&
                  row.draftForDayKey?.trim() ? (
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
                  row.clerkUserId?.trim() &&
                  row.draftForDayKey?.trim() ? (
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
