import { playedFraction } from "@/lib/homepage-video";

/** First-achievement events for one recipient journey. Play is not completion. */
export const ACQUISITION_VIDEO_EVENT_TYPES = [
  "personal_video_visited",
  "personal_video_player_ready",
  "personal_video_played",
  "personal_video_watched_25",
  "personal_video_watched_50",
  "personal_video_watched_75",
  "personal_video_watched_95",
  "personal_video_cta_clicked",
] as const;

export type AcquisitionVideoEventType = (typeof ACQUISITION_VIDEO_EVENT_TYPES)[number];

const MILESTONES: ReadonlyArray<{ eventType: AcquisitionVideoEventType; fraction: number }> = [
  { eventType: "personal_video_watched_25", fraction: 0.25 },
  { eventType: "personal_video_watched_50", fraction: 0.5 },
  { eventType: "personal_video_watched_75", fraction: 0.75 },
  { eventType: "personal_video_watched_95", fraction: 0.95 },
];

export function isAcquisitionVideoEventType(value: unknown): value is AcquisitionVideoEventType {
  return typeof value === "string" && (ACQUISITION_VIDEO_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Share of the video that Vimeo reports as actually played.
 * A seek of the playhead does not add time. Null means the ranges could not be read.
 */
export function playedShare(played: unknown, duration: unknown): number | null {
  const fraction = playedFraction(played, duration);
  if (fraction == null || !Number.isFinite(fraction) || fraction < 0) return null;
  return fraction;
}

/**
 * Milestones newly crossed by played time. `ended` records completion even when the
 * last range read is slightly short. This is not a measure of attention.
 */
export function crossedMilestones(args: {
  playedFraction: number | null;
  ended: boolean;
  already: ReadonlySet<string>;
}): AcquisitionVideoEventType[] {
  const next: AcquisitionVideoEventType[] = [];
  if (args.playedFraction != null) {
    for (const milestone of MILESTONES) {
      if (args.playedFraction >= milestone.fraction && !args.already.has(milestone.eventType)) {
        next.push(milestone.eventType);
      }
    }
  }
  if (args.ended && !args.already.has("personal_video_watched_95") && !next.includes("personal_video_watched_95")) {
    next.push("personal_video_watched_95");
  }
  return next;
}

/** One id per recipient, journey, and event. A second campaign gets its own id. */
export function acquisitionVideoEventId(args: {
  recipientId: string;
  eventType: string;
  journeyId: string | null;
}): string {
  const scope = args.journeyId ? `journey:${args.journeyId}` : "unscoped";
  return `recipient:${args.recipientId}:${scope}:${args.eventType}`;
}
