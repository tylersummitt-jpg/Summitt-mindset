/**
 * D2a ownership codes and timing. Not C1/C2 ownership.
 * semantic_due is armed by B2 image-only success for NEW jobs only.
 * semantic_grace is armed here but listed/processed by D2b.
 */

export const INBOUND_MEDIA_D2A_SEMANTIC_DUE = "semantic_due" as const;
export const INBOUND_MEDIA_D2A_SEMANTIC_GRACE = "semantic_grace" as const;
export const INBOUND_MEDIA_D2A_SEMANTIC_MODEL_FAILED =
  "semantic_model_failed" as const;

export const INBOUND_MEDIA_D2A_OWNED_LAST_ERROR_CODES = [
  INBOUND_MEDIA_D2A_SEMANTIC_DUE,
  INBOUND_MEDIA_D2A_SEMANTIC_MODEL_FAILED,
] as const;

export type InboundMediaD2aLastErrorCode =
  (typeof INBOUND_MEDIA_D2A_OWNED_LAST_ERROR_CODES)[number];

export function isInboundMediaD2aOwnedLastErrorCode(
  value: string | null | undefined
): value is InboundMediaD2aLastErrorCode {
  return (
    typeof value === "string" &&
    (INBOUND_MEDIA_D2A_OWNED_LAST_ERROR_CODES as readonly string[]).includes(
      value
    )
  );
}

/** Grace before D2b may later ask. Not semantic attach authority. */
export const INBOUND_MEDIA_D2A_GRACE_MS = 10 * 60 * 1000;
/** If first eval is already past created_at+10m, arm a short future retry (still no SMS). */
export const INBOUND_MEDIA_D2A_GRACE_FLOOR_MS = 60 * 1000;
/** One bounded OpenAI retry after semantic_model_failed. */
export const INBOUND_MEDIA_D2A_MODEL_RETRY_MS = 60 * 1000;
export const INBOUND_MEDIA_D2A_WIN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const INBOUND_MEDIA_D2A_WIN_CAP = 7;
export const INBOUND_MEDIA_PIPELINE_D2A_LIMIT = 1;

export function inboundMmsD2aGraceRetryIso(args: {
  createdAt: string;
  now: Date;
}): string {
  const created = new Date(args.createdAt).getTime();
  const graceAt = Number.isFinite(created)
    ? created + INBOUND_MEDIA_D2A_GRACE_MS
    : args.now.getTime() + INBOUND_MEDIA_D2A_GRACE_MS;
  const floor = args.now.getTime() + INBOUND_MEDIA_D2A_GRACE_FLOOR_MS;
  return new Date(Math.max(graceAt, floor)).toISOString();
}

export function inboundMmsD2aParkRetryIso(args: {
  expiresAt: string | null;
  now: Date;
}): string {
  if (args.expiresAt) {
    const t = new Date(args.expiresAt).getTime();
    if (Number.isFinite(t) && t > args.now.getTime()) {
      return args.expiresAt;
    }
  }
  return new Date(args.now.getTime() + INBOUND_MEDIA_D2A_WIN_LOOKBACK_MS).toISOString();
}
