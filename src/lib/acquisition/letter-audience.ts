import type { InstantlyLeadSnapshot } from "@/lib/acquisition/backfill";
import type { HistoricalDecision } from "@/lib/historical-never-subscriber";
import { normalizeAcquisitionEmail, type AcquisitionLifecycle } from "@/lib/acquisition/model";
import {
  classifySummittMembership,
  type SummittSubscriptionLike,
} from "@/lib/summitt-subscription-membership";
import type { MembershipClearance } from "@/lib/acquisition/video-first-prep";

export type LetterLocalFacts = {
  lifecycle: AcquisitionLifecycle | null;
  /** Exact address on the imported Instantly block list. */
  addressBlocked: boolean;
  /** Domain or subdomain on the imported Instantly domain block list. */
  domainBlocked: boolean;
  /** Recovery suppression or opt-out. */
  optedOut: boolean;
  outstandingFulfillment: boolean;
  hasJourney: boolean;
  /** Ledger event `email_sent`, or a lifecycle that is only reached after a send. */
  ledgerEmailed: boolean;
  /** Ledger reply or interest, separate from an Instantly reply row. */
  ledgerReplied: boolean;
  /** Ledger bounce, separate from an Instantly bounced lead. */
  ledgerBounced: boolean;
  /** Ledger opt-out, complaint, or wrong-person event. */
  ledgerStopped: boolean;
  /** Ledger sequence state or campaign completion without a verified send. */
  ledgerSequence: boolean;
  membership: MembershipClearance;
  /** Historical Stripe/Apple membership. Only "clear" can become eligible. */
  historicalMembership: "member" | "clear" | "unverified";
  /** Present when the historical read failed or was incomplete. */
  historicalDetail?: string | null;
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
  reasons: string[];
  kind: "excluded" | "unverified";
};

const STOP_LIFE: ReadonlySet<AcquisitionLifecycle> = new Set(["unsubscribed", "suppressed", "not_interested"]);
const REPLY_LIFE: ReadonlySet<AcquisitionLifecycle> = new Set(["reply_needs_review", "asset_requested"]);
const EMAIL_LIFE: ReadonlySet<AcquisitionLifecycle> = new Set(["asset_sent", "warm_video_sent", "trial_invited"]);
const SEQUENCE_LIFE: ReadonlySet<AcquisitionLifecycle> = new Set(["cold_active", "cold_no_response"]);

const MEMBER: ReadonlySet<AcquisitionLifecycle> = new Set([
  "trial_started",
  "paid_member",
  "trial_expired",
]);

const SENT = "This address has a verified Instantly send. The earlier record was left unchanged.";
const REPLY = "Instantly has a reply from this address.";
const BOUNCE = "Instantly has this lead as bounced.";
const UNSUBSCRIBED = "Instantly has this lead as unsubscribed.";
const ENROLLED = "This address is enrolled in another active Instantly sequence. Nothing was sent.";
const UNPROVEN = "Contact history across campaigns could not be proven. They were left unverified.";

export type LetterInstantlyHistory =
  | { outcome: "never" }
  | { outcome: "unverified"; reason: string; reasons: string[] }
  | { outcome: "excluded"; reason: string; reasons: string[] };

/**
 * Campaign membership alone is not a send. A null activity map means the
 * campaign list could not be read. A missing id means that campaign's status
 * is unknown. Only status "active" is another live sequence.
 */
export function letterInstantlyHistory(
  rows: readonly InstantlyLeadSnapshot[],
  sourceCampaignId: string,
  campaignActivity: ReadonlyMap<string, "active" | "inactive"> | null,
): LetterInstantlyHistory {
  if (rows.length === 0) return { outcome: "unverified", reason: UNPROVEN, reasons: [UNPROVEN] };
  const exclusions = new Set<string>();
  let unclear = false;
  let enrolled = false;
  for (const row of rows) {
    if (row.leadStatus === "bounced") exclusions.add(BOUNCE);
    if (row.leadStatus === "unsubscribed") exclusions.add(UNSUBSCRIBED);
    if (row.replied || row.interestLabel) exclusions.add(REPLY);
    if (row.sent) exclusions.add(SENT);
    const stopped = row.leadStatus === "bounced"
      || row.leadStatus === "unsubscribed"
      || row.replied
      || Boolean(row.interestLabel)
      || row.sent;
    if (stopped) continue;
    if (!row.campaignId || row.leadStatus === "completed") {
      unclear = true;
      continue;
    }
    if (row.leadStatus !== "active" && row.leadStatus !== "paused" && row.leadStatus !== "skipped") {
      unclear = true;
      continue;
    }
    if (row.campaignId !== sourceCampaignId && (row.leadStatus === "active" || row.leadStatus === "paused")) {
      const activity = campaignActivity?.get(row.campaignId);
      if (campaignActivity === null || !activity) unclear = true;
      else if (activity === "active") enrolled = true;
    }
  }
  const reasons = [BOUNCE, UNSUBSCRIBED, REPLY, SENT].filter((reason) => exclusions.has(reason));
  if (reasons.length > 0) return { outcome: "excluded", reason: reasons[0] ?? BOUNCE, reasons };
  if (unclear) return { outcome: "unverified", reason: UNPROVEN, reasons: [UNPROVEN] };
  if (enrolled) return { outcome: "excluded", reason: ENROLLED, reasons: [ENROLLED] };
  return { outcome: "never" };
}

