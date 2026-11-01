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

/**
 * Largest forward playhead jump still treated as continuous playback.
 * Larger jumps are seeks and do not add watched time.
 */
export const MAX_CONTINUOUS_PLAYBACK_GAP_SECONDS = 2.5;

export type PlaybackProgress = {
  lastSeconds: number | null;
  watchedSeconds: number;
};

export function emptyPlaybackProgress(): PlaybackProgress {
  return { lastSeconds: null, watchedSeconds: 0 };
}

export function isAcquisitionVideoEventType(value: unknown): value is AcquisitionVideoEventType {
  return typeof value === "string" && (ACQUISITION_VIDEO_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Share of the video that Vimeo reports as actually played.
 * A seek of the playhead does not add time. Null means the ranges could not be read.
 */
export function playedShare(played: unknown, duration: unknown): number | null {
  const fraction = playedFraction(normalizePlayedRanges(played), duration);
  if (fraction == null || !Number.isFinite(fraction) || fraction < 0) return null;
  return fraction;
}

/**
 * Preferred Vimeo played-range share. Empty or unreadable ranges return null so the
 * player can fall back to seek-safe timeupdate accumulation.
 */
export function preferredPlayedShare(played: unknown, duration: unknown): number | null {
  if (isEmptyPlayedRanges(played)) return null;
  return playedShare(played, duration);
}

/**
 * Credit only small forward playhead advances as watched time.
 * Seeks, rewinds, and out-of-order samples move the marker without adding time.
 * This is observed playback progress, not attention.
 */
export function accumulateForwardPlayback(args: {
  progress: PlaybackProgress;
  seconds: unknown;
  duration: unknown;
}): PlaybackProgress {
  const duration = typeof args.duration === "number" ? args.duration : Number(args.duration);
  const seconds = typeof args.seconds === "number" ? args.seconds : Number(args.seconds);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(seconds)) return args.progress;
  const clamped = Math.max(0, Math.min(seconds, duration));
  if (args.progress.lastSeconds == null) {
    return { lastSeconds: clamped, watchedSeconds: args.progress.watchedSeconds };
  }
  const delta = clamped - args.progress.lastSeconds;
  if (delta > 0 && delta <= MAX_CONTINUOUS_PLAYBACK_GAP_SECONDS) {
    return {
      lastSeconds: clamped,
      watchedSeconds: Math.min(duration, args.progress.watchedSeconds + delta),
    };
  }
  return { lastSeconds: clamped, watchedSeconds: args.progress.watchedSeconds };
}

export function accumulatedShare(progress: PlaybackProgress, duration: unknown): number | null {
  const total = typeof duration === "number" ? duration : Number(duration);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(progress.watchedSeconds) || progress.watchedSeconds < 0) return null;
  return Math.min(1, progress.watchedSeconds / total);
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

function normalizePlayedRanges(played: unknown): unknown {
  if (!Array.isArray(played) || played.length === 0) return played;
  const first = played[0];
  if (Array.isArray(first) && first.length >= 2) {
    const ranges: Array<{ start: number; end: number }> = [];
    for (const pair of played) {
      if (!Array.isArray(pair) || pair.length < 2) return played;
      const start = Number(pair[0]);
      const end = Number(pair[1]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return played;
      ranges.push({ start, end });
    }
    return ranges;
  }
  return played;
}

function isEmptyPlayedRanges(played: unknown): boolean {
  if (Array.isArray(played)) return played.length === 0;
  if (
    played
    && typeof played === "object"
    && typeof (played as { length?: unknown }).length === "number"
    && typeof (played as { start?: unknown }).start === "function"
    && typeof (played as { end?: unknown }).end === "function"
  ) {
    return (played as { length: number }).length === 0;
  }
  return false;
}
