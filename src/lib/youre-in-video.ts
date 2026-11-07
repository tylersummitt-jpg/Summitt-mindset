/**
 * First-party You're In! welcome video facts.
 * Playback math stays in the existing Vimeo helpers. This module names the
 * five events and counts unique members. It does not talk to Vimeo.
 */

export const YOURE_IN_VIMEO_ID = "1244458037";

export const YOURE_IN_VIDEO_EVENT_TYPES = [
  "youre_in_page_reached",
  "youre_in_video_started",
  "youre_in_video_watched_25",
  "youre_in_video_watched_50",
  "youre_in_video_completed",
] as const;

export type YoureInVideoEventType = (typeof YOURE_IN_VIDEO_EVENT_TYPES)[number];

export type YoureInWatchEventType = Extract<
  YoureInVideoEventType,
  "youre_in_video_watched_25" | "youre_in_video_watched_50" | "youre_in_video_completed"
>;

const WATCH_MILESTONES: ReadonlyArray<{ eventType: YoureInWatchEventType; fraction: number }> = [
  { eventType: "youre_in_video_watched_25", fraction: 0.25 },
  { eventType: "youre_in_video_watched_50", fraction: 0.5 },
];

export type YoureInVideoEngagement = {
  status: "ready" | "unavailable" | "not_in_report";
  reached: number | null;
  started: number | null;
  watched25: number | null;
  watched50: number | null;
  completed: number | null;
  note: string;
};

const NOT_IN_REPORT =
  "You're In! video engagement is not in this saved report. It is not shown as zero.";

const READY_NOTE =
  "Reached the final onboarding page is the denominator for started, watched 25%, watched 50%, and completed video. Started is the denominator for how far a play went. Completed video means the player reported that playback ended. It is not verified that every second was watched. A member who completed the video is included in 25% and 50%. A member who reached 50% is included in 25% and started. Counts are unique members. Replays are not extra members. A zero means no recorded member since this tracking began. It is not every historical member. A failed analytics write is missing, not a confirmed skip.";

export function isYoureInVideoEventType(value: unknown): value is YoureInVideoEventType {
  return (
    typeof value === "string" &&
    (YOURE_IN_VIDEO_EVENT_TYPES as readonly string[]).includes(value)
  );
}

/** One row per member per milestone. The same key is used on every device and day. */
export function youreInVideoIdempotencyKey(
  eventType: YoureInVideoEventType,
  clerkUserId: string
): string {
  return `youre_in_video:${eventType}:${encodeURIComponent(clerkUserId.trim())}`;
}

/**
 * 25% and 50% come from played time already measured by the caller.
 * `ended` records that the player finished. It does not invent 25% or 50%.
 */
export function crossedYoureInWatchMilestones(args: {
  playedFraction: number | null;
  ended: boolean;
  already: ReadonlySet<string>;
}): YoureInWatchEventType[] {
  const next: YoureInWatchEventType[] = [];
  if (args.playedFraction != null && Number.isFinite(args.playedFraction)) {
    for (const milestone of WATCH_MILESTONES) {
      if (args.playedFraction >= milestone.fraction && !args.already.has(milestone.eventType)) {
        next.push(milestone.eventType);
      }
    }
  }
  if (
    args.ended &&
    !args.already.has("youre_in_video_completed") &&
    !next.includes("youre_in_video_completed")
  ) {
    next.push("youre_in_video_completed");
  }
  return next;
}

export function youreInVideoNotInReport(): YoureInVideoEngagement {
  return {
    status: "not_in_report",
    reached: null,
    started: null,
    watched25: null,
    watched50: null,
    completed: null,
    note: NOT_IN_REPORT,
  };
}

export function youreInVideoUnavailable(note: string): YoureInVideoEngagement {
  return {
    status: "unavailable",
    reached: null,
    started: null,
    watched25: null,
    watched50: null,
    completed: null,
    note,
  };
}

export function aggregateYoureInVideoMembers(
  rows: ReadonlyArray<{ clerkUserId: string; eventType: string }>
): YoureInVideoEngagement {
  const reached = new Set<string>();
  const started = new Set<string>();
  const watched25 = new Set<string>();
  const watched50 = new Set<string>();
  const completed = new Set<string>();

  for (const row of rows) {
    const clerkUserId = row.clerkUserId.trim();
    if (!clerkUserId || !isYoureInVideoEventType(row.eventType)) continue;
    reached.add(clerkUserId);
    if (row.eventType !== "youre_in_page_reached") started.add(clerkUserId);
    if (
      row.eventType === "youre_in_video_watched_25" ||
      row.eventType === "youre_in_video_watched_50" ||
      row.eventType === "youre_in_video_completed"
    ) {
      watched25.add(clerkUserId);
    }
    if (row.eventType === "youre_in_video_watched_50" || row.eventType === "youre_in_video_completed") {
      watched50.add(clerkUserId);
    }
    if (row.eventType === "youre_in_video_completed") completed.add(clerkUserId);
  }

  return {
    status: "ready",
    reached: reached.size,
    started: started.size,
    watched25: watched25.size,
    watched50: watched50.size,
    completed: completed.size,
    note: READY_NOTE,
  };
}

function countOrNull(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function members(count: number): string {
  return `${count} unique ${count === 1 ? "member" : "members"}`;
}

function percentOf(count: number, denominator: number, who: string): string {
  if (denominator === 0) return `Percent of members who ${who}: Not available.`;
  return `${Math.round((count / denominator) * 100)}% of members who ${who}.`;
}

export function formatYoureInVideoEngagement(
  facts: YoureInVideoEngagement | undefined
): string[] {
  const section = facts ?? youreInVideoNotInReport();
  const heading = "YOU'RE IN! VIDEO ENGAGEMENT";
  if (section.status === "not_in_report") {
    return [heading, NOT_IN_REPORT];
  }
  if (section.status === "unavailable") {
    return [heading, section.note];
  }
  const reached = countOrNull(section.reached);
  const started = countOrNull(section.started);
  const watched25 = countOrNull(section.watched25);
  const watched50 = countOrNull(section.watched50);
  const completed = countOrNull(section.completed);
  if (
    reached == null ||
    started == null ||
    watched25 == null ||
    watched50 == null ||
    completed == null
  ) {
    return [
      heading,
      "You're In! video engagement could not be read. It is not shown as zero.",
    ];
  }
  return [
    heading,
    `Reached final onboarding page: ${members(reached)}. This is the denominator for the video rows below.`,
    `Started video: ${members(started)}. ${percentOf(started, reached, "reached the page")}`,
    `Watched 25%: ${members(watched25)}. ${percentOf(watched25, reached, "reached the page")} ${percentOf(watched25, started, "started the video")}`,
    `Watched 50%: ${members(watched50)}. ${percentOf(watched50, reached, "reached the page")} ${percentOf(watched50, started, "started the video")}`,
    `Completed video: ${members(completed)}. ${percentOf(completed, reached, "reached the page")} ${percentOf(completed, started, "started the video")}`,
    section.note,
  ];
}
