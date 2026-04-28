/**
 * Deterministic Victory Room share snippet — no AI, no persistence.
 * Built only from the loaded view + a selected VictoryMoment id.
 */

import type { VictoryMoment, VictoryRoomViewData } from "@/lib/v2-victory-room-view";

/** Optional display line (e.g. Clerk firstName) when `preferred_name` is empty — set only by the page. */
export type VictoryRoomViewForShare = VictoryRoomViewData & {
  share_identity_line?: string;
};

const MAX_NAME = 56;
const MAX_ANCHOR = 160;
/** Max length for full “Current bar: …” line including label */
const MAX_BAR_LINE = 220;
const MAX_BODY = 360;

export type VictoryShareSnippet = {
  /** Display / preferred line */
  title: string;
  identityLine: string | null;
  /** Selected moment body (canonical proof surface) */
  body: string;
  /** Current bar context */
  barLine: string | null;
  attribution: string;
  plainText: string;
  lines: string[];
};

function truncateIntentional(s: string, max: number): string {
  const x = s.trim().replace(/\s+/g, " ");
  if (x.length <= max) return x;
  return `${x.slice(0, max - 1)}…`;
}

function displayLine(view: VictoryRoomViewForShare): string {
  const fromPage = view.share_identity_line?.trim();
  if (fromPage) return truncateIntentional(fromPage, MAX_NAME);
  const pref = view.profile.preferred_name?.trim();
  if (pref) return truncateIntentional(pref, MAX_NAME);
  return "You";
}

/**
 * Pure builder: same output drives preview and clipboard.
 * @returns null if no active commitment or moment id not in the current view.
 */
export function buildShareSnippetFromMoment(
  view: VictoryRoomViewForShare,
  momentId: string
): VictoryShareSnippet | null {
  if (!view.hasActiveV2Commitment) return null;
  const moment: VictoryMoment | undefined = view.moments.find((m) => m.id === momentId);
  if (!moment) return null;

  const title = displayLine(view);
  const identityLine = view.profile.identity_anchor_text?.trim()
    ? truncateIntentional(view.profile.identity_anchor_text.trim(), MAX_ANCHOR)
    : null;
  const body = truncateIntentional(moment.body, MAX_BODY);
  const askRaw = view.effectiveCoachingAsk?.trim();
  const barLine = askRaw ? truncateIntentional(`Current bar: ${askRaw}`, MAX_BAR_LINE) : null;
  const attribution = "From my Victory Room · Summitt";

  const lines: string[] = [];
  lines.push(title);
  if (identityLine) lines.push(identityLine);
  lines.push("");
  lines.push(body);
  if (barLine) {
    lines.push("");
    lines.push(barLine);
  }
  lines.push("");
  lines.push(attribution);

  const plainText = lines.join("\n");

  return {
    title,
    identityLine,
    body,
    barLine,
    attribution,
    plainText,
    lines,
  };
}
