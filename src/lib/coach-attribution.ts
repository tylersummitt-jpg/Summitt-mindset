export const COACH_ATTRIBUTION_COOKIE_NAME = "summitt_attribution";
export const COACH_ATTRIBUTION_SYNCED_COOKIE_NAME = "summitt_attribution_synced";

export const COACH_ATTRIBUTION_COOKIE_VALUE_COACH = "coach";

export function isCoachAttributionEnabled(): boolean {
  return process.env.COACH_ATTRIBUTION_COOKIE_ENABLED === "true";
}

export function isCoachAttributionPath(pathname: string): boolean {
  return (
    pathname === "/coach-leadership-kit" ||
    pathname === "/coach-leadership-kit/" ||
    pathname.startsWith("/coach-leadership-kit/")
  );
}

/**
 * Whether it is safe to set acquisitionSource to "coach" without overwriting
 * an existing non-coach value.
 */
export function maySetCoachAcquisitionSource(existing: unknown): boolean {
  if (existing === null || existing === undefined) return true;

  if (typeof existing === "string") {
    const trimmed = existing.trim();
    if (trimmed === "") return true;
    if (trimmed === COACH_ATTRIBUTION_COOKIE_VALUE_COACH) return false;
    return false;
  }

  return false;
}

export function shouldSyncCoachAttribution(args: {
  acquisitionSource: unknown;
  attributionCookieValue: string | null | undefined;
}): boolean {
  const { acquisitionSource, attributionCookieValue } = args;

  if (attributionCookieValue !== COACH_ATTRIBUTION_COOKIE_VALUE_COACH)
    return false;

  return maySetCoachAcquisitionSource(acquisitionSource);
}

