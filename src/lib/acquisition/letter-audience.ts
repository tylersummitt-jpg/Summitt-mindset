import { createHmac, timingSafeEqual } from "node:crypto";

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

/** Membership lookups stay inside the same batch size the video clearance already uses. */
export const LETTER_FACT_BATCH = 20;
/** Above this, the check stops instead of returning a partial audience. */
export const LETTER_AUDIENCE_CAP = 20000;

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
  sourceCampaignIds: string | readonly string[],
  campaignActivity: ReadonlyMap<string, "active" | "inactive"> | null,
): LetterInstantlyHistory {
  if (rows.length === 0) return { outcome: "unverified", reason: UNPROVEN, reasons: [UNPROVEN] };
  const sources = sourceIds(sourceCampaignIds);
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
    if (row.campaignId && !sources.has(row.campaignId) && (row.leadStatus === "active" || row.leadStatus === "paused")) {
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
  sourceCampaignIds: string | readonly string[],
  leads: readonly InstantlyLeadSnapshot[],
  campaignActivity: ReadonlyMap<string, "active" | "inactive"> | null,
): string[] {
  return classifyLetterHistory({
    sourceCampaignIds: typeof sourceCampaignIds === "string" ? [sourceCampaignIds] : sourceCampaignIds,
    leads,
    campaignActivity,
  }).pending.map((lead) => lead.email);
}

const LEDGER_UNREAD = "Membership and the acquisition ledger could not be read. They were left unverified.";

export function classifyLetterHistory(args: {
  sourceCampaignId?: string;
  sourceCampaignIds?: readonly string[];
  leads: readonly InstantlyLeadSnapshot[];
  campaignActivity: ReadonlyMap<string, "active" | "inactive"> | null;
}): { pending: LetterLead[]; skips: LetterSkip[] } {
  const sources = audienceSources(args);
  const byEmail = groupByEmail(args.leads);
  const pending: LetterLead[] = [];
  const skips: LetterSkip[] = [];
  for (const email of [...byEmail.keys()].sort()) {
    const rows = byEmail.get(email) ?? [];
    if (!rows.some((row) => row.campaignId && sources.has(row.campaignId))) continue;
    const history = letterInstantlyHistory(rows, [...sources], args.campaignActivity);
    if (history.outcome === "excluded" || history.outcome === "unverified") {
      skips.push({ email, kind: history.outcome, reason: history.reason, reasons: history.reasons });
      continue;
    }
    const source = rows.find((row) => row.campaignId && sources.has(row.campaignId)) ?? rows[0];
    pending.push(leadFromRow(email, source));
  }
  return { pending, skips };
}

export function decideLetterFacts(
  pending: readonly LetterLead[],
  localByEmail: ReadonlyMap<string, LetterLocalFacts> | null,
): { eligible: LetterLead[]; skips: LetterSkip[] } {
  const eligible: LetterLead[] = [];
  const skips: LetterSkip[] = [];
  for (const lead of pending) {
    if (!localByEmail || !localByEmail.has(lead.email)) {
      skips.push(skip(lead.email, "unverified", [LEDGER_UNREAD]));
      continue;
    }
    const blocked = localBlock(localByEmail.get(lead.email)!);
    if (blocked) skips.push(skip(lead.email, blocked.kind, blocked.reasons));
    else eligible.push(lead);
  }
  return { eligible, skips };
}

export function reviewLetterAudience(args: {
  sourceCampaignId: string;
  sourceCampaignIds?: readonly string[];
  leads: readonly InstantlyLeadSnapshot[];
  localByEmail: ReadonlyMap<string, LetterLocalFacts> | null;
  campaignActivity: ReadonlyMap<string, "active" | "inactive"> | null;
}): { eligible: LetterLead[]; skips: LetterSkip[] } {
  const classified = classifyLetterHistory(args);
  const facts = decideLetterFacts(classified.pending, args.localByEmail);
  return { eligible: facts.eligible, skips: [...classified.skips, ...facts.skips] };
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

function sourceIds(value: string | readonly string[]): Set<string> {
  const list = typeof value === "string" ? [value] : [...value];
  return new Set(list.map((id) => id.trim()).filter((id) => id.length > 0));
}

function audienceSources(args: { sourceCampaignId?: string; sourceCampaignIds?: readonly string[] }): Set<string> {
  return sourceIds([...(args.sourceCampaignIds ?? []), ...(args.sourceCampaignId ? [args.sourceCampaignId] : [])]);
}

function leadFromRow(email: string, source: InstantlyLeadSnapshot | undefined): LetterLead {
  return {
    email,
    firstName: source?.firstName ?? null,
    lastName: source?.lastName ?? null,
    state: source?.geography?.trim().toLowerCase() || "unknown",
    role: coachRole(source?.jobTitle ?? null),
    level: schoolLevel(source?.jobTitle ?? null),
    provider: emailProvider(email),
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

export type LetterPendingTicket = { email: string; lead: LetterLead; token: string };
export type LetterFactTicket = { email: string; token: string; lead?: LetterLead; skip?: LetterSkip };

const INCOMPLETE_CLEARANCE = "Clearance is incomplete, so no import file was created. Nothing was written.";
const SIGNED_MISMATCH = "This clearance does not match the signed audience. No import file was created. Nothing was written.";
const RECONCILE_MISMATCH = "Eligible, excluded, and unverified coaches do not add up to the unique audience. No import file was created. Nothing was written.";

function signPayload(secret: string, payload: string): string | null {
  const key = secret.trim();
  if (key.length < 16) return null;
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function signaturesMatch(secret: string, payload: string, token: string): boolean {
  const expected = signPayload(secret, payload);
  if (!expected || !token) return false;
  const left = Buffer.from(token);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function leadCanonical(lead: LetterLead): string {
  return [lead.email, lead.firstName ?? "", lead.lastName ?? "", lead.state, lead.role, lead.level, lead.provider].join("\u001f");
}

function skipCanonical(row: LetterSkip): string {
  return [row.email, row.kind, row.reason, row.reasons.join("\u001e")].join("\u001f");
}

function manifestPayload(args: {
  sourceCampaignIds: readonly string[];
  launchCampaignId: string;
  pairCampaignId: string | null;
  pending: readonly LetterLead[];
  historySkips: readonly LetterSkip[];
}): string {
  const sources = [...sourceIds(args.sourceCampaignIds)].sort();
  const pending = [...args.pending].sort((a, b) => a.email.localeCompare(b.email));
  const skips = [...args.historySkips].sort((a, b) => a.email.localeCompare(b.email) || a.reason.localeCompare(b.reason));
  return [
    "letter-manifest:v1",
    sources.join(","),
    args.launchCampaignId.trim(),
    args.pairCampaignId?.trim() || "",
    pending.map(leadCanonical).join("\n"),
    skips.map(skipCanonical).join("\n"),
  ].join("\n");
}

export function signLetterBatch(args: {
  secret: string;
  sourceCampaignIds: readonly string[];
  launchCampaignId: string;
  pairCampaignId: string | null;
  pending: readonly LetterLead[];
  historySkips: readonly LetterSkip[];
}): { manifest: string; tickets: LetterPendingTicket[] } | null {
  if (args.pending.length + args.historySkips.length > LETTER_AUDIENCE_CAP) return null;
  const manifest = signPayload(args.secret, manifestPayload(args));
  if (!manifest) return null;
  const tickets: LetterPendingTicket[] = [];
  for (const lead of [...args.pending].sort((a, b) => a.email.localeCompare(b.email))) {
    const token = signPayload(args.secret, `letter-pending:v1\n${manifest}\n${leadCanonical(lead)}`);
    if (!token) return null;
    tickets.push({ email: lead.email, lead, token });
  }
  return { manifest, tickets };
}

export function verifyLetterPending(args: { secret: string; manifest: string; ticket: LetterPendingTicket }): boolean {
  if (args.ticket.email !== args.ticket.lead.email) return false;
  return signaturesMatch(args.secret, `letter-pending:v1\n${args.manifest}\n${leadCanonical(args.ticket.lead)}`, args.ticket.token);
}

export function signLetterOutcomes(args: {
  secret: string;
  manifest: string;
  eligible: readonly LetterLead[];
  skips: readonly LetterSkip[];
}): LetterFactTicket[] | null {
  const tickets: LetterFactTicket[] = [];
  for (const lead of args.eligible) {
    const token = signPayload(args.secret, `letter-outcome:v1\n${args.manifest}\neligible\n${leadCanonical(lead)}`);
    if (!token) return null;
    tickets.push({ email: lead.email, token, lead });
  }
  for (const row of args.skips) {
    const token = signPayload(args.secret, `letter-outcome:v1\n${args.manifest}\n${row.kind}\n${skipCanonical(row)}`);
    if (!token) return null;
    tickets.push({ email: row.email, token, skip: row });
  }
  return tickets;
}

export function finishLetterClearance(args: {
  secret: string;
  manifest: string;
  sourceCampaignIds: readonly string[];
  launchCampaignId: string;
  pairCampaignId: string | null;
  pending: readonly LetterLead[];
  historySkips: readonly LetterSkip[];
  outcomes: readonly LetterFactTicket[];
}): { ok: false; error: string } | {
  ok: true;
  complete: true;
  unique: number;
  eligible: number;
  excluded: number;
  unverified: number;
  groups: Array<{ campaignId: string; leads: LetterLead[] }>;
  skips: LetterSkip[];
} {
  const manifest = signPayload(args.secret, manifestPayload(args));
  if (!manifest || !signaturesMatch(args.secret, manifestPayload(args), args.manifest)) {
    return { ok: false, error: SIGNED_MISMATCH };
  }
  const pendingByEmail = new Map<string, LetterLead>();
  for (const lead of args.pending) {
    if (pendingByEmail.has(lead.email)) return { ok: false, error: SIGNED_MISMATCH };
    pendingByEmail.set(lead.email, lead);
  }
  const historyEmails = new Set(args.historySkips.map((row) => row.email));
  for (const email of historyEmails) {
    if (pendingByEmail.has(email)) return { ok: false, error: SIGNED_MISMATCH };
  }
  if (historyEmails.size !== args.historySkips.length) return { ok: false, error: SIGNED_MISMATCH };

  const eligible: LetterLead[] = [];
  const factSkips: LetterSkip[] = [];
  const seen = new Set<string>();
  for (const outcome of args.outcomes) {
    if (seen.has(outcome.email)) return { ok: false, error: SIGNED_MISMATCH };
    seen.add(outcome.email);
    const pendingLead = pendingByEmail.get(outcome.email);
    if (!pendingLead) return { ok: false, error: SIGNED_MISMATCH };
    if (outcome.lead) {
      if (leadCanonical(outcome.lead) !== leadCanonical(pendingLead)) return { ok: false, error: SIGNED_MISMATCH };
      const payload = `letter-outcome:v1\n${args.manifest}\neligible\n${leadCanonical(outcome.lead)}`;
      if (!signaturesMatch(args.secret, payload, outcome.token)) return { ok: false, error: SIGNED_MISMATCH };
      eligible.push(pendingLead);
    } else if (outcome.skip && outcome.skip.email === outcome.email) {
      const payload = `letter-outcome:v1\n${args.manifest}\n${outcome.skip.kind}\n${skipCanonical(outcome.skip)}`;
      if (!signaturesMatch(args.secret, payload, outcome.token)) return { ok: false, error: SIGNED_MISMATCH };
      factSkips.push(outcome.skip);
    } else {
      return { ok: false, error: SIGNED_MISMATCH };
    }
  }
  if (seen.size !== pendingByEmail.size) return { ok: false, error: INCOMPLETE_CLEARANCE };

  const skips = [...args.historySkips, ...factSkips].sort((a, b) => a.email.localeCompare(b.email));
  const excluded = skips.filter((row) => row.kind === "excluded").length;
  const unverified = skips.filter((row) => row.kind === "unverified").length;
  const unique = historyEmails.size + pendingByEmail.size;
  if (eligible.length + excluded + unverified !== unique) return { ok: false, error: RECONCILE_MISMATCH };
  const pair = args.pairCampaignId?.trim() || null;
  const groups = pair
    ? splitLetterAudience(eligible, [args.launchCampaignId, pair]).groups
    : [{ campaignId: args.launchCampaignId, leads: eligible }];
  return { ok: true, complete: true, unique, eligible: eligible.length, excluded, unverified, groups, skips };
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
