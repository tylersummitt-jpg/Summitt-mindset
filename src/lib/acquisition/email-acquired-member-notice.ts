import { createHmac, timingSafeEqual } from "node:crypto";

export const ACQUISITION_JOURNEY_METADATA_KEY = "acquisitionJourneyId";
export const ACQUISITION_JOURNEY_QUERY = "aj";

const JOURNEY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseAcquisitionJourneyId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return JOURNEY_ID.test(id) ? id : null;
}

export function acquisitionJourneyTokenShape(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const id = parseAcquisitionJourneyId(token.slice(0, dot));
  const mac = token.slice(dot + 1);
  if (!id || !/^[A-Za-z0-9_-]{43}$/.test(mac)) return null;
  return `${id}.${mac}`;
}

export function signAcquisitionJourneyId(journeyId: string, secret: string): string | null {
  const id = parseAcquisitionJourneyId(journeyId);
  const key = secret.trim();
  if (!id || key.length < 16) return null;
  const mac = createHmac("sha256", key).update(`acquisition-journey:${id}`).digest("base64url");
  return `${id}.${mac}`;
}

export function readSignedAcquisitionJourneyId(token: unknown, secret: string): string | null {
  const shaped = acquisitionJourneyTokenShape(token);
  const key = secret.trim();
  if (!shaped || key.length < 16) return null;
  const dot = shaped.indexOf(".");
  const id = shaped.slice(0, dot);
  const mac = shaped.slice(dot + 1);
  const expected = createHmac("sha256", key).update(`acquisition-journey:${id}`).digest("base64url");
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  return id;
}

export function acquisitionCheckoutPath(token: string | null): string {
  return token ? `/checkout/start?${ACQUISITION_JOURNEY_QUERY}=${encodeURIComponent(token)}` : "/checkout/start";
}

export function acquisitionTrialCheckoutUrl(journeyId: string | null, secret: string): string {
  const token = journeyId ? signAcquisitionJourneyId(journeyId, secret) : null;
  return `https://summittmindset.com${acquisitionCheckoutPath(token)}`;
}

export function journeyIdFromStripeMetadata(
  metadata: { [key: string]: string | undefined } | null | undefined
): string | null {
  return parseAcquisitionJourneyId(metadata?.[ACQUISITION_JOURNEY_METADATA_KEY]);
}

/** Campaign credit exists only when the checkout journey belongs to this person. */
export function attributionFromVerifiedJourney(args: {
  requestedJourneyId: string | null;
  journey: { id: string; personId: string; campaignId: string | null } | null;
  personId: string;
}): { journeyId: string; campaignId: string } | null {
  const requested = parseAcquisitionJourneyId(args.requestedJourneyId);
  if (!requested || !args.journey || args.journey.id !== requested) return null;
  if (args.journey.personId !== args.personId) return null;
  const campaignId = args.journey.campaignId?.trim() ?? "";
  if (!campaignId) return null;
  return { journeyId: requested, campaignId };
}

export type OutreachHistoryDecision = {
  ownerCanary: boolean;
  exactEmailConfirmed: boolean;
  signedJourneyConfirmed: boolean;
};

/** A stored send, a real reply, or a Resend acceptance. An imported lead is not contact. */
export function confirmedPreviousOutreach(input: {
  emailSent: number;
  inboundReplies: number;
  sentOutboundReplies: number;
  acceptedOrDeliveredResources: number;
}): boolean {
  return (
    input.emailSent > 0 ||
    input.inboundReplies > 0 ||
    input.sentOutboundReplies > 0 ||
    input.acceptedOrDeliveredResources > 0
  );
}

export function resendResourceCountsAsSent(status: string | null, deliveredAt: string | null): boolean {
  if (deliveredAt?.trim()) return true;
  return status === "accepted" || status === "delivered";
}

