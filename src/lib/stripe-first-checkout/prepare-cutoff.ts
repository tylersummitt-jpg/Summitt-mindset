const UTC_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/;

/**
 * Accept only an explicit UTC instant. A missing zone or a numeric offset
 * is rejected so a local-time string cannot move the cutoff.
 */
export function readPrepareAfterCutoff(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  const match = UTC_INSTANT.exec(value);
  if (!match) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }
  return date.toISOString();
}

/**
 * Same rule as the hourly query: the persisted confirmation instant is
 * strictly after the normalized UTC cutoff. A missing or invalid cutoff
 * is not eligible.
 */
export function confirmedTrialIsAfterPrepareCutoff(
  confirmedAt: string | null | undefined,
  rawCutoff: string | null | undefined
): boolean {
  const cutoff = readPrepareAfterCutoff(rawCutoff);
  if (!cutoff) return false;
  const confirmedMs = Date.parse(typeof confirmedAt === "string" ? confirmedAt.trim() : "");
  const cutoffMs = Date.parse(cutoff);
  if (!Number.isFinite(confirmedMs) || !Number.isFinite(cutoffMs)) return false;
  return confirmedMs > cutoffMs;
}
