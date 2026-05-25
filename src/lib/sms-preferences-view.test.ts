import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { maskSmsPhoneDisplay } from "@/lib/sms-preferences-types";
import {
  buildSmsPreferencesViewModel,
  deriveRelationshipStatus,
  isClearOnlySmsPreferencesPatch,
  validateSmsPreferencesPatch,
} from "@/lib/sms-preferences-view";
import { MAX_PAUSE_DURATION_MS } from "@/lib/v2-sms-comms-preferences";
import type { V2UserSmsCommsPreferencesRow } from "@/lib/v2-sms-comms-preferences";

const baseRow = (over: Partial<V2UserSmsCommsPreferencesRow>): V2UserSmsCommsPreferencesRow => ({
  clerk_user_id: "user_1",
  pause_until: null,
  pause_reason_category: null,
  cadence_override: null,
  weekend_send_policy: null,
  preferred_send_window: null,
  preferred_local_hour: null,
  source_message_sid: null,
  resume_prompt_sent_at: null,
  created_at: "",
  updated_at: "",
  ...over,
});

const now = new Date("2026-05-22T15:00:00.000Z");

describe("sms-preferences-view", () => {
  it("builds active status", () => {
    const view = buildSmsPreferencesViewModel({
      uiEnabled: true,
      smsEnabled: true,
      phoneNumber: "+15551234567",
      timezoneRaw: "America/New_York",
      smsDisclosureAccepted: true,
      prefs: null,
      accountabilityPhase: "active_accountability",
      now,
    });
    expect(view.relationshipStatus).toBe("active");
    expect(view.pauseActive).toBe(false);
  });

  it("builds paused status", () => {
    const view = buildSmsPreferencesViewModel({
      uiEnabled: true,
      smsEnabled: true,
      phoneNumber: "+15551234567",
      timezoneRaw: "America/New_York",
      smsDisclosureAccepted: true,
      prefs: baseRow({ pause_until: "2026-12-01T11:00:00.000Z", pause_reason_category: "vacation" }),
      accountabilityPhase: "active_accountability",
      now,
    });
    expect(view.relationshipStatus).toBe("paused");
    expect(view.pauseActive).toBe(true);
    expect(view.pauseReasonLabel).toBe("Vacation");
  });

  it("builds stopped status", () => {
    const view = buildSmsPreferencesViewModel({
      uiEnabled: true,
      smsEnabled: false,
      phoneNumber: "+15551234567",
      timezoneRaw: "America/New_York",
      smsDisclosureAccepted: true,
      prefs: null,
      accountabilityPhase: null,
      now,
    });
    expect(view.relationshipStatus).toBe("stopped");
  });

  it("masks phone", () => {
    expect(maskSmsPhoneDisplay("+15551234567")).toBe("(***) ***-4567");
    expect(maskSmsPhoneDisplay("")).toBeNull();
  });

  it("GET view model omits timing display fields", () => {
    const view = buildSmsPreferencesViewModel({
      uiEnabled: true,
      smsEnabled: true,
      phoneNumber: "+15551234567",
      timezoneRaw: "America/New_York",
      smsDisclosureAccepted: true,
      prefs: baseRow({ preferred_local_hour: 9, preferred_send_window: "morning" }),
      accountabilityPhase: "active_accountability",
      now,
    });
    expect(view).not.toHaveProperty("effectiveTimingLabel");
    expect(view).not.toHaveProperty("effectiveTimingSource");
    expect(view).not.toHaveProperty("preferredSendWindow");
    expect(view).not.toHaveProperty("preferredLocalHour");
    expect(view.cadenceLabel).toBe("Daily (default rhythm)");
    expect(view.weekendLabel).toBe("All days");
  });

  it("validates pause max duration", () => {
    const tooFar = new Date(now.getTime() + MAX_PAUSE_DURATION_MS + 86400000).toISOString();
    const result = validateSmsPreferencesPatch({ pause_until: tooFar }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("rejects preferred_send_window from app PATCH", () => {
    const result = validateSmsPreferencesPatch({ preferred_send_window: "morning" }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("Unknown field");
    }
  });

  it("rejects preferred_local_hour from app PATCH", () => {
    const result = validateSmsPreferencesPatch({ preferred_local_hour: 7 }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("Unknown field");
    }
  });

  it("rejects clearPreferredTime from app PATCH", () => {
    const result = validateSmsPreferencesPatch({ clearPreferredTime: true }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Unknown field");
  });

  it("rejects unknown fields", () => {
    const result = validateSmsPreferencesPatch({ sms_enabled: true }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Unknown field");
  });

  it("rejects daily cadence from app", () => {
    const result = validateSmsPreferencesPatch({ cadence_override: "daily" }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("daily");
  });

  it("clear-only patch detection", () => {
    expect(isClearOnlySmsPreferencesPatch({ clearPause: true })).toBe(true);
    expect(isClearOnlySmsPreferencesPatch({ cadence_override: "every_other_day" })).toBe(false);
  });

  it("deriveRelationshipStatus not_configured without phone", () => {
    expect(
      deriveRelationshipStatus({
        smsEnabled: true,
        phoneConfigured: false,
        prefs: null,
        now,
      })
    ).toBe("not_configured");
  });
});