export function decideOutreachHistoryNotice(
  history: OutreachHistoryDecision
): { send: false; reason: string } | { send: true } {
  if (history.ownerCanary) return { send: false, reason: "owner_canary" };
  if (!history.exactEmailConfirmed && !history.signedJourneyConfirmed) {
    return { send: false, reason: "no_confirmed_outreach" };
  }
  return { send: true };
}

export type RecordedConversationEntry = {
  at: string;
  kind: "instantly_outreach" | "inbound_reply" | "ai_reply" | "ai_draft" | "resend_resource";
  sender: string;
  subject: string | null;
  body: string | null;
  detail: string | null;
};

export type OutreachHistoryCampaign = {
  id: string | null;
  name: string | null;
  entries: RecordedConversationEntry[];
};

export type OutreachHistorySection = {
  association: "exact_email" | "signed_journey";
  acquisitionName: string | null;
  acquisitionEmail: string | null;
  campaigns: OutreachHistoryCampaign[];
};

export type HistoryJourney = {
  id: string;
  campaignId: string | null;
  name: string | null;
};

export type HistoryRow = {
  at: string;
  journeyId: string | null;
  campaignId: string | null;
  entry: RecordedConversationEntry;
};

/**
 * Keep each journey's records together. A row is attached to a journey when it
 * carries that journey id, or when it has no journey id and its campaign id
 * matches exactly one known journey. A different campaign stays in its own group.
 */
function stampCampaign(entry: RecordedConversationEntry, campaignId: string | null): RecordedConversationEntry {
  if (!campaignId) return entry;
  const note = `Campaign id on this record: ${campaignId}.`;
  if (entry.detail?.includes(note)) return entry;
  return { ...entry, detail: entry.detail ? `${entry.detail} ${note}` : note };
}

export function groupHistoryByJourney(journeys: HistoryJourney[], rows: HistoryRow[]): OutreachHistoryCampaign[] {
  const byJourney = new Map(journeys.map((journey) => [journey.id, journey]));
  const byCampaign = new Map<string, HistoryJourney | "ambiguous">();
  for (const journey of journeys) {
    if (!journey.campaignId) continue;
    const existing = byCampaign.get(journey.campaignId);
    if (!existing) byCampaign.set(journey.campaignId, journey);
    else if (existing === "ambiguous" || existing.id !== journey.id) byCampaign.set(journey.campaignId, "ambiguous");
  }
  const buckets = new Map<string, { at: string; campaign: OutreachHistoryCampaign }>();
  for (const row of rows) {
    const tagged = row.journeyId ? byJourney.get(row.journeyId) ?? null : null;
    const campaignJourney = !row.journeyId && row.campaignId ? byCampaign.get(row.campaignId) : undefined;
    const matched = tagged ?? (campaignJourney && campaignJourney !== "ambiguous" ? campaignJourney : null);
    const key = matched
      ? `journey:${matched.id}`
      : row.journeyId
        ? `journey:${row.journeyId}`
        : row.campaignId
          ? `campaign:${row.campaignId}`
          : "unscoped";
    const campaignId = matched?.campaignId ?? row.campaignId;
    const name = matched?.name ?? null;
    let detail = row.entry.detail;
    if (row.campaignId && campaignId && row.campaignId !== campaignId) {
      const note = `Campaign id on this record: ${row.campaignId}.`;
      detail = detail ? `${detail} ${note}` : note;
    }
    const entry = { ...row.entry, detail };
    const existing = buckets.get(key);
    if (existing) {
      if (existing.campaign.id && campaignId && existing.campaign.id !== campaignId) {
        const previousId = existing.campaign.id;
        existing.campaign.id = null;
        existing.campaign.name = null;
        existing.campaign.entries = existing.campaign.entries.map((item) => stampCampaign(item, previousId));
        entry.detail = stampCampaign(entry, row.campaignId).detail;
      }
      existing.campaign.entries.push(entry);
      if (row.at < existing.at) existing.at = row.at;
      continue;
    }
    buckets.set(key, {
      at: row.at,
      campaign: { id: campaignId, name, entries: [entry] },
    });
  }
  return [...buckets.values()]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((bucket) => ({
      ...bucket.campaign,
      entries: bucket.campaign.entries.sort((a, b) => a.at.localeCompare(b.at)),
    }));
}

