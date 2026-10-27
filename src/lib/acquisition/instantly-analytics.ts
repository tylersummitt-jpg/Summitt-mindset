/**
 * Read-only shapes from Instantly API v2 analytics.
 * Open and click counts are dropped on purpose. They are not inbox placement.
 * A missing number stays null. It is not stored as zero.
 */

export type InstantlyCampaignStatusFilter =
  | "draft"
  | "active"
  | "paused"
  | "completed"
  | "running"
  | "other"
  | "unknown";

export type InstantlyCampaignAnalytics = {
  campaignId: string;
  campaignName: string | null;
  statusCode: number | null;
  statusLabel: string;
  statusFilter: InstantlyCampaignStatusFilter;
  leadsCount: number | null;
  contactedCount: number | null;
  emailsSentCount: number | null;
  newLeadsContactedCount: number | null;
  replyCount: number | null;
  replyCountUnique: number | null;
  replyCountAutomaticUnique: number | null;
  bouncedCount: number | null;
  unsubscribedCount: number | null;
  completedCount: number | null;
  totalOpportunities: number | null;
};

export type InstantlyOverview = {
  emailsSentCount: number | null;
  contactedCount: number | null;
  newLeadsContactedCount: number | null;
  replyCount: number | null;
  replyCountUnique: number | null;
  replyCountAutomaticUnique: number | null;
  bouncedCount: number | null;
  unsubscribedCount: number | null;
  completedCount: number | null;
  totalOpportunities: number | null;
  totalInterested: number | null;
};

export type InstantlyDailyPoint = {
  date: string;
  sent: number | null;
  contacted: number | null;
  uniqueReplies: number | null;
  opportunities: number | null;
};

export type InstantlyStepPoint = {
  step: string | null;
  variant: string | null;
  variantLabel: string;
  sent: number | null;
  uniqueReplies: number | null;
  repliesAutomatic: number | null;
  opportunities: number | null;
};

export type InstantlyCampaignProfile = {
  id: string;
  name: string | null;
  statusCode: number | null;
  statusLabel: string;
  statusFilter: InstantlyCampaignStatusFilter;
  createdAt: string | null;
  openTracking: boolean | null;
  linkTracking: boolean | null;
};

export type InstantlyAccount = {
  id: string | null;
  email: string;
  statusCode: number | null;
};

export type InstantlyAccountDaily = {
  date: string;
  email: string;
  sent: number | null;
  bounced: number | null;
  contacted: number | null;
  uniqueReplies: number | null;
};

const CAMPAIGN_STATUS: Record<number, { label: string; filter: InstantlyCampaignStatusFilter }> = {
  0: { label: "Draft", filter: "draft" },
  1: { label: "Active", filter: "active" },
  2: { label: "Paused", filter: "paused" },
  3: { label: "Completed", filter: "completed" },
  4: { label: "Running subsequences", filter: "running" },
  [-99]: { label: "Account suspended", filter: "other" },
  [-1]: { label: "Accounts unhealthy", filter: "other" },
  [-2]: { label: "Bounce protect", filter: "other" },
};

export function instantlyCampaignStatus(value: unknown): {
  code: number | null;
  label: string;
  filter: InstantlyCampaignStatusFilter;
} {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { code: null, label: "Unknown", filter: "unknown" };
  }
  const known = CAMPAIGN_STATUS[value];
  if (!known) return { code: value, label: "Unknown", filter: "unknown" };
  return { code: value, label: known.label, filter: known.filter };
}

export function variantLabel(variant: string | null): string {
  if (variant == null) return "Not attributed";
  if (variant === "0") return "A";
  if (variant === "1") return "B";
  if (variant === "2") return "C";
  return `Index ${variant}`;
}

function count(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function text(value: unknown, max = 180): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function rows(body: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(body)) return null;
  return body.flatMap((item) => (item && typeof item === "object" ? [item as Record<string, unknown>] : []));
}

export function parseCampaignAnalytics(body: unknown): { ok: true; campaigns: InstantlyCampaignAnalytics[] } | { ok: false; reason: "invalid_shape" } {
  const list = rows(body);
  if (!list) return { ok: false, reason: "invalid_shape" };
  const campaigns: InstantlyCampaignAnalytics[] = [];
  for (const row of list) {
    const campaignId = text(row.campaign_id, 80);
    if (!campaignId) continue;
    const status = instantlyCampaignStatus(row.campaign_status);
    campaigns.push({
      campaignId,
      campaignName: text(row.campaign_name),
      statusCode: status.code,
      statusLabel: status.label,
      statusFilter: status.filter,
      leadsCount: count(row.leads_count),
      contactedCount: count(row.contacted_count),
      emailsSentCount: count(row.emails_sent_count),
      newLeadsContactedCount: count(row.new_leads_contacted_count),
      replyCount: count(row.reply_count),
      replyCountUnique: count(row.reply_count_unique),
      replyCountAutomaticUnique: count(row.reply_count_automatic_unique),
      bouncedCount: count(row.bounced_count),
      unsubscribedCount: count(row.unsubscribed_count),
      completedCount: count(row.completed_count),
      totalOpportunities: count(row.total_opportunities),
    });
  }
  if (list.length > 0 && campaigns.length === 0) return { ok: false, reason: "invalid_shape" };
  return { ok: true, campaigns };
}

