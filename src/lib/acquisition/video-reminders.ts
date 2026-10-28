import { isVideoReminderAction, type AcquisitionActionType } from "@/lib/acquisition/model";

export const DEFAULT_VIDEO_REMINDER_HOURS = 48;
export const DEFAULT_VIDEO_FINAL_REMINDER_HOURS = 96;
const HOUR_MS = 60 * 60 * 1000;
const TRIAL_NOTE_GAP_MS = 24 * HOUR_MS;

export function videoReminderTimes(args: {
  acceptedAtMs: number;
  firstHours: number;
  finalHours: number;
}): { firstAtMs: number; finalAtMs: number } | null {
  if (!Number.isFinite(args.acceptedAtMs)) return null;
  if (!Number.isFinite(args.firstHours) || !Number.isFinite(args.finalHours)) return null;
  if (!(args.firstHours > 0) || !(args.finalHours > args.firstHours)) return null;
  return {
    firstAtMs: args.acceptedAtMs + args.firstHours * HOUR_MS,
    finalAtMs: args.acceptedAtMs + args.finalHours * HOUR_MS,
  };
}

/** While the final reminder is still waiting, the trial note waits until a day after it. */
export function deferredTrialAtMs(args: { nowMs: number; finalReminderAtMs: number }): number {
  const afterFinal = args.finalReminderAtMs + TRIAL_NOTE_GAP_MS;
  const notThisRun = args.nowMs + HOUR_MS;
  return Math.max(afterFinal, notThisRun);
}

export function videoLinkAction(action: AcquisitionActionType): boolean {
  return action === "send_video" || isVideoReminderAction(action);
}

export function videoReminderCopy(args: {
  which: "first" | "final";
  firstName: string | null;
  watchUrl: string;
  unsubscribeUrl: string;
}): { subject: string; text: string; html: string } {
  const name = args.firstName ? ` ${args.firstName}` : "";
  const reason = args.which === "first"
    ? "I recorded a short video for you a couple of days ago. It is the clearest way I can show what this is about, so I wanted the link back at the top of your inbox."
    : "This is the last time I will send it. The video is short, and I recorded it so you could see the idea before deciding anything.";
  const subject = args.which === "first" ? "The short video I recorded" : "Last note on that video";
  const text = `Hi${name},\n\n${reason}\n\n${args.watchUrl}\n\nTyler Summitt\n\nUnsubscribe: ${args.unsubscribeUrl}`;
  const html = `<p>Hi${name},</p><p>${reason}</p><p><a href="${args.watchUrl}">Watch the video</a></p><p>Tyler Summitt</p><p><a href="${args.unsubscribeUrl}">Unsubscribe</a></p>`;
  return { subject, text, html };
}
