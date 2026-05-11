/**
 * Canonical URLs for the sports coach acquisition funnel.
 * Pass sign-up redirect through encodeURIComponent when embedding in query strings.
 */
export const COACH_SUBSCRIBE_PATH = "/subscribe?src=coach";

export const COACH_SIGN_UP_HREF = `/sign-up?redirect_url=${encodeURIComponent(
  COACH_SUBSCRIBE_PATH
)}`;
