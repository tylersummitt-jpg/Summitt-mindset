/**
 * Secure Twilio MMS media download (Slice B1).
 * First hop: api.twilio.com + Basic Auth + redirect:manual
 * One hop: mms.twiliocdn.com without Authorization
 */

import { VICTORY_MEDIA_MAX_UPLOAD_BYTES } from "@/lib/victory-media/constants";
import {
  ContentLengthTooLargeError,
  readResponseBodyWithByteCap,
  StreamByteLimitExceededError,
} from "@/lib/victory-media/read-response-body-byte-cap";
import {
  buildTwilioMediaContentUrl,
  twilioBasicAuthHeader,
  validateTwilioMmsCdnRedirectUrl,
} from "@/lib/victory-media/twilio-mms-media-url";

export const TWILIO_MMS_LIST_TIMEOUT_MS = 10_000;
export const TWILIO_MMS_FIRST_HOP_TIMEOUT_MS = 15_000;
export const TWILIO_MMS_BYTE_FETCH_TIMEOUT_MS = 20_000;

export type TwilioMmsDownloadStage =
  | "media_sid_resolution"
  | "first_hop"
  | "redirect_validation"
  | "cdn_fetch"
  | "stream_read"
  | "storage_upload";

export type TwilioMmsDownloadErrorCode =
  | "missing_twilio_credentials"
  | "invalid_account_sid"
  | "invalid_message_sid"
  | "invalid_media_sid"
  | "timeout"
  | "request_aborted"
  | "network_error"
  | "http_429"
  | "http_5xx"
  | "http_401"
  | "http_403"
  | "http_404"
  | "http_4xx"
  | "invalid_redirect"
  | "redirect_host_forbidden"
  | "redirect_not_https"
  | "redirect_userinfo_forbidden"
  | "second_redirect_forbidden"
  | "content_length_too_large"
  | "byte_limit_exceeded"
  | "empty_body";

export class TwilioMmsDownloadError extends Error {
  readonly code: TwilioMmsDownloadErrorCode;
  readonly httpStatus: number | null;
  readonly retryable: boolean;
  readonly stage: TwilioMmsDownloadStage | null;
  readonly abortName: string | null;

  constructor(
    code: TwilioMmsDownloadErrorCode,
    opts?: {
      httpStatus?: number | null;
      retryable?: boolean;
      cause?: unknown;
      stage?: TwilioMmsDownloadStage | null;
      abortName?: string | null;
    }
  ) {
    super(code);
    this.name = "TwilioMmsDownloadError";
    this.code = code;
    this.httpStatus = opts?.httpStatus ?? null;
    this.retryable = opts?.retryable ?? false;
    this.stage = opts?.stage ?? null;
    this.abortName = opts?.abortName ?? null;
    if (opts?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = opts.cause;
    }
  }
}

export type TwilioMmsDownloadSuccess = {
  bytes: Buffer;
  responseContentType: string | null;
  byteCount: number;
};

export type TwilioMmsDownloadDeps = {
  fetchFn?: typeof fetch;
  accountSid?: string;
  authToken?: string;
  firstHopTimeoutMs?: number;
  byteFetchTimeoutMs?: number;
  maxBytes?: number;
};

function classifyHttpStatus(status: number): {
  code: TwilioMmsDownloadErrorCode;
  retryable: boolean;
} {
  if (status === 429) return { code: "http_429", retryable: true };
  if (status >= 500) return { code: "http_5xx", retryable: true };
  if (status === 401) return { code: "http_401", retryable: false };
  if (status === 403) return { code: "http_403", retryable: false };
  if (status === 404) return { code: "http_404", retryable: true }; // bounded retries at processor
  if (status >= 400) return { code: "http_4xx", retryable: false };
  return { code: "http_4xx", retryable: false };
}

