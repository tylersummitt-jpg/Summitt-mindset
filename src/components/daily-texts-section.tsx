"use client";

import { useEffect, useRef, useState } from "react";

import {
  utBody,
  utErrorPanel,
  utFormField,
  utPrimaryBtn,
  utSecondaryBtn,
  utSectionTitle,
} from "@/components/utility-page-visual";
import {
  SMS_WEEKDAYS,
  applySameTimeToEnabledDays,
  buildDailyTextsSaveBody,
  canSaveDailyTexts,
  classifyPreferenceWriteResponse,
  dailyTextsFrequencyCopy,
  defaultWeeklySchedule,
  displayScheduleForAccount,
  enabledDayCount,
  explicitTimezoneSelection,
  mergeAccountDailyTextsDraft,
  formatLocalMinuteLabel,
  formatTimedPauseWhen,
  quarterHourMinutes,
  sameTimeAcrossEnabledDays,
  scheduleHasNighttimeDelivery,
  timezoneChoices,
  timezoneLabel,
  type SmsWeekday,
  type SmsWeeklySchedule,
} from "@/lib/sms-account-schedule";
import type { SmsPreferencesView } from "@/lib/sms-preferences-types";

const DAY_LABELS: Record<SmsWeekday, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

const NIGHT_NOTICE =
  "You are choosing to receive texts during nighttime or early morning hours. You can change your preferences or opt out at any time.";

const STILL_TEXT_COACH =
  "You can still text Coach Pat anytime while your daily texts are paused.";

const UNCERTAIN_SAVE =
  "We could not confirm whether that was saved. Refresh to check.";

const SAVED_REFRESH =
  "Saved. Refresh the page if other details look out of date.";

const SAVED_PARTIAL = "Saved. Refresh to show the saved preferences.";

function isPreferencesView(value: unknown): value is SmsPreferencesView {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    row.ok === true &&
    typeof row.smsEnabled === "boolean" &&
    typeof row.applicationPauseActive === "boolean" &&
    typeof row.weeklyScheduleExplicit === "boolean" &&
    typeof row.effectiveTimezoneSource === "string"
  );
}

function scheduleFromView(next: SmsPreferencesView): SmsWeeklySchedule {
  return next.scheduleInvalid
    ? defaultWeeklySchedule()
    : displayScheduleForAccount({
        explicitSchedule: next.weeklyScheduleExplicit ? next.weeklySchedule : null,
        weekendSendPolicy: next.weekendSendPolicy,
      });
}

