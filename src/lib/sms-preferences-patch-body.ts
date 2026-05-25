import type { SmsPreferencesView } from "@/lib/sms-preferences-types";

export type SmsPreferencesEditFormState = {
  cadenceOverride: string;
  weekendSendPolicy: string;
  pauseUntilLocal: string;
  pauseReasonCategory: string;
  clearPause: boolean;
};

export type SmsPreferencesEditBaseline = Omit<SmsPreferencesEditFormState, "clearPause">;

export const SMS_PREFS_STOPPED_COPY =
  "Texts are off. Reply START to your Summitt number to resume. You can adjust rhythm after texts are back on.";

export function editBaselineFromView(view: SmsPreferencesView): SmsPreferencesEditBaseline {
  return {
    cadenceOverride: view.cadenceOverride ?? "",
    weekendSendPolicy: view.weekendSendPolicy ?? "all",
    pauseUntilLocal: view.editable.pauseUntil ? view.editable.pauseUntil.slice(0, 10) : "",
    pauseReasonCategory: view.editable.pauseReasonCategory ?? "pause_request",
  };
}

export function editFormFromView(view: SmsPreferencesView): SmsPreferencesEditFormState {
  return {
    ...editBaselineFromView(view),
    clearPause: false,
  };
}

export function buildSmsPreferencesPatchBody(
  baseline: SmsPreferencesEditBaseline,
  form: SmsPreferencesEditFormState
): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};

  if (form.clearPause) {
    if (baseline.pauseUntilLocal) {
      body.clearPause = true;
    }
  } else {
    const pauseChanged =
      form.pauseUntilLocal !== baseline.pauseUntilLocal ||
      (form.pauseUntilLocal !== "" &&
        form.pauseReasonCategory !== baseline.pauseReasonCategory);
    if (pauseChanged && form.pauseUntilLocal) {
      const end = new Date(`${form.pauseUntilLocal}T23:59:59`);
      body.pause_until = end.toISOString();
      body.pause_reason_category = form.pauseReasonCategory;
    }
  }

  if (form.cadenceOverride !== baseline.cadenceOverride) {
    if (form.cadenceOverride === "") {
      body.clearCadenceOverride = true;
    } else {
      body.cadence_override = form.cadenceOverride;
    }
  }

  if (form.weekendSendPolicy !== baseline.weekendSendPolicy) {
    body.weekend_send_policy = form.weekendSendPolicy;
  }

  return Object.keys(body).length > 0 ? body : null;
}
