"use client";

import { useCallback, useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";

import {
  buildSmsPreferencesPatchBody,
  editBaselineFromView,
  editFormFromView,
  SMS_PREFS_STOPPED_COPY,
  type SmsPreferencesEditBaseline,
  type SmsPreferencesEditFormState,
} from "@/lib/sms-preferences-patch-body";
import {
  SMS_PREFS_COMPLIANCE_COPY,
  type SmsPreferencesView,
} from "@/lib/sms-preferences-types";

type LoadState = "loading" | "legacy" | "ready" | "error";

const PAUSE_REASON_OPTIONS = [
  { value: "pause_request", label: "Requested pause" },
  { value: "vacation", label: "Vacation" },
  { value: "travel", label: "Travel" },
  { value: "illness", label: "Illness" },
  { value: "family_emergency", label: "Family emergency" },
  { value: "weekend_or_short_break", label: "Short break" },
  { value: "work_or_schedule_overload", label: "Work or schedule overload" },
  { value: "other", label: "Other" },
];

function statusHeadline(view: SmsPreferencesView): string {
  if (view.relationshipStatus === "stopped") return "Texts are off (STOP)";
  if (view.relationshipStatus === "paused") return "Check-ins paused for now";
  if (view.relationshipStatus === "not_configured") return "Phone not set up";
  return "Check-ins are on";
}

function statusDetail(view: SmsPreferencesView): string {
  if (view.relationshipStatus === "stopped") {
    return "Reply START to your Summitt number to resume carrier delivery.";
  }
  if (view.relationshipStatus === "paused" && view.pauseUntil) {
    const until = new Date(view.pauseUntil);
    const label = Number.isFinite(until.getTime())
      ? until.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
      : "soon";
    return `Pat will pick back up after ${label}.`;
  }
  if (view.lowPressureActive) {
    return "Pat is keeping check-ins lighter while you find your footing again.";
  }
  return "Pat texts you about the commitment you chose—not a notification feed.";
}

function formatSmsPhoneDisplay(phoneRaw: unknown): string | null {
  if (typeof phoneRaw !== "string" || !phoneRaw.trim()) return null;
  const digits = phoneRaw.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `(***) ***-${digits.slice(-4)}`;
}

export function LegacyTextMessagesCard() {
  const { user, isLoaded } = useUser();
  const md = user?.publicMetadata as Record<string, unknown> | undefined;

  const smsOn = md?.smsEnabled === true;
  const maskedPhone = formatSmsPhoneDisplay(md?.phoneNumber);

  let status: string;
  let phoneLabel: string;

  if (!isLoaded) {
    status = "—";
    phoneLabel = "—";
  } else {
    status = smsOn ? "On" : "Off";
    phoneLabel = maskedPhone ?? "Not set";
  }

  return (
    <div className="w-full space-y-2">
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
        <div className="flex justify-between gap-4 py-1">
          <span className="text-gray-600">Status</span>
          <span className="font-medium text-gray-900">{status}</span>
        </div>
        <div className="flex justify-between gap-4 py-1">
          <span className="text-gray-600">Phone</span>
          <span className="font-medium text-gray-900">{phoneLabel}</span>
        </div>
      </div>
      <p className="text-xs text-gray-500 text-center">{SMS_PREFS_COMPLIANCE_COPY}</p>
    </div>
  );
}

function TextCheckInsContent({
  view,
  onSaved,
}: {
  view: SmsPreferencesView;
  onSaved: (next: SmsPreferencesView) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [baseline, setBaseline] = useState<SmsPreferencesEditBaseline>(() =>
    editBaselineFromView(view)
  );
  const [form, setForm] = useState<SmsPreferencesEditFormState>(() => editFormFromView(view));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const stopped = view.relationshipStatus === "stopped";
  const canEdit = !stopped && view.smsEnabled;

  useEffect(() => {
    const nextBaseline = editBaselineFromView(view);
    setBaseline(nextBaseline);
    setForm(editFormFromView(view));
  }, [view]);

  const handleSave = async () => {
    const patchBody = buildSmsPreferencesPatchBody(baseline, form);
    if (!patchBody) {
      setSaveError("No changes to save");
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/sms/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(typeof data.error === "string" ? data.error : "Could not save changes");
        return;
      }
      onSaved(data as SmsPreferencesView);
      setEditOpen(false);
    } catch {
      setSaveError("Could not save changes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full space-y-3 text-sm">
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-4 text-left space-y-3">
        <div className="space-y-1">
          <h2 className="font-semibold text-gray-900">Text check-ins</h2>
          <p className="text-gray-600 text-xs leading-relaxed">
            Pat texts you about the commitment you chose. This shapes how often Pat reaches
            out—it does not change your commitment.
          </p>
        </div>

        <div className="rounded-md bg-gray-50 px-3 py-2 space-y-1">
          <p className="font-medium text-gray-900">{statusHeadline(view)}</p>
          <p className="text-gray-600 text-xs leading-relaxed">{statusDetail(view)}</p>
        </div>

        <div className="space-y-2 pt-1">
          <div className="flex justify-between gap-4">
            <span className="text-gray-600">Phone</span>
            <span className="font-medium text-gray-900">{view.phoneMasked ?? "Not set"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-600">Cadence</span>
            <span className="font-medium text-gray-900">{view.cadenceLabel}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-600">Weekends</span>
            <span className="font-medium text-gray-900">{view.weekendLabel}</span>
          </div>
        </div>

        <p className="text-xs text-gray-500 leading-relaxed border-t border-gray-100 pt-3">
          Pause is temporary—you&apos;re still in the relationship. STOP is a carrier-level opt-out.
        </p>
      </div>

      {canEdit ? (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <button
            type="button"
            onClick={() => {
              setEditOpen((open) => {
                if (!open) {
                  setBaseline(editBaselineFromView(view));
                  setForm(editFormFromView(view));
                }
                return !open;
              });
            }}
            className="w-full text-left font-medium text-gray-900 text-sm"
          >
            {editOpen ? "Hide rhythm settings" : "Adjust rhythm"}
          </button>

          {editOpen ? (
            <div className="mt-4 space-y-4">
              <div className="space-y-1">
                <label className="text-xs text-gray-600" htmlFor="cadence">
                  How often
                </label>
                <select
                  id="cadence"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={form.cadenceOverride}
                  onChange={(e) => setForm((f) => ({ ...f, cadenceOverride: e.target.value }))}
                >
                  <option value="">Default rhythm</option>
                  <option value="every_other_day">Every other day</option>
                  <option value="every_3_days">Every 3 days</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-600" htmlFor="weekends">
                  Weekends
                </label>
                <select
                  id="weekends"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={form.weekendSendPolicy}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, weekendSendPolicy: e.target.value }))
                  }
                >
                  <option value="all">All days</option>
                  <option value="weekdays_only">Weekdays only</option>
                </select>
              </div>

              <div className="space-y-2 border-t border-gray-100 pt-3">
                <p className="text-xs font-medium text-gray-900">Pause check-ins until</p>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={form.clearPause}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        clearPause: e.target.checked,
                        pauseUntilLocal: e.target.checked ? "" : f.pauseUntilLocal,
                      }))
                    }
                  />
                  Clear pause
                </label>
                {!form.clearPause ? (
                  <>
                    <input
                      type="date"
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      value={form.pauseUntilLocal}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, pauseUntilLocal: e.target.value }))
                      }
                    />
                    <select
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      value={form.pauseReasonCategory}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, pauseReasonCategory: e.target.value }))
                      }
                    >
                      {PAUSE_REASON_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </>
                ) : null}
              </div>

              {saveError ? <p className="text-xs text-red-600">{saveError}</p> : null}

              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="w-full rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-gray-500 text-center leading-relaxed">{SMS_PREFS_STOPPED_COPY}</p>
      )}

      <p className="text-xs text-gray-500 text-center leading-relaxed">{view.compliance.stopHelpStart}</p>
    </div>
  );
}

export default function AccountSmsBlock() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [view, setView] = useState<SmsPreferencesView | null>(null);
  const [fetchError, setFetchError] = useState(false);

  const load = useCallback(async () => {
    setLoadState("loading");
    setFetchError(false);
    try {
      const res = await fetch("/api/sms/preferences");
      if (res.status === 404) {
        setLoadState("legacy");
        return;
      }
      if (!res.ok) {
        setFetchError(true);
        setLoadState("legacy");
        return;
      }
      const data = (await res.json()) as SmsPreferencesView;
      setView(data);
      setLoadState("ready");
    } catch {
      setFetchError(true);
      setLoadState("legacy");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadState === "loading") {
    return (
      <div className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500 text-center">
        Loading text check-ins…
      </div>
    );
  }

  if (loadState === "legacy") {
    return (
      <>
        {fetchError ? (
          <p className="text-xs text-amber-700 text-center">
            Could not load text check-in settings. Showing basic text check-in status.
          </p>
        ) : null}
        <LegacyTextMessagesCard />
      </>
    );
  }

  if (!view) {
    return <LegacyTextMessagesCard />;
  }

  return <TextCheckInsContent view={view} onSaved={setView} />;
}
