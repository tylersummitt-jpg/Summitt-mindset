/**
 * Twilio MMS media SID validation + canonical download URL (Slice B1).
 * No MediaUrl persistence. No credential logging.
 */

export const TWILIO_ACCOUNT_SID_RE = /^AC[0-9a-fA-F]{32}$/;
export const TWILIO_MESSAGE_SID_RE = /^(?:SM|MM|MG)[0-9a-fA-F]{32}$/;
export const TWILIO_MEDIA_SID_RE = /^ME[0-9a-fA-F]{32}$/;

/** Locked redirect host for authenticated media retrieval. */
export const TWILIO_MMS_CDN_HOST = "mms.twiliocdn.com";

export function isTwilioAccountSid(value: string | null | undefined): boolean {
  return typeof value === "string" && TWILIO_ACCOUNT_SID_RE.test(value.trim());
}

export function isTwilioMessageSid(value: string | null | undefined): boolean {
  return typeof value === "string" && TWILIO_MESSAGE_SID_RE.test(value.trim());
}

export function isTwilioMediaSid(value: string | null | undefined): boolean {
  return typeof value === "string" && TWILIO_MEDIA_SID_RE.test(value.trim());
}

export function buildTwilioMediaContentUrl(args: {
  accountSid: string;
  messageSid: string;
  mediaSid: string;
}): string {
  const accountSid = args.accountSid.trim();
  const messageSid = args.messageSid.trim();
  const mediaSid = args.mediaSid.trim();
  if (!isTwilioAccountSid(accountSid)) {
    throw new Error("invalid_account_sid");
  }
  if (!isTwilioMessageSid(messageSid)) {
    throw new Error("invalid_message_sid");
  }
  if (!isTwilioMediaSid(mediaSid)) {
    throw new Error("invalid_media_sid");
  }
  return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}/Media/${mediaSid}`;
}

export function twilioBasicAuthHeader(accountSid: string, authToken: string): string {
  const user = accountSid.trim();
  const pass = authToken;
  if (!user || !pass) throw new Error("missing_twilio_credentials");
  return `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`;
}

/**
 * Validate Twilio CDN redirect Location. Exact host mms.twiliocdn.com only.
 */
export function validateTwilioMmsCdnRedirectUrl(location: string): URL {
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    throw new Error("invalid_redirect_url");
  }
  if (url.protocol !== "https:") throw new Error("redirect_not_https");
  if (url.username || url.password) throw new Error("redirect_userinfo_forbidden");
  if (url.port && url.port !== "443") throw new Error("redirect_port_forbidden");
  if (url.hostname !== TWILIO_MMS_CDN_HOST) throw new Error("redirect_host_forbidden");
  // Reject IP literals (hostname equality already blocks most; belt + suspenders).
  if (/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname.includes(":")) {
    throw new Error("redirect_host_forbidden");
  }
  return url;
}