export type EmailAcquiredMemberNoticeInput = {
  memberName: string | null;
  memberEmail: string | null;
  sections: OutreachHistorySection[];
  outreachUnreadable: boolean;
  repliesUnreadable: boolean;
  resourcesUnreadable: boolean;
  truncated: boolean;
};

export function emailAcquiredMemberNotifyKey(subscriptionId: string): string | null {
  const id = subscriptionId.trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
  return `email-campaign-member-${id}`;
}

function clean(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const KIND_LABEL: Record<RecordedConversationEntry["kind"], string> = {
  instantly_outreach: "Instantly outreach",
  inbound_reply: "Prospect reply",
  ai_reply: "Automated AI reply",
  ai_draft: "AI draft, not sent",
  resend_resource: "Resend resource",
};

/** Signed journey links stay valid until checkout and payment re-check the journey row. */
export const ACQUISITION_JOURNEY_LINK_LIFETIME = "rechecked_at_checkout_and_payment";

export function describeResendResource(args: {
  status: string | null;
  resource: string | null;
  deliveredAt: string | null;
}): string {
  const resource = args.resource?.trim() || "not stored";
  if (args.deliveredAt?.trim() || args.status === "delivered") {
    return `Delivery was recorded. Resource: ${resource}.`;
  }
  if (args.status === "accepted") {
    return `Resend accepted this send. Delivery has not been recorded. Resource: ${resource}.`;
  }
  if (args.status === "scheduled") {
    return `Scheduled. Resend has not accepted it. Delivery has not been recorded. Resource: ${resource}.`;
  }
  if (args.status === "claimed") {
    return `Claimed for sending. Resend has not accepted it. Delivery has not been recorded. Resource: ${resource}.`;
  }
  return `Status: ${args.status?.trim() || "not stored"}. Delivery has not been recorded. Resource: ${resource}.`;
}

export type NoticeClaimRow = {
  state: string | null;
  claimUntilMs: number | null;
  resendId: string | null;
};

export function decideNoticeClaim(existing: NoticeClaimRow | null, nowMs: number): "create" | "skip" | "takeover" {
  if (!existing) return "create";
  if (existing.resendId || existing.state === "accepted") return "skip";
  if (existing.state === "claim" && existing.claimUntilMs != null && existing.claimUntilMs > nowMs) return "skip";
  if (existing.state === "failed") return "takeover";
  if (existing.state === "claim") return "takeover";
  return "skip";
}

export function buildEmailAcquiredMemberNotice(input: EmailAcquiredMemberNoticeInput): {
  subject: string;
  text: string;
  html: string;
  incomplete: boolean;
} {
  const label = clean(input.memberName, 120) ?? clean(input.memberEmail, 254) ?? "new member";
  const subject = `Previous outreach — ${label}`;
  const entries = input.sections.flatMap((section) => section.campaigns.flatMap((campaign) => campaign.entries));
  const missing: string[] = [];
  if (input.outreachUnreadable) missing.push("Instantly outreach records could not be read.");
  if (input.repliesUnreadable) missing.push("Replies and AI replies could not be read.");
  if (input.resourcesUnreadable) missing.push("Resend resource records could not be read.");
  if (input.truncated) missing.push("The recorded history was longer than this email includes.");
  if (entries.some((entry) => entry.kind === "instantly_outreach" && !entry.body)) {
    missing.push("Instantly outreach bodies are not stored.");
  }
  const incomplete = missing.length > 0;
  const lines = [
    "Previously contacted through email outreach. This does not establish that email caused the subscription.",
    "",
    `Member name: ${clean(input.memberName, 120) ?? "not provided"}`,
    `Member email: ${clean(input.memberEmail, 254) ?? "not provided"}`,
    "",
  ];
  for (const section of input.sections) {
    if (section.association === "exact_email") {
      lines.push("Exact email match.");
      lines.push("The member email matches the acquisition email.");
    } else {
      lines.push("Signed journey link.");
      lines.push("The member email differs from the acquisition email. Checkout carried a verified signed journey. This is not an exact email match.");
    }
    lines.push(`Acquisition name: ${clean(section.acquisitionName, 120) ?? "not stored"}`);
    lines.push(`Acquisition email: ${clean(section.acquisitionEmail, 254) ?? "not stored"}`);
    const campaigns = section.campaigns.length > 0 ? section.campaigns : [{ id: null, name: null, entries: [] }];
    for (const campaign of campaigns) {
      lines.push(`Campaign: ${clean(campaign.name, 80) ?? "campaign name not stored"}`);
      lines.push(`Campaign id: ${clean(campaign.id, 80) ?? "not stored"}`);
      if (!campaign.id) lines.push("These records are not tied to a stored campaign.");
      lines.push("Recorded history, oldest first.");
      if (campaign.entries.length === 0) {
        lines.push("A previous outreach record is stored, but its time could not be read. This line is not a reconstructed email.");
      }
      campaign.entries.forEach((entry, index) => {
        lines.push(`${index + 1}. ${entry.at} — ${KIND_LABEL[entry.kind]}`);
        lines.push(`Sender: ${clean(entry.sender, 254) ?? "not stored"}`);
        if (entry.subject) lines.push(`Subject: ${clean(entry.subject, 300)}`);
        if (entry.detail) lines.push(clean(entry.detail, 300) ?? "");
        lines.push(entry.body ? entry.body.slice(0, 4000) : "Body: not stored. This line is not a reconstructed email.");
        if (entry.body && entry.body.length > 4000) lines.push("The stored body continues beyond this email.");
        lines.push("");
      });
    }
  }
  if (incomplete) {
    lines.push("Part of this history is missing.");
    lines.push(...missing);
    lines.push("");
  }
  lines.push("Review whether a Leadership Kit is appropriate.");
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  const html = `<p><strong>${escapeHtml(subject)}</strong></p><pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(text)}</pre>`;
  return { subject, text, html, incomplete };
}

export async function deliverEmailAcquiredMemberNotice(args: {
  history: OutreachHistoryDecision;
  notice: EmailAcquiredMemberNoticeInput;
  subscriptionId: string;
  credentialsReady: boolean;
  claim: () => Promise<"send" | "skip" | "fail">;
  send: (
    message: { subject: string; text: string; html: string },
    idempotencyKey: string
  ) => Promise<{ state: "sent"; providerMessageId: string } | { state: "failed" } | { state: "skipped" }>;
  record: (result: "accepted" | "failed", providerMessageId: string | null) => Promise<void>;
}): Promise<"sent" | "skipped" | "failed"> {
  const decision = decideOutreachHistoryNotice(args.history);
  if (!decision.send) return "skipped";
  const key = emailAcquiredMemberNotifyKey(args.subscriptionId);
  if (!key) return "skipped";
  if (!args.credentialsReady) return "skipped";
  const claimed = await args.claim();
  if (claimed === "skip") return "skipped";
  if (claimed !== "send") return "failed";
  const message = buildEmailAcquiredMemberNotice(args.notice);
  let result: { state: "sent"; providerMessageId: string } | { state: "failed" } | { state: "skipped" };
  try {
    result = await args.send(
      { subject: message.subject, text: message.text, html: message.html },
      key
    );
  } catch {
    result = { state: "failed" };
  }
  if (result.state === "sent" && result.providerMessageId) {
    try {
      await args.record("accepted", result.providerMessageId);
    } catch {
      return "failed";
    }
    return "sent";
  }
  try {
    await args.record("failed", null);
  } catch {
    return "failed";
  }
  return "failed";
}
