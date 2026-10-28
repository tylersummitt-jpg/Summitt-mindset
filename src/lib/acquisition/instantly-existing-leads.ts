import { normalizeAcquisitionEmail } from "@/lib/acquisition/model";
import { instantlyLeadStatusLabel } from "@/lib/acquisition/instantly";

/** One Campaign Playbooks request handles this many leads, then the page asks for the next cursor. */
export const EXISTING_INSTANTLY_BATCH = 20;
export const INSTANTLY_LEAD_LIST_URL = "https://api.instantly.ai/api/v2/leads/list";
export const INSTANTLY_LEADS_URL = "https://api.instantly.ai/api/v2/leads";

const LEAD_ID = /^[A-Za-z0-9_-]{1,80}$/;

export type InstantlyLeadView = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  campaignId: string | null;
  status: number | null;
  payload: Record<string, unknown>;
  videoUrl: string | null;
  missingFirst: boolean;
  missingLast: boolean;
};

export function instantlyLeadListBody(campaignId: string, startingAfter: string | null): {
  campaign: string;
  limit: 100;
  starting_after?: string;
} {
  return {
    campaign: campaignId,
    limit: 100,
    ...(startingAfter ? { starting_after: startingAfter } : {}),
  };
}

export function videoUrlPatchBody(url: string): { custom_variables: { video_url: string } } {
  return { custom_variables: { video_url: url } };
}

/** Bounced and unsubscribed leads stay in Instantly and are left out of the update. */
export function instantlyDeliveryStop(status: number | null): "bounced" | "unsubscribed" | null {
  const label = instantlyLeadStatusLabel(status);
  if (label === "bounced" || label === "unsubscribed") return label;
  return null;
}

export function readInstantlyLead(row: unknown): InstantlyLeadView | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!LEAD_ID.test(id)) return null;
  const email = normalizeAcquisitionEmail(typeof record.email === "string" ? record.email : null);
  if (!email) return null;
  const payload = record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
    ? record.payload as Record<string, unknown>
    : {};
  const firstName = cleanName(record.first_name) ?? cleanName(payload.firstName) ?? cleanName(payload.first_name);
  const lastName = cleanName(record.last_name) ?? cleanName(payload.lastName) ?? cleanName(payload.last_name);
  const videoUrl = typeof payload.video_url === "string" && payload.video_url.trim() ? payload.video_url.trim() : null;
  return {
    id,
    email,
    firstName,
    lastName,
    campaignId: typeof record.campaign === "string" && record.campaign.trim() ? record.campaign.trim() : null,
    status: typeof record.status === "number" && Number.isInteger(record.status) ? record.status : null,
    payload,
    videoUrl,
    missingFirst: firstName == null,
    missingLast: lastName == null,
  };
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || name.length > 80) return null;
  return name;
}

export function videoUrlUpdateVerified(args: {
  before: Record<string, unknown>;
  after: unknown;
  expectedUrl: string;
}): { ok: true; replaced: boolean } | { ok: false; reason: string } {
  const payload = payloadOf(args.after);
  if (!payload) return { ok: false, reason: "Instantly's reply did not include the lead's variables." };
  if (payload.video_url !== args.expectedUrl) {
    return { ok: false, reason: "The saved video_url did not match the recipient link." };
  }
  for (const [key, value] of Object.entries(args.before)) {
    if (key === "video_url") continue;
    if (JSON.stringify(payload[key]) !== JSON.stringify(value)) {
      return { ok: false, reason: "An existing personalization field changed during the video_url update." };
    }
  }
  const previous = typeof args.before.video_url === "string" ? args.before.video_url.trim() : "";
  return { ok: true, replaced: previous.length > 0 && previous !== args.expectedUrl };
}

function payloadOf(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const payload = (body as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

export function instantlyRetryWaitMs(attempt: number): number | null {
  if (attempt >= 4) return null;
  return 2000 * 2 ** attempt;
}

export function instantlyStatusRetries(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function writeAndVerifyVideoUrl(args: {
  leadId: string;
  expectedUrl: string;
  before: Record<string, unknown>;
  apiKey: string;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}): Promise<{ ok: true; replaced: boolean } | { ok: false; reason: string; halt: boolean }> {
  const url = `${INSTANTLY_LEADS_URL}/${encodeURIComponent(args.leadId)}`;
  const headers = { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" };
  let attempt = 0;
  while (true) {
    let response: Response;
    try {
      response = await args.fetchImpl(url, {
        method: "PATCH",
        headers,
        body: JSON.stringify(videoUrlPatchBody(args.expectedUrl)),
      });
    } catch {
      const wait = instantlyRetryWaitMs(attempt);
      attempt += 1;
      if (wait == null) return { ok: false, reason: "Instantly could not be reached.", halt: false };
      await args.sleep(wait);
      continue;
    }
    if (instantlyStatusRetries(response.status)) {
      const wait = instantlyRetryWaitMs(attempt);
      attempt += 1;
      if (wait == null) return { ok: false, reason: "Instantly stayed unavailable after retries.", halt: false };
      await args.sleep(wait);
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: "Instantly refused the update.", halt: true };
    }
    if (response.status !== 200) {
      return { ok: false, reason: `Instantly returned ${response.status} for this lead.`, halt: false };
    }
    const patched = await response.json().catch(() => null);
    const direct = videoUrlUpdateVerified({ before: args.before, after: patched, expectedUrl: args.expectedUrl });
    if (direct.ok) return { ok: true, replaced: direct.replaced };
    const reread = await readLeadPayload(url, args.apiKey, args.fetchImpl, args.sleep);
    if (!reread.ok) return reread;
    const checked = videoUrlUpdateVerified({ before: args.before, after: reread.body, expectedUrl: args.expectedUrl });
    if (!checked.ok) return { ok: false, reason: checked.reason, halt: checked.reason.includes("personalization") };
    return { ok: true, replaced: checked.replaced };
  }
}

async function readLeadPayload(
  url: string,
  apiKey: string,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
): Promise<{ ok: true; body: unknown } | { ok: false; reason: string; halt: boolean }> {
  let attempt = 0;
  while (true) {
    let response: Response;
    try {
      response = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    } catch {
      const wait = instantlyRetryWaitMs(attempt);
      attempt += 1;
      if (wait == null) return { ok: false, reason: "The updated lead could not be reread.", halt: false };
      await sleep(wait);
      continue;
    }
    if (instantlyStatusRetries(response.status)) {
      const wait = instantlyRetryWaitMs(attempt);
      attempt += 1;
      if (wait == null) return { ok: false, reason: "The updated lead could not be reread.", halt: false };
      await sleep(wait);
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: "Instantly refused the lead reread.", halt: true };
    }
    if (response.status !== 200) return { ok: false, reason: "The updated lead could not be reread.", halt: false };
    return { ok: true, body: await response.json().catch(() => null) };
  }
}
