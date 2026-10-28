import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { fulfillmentEligible } from "@/lib/acquisition/campaign-activation";
import { journeyCloses } from "@/lib/acquisition/journey-lifecycle";
import { LEADERSHIP_KIT_CLAIM } from "@/lib/acquisition/email-knowledge";
import { salesEmailMustStop } from "@/lib/acquisition/model";
import { runAcquisitionPass, type PassAction, type PassPerson } from "@/lib/acquisition/pass";
import {
  DEFAULT_VIDEO_FINAL_REMINDER_HOURS,
  DEFAULT_VIDEO_REMINDER_HOURS,
  deferredTrialAtMs,
  videoReminderCopy,
  videoReminderTimes,
} from "@/lib/acquisition/video-reminders";

const HOUR = 60 * 60 * 1000;
const ACCEPTED = Date.parse("2026-10-21T16:00:00.000Z");

function person(lifecycle: PassPerson["lifecycle"] = "warm_video_sent"): PassPerson {
  return {
    id: "person-1",
    email: "coach@school.edu",
    firstName: "Pat",
    lifecycle,
    requestedAsset: null,
    offerKey: null,
    clerkUserId: null,
  };
}

function reminder(overrides: Partial<PassAction> = {}): PassAction {
  return {
    id: "reminder-1",
    personId: "person-1",
    actionType: "send_video_reminder",
    attemptCount: 0,
    idempotencyKey: "acquisition:person-1:journey-1:send_video_reminder",
    journeyId: "journey-1",
    promisedAssets: null,
    promisedLabel: null,
    journeyKnown: true,
    journeyLifecycle: "warm_video_sent",
    journeyClosed: false,
    ...overrides,
  };
}

async function sendReminder(overrides: {
  action?: PassAction;
  play?: "played" | "unplayed" | "unknown";
  automation?: "off" | "pilot" | "active";
  lifecycle?: PassPerson["lifecycle"];
  suppressed?: boolean | null;
}) {
  const sends: string[] = [];
  const effects: string[] = [];
  const result = await runAcquisitionPass({
    now: new Date(ACCEPTED + 48 * HOUR),
    automation: overrides.automation ?? "pilot",
    dailyCap: 25,
    acceptedToday: 0,
    due: [overrides.action ?? reminder()],
    claim: async () => true,
    person: async () => person(overrides.lifecycle ?? "warm_video_sent"),
    suppression: async () => overrides.suppressed ?? false,
    clerkSubscribed: async () => false,
    assetFiles: async () => null,
    videoToken: async () => "recipient-token",
    videoPlay: async () => overrides.play ?? "unplayed",
    unsubscribeToken: () => "unsubscribe-token-unsubscribe-token",
    send: async (request) => {
      sends.push(request.action.actionType);
      return { outcome: "accepted", providerMessageId: "msg-1" };
    },
    apply: async (effect) => {
      if (effect.kind === "accept") effects.push(`accept:${effect.settle.schedule ?? "none"}`);
      else if (effect.kind === "defer") effects.push(`defer:${effect.untilMs}`);
      else if (effect.kind === "stop") effects.push(`stop:${effect.status}:${effect.cancelReminders ? "reminders" : "other"}`);
      else effects.push(effect.kind);
    },
  });
  return { result, sends, effects };
}

describe("video reminder schedule", () => {
  it("schedules one reminder at 48 hours and one final reminder at 96 hours", () => {
    const times = videoReminderTimes({
      acceptedAtMs: ACCEPTED,
      firstHours: DEFAULT_VIDEO_REMINDER_HOURS,
      finalHours: DEFAULT_VIDEO_FINAL_REMINDER_HOURS,
    });
    expect(times?.firstAtMs).toBe(ACCEPTED + 48 * HOUR);
    expect(times?.finalAtMs).toBe(ACCEPTED + 96 * HOUR);
    expect("acquisition:person-1:journey-1:send_video_reminder")
      .not.toBe("acquisition:person-1:journey-1:send_video_reminder_final");
  });

  it("holds the existing trial note until a day after the final reminder", () => {
    const times = videoReminderTimes({
      acceptedAtMs: ACCEPTED,
      firstHours: 48,
      finalHours: 96,
    });
    const now = ACCEPTED + 72 * HOUR;
    expect(deferredTrialAtMs({ nowMs: now, finalReminderAtMs: times?.finalAtMs ?? 0 })).toBe(ACCEPTED + 120 * HOUR);
  });

  it("keeps a journey open while a reminder is still scheduled", () => {
    expect(journeyCloses({
      reason: "fulfillment",
      followUp: "legacy",
      justAccepted: "send_video",
      outstanding: ["send_video_reminder", "send_video_reminder_final", "send_trial_followup"],
    })).toBe(false);
  });

  it("does not mention a Leadership Kit", () => {
    for (const which of ["first", "final"] as const) {
      const copy = videoReminderCopy({
        which,
        firstName: "Pat",
        watchUrl: "https://summittmindset.com/for/token?aj=signed",
        unsubscribeUrl: "https://summittmindset.com/api/acquisition/unsubscribe?token=one",
      });
      expect(LEADERSHIP_KIT_CLAIM.test(`${copy.subject}\n${copy.text}`)).toBe(false);
      expect(copy.text).toContain("https://summittmindset.com/for/token?aj=signed");
    }
  });
});

