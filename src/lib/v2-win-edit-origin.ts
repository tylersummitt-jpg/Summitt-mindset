/**
 * Item #4 — user Edit Win origin / href helpers (client-safe).
 * Bounded origins only — never arbitrary returnTo URLs.
 */

import { parseVictoryCalendarMonthKey } from "@/lib/v2-victory-calendar";
import { isValidOccurredOnDateKey } from "@/lib/v2-win-manual-fields";

export type EditWinOrigin =
  | { kind: "victory-room" }
  | { kind: "all-wins" }
  | { kind: "season"; seasonId: string }
  | { kind: "calendar"; month: string; day: string };

const SEASON_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CALENDAR_ORIGIN_RE = /^calendar:(\d{4}-(0[1-9]|1[0-2])):(\d{4}-\d{2}-\d{2})$/;

function parseCalendarOriginToken(s: string): EditWinOrigin | null {
  const match = CALENDAR_ORIGIN_RE.exec(s);
  if (!match) return null;
  const month = parseVictoryCalendarMonthKey(match[1]);
  const day = match[3];
  if (!month || !isValidOccurredOnDateKey(day)) return null;
  if (day.slice(0, 7) !== month) return null;
  return { kind: "calendar", month, day };
}

export function parseEditWinOrigin(raw: unknown): EditWinOrigin {
  if (typeof raw !== "string") return { kind: "victory-room" };
  const s = raw.trim();
  if (s === "all-wins") return { kind: "all-wins" };
  if (s.startsWith("season:")) {
    const seasonId = s.slice("season:".length).trim();
    if (SEASON_UUID_RE.test(seasonId)) {
      return { kind: "season", seasonId };
    }
  }
  const calendar = parseCalendarOriginToken(s);
  if (calendar) return calendar;
  return { kind: "victory-room" };
}

export function encodeEditWinOrigin(origin: EditWinOrigin): string {
  if (origin.kind === "all-wins") return "all-wins";
  if (origin.kind === "season") return `season:${origin.seasonId}`;
  if (origin.kind === "calendar") return `calendar:${origin.month}:${origin.day}`;
  return "victory-room";
}

export function editWinOriginHref(origin: EditWinOrigin): string {
  if (origin.kind === "all-wins") return "/dashboard/victory-room/all-proof";
  if (origin.kind === "season") {
    return `/dashboard/victory-room/seasons/${encodeURIComponent(origin.seasonId)}`;
  }
  if (origin.kind === "calendar") {
    return `/dashboard/victory-room?month=${encodeURIComponent(origin.month)}&day=${encodeURIComponent(origin.day)}`;
  }
  return "/dashboard/victory-room";
}

export function buildEditWinHref(winId: string, origin: EditWinOrigin): string {
  const id = winId.trim();
  const q = encodeURIComponent(encodeEditWinOrigin(origin));
  return `/dashboard/victory-room/wins/${encodeURIComponent(id)}/edit?from=${q}`;
}

export function buildCalendarAddWinHref(month: string, day: string): string {
  const origin = parseEditWinOrigin(`calendar:${month}:${day}`);
  if (origin.kind !== "calendar") {
    return "/dashboard/victory-room/add-win";
  }
  const from = encodeURIComponent(encodeEditWinOrigin(origin));
  return `/dashboard/victory-room/add-win?occurredOn=${encodeURIComponent(origin.day)}&from=${from}`;
}
