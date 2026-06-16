/**
 * Deterministic Victory Room share snippet — no AI, no persistence.
 * Built only from the loaded view + a selected VictoryMoment id.
 */

import { resolveVictoryMomentCardDisplay } from "@/lib/v2-victory-room-display";
import type { VictoryMoment, VictoryRoomViewData } from "@/lib/v2-victory-room-view";

/** Optional display line (e.g. Clerk firstName) when `preferred_name` is empty — set only by the page. */
export type VictoryRoomViewForShare = VictoryRoomViewData & {
  share_identity_line?: string;
  /** Moments eligible for share lookup (home wins, all proof, etc.). */
  shareProofMoments?: VictoryMoment[];
};

function findShareMoment(view: VictoryRoomViewForShare, momentId: string): VictoryMoment | undefined {
  const pool = view.shareProofMoments ?? view.recentWins ?? view.moments;
  return pool.find((m) => m.id === momentId);
}

export const VICTORY_SHARE_LEDE = "Building proof, not just intentions.";
export const VICTORY_SHARE_TAGLINE = "Proof over promises.";
export const VICTORY_SHARE_BRAND = "Summitt Mindset";
export const VICTORY_SHARE_URL = "summittmindset.com";

const MAX_CATEGORY = 80;
const MAX_DATE = 48;
const MAX_QUOTE = 320;
const MAX_MEANING = 360;

export type VictoryShareDisplayHints = {
  categoryLabel?: string;
  dateLabel?: string;
};

export type VictoryShareSnippet = {
  categoryLabel: string;
  dateLabel: string;
  quote: string | null;
  meaning: string;
  tagline: string;
  brandLine: string;
  brandUrl: string;
  plainText: string;
};

function truncateIntentional(s: string, max: number): string {
  const x = s.trim().replace(/\s+/g, " ");
  if (x.length <= max) return x;
  return `${x.slice(0, max - 1)}…`;
}

function buildPlainText(args: {
  categoryLabel: string;
  quote: string | null;
  meaning: string;
}): string {
  const lines: string[] = [VICTORY_SHARE_LEDE, "", args.categoryLabel];
  if (args.quote) {
    lines.push(`"${args.quote}"`);
    lines.push(args.meaning);
  } else {
    lines.push(args.meaning);
  }
  lines.push("", VICTORY_SHARE_BRAND, VICTORY_SHARE_URL);
  return lines.join("\n");
}

/**
 * Pure builder: same output drives preview, clipboard, and PNG export.
 * @returns null if no active commitment or moment id not in the current view.
 */
export function buildShareSnippetFromMoment(
  view: VictoryRoomViewForShare,
  momentId: string,
  display?: VictoryShareDisplayHints
): VictoryShareSnippet | null {
  if (!view.hasActiveV2Commitment) return null;
  const moment = findShareMoment(view, momentId);
  if (!moment) return null;

  const categoryLabel = truncateIntentional(
    display?.categoryLabel?.trim() || moment.headline?.trim() || "Proof",
    MAX_CATEGORY
  );
  const dateLabel = truncateIntentional(display?.dateLabel?.trim() ?? "", MAX_DATE);
  const cardDisplay = resolveVictoryMomentCardDisplay(moment, "share");
  let quote: string | null = null;
  let meaning: string;
  if (cardDisplay.showQuoteMarks) {
    quote = truncateIntentional(cardDisplay.primaryText, MAX_QUOTE);
    meaning = truncateIntentional(
      cardDisplay.secondaryText ?? moment.meaning ?? moment.body,
      MAX_MEANING
    );
  } else {
    meaning = truncateIntentional(cardDisplay.primaryText, MAX_MEANING);
  }

  const plainText = buildPlainText({ categoryLabel, quote, meaning });

  return {
    categoryLabel,
    dateLabel,
    quote,
    meaning,
    tagline: VICTORY_SHARE_TAGLINE,
    brandLine: VICTORY_SHARE_BRAND,
    brandUrl: VICTORY_SHARE_URL,
    plainText,
  };
}
