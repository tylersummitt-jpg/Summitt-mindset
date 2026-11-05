/**
 * Shared exit-survey vocabulary for cancellation feedback.
 * Presentational vocabulary and pure Apple-grant classification.
 * Nothing here calls Stripe, Apple, or deletion.
 */

import { isAppleRowCurrentlyGranting } from "@/lib/summitt-membership-entitlement";

export const EXIT_SURVEY_VERSION = 2 as const;

export const APPLE_SUBSCRIPTION_MANAGEMENT_URL =
  "https://apps.apple.com/account/subscriptions" as const;

export const EXIT_SURVEY_REASON_QUESTION =
  "What's the main reason you're leaving Summitt Mindset?" as const;

export const EXIT_SURVEY_COMMENT_QUESTION =
  "Help us improve. What's one thing we could do better?" as const;

export const EXIT_SURVEY_COMMENT_MAX = 2000;

export const EXIT_SURVEY_REASONS = [
  { code: "not_using", label: "I wasn't using it enough." },
  { code: "no_results", label: "I wasn't getting the results I hoped for." },
  { code: "too_expensive", label: "It cost more than I wanted to spend." },
  { code: "coach_pat_texts", label: "The Coach Pat texts weren't right for me." },
  { code: "hard_to_use", label: "The website or app was difficult to use." },
  { code: "no_longer_need", label: "I no longer need the membership." },
  { code: "something_else", label: "Something else." },
  { code: "prefer_not_to_say", label: "Prefer not to say." },
] as const;

export type ExitSurveyReasonCode = (typeof EXIT_SURVEY_REASONS)[number]["code"];

const REASON_CODES = new Set<string>(EXIT_SURVEY_REASONS.map((reason) => reason.code));

export const LEGACY_CANCEL_REASON_LABELS: Record<string, string> = {
  too_busy: "Life got too busy",
  not_relevant: "The practices didn’t fit me",
  unclear_value: "I didn’t feel the value yet",
  journal_friction: "Journaling was hard to keep up with",
  cost: "It’s a financial stretch right now",
  other: "Something else",
};

export type CancelFlowMode = "stripe" | "apple" | "both";

export function isExitSurveyReasonCode(value: unknown): value is ExitSurveyReasonCode {
  return typeof value === "string" && REASON_CODES.has(value);
}

export function exitSurveyReasonLabel(code: string | null | undefined): string {
  if (!code) return "No reason selected";
  const current = EXIT_SURVEY_REASONS.find((reason) => reason.code === code);
  if (current) return current.label;
  return LEGACY_CANCEL_REASON_LABELS[code] ?? "Unrecognized reason";
}

export function blankToNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, EXIT_SURVEY_COMMENT_MAX);
}

export type ParsedExitSurvey = {
  reasonCode: ExitSurveyReasonCode | null;
  message: string | null;
  skippedReason: boolean;
  skippedComment: boolean;
};

export function emptyExitSurvey(): ParsedExitSurvey {
  return {
    reasonCode: null,
    message: null,
    skippedReason: true,
    skippedComment: true,
  };
}

/**
 * Accept only the eight current answers. Legacy codes stay historical and are
 * not stored as version 2 answers. Invalid input becomes a skip, never an error.
 */
export function parseExitSurveyBody(body: unknown): ParsedExitSurvey {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return emptyExitSurvey();
  }
  const record = body as Record<string, unknown>;
  const selected = isExitSurveyReasonCode(record.reasonCode) ? record.reasonCode : null;
  const skippedReason = record.skippedReason === true || selected == null;
  const reasonCode = skippedReason ? null : selected;
  const message = blankToNull(record.message);
  const skippedComment = record.skippedComment === true || message == null;
  return {
    reasonCode,
    message: skippedComment ? null : message,
    skippedReason,
    skippedComment,
  };
}

export function cancelModeFromFacts(args: {
  stripeSubscriptionId: string | null;
  appleGrant: boolean | null;
}): CancelFlowMode {
  if (!args.stripeSubscriptionId) return "apple";
  if (args.appleGrant === true) return "both";
  return "stripe";
}

export function stripeSubscriptionIdFromMetadata(metadata: unknown): string | null {
  if (metadata == null || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).stripeSubscriptionId;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type AppleGrantQueryRow = {
  product_id?: unknown;
  status?: unknown;
  expires_at?: unknown;
};

/**
 * A database error or a missing row list is unknown, not proof that Apple is absent.
 * An empty successful read is a real "no current Apple grant."
 */
export function appleGrantFromQuery(args: {
  error: unknown;
  rows: AppleGrantQueryRow[] | null;
  now?: Date;
}): boolean | null {
  if (args.error) return null;
  if (!Array.isArray(args.rows)) return null;
  const now = args.now ?? new Date();
  return args.rows.some((row) =>
    isAppleRowCurrentlyGranting(
      {
        product_id: typeof row.product_id === "string" ? row.product_id : "",
        status: typeof row.status === "string" ? row.status : "",
        expires_at:
          typeof row.expires_at === "string" || row.expires_at instanceof Date
            ? row.expires_at
            : null,
      },
      now
    )
  );
}

export async function readAppleGrant(
  load: () => Promise<{ error: unknown; rows: AppleGrantQueryRow[] | null }>
): Promise<boolean | null> {
  try {
    const result = await load();
    return appleGrantFromQuery(result);
  } catch {
    return null;
  }
}