function mapAbortOrNetwork(
  e: unknown,
  opts?: { stage?: TwilioMmsDownloadStage | null; timedOut?: boolean }
): never {
  if (e instanceof TwilioMmsDownloadError) throw e;
  if (e instanceof ContentLengthTooLargeError) {
    throw new TwilioMmsDownloadError("content_length_too_large", {
      retryable: false,
      stage: opts?.stage ?? null,
    });
  }
  if (e instanceof StreamByteLimitExceededError) {
    throw new TwilioMmsDownloadError("byte_limit_exceeded", {
      retryable: false,
      stage: opts?.stage ?? null,
    });
  }
  const name = e instanceof Error ? e.name : "";
  const msg = e instanceof Error ? e.message : String(e);

  // Only our AbortController timer may produce error_code=timeout.
  if (opts?.timedOut) {
    throw new TwilioMmsDownloadError("timeout", {
      retryable: true,
      cause: e,
      stage: opts.stage ?? null,
      abortName: name || null,
    });
  }

  if (name === "AbortError" || /aborted/i.test(msg)) {
    throw new TwilioMmsDownloadError("request_aborted", {
      retryable: true,
      cause: e,
      stage: opts?.stage ?? null,
      abortName: name || "AbortError",
    });
  }

  throw new TwilioMmsDownloadError("network_error", {
    retryable: true,
    cause: e,
    stage: opts?.stage ?? null,
  });
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  stage: TwilioMmsDownloadStage
): Promise<Response> {
  let timedOut = false;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch (e) {
    mapAbortOrNetwork(e, { stage, timedOut });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download media bytes via authenticated Twilio API + one CDN redirect.
 * Never logs Authorization or URLs.
 */
export async function downloadTwilioMmsMediaBytes(
  args: {
    messageSid: string;
    mediaSid: string;
  },
  deps: TwilioMmsDownloadDeps = {}
): Promise<TwilioMmsDownloadSuccess> {
  const accountSid = (deps.accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const authToken = deps.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? "";
  if (!accountSid || !authToken) {
    throw new TwilioMmsDownloadError("missing_twilio_credentials", { retryable: false });
  }

  let firstUrl: string;
  try {
    firstUrl = buildTwilioMediaContentUrl({
      accountSid,
      messageSid: args.messageSid,
      mediaSid: args.mediaSid,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "invalid_account_sid") {
      throw new TwilioMmsDownloadError("invalid_account_sid", { retryable: false });
    }
    if (msg === "invalid_message_sid") {
      throw new TwilioMmsDownloadError("invalid_message_sid", { retryable: false });
    }
    throw new TwilioMmsDownloadError("invalid_media_sid", { retryable: false });
  }

  const fetchFn = deps.fetchFn ?? fetch;
  const firstTimeout = deps.firstHopTimeoutMs ?? TWILIO_MMS_FIRST_HOP_TIMEOUT_MS;
  const byteTimeout = deps.byteFetchTimeoutMs ?? TWILIO_MMS_BYTE_FETCH_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? VICTORY_MEDIA_MAX_UPLOAD_BYTES;
  const auth = twilioBasicAuthHeader(accountSid, authToken);

  const firstRes = await fetchWithTimeout(
    fetchFn,
    firstUrl,
    {
      method: "GET",
      redirect: "manual",
      headers: { Authorization: auth },
    },
    firstTimeout,
    "first_hop"
  );

  // Direct 200 (unusual with media auth but handle safely) — still no auto-follow.
  if (firstRes.status >= 200 && firstRes.status < 300) {
    try {
      const bytes = await readResponseBodyWithByteCap(firstRes, maxBytes);
      if (bytes.length === 0) {
        throw new TwilioMmsDownloadError("empty_body", {
          retryable: true,
          stage: "stream_read",
        });
      }
      return {
        bytes,
        responseContentType: firstRes.headers.get("content-type"),
        byteCount: bytes.length,
      };
    } catch (e) {
      mapAbortOrNetwork(e, { stage: "stream_read" });
    }
  }

  if (
    firstRes.status === 301 ||
    firstRes.status === 302 ||
    firstRes.status === 303 ||
    firstRes.status === 307 ||
    firstRes.status === 308
  ) {
    const location = firstRes.headers.get("location");
    if (!location) {
      throw new TwilioMmsDownloadError("invalid_redirect", {
        retryable: true,
        stage: "redirect_validation",
      });
    }
    let cdnUrl: URL;
    try {
      cdnUrl = validateTwilioMmsCdnRedirectUrl(location);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "invalid_redirect";
      const code =
        msg === "redirect_host_forbidden"
          ? "redirect_host_forbidden"
          : msg === "redirect_not_https"
            ? "redirect_not_https"
            : msg === "redirect_userinfo_forbidden"
              ? "redirect_userinfo_forbidden"
              : "invalid_redirect";
      throw new TwilioMmsDownloadError(code, {
        retryable: false,
        stage: "redirect_validation",
      });
    }

    const secondRes = await fetchWithTimeout(
      fetchFn,
      cdnUrl.toString(),
      {
        method: "GET",
        redirect: "manual",
        // Intentionally NO Authorization
        headers: {},
      },
      byteTimeout,
      "cdn_fetch"
    );

    if (secondRes.status >= 300 && secondRes.status < 400) {
      throw new TwilioMmsDownloadError("second_redirect_forbidden", {
        retryable: false,
        stage: "cdn_fetch",
      });
    }

    if (secondRes.status < 200 || secondRes.status >= 300) {
      const { code, retryable } = classifyHttpStatus(secondRes.status);
      throw new TwilioMmsDownloadError(code, {
        httpStatus: secondRes.status,
        retryable,
        stage: "cdn_fetch",
      });
    }

    try {
      const bytes = await readResponseBodyWithByteCap(secondRes, maxBytes);
      if (bytes.length === 0) {
        throw new TwilioMmsDownloadError("empty_body", {
          retryable: true,
          stage: "stream_read",
        });
      }
      return {
        bytes,
        responseContentType: secondRes.headers.get("content-type"),
        byteCount: bytes.length,
      };
    } catch (e) {
      mapAbortOrNetwork(e, { stage: "stream_read" });
    }
  }

  const { code, retryable } = classifyHttpStatus(firstRes.status);
  throw new TwilioMmsDownloadError(code, {
    httpStatus: firstRes.status,
    retryable,
    stage: "first_hop",
  });
}

export type TwilioMediaListItem = {
  sid: string;
  contentType?: string | null;
};

/**
 * List media SIDs for a Message. Used only when job.twilio_media_sid is null.
 * Caller must enforce exactly-one rule.
 */
export async function listTwilioMessageMediaSids(
  messageSid: string,
  deps: {
    fetchFn?: typeof fetch;
    accountSid?: string;
    authToken?: string;
    timeoutMs?: number;
  } = {}
): Promise<TwilioMediaListItem[]> {
  const accountSid = (deps.accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const authToken = deps.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? "";
  if (!accountSid || !authToken) {
    throw new TwilioMmsDownloadError("missing_twilio_credentials", {
      retryable: false,
      stage: "media_sid_resolution",
    });
  }
  if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) {
    throw new TwilioMmsDownloadError("invalid_account_sid", {
      retryable: false,
      stage: "media_sid_resolution",
    });
  }
  if (!/^(?:SM|MM|MG)[0-9a-fA-F]{32}$/.test(messageSid.trim())) {
    throw new TwilioMmsDownloadError("invalid_message_sid", {
      retryable: false,
      stage: "media_sid_resolution",
    });
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageSid.trim()}/Media.json?PageSize=20`;
  const fetchFn = deps.fetchFn ?? fetch;
  const auth = twilioBasicAuthHeader(accountSid, authToken);
  const res = await fetchWithTimeout(
    fetchFn,
    url,
    {
      method: "GET",
      redirect: "manual",
      headers: { Authorization: auth, Accept: "application/json" },
    },
    deps.timeoutMs ?? TWILIO_MMS_LIST_TIMEOUT_MS,
    "media_sid_resolution"
  );

  if (res.status < 200 || res.status >= 300) {
    const { code, retryable } = classifyHttpStatus(res.status);
    throw new TwilioMmsDownloadError(code, {
      httpStatus: res.status,
      retryable,
      stage: "media_sid_resolution",
    });
  }

  const json = (await res.json()) as { media_list?: unknown; media?: unknown };
  const list = Array.isArray(json.media_list)
    ? json.media_list
    : Array.isArray(json.media)
      ? json.media
      : [];

  const out: TwilioMediaListItem[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const sid = (item as { sid?: unknown }).sid;
    if (typeof sid !== "string" || !/^ME[0-9a-fA-F]{32}$/.test(sid)) continue;
    const ct = (item as { content_type?: unknown }).content_type;
    out.push({
      sid,
      contentType: typeof ct === "string" ? ct : null,
    });
  }
  return out;
}
