/**
 * Scrub OpenAI / SDK thrown errors for admin forensic metadata.
 * Whitelist only — never persist headers, keys, stacks, or request payloads.
 */

export type ScrubbedOpenAiRequestError = {
  name: string | null;
  message: string | null;
  status: number | null;
  code: string | null;
  type: string | null;
  request_id: string | null;
};

const MESSAGE_MAX = 500;
const SHORT_MAX = 120;

function truncate(value: string, max: number): string {
  const t = value.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function readString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = truncate(value, max);
  return t.length > 0 ? t : null;
}

/**
 * Extract safe diagnostic fields from an unknown thrown error.
 * Does not copy headers, stack, cause, body, or auth material.
 */
export function scrubOpenAiRequestErrorForCapture(
  err: unknown
): ScrubbedOpenAiRequestError {
  if (err == null) {
    return {
      name: null,
      message: null,
      status: null,
      code: null,
      type: null,
      request_id: null,
    };
  }

  if (typeof err !== "object") {
    return {
      name: null,
      message: truncate(String(err), MESSAGE_MAX),
      status: null,
      code: null,
      type: null,
      request_id: null,
    };
  }

  const o = err as Record<string, unknown>;
  const nested =
    o.error && typeof o.error === "object" && !Array.isArray(o.error)
      ? (o.error as Record<string, unknown>)
      : null;

  let code = readString(o.code, SHORT_MAX);
  if (!code && typeof o.code === "number" && Number.isFinite(o.code)) {
    code = String(o.code);
  }
  if (!code && nested) {
    code = readString(nested.code, SHORT_MAX);
    if (!code && typeof nested.code === "number" && Number.isFinite(nested.code)) {
      code = String(nested.code);
    }
  }

  let type = readString(o.type, SHORT_MAX);
  if (!type && nested) type = readString(nested.type, SHORT_MAX);

  const request_id =
    readString(o.request_id, SHORT_MAX) ?? readString(o.requestID, SHORT_MAX);

  const status =
    typeof o.status === "number" && Number.isFinite(o.status) ? o.status : null;

  return {
    name: readString(o.name, SHORT_MAX),
    message: readString(o.message, MESSAGE_MAX),
    status,
    code,
    type,
    request_id,
  };
}
