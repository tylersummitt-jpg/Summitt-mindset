/**
 * Twilio inbound transport gate helpers (MMS Slice A1).
 * NumMedia parsing + Body-OR-Media validity only — no media URL handling.
 */

/** Parse Twilio NumMedia: missing/invalid/negative → 0. A1 uses only `> 0`. */
export function parseTwilioInboundNumMedia(raw: string | null | undefined): number {
  if (raw == null) return 0;
  const trimmed = String(raw).trim();
  if (!trimmed) return 0;
  if (!/^\d+$/.test(trimmed)) return 0;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(n) || n < 0) return 0;
  return n;
}

export type TwilioInboundTransportGate = {
  accept: boolean;
  hasBody: boolean;
  hasMedia: boolean;
  /** Accepted inbound with media and no text body (image-only MMS). */
  imageOnly: boolean;
};

/**
 * Valid inbound requires MessageSid, From, and (non-empty Body OR NumMedia > 0).
 * Does not fabricate Body.
 */
export function evaluateTwilioInboundTransportGate(args: {
  messageSid: string | null | undefined;
  from: string;
  body: string;
  numMedia: number;
}): TwilioInboundTransportGate {
  const hasBody = args.body.trim().length > 0;
  const hasMedia = args.numMedia > 0;
  const accept = Boolean(args.messageSid?.trim() && args.from && (hasBody || hasMedia));
  return {
    accept,
    hasBody,
    hasMedia,
    imageOnly: accept && !hasBody && hasMedia,
  };
}
