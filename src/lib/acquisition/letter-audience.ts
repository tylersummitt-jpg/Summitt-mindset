import type { InstantlyLeadSnapshot } from "@/lib/acquisition/backfill";
import type { HistoricalDecision } from "@/lib/historical-never-subscriber";
import { normalizeAcquisitionEmail, type AcquisitionLifecycle } from "@/lib/acquisition/model";
import {
  classifySummittMembership,
  type SummittSubscriptionLike,
} from "@/lib/summitt-subscription-membership";
import type { MembershipClearance } from "@/lib/acquisition/video-first-prep";

export type LetterContact = "never" | "contacted" | "unknown";

export type LetterLocalFacts = {
  lifecycle: AcquisitionLifecycle | null;
  suppressed: boolean;
  outstandingFulfillment: boolean;
  hasJourney: boolean;
  recordedOutreach: boolean;
  membership: MembershipClearance;
  /** Historical Stripe/Apple membership. Only "clear" can become eligible. */
  historicalMembership: "member" | "clear" | "unverified";
};

export type LetterLead = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  state: string;
  role: string;
  level: string;
  provider: string;
};

export type LetterSkip = {
  email: string;
  reason: string;
  kind: "excluded" | "unverified";
};

const OUTREACH: ReadonlySet<AcquisitionLifecycle> = new Set([
  "cold_active",
  "cold_no_response",
  "reply_needs_review",
  "asset_requested",
  "asset_sent",
  "warm_video_sent",
  "trial_invited",
  "not_interested",
  "unsubscribed",
  "suppressed",
]);

const MEMBER: ReadonlySet<AcquisitionLifecycle> = new Set([
  "trial_started",
  "paid_member",
  "trial_expired",
]);

/** One address across every Instantly campaign row we could read. */
export function campaignHistoryContact(
  rows: readonly InstantlyLeadSnapshot[],
  sourceCampaignId: string,
): LetterContact {
  if (rows.length === 0) return "unknown";
  for (const row of rows) {
    if (!row.campaignId) return "unknown";
    if (row.campaignId !== sourceCampaignId) return "contacted";
    if (row.sent || row.replied || row.interestLabel) return "contacted";
    if (row.leadStatus === "bounced" || row.leadStatus === "unsubscribed") return "contacted";
    if (row.leadStatus === "completed") return "unknown";
    if (row.leadStatus !== "active" && row.leadStatus !== "paused" && row.leadStatus !== "skipped") return "unknown";
  }
  return "never";
}

/** Addresses on the source campaign whose Instantly rows show no prior send. */
export function emailsWithClearHistory(sourceCampaignId: string, leads: readonly InstantlyLeadSnapshot[]): string[] {
  const byEmail = groupByEmail(leads);
  const clear: string[] = [];
  for (const email of [...byEmail.keys()].sort()) {
    const rows = byEmail.get(email) ?? [];
    if (!rows.some((row) => row.campaignId === sourceCampaignId)) continue;
    if (campaignHistoryContact(rows, sourceCampaignId) === "never") clear.push(email);
  }
  return clear;
}

export function reviewLetterAudience(args: {
  sourceCampaignId: string;
  leads: readonly InstantlyLeadSnapshot[];
  localByEmail: ReadonlyMap<string, LetterLocalFacts> | null;
}): { eligible: LetterLead[]; skips: LetterSkip[] } {
  const byEmail = groupByEmail(args.leads);

  const eligible: LetterLead[] = [];
  const skips: LetterSkip[] = [];
  const emails = [...byEmail.keys()].sort();
  for (const email of emails) {
    const rows = byEmail.get(email) ?? [];
    if (!rows.some((row) => row.campaignId === args.sourceCampaignId)) continue;
    const history = campaignHistoryContact(rows, args.sourceCampaignId);
    if (history === "contacted") {
      skips.push({ email, kind: "excluded", reason: "This address was already contacted in Instantly. The earlier record was left unchanged." });
      continue;
    }
    if (history === "unknown") {
      skips.push({ email, kind: "unverified", reason: "Contact history across campaigns could not be proven. They were left unverified." });
      continue;
    }
    if (!args.localByEmail) {
      skips.push({ email, kind: "unverified", reason: "Membership and the acquisition ledger could not be read. They were left unverified." });
      continue;
    }
    const local = args.localByEmail.get(email);
    if (!local) {
      skips.push({ email, kind: "unverified", reason: "Membership and the acquisition ledger could not be read. They were left unverified." });
      continue;
    }
    const blocked = localBlock(local);
    if (blocked) {
      skips.push({ email, kind: blocked.kind, reason: blocked.reason });
      continue;
    }
    const source = rows.find((row) => row.campaignId === args.sourceCampaignId) ?? rows[0];
    eligible.push({
      email,
      firstName: source?.firstName ?? null,
      lastName: source?.lastName ?? null,
      state: source?.geography?.trim().toLowerCase() || "unknown",
      role: coachRole(source?.jobTitle ?? null),
      level: schoolLevel(source?.jobTitle ?? null),
      provider: emailProvider(email),
    });
  }
  return { eligible, skips };
}

/**
 * Current and former members are excluded. A missing, failed, or incomplete
 * historical read stays unverified and cannot become eligible.
 */
