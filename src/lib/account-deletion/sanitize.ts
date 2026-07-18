const MAX_DETAIL_LENGTH = 500;

/**
 * Best-effort redaction patterns only — not a guarantee that arbitrary IDs
 * or secrets are removed. Prefer not putting sensitive payloads in details.
 */
const REDACT_FULL_MATCH: RegExp[] = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\buser_[A-Za-z0-9]+/gi,
  /\b(cus|sub|pi|price)_[A-Za-z0-9]+\b/gi,
  /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]+\b/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\+?\d[\d\s().-]{7,}\d/g,
];

const REDACT_QUERY_VALUE =
  /([?&](?:token|api_key|key|secret|access_token)=)[^&\s#]*/gi;

/**
 * Best-effort, log-safe error detail: redact common PII/token shapes and
 * truncate. Does not claim complete secret scrubbing.
 */
export function sanitizeAccountDeletionErrorDetail(
  detail: string | null | undefined
): string | null {
  if (detail == null) return null;
  let out = String(detail);
  for (const pattern of REDACT_FULL_MATCH) {
    out = out.replace(pattern, "[redacted]");
  }
  out = out.replace(REDACT_QUERY_VALUE, "$1[redacted]");
  out = out.replace(/\s+/g, " ").trim();
  if (out.length === 0) return null;
  if (out.length > MAX_DETAIL_LENGTH) {
    return out.slice(0, MAX_DETAIL_LENGTH);
  }
  return out;
}
