/**
 * Homepage explainer only. This id must not be stored in film_videos,
 * Programs, or any other content table.
 */
export const HOMEPAGE_VIMEO_VIDEO_ID = "1231615684";

export const HOMEPAGE_VIDEO_EVENT_TYPES = [
  "homepage_video_reached",
  "homepage_video_started",
  "homepage_video_50",
  "homepage_video_completed",
] as const;

export type HomepageVideoEventType = (typeof HOMEPAGE_VIDEO_EVENT_TYPES)[number];

const VIMEO_VIDEO_ID_RE = /^\d{6,20}$/;

export function isHomepageVideoEventType(raw: unknown): raw is HomepageVideoEventType {
  return (
    typeof raw === "string" &&
    (HOMEPAGE_VIDEO_EVENT_TYPES as readonly string[]).includes(raw)
  );
}

/** Digits only, length 6–20 after trim. Rejects URLs, letters, and empty. */
export function parseVimeoVideoId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!VIMEO_VIDEO_ID_RE.test(id)) return null;
  return id;
}

type PlayedRange = { start: number; end: number };

function rangesFromPlayed(played: unknown): PlayedRange[] | null {
  if (Array.isArray(played)) {
    const ranges: PlayedRange[] = [];
    for (const range of played) {
      if (!range || typeof range !== "object") return null;
      const start = Number((range as { start?: unknown }).start);
      const end = Number((range as { end?: unknown }).end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
      ranges.push({ start, end });
    }
    return ranges;
  }
  if (
    played &&
    typeof played === "object" &&
    typeof (played as { length?: unknown }).length === "number" &&
    typeof (played as { start?: unknown }).start === "function" &&
    typeof (played as { end?: unknown }).end === "function"
  ) {
    const source = played as {
      length: number;
      start: (index: number) => number;
      end: (index: number) => number;
    };
    const ranges: PlayedRange[] = [];
    for (let i = 0; i < source.length; i += 1) {
      const start = Number(source.start(i));
      const end = Number(source.end(i));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
      ranges.push({ start, end });
    }
    return ranges;
  }
  return null;
}

/** Sum of Vimeo played ranges. Seeking the playhead does not add time. */
export function playedSecondsFromRanges(played: unknown): number | null {
  const ranges = rangesFromPlayed(played);
  if (!ranges) return null;
  let total = 0;
  for (const range of ranges) total += range.end - range.start;
  return total;
}

/**
 * playedSeconds / duration. Null when duration is missing, zero, or non-finite,
 * or when played ranges cannot be read.
 */
export function playedFraction(played: unknown, duration: unknown): number | null {
  const seconds = playedSecondsFromRanges(played);
  const dur = typeof duration === "number" ? duration : Number(duration);
  if (seconds == null || !Number.isFinite(dur) || dur <= 0) return null;
  return seconds / dur;
}