describe("video reminder sends", () => {
  it("sends the reminder when the video has not been played", async () => {
    const ran = await sendReminder({ play: "unplayed" });
    expect(ran.sends).toEqual(["send_video_reminder"]);
    expect(ran.effects).toEqual(["accept:none"]);
  });

  it("cancels reminders when a play is recorded", async () => {
    const ran = await sendReminder({ play: "played" });
    expect(ran.sends).toEqual([]);
    expect(ran.effects).toEqual(["stop:canceled:reminders"]);
  });

  it("does not send when play data is unreadable", async () => {
    const ran = await sendReminder({ play: "unknown" });
    expect(ran.sends).toEqual([]);
    expect(ran.effects).toEqual(["release"]);
  });

  it("cancels a reminder after a trial, a paid membership, or an opt-out", async () => {
    expect(salesEmailMustStop("trial_started")).toBe(true);
    expect(salesEmailMustStop("paid_member")).toBe(true);
    expect(salesEmailMustStop("unsubscribed")).toBe(true);
    const trial = await sendReminder({ lifecycle: "trial_started" });
    const paid = await sendReminder({ lifecycle: "paid_member" });
    const bounced = await sendReminder({ lifecycle: "suppressed" });
    const optedOut = await sendReminder({ suppressed: true });
    expect(trial.sends).toEqual([]);
    expect(paid.sends).toEqual([]);
    expect(bounced.sends).toEqual([]);
    expect(optedOut.sends).toEqual([]);
    expect(trial.effects[0]).toContain("stop:canceled");
    expect(paid.effects[0]).toContain("stop:canceled");
    expect(bounced.effects[0]).toContain("stop:canceled");
    expect(optedOut.effects[0]).toContain("stop:suppressed");
  });

  it("cancels a reminder when the journey was declined", async () => {
    const ran = await sendReminder({
      action: reminder({ journeyLifecycle: "not_interested" }),
    });
    expect(ran.sends).toEqual([]);
    expect(ran.effects[0]).toContain("stop:canceled");
  });

  it("does not send while global automation is off", async () => {
    const ran = await sendReminder({ automation: "off" });
    expect(ran.sends).toEqual([]);
    expect(ran.result.skipped).toBe("automation_off");
  });

  it("does not send for a paused or finished campaign", () => {
    const paused = [{ id: "camp-1", state: "paused" as const, activatedAt: null, lastActivatedAt: "2026-10-20T00:00:00.000Z" }];
    const finished = [{ id: "camp-1", state: "finished" as const, activatedAt: null, lastActivatedAt: "2026-10-20T00:00:00.000Z" }];
    expect(fulfillmentEligible({
      activations: paused,
      campaignId: "camp-1",
      scheduledAt: "2026-10-23T16:00:00.000Z",
    })).toBe(false);
    expect(fulfillmentEligible({
      activations: finished,
      campaignId: "camp-1",
      scheduledAt: "2026-10-23T16:00:00.000Z",
    })).toBe(false);
  });

  it("defers the trial note instead of sending it beside an unsent final reminder", async () => {
    const effects: string[] = [];
    await runAcquisitionPass({
      now: new Date(ACCEPTED + 72 * HOUR),
      automation: "pilot",
      dailyCap: 25,
      acceptedToday: 0,
      due: [reminder({
        id: "trial-1",
        actionType: "send_trial_followup",
        idempotencyKey: "acquisition:person-1:journey-1:send_trial_followup",
        finalReminderAtMs: ACCEPTED + 96 * HOUR,
      })],
      claim: async () => true,
      person: async () => person(),
      suppression: async () => false,
      clerkSubscribed: async () => false,
      assetFiles: async () => null,
      videoToken: async () => null,
      unsubscribeToken: () => "unsubscribe-token-unsubscribe-token",
      send: async () => ({ outcome: "accepted", providerMessageId: "msg-1" }),
      apply: async (effect) => {
        if (effect.kind === "defer") effects.push(String(effect.untilMs));
      },
    });
    expect(effects).toEqual([String(ACCEPTED + 120 * HOUR)]);
  });
});

describe("video reminder safety", () => {
  it("does not rewrite existing actions and only cancels reminder rows", () => {
    const migration = readFileSync("supabase/migrations/20261028140000_acquisition_video_reminders.sql", "utf8");
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    expect(migration).not.toContain("UPDATE public.acquisition_actions");
    expect(migration).not.toContain("UPDATE public.acquisition_journeys");
    expect(migration).not.toContain("automation_status");
    expect(store).toContain('in("action_type", ["send_video_reminder", "send_video_reminder_final"])');
    expect(store).toContain("scheduleVideoReminders");
    expect(store).toContain('eventType === "personal_video_played"');
    const trial = store.slice(
      store.indexOf("export async function noteAcquisitionTrial"),
      store.indexOf("export async function noteAcquisitionClerk"),
    );
    expect(trial).not.toContain("scheduleVideoReminders");
    expect(store).toContain('followUp === "legacy" && effect.settle.schedule');
  });
});
