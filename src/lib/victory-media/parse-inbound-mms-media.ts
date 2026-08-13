/**
 * Twilio inbound MMS metadata parsing (Slice A2).
 * Enumerate MediaUrlN / MediaContentTypeN for enqueue only — never fetch bytes.
 */

import { isVictoryMediaAllowedUploadMime } from "@/lib/victory-media/constants";

/**
 * Twilio MMS allows at most 10 media items per message.
 * Cap enumeration so a forged NumMedia cannot force unbounded param reads.
 */
export const TWILIO_INBOUND_MMS_MEDIA_ENUM_CAP = 10;

/** Twilio Media SID: ME + 32 hex chars. */
const TWILIO_MEDIA_SID_RE = /^ME[0-9a-fA-F]{32}$/;

const TWILIO_MEDIA_PATH_RE =
  /^\/2010-04-01\/Accounts\/(AC[0-9a-fA-F]{32})\/Messages\/((?:SM|MM|MG)[0-9a-fA-F]{32})\/Media\/(ME[0-9a-fA-F]{32})$/;

export type InboundMmsEnqueueCandidate = {
  ordinal: number;
  declaredContentType: string;
  twilioMediaSid: string | null;
};

/**
 * Extract optional Twilio Media SID from MediaUrl without fetching.
 * On any validation failure → null (worker may recover via MessageSid+ordinal).
 */
export function extractTwilioMediaSidFromMediaUrl(args: {
  mediaUrl: string | null | undefined;
  inboundMessageSid: string;
  twilioAccountSid?: string | null;
}): string | null {
  const raw = typeof args.mediaUrl === "string" ? args.mediaUrl.trim() : "";
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.hostname !== "api.twilio.com") return null;

  const pathMatch = TWILIO_MEDIA_PATH_RE.exec(url.pathname);
  if (!pathMatch) return null;

  const accountSid = pathMatch[1]!;
  const messageSidInPath = pathMatch[2]!;
  const mediaSid = pathMatch[3]!;

  if (!TWILIO_MEDIA_SID_RE.test(mediaSid)) return null;

  const expectedMessageSid = args.inboundMessageSid.trim();
  if (!expectedMessageSid || messageSidInPath !== expectedMessageSid) return null;

  const expectedAccount = args.twilioAccountSid?.trim() || null;
  if (expectedAccount && accountSid !== expectedAccount) return null;

  return mediaSid;
}

function normalizeDeclaredContentType(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = String(raw).trim().toLowerCase();
  if (!t) return null;
  const base = t.split(";")[0]?.trim() ?? "";
  return base || null;
}

/**
 * Collect supported image media candidates for enqueue.
 * Unsupported / blank MIME ordinals are skipped. Does not fetch URLs.
 */
export function collectInboundMmsEnqueueCandidates(args: {
  params: URLSearchParams;
  messageSid: string;
  numMedia: number;
  twilioAccountSid?: string | null;
}): InboundMmsEnqueueCandidate[] {
  const n = Math.min(
    Math.max(0, args.numMedia),
    TWILIO_INBOUND_MMS_MEDIA_ENUM_CAP
  );
  if (n <= 0) return [];

  const out: InboundMmsEnqueueCandidate[] = [];
  for (let ordinal = 0; ordinal < n; ordinal++) {
    const declared = normalizeDeclaredContentType(
      args.params.get(`MediaContentType${ordinal}`)
    );
    if (!declared || !isVictoryMediaAllowedUploadMime(declared)) {
      continue;
    }

    const mediaUrl = args.params.get(`MediaUrl${ordinal}`);
    const twilioMediaSid = extractTwilioMediaSidFromMediaUrl({
      mediaUrl,
      inboundMessageSid: args.messageSid,
      twilioAccountSid: args.twilioAccountSid ?? null,
    });

    out.push({
      ordinal,
      declaredContentType: declared,
      twilioMediaSid,
    });
  }
  return out;
}