export function parseOverview(body: unknown): { ok: true; overview: InstantlyOverview } | { ok: false; reason: "invalid_shape" } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_shape" };
  const row = body as Record<string, unknown>;
  return {
    ok: true,
    overview: {
      emailsSentCount: count(row.emails_sent_count),
      contactedCount: count(row.contacted_count),
      newLeadsContactedCount: count(row.new_leads_contacted_count),
      replyCount: count(row.reply_count),
      replyCountUnique: count(row.reply_count_unique),
      replyCountAutomaticUnique: count(row.reply_count_automatic_unique),
      bouncedCount: count(row.bounced_count),
      unsubscribedCount: count(row.unsubscribed_count),
      completedCount: count(row.completed_count),
      totalOpportunities: count(row.total_opportunities),
      totalInterested: count(row.total_interested),
    },
  };
}

export function parseDaily(body: unknown): { ok: true; rows: InstantlyDailyPoint[] } | { ok: false; reason: "invalid_shape" } {
  const list = rows(body);
  if (!list) return { ok: false, reason: "invalid_shape" };
  return {
    ok: true,
    rows: list.flatMap((row) => {
      const date = text(row.date, 10);
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
      return [{
        date,
        sent: count(row.sent),
        contacted: count(row.contacted),
        uniqueReplies: count(row.unique_replies),
        opportunities: count(row.opportunities),
      }];
    }),
  };
}

export function parseSteps(body: unknown): { ok: true; rows: InstantlyStepPoint[] } | { ok: false; reason: "invalid_shape" } {
  const list = rows(body);
  if (!list) return { ok: false, reason: "invalid_shape" };
  return {
    ok: true,
    rows: list.map((row) => {
      const variant = row.variant == null ? null : text(String(row.variant), 12);
      const step = row.step == null ? null : text(String(row.step), 12);
      return {
        step,
        variant,
        variantLabel: variantLabel(variant),
        sent: count(row.sent),
        uniqueReplies: count(row.unique_replies),
        repliesAutomatic: count(row.replies_automatic),
        opportunities: count(row.opportunities),
      };
    }),
  };
}

export function parseCampaignProfiles(items: unknown[]): { profiles: InstantlyCampaignProfile[]; skipped: number } {
  const profiles: InstantlyCampaignProfile[] = [];
  let skipped = 0;
  for (const item of items) {
    if (!item || typeof item !== "object") {
      skipped += 1;
      continue;
    }
    const row = item as Record<string, unknown>;
    const id = text(row.id, 80);
    if (!id) {
      skipped += 1;
      continue;
    }
    const status = instantlyCampaignStatus(row.status);
    profiles.push({
      id,
      name: text(row.name),
      statusCode: status.code,
      statusLabel: status.label,
      statusFilter: status.filter,
      createdAt: text(row.timestamp_created, 40),
      openTracking: typeof row.open_tracking === "boolean" ? row.open_tracking : null,
      linkTracking: typeof row.link_tracking === "boolean" ? row.link_tracking : null,
    });
  }
  return { profiles, skipped };
}

export function parseAccounts(items: unknown[]): { accounts: InstantlyAccount[]; skipped: number } {
  const accounts: InstantlyAccount[] = [];
  let skipped = 0;
  for (const item of items) {
    if (!item || typeof item !== "object") {
      skipped += 1;
      continue;
    }
    const row = item as Record<string, unknown>;
    const email = text(row.email, 254)?.toLowerCase() ?? null;
    if (!email || !email.includes("@")) {
      skipped += 1;
      continue;
    }
    accounts.push({
      id: text(row.id, 80),
      email,
      statusCode: typeof row.status === "number" && Number.isInteger(row.status) ? row.status : null,
    });
  }
  return { accounts, skipped };
}

export function parseAccountDaily(body: unknown): { ok: true; rows: InstantlyAccountDaily[] } | { ok: false; reason: "invalid_shape" } {
  const list = rows(body);
  if (!list) return { ok: false, reason: "invalid_shape" };
  return {
    ok: true,
    rows: list.flatMap((row) => {
      const date = text(row.date, 10);
      const email = text(row.email_account, 254)?.toLowerCase() ?? null;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !email) return [];
      return [{
        date,
        email,
        sent: count(row.sent),
        bounced: count(row.bounced),
        contacted: count(row.contacted),
        uniqueReplies: count(row.unique_replies),
      }];
    }),
  };
}