/** Addresses on the source campaign with no verified send and no other stop. */
export function emailsWithClearHistory(
  sourceCampaignId: string,
  leads: readonly InstantlyLeadSnapshot[],
  campaignActivity: ReadonlyMap<string, "active" | "inactive"> | null,
): string[] {
  const byEmail = groupByEmail(leads);
  const clear: string[] = [];
  for (const email of [...byEmail.keys()].sort()) {
    const rows = byEmail.get(email) ?? [];
    if (!rows.some((row) => row.campaignId === sourceCampaignId)) continue;
    if (letterInstantlyHistory(rows, sourceCampaignId, campaignActivity).outcome === "never") clear.push(email);
  }
  return clear;
}

export function reviewLetterAudience(args: {
  sourceCampaignId: string;
  leads: readonly InstantlyLeadSnapshot[];
  localByEmail: ReadonlyMap<string, LetterLocalFacts> | null;
  campaignActivity: ReadonlyMap<string, "active" | "inactive"> | null;
}): { eligible: LetterLead[]; skips: LetterSkip[] } {
  const byEmail = groupByEmail(args.leads);

  const eligible: LetterLead[] = [];
  const skips: LetterSkip[] = [];
  const emails = [...byEmail.keys()].sort();
  for (const email of emails) {
    const rows = byEmail.get(email) ?? [];
    if (!rows.some((row) => row.campaignId === args.sourceCampaignId)) continue;
    const history = letterInstantlyHistory(rows, args.sourceCampaignId, args.campaignActivity);
    if (history.outcome === "excluded" || history.outcome === "unverified") {
      skips.push({ email, kind: history.outcome, reason: history.reason, reasons: history.reasons });
      continue;
    }
    if (!args.localByEmail) {
      skips.push(skip(email, "unverified", ["Membership and the acquisition ledger could not be read. They were left unverified."]));
      continue;
    }
    const local = args.localByEmail.get(email);
    if (!local) {
      skips.push(skip(email, "unverified", ["Membership and the acquisition ledger could not be read. They were left unverified."]));
      continue;
    }
    const blocked = localBlock(local);
    if (blocked) {
      skips.push(skip(email, blocked.kind, blocked.reasons));
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

const DOMAIN_BLOCK = "Instantly has this email domain blocked.";
const ADDRESS_BLOCK = "Instantly has this exact address blocked.";
const OPT_OUT = "This address is suppressed or opted out.";
const MEMBER_REASON = "This person is a current or former member, or is already in a trial.";
const LEDGER_EMAIL = "The acquisition ledger shows a previous email.";
const LEDGER_REPLY = "The acquisition ledger shows a reply.";
const LEDGER_BOUNCE = "The acquisition ledger shows a bounce.";
const LEDGER_SEQUENCE = "This person is already in an acquisition sequence. Nothing was sent from this check.";
const JOURNEY = "This person already has a journey. It was left unchanged.";
const HELD = "This person still has a scheduled or claimed fulfillment action. It was left in place.";
const MEMBERSHIP_UNREAD = "Historical membership could not be confirmed. They were left unverified.";
const LIVE_MEMBERSHIP_UNREAD = "Live membership could not be confirmed. They were left unverified.";

function localBlock(local: LetterLocalFacts): { kind: "excluded" | "unverified"; reasons: string[] } | null {
  const excluded: string[] = [];
  if (local.domainBlocked) excluded.push(DOMAIN_BLOCK);
  if (local.addressBlocked) excluded.push(ADDRESS_BLOCK);
  if (local.optedOut || local.ledgerStopped || (local.lifecycle && STOP_LIFE.has(local.lifecycle))) excluded.push(OPT_OUT);
  if (local.ledgerBounced) excluded.push(LEDGER_BOUNCE);
  if (local.ledgerReplied || (local.lifecycle && REPLY_LIFE.has(local.lifecycle))) excluded.push(LEDGER_REPLY);
  if (local.historicalMembership === "member" || local.membership === "member" || (local.lifecycle && MEMBER.has(local.lifecycle))) {
    excluded.push(MEMBER_REASON);
  }
  if (local.ledgerEmailed || (local.lifecycle && EMAIL_LIFE.has(local.lifecycle))) excluded.push(LEDGER_EMAIL);
  if (local.ledgerSequence || (local.lifecycle && SEQUENCE_LIFE.has(local.lifecycle))) excluded.push(LEDGER_SEQUENCE);
  if (local.hasJourney) excluded.push(JOURNEY);
  if (local.outstandingFulfillment) excluded.push(HELD);
  const reasons = [...excluded];
  if (local.historicalMembership !== "clear") reasons.push(local.historicalDetail?.trim() || MEMBERSHIP_UNREAD);
  if (local.membership === "unverified") reasons.push(LIVE_MEMBERSHIP_UNREAD);
  if (excluded.length > 0) return { kind: "excluded", reasons };
  if (reasons.length > 0) return { kind: "unverified", reasons };
  return null;
}

function skip(email: string, kind: "excluded" | "unverified", reasons: string[]): LetterSkip {
  return { email, kind, reason: reasons[0] ?? "They were left unverified.", reasons };
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
  const lines = ["email,reason,all_reasons,kind"];
  for (const skipRow of skips) {
    lines.push([skipRow.email, skipRow.reason, skipRow.reasons.join("; "), skipRow.kind].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}