export function letterMembershipVerdict(args: {
  decision: HistoricalDecision | null;
  subscriptions?: readonly SummittSubscriptionLike[];
}): "member" | "clear" | "unverified" {
  for (const subscription of args.subscriptions ?? []) {
    const classification = classifySummittMembership(subscription);
    if (
      classification === "entitled" ||
      classification === "past_due_recoverable" ||
      classification === "paused_recoverable" ||
      classification === "ended"
    ) {
      return "member";
    }
    if (classification !== "other_non_blocking") return "unverified";
  }
  if (!args.decision) return "unverified";
  if (
    args.decision.classification === "Active membership" ||
    args.decision.classification === "Confirmed former subscriber" ||
    args.decision.classification === "Test/internal account"
  ) {
    return "member";
  }
  if (args.decision.classification !== "Strong never-subscriber candidate" || !args.decision.outreachCandidate) {
    return "unverified";
  }
  return "clear";
}

function localBlock(local: LetterLocalFacts): { kind: "excluded" | "unverified"; reason: string } | null {
  if (local.historicalMembership === "member") {
    return { kind: "excluded", reason: "This person is a current or former member, or is already in a trial." };
  }
  if (local.historicalMembership !== "clear") {
    return { kind: "unverified", reason: "Historical membership could not be confirmed. They were left unverified." };
  }
  if (local.membership === "unverified") {
    return { kind: "unverified", reason: "Live membership could not be confirmed. They were left unverified." };
  }
  if (local.membership === "member" || (local.lifecycle && MEMBER.has(local.lifecycle))) {
    return { kind: "excluded", reason: "This person is a current or former member, or is already in a trial." };
  }
  if (local.suppressed || (local.lifecycle && OUTREACH.has(local.lifecycle)) || local.recordedOutreach) {
    return { kind: "excluded", reason: "This person is already in the acquisition ledger, suppressed, or previously emailed." };
  }
  if (local.hasJourney) {
    return { kind: "excluded", reason: "This person already has a journey. It was left unchanged." };
  }
  if (local.outstandingFulfillment) {
    return { kind: "excluded", reason: "This person still has a scheduled or claimed fulfillment action. It was left in place." };
  }
  return null;
}

function coachRole(title: string | null): string {
  const value = title?.toLowerCase() ?? "";
  if (value.includes("assistant")) return "assistant";
  if (value.includes("head")) return "head";
  return "unknown";
}

function schoolLevel(title: string | null): string {
  const value = title?.toLowerCase() ?? "";
  if (value.includes("college") || value.includes("university")) return "college";
  if (value.includes("high")) return "high";
  if (value.includes("middle") || value.includes("junior")) return "middle";
  return "unknown";
}

function emailProvider(email: string): string {
  const domain = email.split("@")[1] ?? "";
  if (domain === "gmail.com" || domain === "googlemail.com") return "gmail";
  if (domain === "outlook.com" || domain === "hotmail.com" || domain === "live.com") return "microsoft";
  if (domain === "yahoo.com") return "yahoo";
  if (domain.endsWith(".edu")) return "edu";
  return "other";
}

/**
 * Stable half-split. Same input always yields the same two groups.
 * Within each state, role, level, and provider, people alternate.
 */
export function splitLetterAudience(
  leads: readonly LetterLead[],
  campaigns: readonly [string, string],
): { groups: Array<{ campaignId: string; leads: LetterLead[] }> } {
  const [first, second] = campaigns;
  const left: LetterLead[] = [];
  const right: LetterLead[] = [];
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  const sorted = [...leads]
    .filter((lead) => {
      if (seen.has(lead.email)) return false;
      seen.add(lead.email);
      return true;
    })
    .sort((a, b) => stratum(a).localeCompare(stratum(b)) || a.email.localeCompare(b.email));
  for (const lead of sorted) {
    const key = stratum(lead);
    const n = counts.get(key) ?? 0;
    counts.set(key, n + 1);
    if (n % 2 === 0) left.push(lead);
    else right.push(lead);
  }
  return {
    groups: [
      { campaignId: first, leads: left },
      { campaignId: second, leads: right },
    ],
  };
}

function groupByEmail(leads: readonly InstantlyLeadSnapshot[]): Map<string, InstantlyLeadSnapshot[]> {
  const byEmail = new Map<string, InstantlyLeadSnapshot[]>();
  for (const lead of leads) {
    const email = normalizeAcquisitionEmail(lead.email);
    if (!email) continue;
    const list = byEmail.get(email) ?? [];
    list.push(lead);
    byEmail.set(email, list);
  }
  return byEmail;
}

function stratum(lead: LetterLead): string {
  return `${lead.state}|${lead.role}|${lead.level}|${lead.provider}`;
}

export function letterLeadCsv(leads: readonly LetterLead[]): string {
  const lines = ["email,first_name,last_name"];
  for (const lead of leads) {
    lines.push([lead.email, lead.firstName ?? "", lead.lastName ?? ""].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function letterSkipCsv(skips: readonly LetterSkip[]): string {
  const lines = ["email,reason,kind"];
  for (const skip of skips) lines.push([skip.email, skip.reason, skip.kind].map(csvCell).join(","));
  return `${lines.join("\n")}\n`;
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}
