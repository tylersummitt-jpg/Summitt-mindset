/**
 * Client-safe manual Win field limits + pure mapping (no DB / server-only / OpenAI).
 * Lengths mirror WIN_FIELD_LIMITS / DB CHECKs without importing recognition modules.
 */

export const MANUAL_WIN_TITLE_MAX = 80;
export const MANUAL_WIN_DETAILS_MAX = 240;
const MANUAL_WIN_ACTION_FACT_MAX = 240;

export function mapManualWinUserText(args: {
  title: string;
  details?: string | null;
}): {
  display_title: string;
  display_body: string;
  action_fact: string;
} {
  const title = args.title.replace(/\s+/g, " ").trim();
  const details =
    typeof args.details === "string" ? args.details.replace(/\s+/g, " ").trim() : "";
  return {
    display_title: title.slice(0, MANUAL_WIN_TITLE_MAX),
    display_body: (details || title).slice(0, MANUAL_WIN_DETAILS_MAX),
    action_fact: title.slice(0, MANUAL_WIN_ACTION_FACT_MAX),
  };
}

export function isValidClientRequestId(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const s = raw.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );
}

export function isValidOccurredOnDateKey(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

export function buildManualWinIdempotencyKey(
  clerkUserId: string,
  clientRequestId: string
): string {
  const clerk = clerkUserId.trim();
  const req = clientRequestId.trim();
  if (!clerk) throw new Error("manual_win_requires_clerk_user_id");
  if (!req) throw new Error("manual_win_requires_client_request_id");
  return `win_v1:manual:${clerk}:${req}`;
}

export type ManualWinSeasonOption = {
  seasonId: string;
  seasonName: string;
  goalLabel: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  isCurrent: boolean;
  pickerLabel: string;
};