export default function DailyTextsSection() {
  const [view, setView] = useState<SmsPreferencesView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [schedule, setSchedule] = useState<SmsWeeklySchedule>(defaultWeeklySchedule);
  const [sameTime, setSameTime] = useState(true);
  const [zone, setZone] = useState("America/New_York");
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [zoneDirty, setZoneDirty] = useState(false);
  const [zoneExplicit, setZoneExplicit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pauseSaving, setPauseSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [pauseNotice, setPauseNotice] = useState<string | null>(null);
  const [offerRefresh, setOfferRefresh] = useState(false);
  const saveLock = useRef(false);
  const pauseLock = useRef(false);

  function applyLoaded(next: SmsPreferencesView) {
    const nextSchedule = scheduleFromView(next);
    const unknown = next.effectiveTimezoneSource === "unknown";
    setView(next);
    setSchedule(nextSchedule);
    setSameTime(sameTimeAcrossEnabledDays(nextSchedule));
    setZone(unknown ? "" : next.effectiveTimezone);
    setZoneExplicit(false);
    setScheduleDirty(false);
    setZoneDirty(false);
    setSaveMessage(null);
    setSaveError(null);
    setOfferRefresh(false);
  }

  function mergeLoaded(next: SmsPreferencesView) {
    const unknown = next.effectiveTimezoneSource === "unknown";
    const merged = mergeAccountDailyTextsDraft({
      loadedSchedule: scheduleFromView(next),
      loadedZone: next.effectiveTimezone,
      sourceUnknown: unknown,
      draftSchedule: schedule,
      draftZone: zone,
      scheduleDirty,
      zoneDirty,
    });
    setView(next);
    setSchedule(merged.schedule);
    if (!scheduleDirty) setSameTime(sameTimeAcrossEnabledDays(merged.schedule));
    setZone(merged.zone);
    if (!zoneDirty) setZoneExplicit(false);
  }

  async function load(options?: { preserveDirty?: boolean }) {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/sms/preferences", { method: "GET" });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok || !isPreferencesView(body)) {
        if (!options?.preserveDirty) setView(null);
        setLoadError("Daily texts could not be loaded. The rest of your account is still available.");
        return;
      }
      if (options?.preserveDirty) {
        mergeLoaded(body);
        setSaveMessage(null);
        setPauseNotice(null);
        setOfferRefresh(false);
      } else {
        applyLoaded(body);
      }
    } catch {
      if (!options?.preserveDirty) setView(null);
      setLoadError("Daily texts could not be loaded. The rest of your account is still available.");
    } finally {
      setLoading(false);
    }
  }

  const loadOnMount = useRef(load);
  loadOnMount.current = load;
  useEffect(() => {
    void loadOnMount.current();
  }, []);

  function updateSchedule(next: SmsWeeklySchedule) {
    setSchedule(next);
    setScheduleDirty(true);
    setSaveMessage(null);
  }

  function toggleDay(day: SmsWeekday) {
    const next = { ...schedule };
    if (next[day] == null) {
      const enabled = SMS_WEEKDAYS.map((key) => schedule[key]).find((minute) => minute != null);
      next[day] = enabled ?? 7 * 60;
    } else {
      next[day] = null;
    }
    updateSchedule(sameTime ? applySameTimeToEnabledDays(next, sharedMinute(next)) : next);
  }

  async function postPreferences(
    payload: unknown,
    kind: "save" | "pause"
  ): Promise<
    | { state: "confirmed"; view: SmsPreferencesView; refreshRequired: boolean }
    | { state: "confirmed_partial"; refreshRequired: true }
    | { state: "failed"; message: string }
    | { state: "uncertain"; message: string }
  > {
    const failedMessage =
      kind === "pause"
        ? "That did not save. Your text status is unchanged."
        : "Save did not complete. Your changes are still here.";
    let res: Response;
    try {
      res = await fetch("/api/sms/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      return { state: "uncertain", message: UNCERTAIN_SAVE };
    }
    const body: unknown = await res.json().catch(() => null);
    const classified = classifyPreferenceWriteResponse({
      networkError: false,
      httpOk: res.ok,
      body,
    });
    if (classified.state === "uncertain" || body == null) {
      return { state: "uncertain", message: UNCERTAIN_SAVE };
    }
    if (classified.state === "confirmed" && isPreferencesView(body)) {
      return { state: "confirmed", view: body, refreshRequired: classified.refreshRequired };
    }
    if (classified.state === "confirmed") {
      return { state: "confirmed_partial", refreshRequired: true };
    }
    const message =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : failedMessage;
    return { state: "failed", message };
  }

  async function onPause() {
    if (!view || view.smsEnabled !== true || pauseLock.current || saveLock.current) return;
    pauseLock.current = true;
    setPauseSaving(true);
    setPauseError(null);
    setPauseNotice(null);
    const result = await postPreferences(
      { account_pause: view.applicationPauseActive ? "resume" : "indefinite" },
      "pause"
    );
    if (result.state === "confirmed") {
      setView(result.view);
      setPauseNotice(result.refreshRequired ? SAVED_REFRESH : null);
      setOfferRefresh(result.refreshRequired);
    } else if (result.state === "confirmed_partial") {
      setPauseNotice(SAVED_PARTIAL);
      setOfferRefresh(true);
    } else if (result.state === "uncertain") {
      setPauseNotice(result.message);
      setOfferRefresh(true);
    } else {
      setPauseError(result.message);
    }
    pauseLock.current = false;
    setPauseSaving(false);
  }

  async function onSave() {
    if (
      !view ||
      saveLock.current ||
      !canSaveDailyTexts({
        stopped: view.smsEnabled !== true,
        scheduleInvalid: view.scheduleInvalid,
        sourceUnknown: view.effectiveTimezoneSource === "unknown",
        zone,
        zoneExplicit,
      })
    ) {
      return;
    }
    const payload = buildDailyTextsSaveBody({
      schedule,
      timezone: zone,
      scheduleDirty,
      timezoneDirty: zoneDirty,
      explicitSchedule: view.weeklyScheduleExplicit,
    });
    if (!payload) {
      setSaveMessage("No changes to save.");
      setSaveError(null);
      return;
    }
    saveLock.current = true;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    const result = await postPreferences(payload, "save");
    if (result.state === "confirmed") {
      applyLoaded(result.view);
      setSaveMessage(result.refreshRequired ? SAVED_REFRESH : "Saved.");
      setOfferRefresh(result.refreshRequired);
    } else if (result.state === "confirmed_partial") {
      setSaveMessage(SAVED_PARTIAL);
      setOfferRefresh(true);
    } else if (result.state === "uncertain") {
      setSaveMessage(result.message);
      setOfferRefresh(true);
    } else {
      setSaveError(result.message);
    }
    saveLock.current = false;
    setSaving(false);
  }

  const stopped = view?.smsEnabled !== true;
  const paused = view?.applicationPauseActive === true;
  const sourceUnknown = view?.effectiveTimezoneSource === "unknown";
  const saveAllowed = view
    ? canSaveDailyTexts({
        stopped,
        scheduleInvalid: view.scheduleInvalid,
        sourceUnknown,
        zone,
        zoneExplicit,
      })
    : false;
  const canTextCoach =
    view?.smsEnabled === true && view.relationshipStatus !== "not_configured";
  const timedPauseLabel =
    view && view.timedPauseActive
      ? formatTimedPauseWhen(
          view.pauseUntil,
          view.effectiveTimezone,
          view.effectiveTimezoneSource !== "unknown"
        )
      : null;
  const enabled = enabledDayCount(schedule);
  const shared = sharedMinute(schedule);
  const night =
    enabled > 0 &&
    (sameTime
      ? scheduleHasNighttimeDelivery(applySameTimeToEnabledDays(schedule, shared))
      : scheduleHasNighttimeDelivery(schedule));
  const frequency = view
    ? dailyTextsFrequencyCopy({
        schedule: sameTime ? applySameTimeToEnabledDays(schedule, shared) : schedule,
        paused,
        stopped,
        explicitSchedule: view.weeklyScheduleExplicit,
        cadenceOverride: view.cadenceOverride,
        weekendSendPolicy: view.weekendSendPolicy,
        canTextCoach,
      })
    : "";

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className={utSectionTitle}>Daily Texts</h2>
        <p className={utBody}>Choose when Coach Pat texts you.</p>
      </div>

      {loading ? <p className={utBody}>Loading daily texts…</p> : null}

      {loadError ? (
        <div className="space-y-3">
          <p className={utErrorPanel} role="alert">
            {loadError}
          </p>
          <button
            type="button"
            className={utSecondaryBtn}
            onClick={() => void load({ preserveDirty: true })}
          >
            Try again
          </button>
        </div>
      ) : null}

      {view && !loading ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className={utBody}>
              {stopped
                ? "Status: Texts are stopped."
                : paused
                  ? "Status: Daily texts are paused."
                  : enabled === 0
                    ? "Status: Scheduled texts are off."
                    : "Status: Daily texts are on."}
            </p>
            {stopped ? (
              <p className={utBody}>Text START to resume text messages. Text HELP for info.</p>
            ) : (
              <button
                type="button"
                className={utSecondaryBtn}
                onClick={() => void onPause()}
                disabled={pauseSaving || saving}
                aria-label={paused ? "Resume Daily Texts" : "Pause Daily Texts"}
              >
                {pauseSaving ? "Saving…" : paused ? "Resume Daily Texts" : "Pause Daily Texts"}
              </button>
            )}
            {canTextCoach ? <p className={utBody}>{STILL_TEXT_COACH}</p> : null}
            {timedPauseLabel ? (
              <p className={utBody}>A timed pause is still on until {timedPauseLabel}.</p>
            ) : null}
            {pauseNotice ? <p className={utBody}>{pauseNotice}</p> : null}
            {pauseError ? (
              <p className={utErrorPanel} role="alert">
                {pauseError}
              </p>
            ) : null}
          </div>

          <label className="block space-y-2">
            <span className={utSectionTitle}>Time Zone</span>
            <select
              className={utFormField}
              value={sourceUnknown && !zoneExplicit ? "" : zone}
              disabled={stopped || saving}
              onChange={(event) => {
                const choice = explicitTimezoneSelection({ selectedZone: event.target.value });
                setZone(choice.zone);
                setZoneExplicit(choice.explicit);
                setZoneDirty(choice.explicit);
                setSaveMessage(null);
              }}
            >
              {sourceUnknown && !zoneExplicit ? (
                <option value="">Eastern Time (not confirmed)</option>
              ) : null}
              {!zone && !(sourceUnknown && !zoneExplicit) ? (
                <option value="">Time zone unavailable</option>
              ) : null}
              {zoneChoices(zone || (sourceUnknown ? "America/New_York" : null)).map((option) => (
                <option key={option.zone} value={option.zone}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-2">
            <p className={utSectionTitle}>Which days would you like to receive texts?</p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7" role="group" aria-label="Days">
              {SMS_WEEKDAYS.map((day) => {
                const selected = schedule[day] != null;
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={selected}
                    disabled={stopped || saving}
                    className={
                      selected
                        ? "rounded-lg bg-[var(--brand)] px-2 py-2 text-sm font-semibold text-white"
                        : "rounded-lg border border-white/20 bg-white/5 px-2 py-2 text-sm font-semibold text-stone-300"
                    }
                    onClick={() => toggleDay(day)}
                  >
                    {DAY_LABELS[day]}
                  </button>
                );
              })}
            </div>
            <p className={utBody}>{frequency}</p>
          </div>

          {enabled > 0 ? (
            <div className="space-y-3">
              <p className={utSectionTitle}>What time?</p>
              <div className="space-y-2" role="radiogroup" aria-label="What time?">
                <label className="flex items-center gap-2 text-sm text-stone-200">
                  <input
                    type="radio"
                    name="daily-text-time-mode"
                    checked={sameTime}
                    disabled={stopped || saving}
                    onChange={() => {
                      setSameTime(true);
                      updateSchedule(applySameTimeToEnabledDays(schedule, shared));
                    }}
                  />
                  Same time on selected days
                </label>
                <label className="flex items-center gap-2 text-sm text-stone-200">
                  <input
                    type="radio"
                    name="daily-text-time-mode"
                    checked={!sameTime}
                    disabled={stopped || saving}
                    onChange={() => {
                      setSameTime(false);
                      setScheduleDirty(true);
                      setSaveMessage(null);
                    }}
                  />
                  Different times each day
                </label>
              </div>

              {sameTime ? (
                <TimeSelect
                  id="daily-text-same-time"
                  label={zone ? `Time (${timezoneLabel(zone)})` : "Time"}
                  minute={shared}
                  disabled={stopped || saving}
                  onChange={(minute) => updateSchedule(applySameTimeToEnabledDays(schedule, minute))}
                />
              ) : (
                <div className="space-y-2">
                  {SMS_WEEKDAYS.map((day) =>
                    schedule[day] == null ? (
                      <p key={day} className="text-sm text-stone-400">
                        {DAY_LABELS[day]}: No text
                      </p>
                    ) : (
                      <TimeSelect
                        key={day}
                        id={`daily-text-${day}`}
                        label={zone ? `${DAY_LABELS[day]} (${timezoneLabel(zone)})` : DAY_LABELS[day]}
                        minute={schedule[day] as number}
                        disabled={stopped || saving}
                        onChange={(minute) => updateSchedule({ ...schedule, [day]: minute })}
                      />
                    )
                  )}
                </div>
              )}
            </div>
          ) : null}

          {view.scheduleInvalid ? (
            <p className={utErrorPanel} role="alert">
              The saved schedule could not be read. Retry before saving so a default is not written over it.
            </p>
          ) : null}

          {night ? <p className={utBody}>{NIGHT_NOTICE}</p> : null}

          {saveError ? (
            <p className={utErrorPanel} role="alert">
              {saveError}
            </p>
          ) : null}
          {saveMessage ? <p className={utBody}>{saveMessage}</p> : null}
          {offerRefresh ? (
            <button
              type="button"
              className={utSecondaryBtn}
              onClick={() => void load({ preserveDirty: true })}
            >
              Refresh saved preferences
            </button>
          ) : null}

          <button
            type="button"
            className={utPrimaryBtn}
            disabled={!saveAllowed || saving || pauseSaving}
            onClick={() => void onSave()}
          >
            {saving ? "Saving…" : "SAVE"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function sharedMinute(schedule: SmsWeeklySchedule): number {
  const found = SMS_WEEKDAYS.map((day) => schedule[day]).find((minute) => minute != null);
  return found ?? 7 * 60;
}

function zoneChoices(zone: string | null) {
  return timezoneChoices(zone || null);
}

function TimeSelect({
  id,
  label,
  minute,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  minute: number;
  disabled: boolean;
  onChange: (minute: number) => void;
}) {
  return (
    <label className="block space-y-1" htmlFor={id}>
      <span className="text-sm text-stone-300">{label}</span>
      <select
        id={id}
        className={utFormField}
        disabled={disabled}
        value={String(minute)}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {quarterHourMinutes(minute).map((value) => (
          <option key={value} value={value}>
            {formatLocalMinuteLabel(value)}
          </option>
        ))}
      </select>
    </label>
  );
}
