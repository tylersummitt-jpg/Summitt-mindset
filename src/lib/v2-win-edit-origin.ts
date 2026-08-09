/**
 * Item #4 — user Edit Win origin / href helpers (client-safe).
 * Bounded origins only — never arbitrary returnTo URLs.
 */

export type EditWinOrigin =
  | { kind: "victory-room" }
  | { kind: "all-wins" }
  | { kind: "season"; seasonId: string };

export function parseEditWinOrigin(raw: unknown): EditWinOrigin {
  if (typeof raw !== "string") return { kind: "victory-room" };
  const s = raw.trim();
  if (s === "all-wins") return { kind: "all-wins" };
  if (s.startsWith("season:")) {
    const seasonId = s.slice("season:".length).trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(seasonId)) {
      return { kind: "season", seasonId };
    }
  }
  return { kind: "victory-room" };
}

export function encodeEditWinOrigin(origin: EditWinOrigin): string {
  if (origin.kind === "all-wins") return "all-wins";
  if (origin.kind === "season") return `season:${origin.seasonId}`;
  return "victory-room";
}

export function editWinOriginHref(origin: EditWinOrigin): string {
  if (origin.kind === "all-wins") return "/dashboard/victory-room/all-proof";
  if (origin.kind === "season") {
    return `/dashboard/victory-room/seasons/${encodeURIComponent(origin.seasonId)}`;
  }
  return "/dashboard/victory-room";
}

export function buildEditWinHref(winId: string, origin: EditWinOrigin): string {
  const id = winId.trim();
  const q = encodeURIComponent(encodeEditWinOrigin(origin));
  return `/dashboard/victory-room/wins/${encodeURIComponent(id)}/edit?from=${q}`;
}
