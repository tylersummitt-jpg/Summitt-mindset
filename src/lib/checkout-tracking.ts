/**
 * Checkout funnel measurement.
 *
 * Event names:
 * - checkout_opened: this server just created a Stripe Checkout Session.
 *   Deduped by Checkout Session id. Not a join click. Not proof of payment.
 * - checkout_creation_failed: Stripe refused or threw while creating the
 *   session. No session exists. Not a membership change.
 *
 * Trial start stays the existing subscription trial_start count.
 * Outcome labels below are read from the Checkout Session later. They are
 * not extra event names.
 */

import { isVisitorId, type SourceNormalized } from "@/lib/marketing-attribution-pure";

export const CHECKOUT_TRACKING_VERSION = "1";
export const CHECKOUT_TRACKING_METADATA_KEY = "summittCheckoutTrack";

/** Open sessions stay pending until this age. Stripe's own expiry is the expired outcome. */
export const CHECKOUT_OBSERVATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Only a session created moments ago is marked. An idempotent replay of an
 * older session is not relabeled as a new instrumented start.
 */
export const CHECKOUT_STAMP_MAX_AGE_MS = 15 * 60 * 1000;

/** List bound so the admin page does not scan years of pre-instrumentation sessions. */
export const CHECKOUT_LIST_NOT_BEFORE_MS = Date.UTC(2026, 9, 10);

const SOURCES = new Set<SourceNormalized>([
  "direct",
  "organic_social",
  "meta",
  "google",
  "referral",
]);

export type CheckoutSessionOutcome =
  | "completed_trial"
  | "pending"
  | "expired"
  | "incomplete"
  | "unknown";

export type CheckoutSessionView = {
  id: string;
  created: number;
  status: string | null;
  metadata: Record<string, string | null | undefined> | null;
  /** Unix seconds from the expanded subscription. A subscription id alone is not enough. */
  subscriptionTrialStart: number | null;
};

export type CheckoutSessionCounts = {
  sessions: number;
  completedTrial: number;
  pending: number;
  expired: number;
  incomplete: number;
  unknown: number;
  withVisitor: number;
  accountWithoutVisitor: number;
  noVisitorMatch: number;
  unknownSource: number;
};

export type CheckoutMeasurement = {
  listComplete: boolean;
  eventsComplete: boolean;
  sessions: number | null;
  completedTrial: number | null;
  pending: number | null;
  expired: number | null;
  incomplete: number | null;
  unknown: number | null;
  creationFailed: number | null;
  withVisitor: number | null;
  accountWithoutVisitor: number | null;
  noVisitorMatch: number | null;
  unknownSource: number | null;
  /** Distinct checkout_opened session ids. Not the funnel total. */
  openedEvents: number | null;
};

export function emptyCheckoutMeasurement(): CheckoutMeasurement {
  return {
    listComplete: true,
    eventsComplete: true,
    sessions: 0,
    completedTrial: 0,
    pending: 0,
    expired: 0,
    incomplete: 0,
    unknown: 0,
    creationFailed: 0,
    withVisitor: 0,
    accountWithoutVisitor: 0,
    noVisitorMatch: 0,
    unknownSource: 0,
    openedEvents: 0,
  };
}

export function unavailableCheckoutMeasurement(): CheckoutMeasurement {
  return {
    listComplete: false,
    eventsComplete: false,
    sessions: null,
    completedTrial: null,
    pending: null,
    expired: null,
    incomplete: null,
    unknown: null,
    creationFailed: null,
    withVisitor: null,
    accountWithoutVisitor: null,
    noVisitorMatch: null,
    unknownSource: null,
    openedEvents: null,
  };
}

export function isCheckoutSource(raw: string | null | undefined): raw is SourceNormalized {
  return typeof raw === "string" && SOURCES.has(raw as SourceNormalized);
}

export function isCheckoutSessionId(raw: string | null | undefined): raw is string {
  return typeof raw === "string" && /^cs_[A-Za-z0-9_]+$/.test(raw) && raw.length <= 255;
}

export function shouldStampCheckoutSession(createdUnix: number, nowMs: number): boolean {
  if (!Number.isFinite(createdUnix) || !Number.isFinite(nowMs)) return false;
  const age = nowMs - createdUnix * 1000;
  return age >= -60_000 && age <= CHECKOUT_STAMP_MAX_AGE_MS;
}

export function isInstrumentedCheckoutSession(session: CheckoutSessionView): boolean {
  return session.metadata?.[CHECKOUT_TRACKING_METADATA_KEY] === CHECKOUT_TRACKING_VERSION;
}

/**
 * One session, one outcome. Expired is not also incomplete.
 * A completed checkout without subscription.trial_start stays unknown.
 */
export function classifyCheckoutSession(
  session: CheckoutSessionView,
  nowMs: number
): CheckoutSessionOutcome | null {
  if (!isInstrumentedCheckoutSession(session)) return null;
  if (session.status === "expired") return "expired";
  if (session.status === "complete") {
    return session.subscriptionTrialStart != null &&
      Number.isFinite(session.subscriptionTrialStart)
      ? "completed_trial"
      : "unknown";
  }
  if (session.status === "open") {
    if (!Number.isFinite(session.created)) return "unknown";
    const age = nowMs - session.created * 1000;
    if (!Number.isFinite(age)) return "unknown";
    return age >= CHECKOUT_OBSERVATION_WINDOW_MS ? "incomplete" : "pending";
  }
  return "unknown";
}

export function summarizeCheckoutSessions(
  sessions: readonly CheckoutSessionView[],
  nowMs: number
): CheckoutSessionCounts | null {
  const seen = new Set<string>();
  const counts = {
    sessions: 0,
    completedTrial: 0,
    pending: 0,
    expired: 0,
    incomplete: 0,
    unknown: 0,
    withVisitor: 0,
    accountWithoutVisitor: 0,
    noVisitorMatch: 0,
    unknownSource: 0,
  };

  for (const session of sessions) {
    if (!isCheckoutSessionId(session.id) || seen.has(session.id)) continue;
    const outcome = classifyCheckoutSession(session, nowMs);
    if (!outcome) continue;
    seen.add(session.id);
    counts.sessions += 1;
    if (outcome === "completed_trial") counts.completedTrial += 1;
    else if (outcome === "pending") counts.pending += 1;
    else if (outcome === "expired") counts.expired += 1;
    else if (outcome === "incomplete") counts.incomplete += 1;
    else counts.unknown += 1;

    const visitor = session.metadata?.visitorId;
    const userId = session.metadata?.userId?.trim() ?? "";
    const hasVisitor = isVisitorId(typeof visitor === "string" ? visitor : null);
    if (hasVisitor) counts.withVisitor += 1;
    else if (userId) counts.accountWithoutVisitor += 1;
    else counts.noVisitorMatch += 1;
    if (!isCheckoutSource(session.metadata?.sourceNormalized)) counts.unknownSource += 1;
  }

  const parts =
    counts.completedTrial +
    counts.pending +
    counts.expired +
    counts.incomplete +
    counts.unknown;
  if (parts !== counts.sessions) return null;
  return counts;
}

export function checkoutListLowerBoundMs(rangeStartMs: number | null): number {
  if (rangeStartMs == null) return CHECKOUT_LIST_NOT_BEFORE_MS;
  return Math.max(rangeStartMs, CHECKOUT_LIST_NOT_BEFORE_MS);
}
