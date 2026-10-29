import { normalizeAcquisitionEmail, type AcquisitionLifecycle } from "@/lib/acquisition/model";
import type { PlaybookFulfillment, PlaybookSendAction, PlaybookStatus } from "@/lib/acquisition/playbook";

export const VIDEO_FIRST_LEAD_CAP = 2000;

export type ColdVideoPlaybook = {
  id: string;
  status: PlaybookStatus;
  personalVideoId: string | null;
  permittedActions: readonly PlaybookSendAction[];
  fulfillment: PlaybookFulfillment;
};

/** A video-first version keeps the selected video and does not send after a reply. */
export function isVideoFirstPlaybook(playbook: ColdVideoPlaybook, videoId: string): boolean {
  return playbook.personalVideoId === videoId
    && playbook.fulfillment === "none"
    && playbook.permittedActions.length === 0;
}

/**
 * The saved campaign can receive a tracked video_url.
 * Manual fulfillment with no permitted send is the shape already saved on the
 * ten campaigns. It does not authorize a new playbook version.
 */
export function playbookCanReceiveExistingLeads(playbook: ColdVideoPlaybook, videoId: string): boolean {
  return playbook.personalVideoId?.toLowerCase() === videoId.toLowerCase()
    && playbook.permittedActions.length === 0
    && (playbook.fulfillment === "none" || playbook.fulfillment === "manual");
}

export function openJourneyVideoFacts(
  playbook: { fulfillment: string; permittedActions: readonly string[]; personalVideoId: string | null } | undefined,
  preparedVideoId: string | undefined,
  videoId: string,
): { videoFirst: boolean; sameVideo: boolean } {
  const quiet = Boolean(
    playbook
    && playbook.permittedActions.length === 0
    && playbook.personalVideoId
    && (playbook.fulfillment === "none" || playbook.fulfillment === "manual"),
  );
  return {
    videoFirst: Boolean(preparedVideoId) || quiet,
    sameVideo: playbook?.personalVideoId?.toLowerCase() === videoId.toLowerCase() || preparedVideoId === videoId,
  };
}

export type ProspectLead = {
  email: string;
  firstName: string | null;
  lastName: string | null;
};

export function parseProspectList(raw: string):
  | { ok: true; leads: ProspectLead[]; invalid: number }
  | { ok: false; error: string } {
  const leads: ProspectLead[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cells = splitCsvLine(trimmed);
    if (cells[0]?.trim().toLowerCase() === "email") continue;
    const email = normalizeAcquisitionEmail(cells[0]);
    if (!email) {
      invalid += 1;
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    const firstName = cleanName(cells[1]);
    const lastName = cleanName(cells[2]);
    leads.push({ email, firstName, lastName });
  }
  if (leads.length === 0) {
    return { ok: false, error: invalid > 0 ? "None of the rows had a usable email address." : "Paste at least one email address." };
  }
  if (leads.length > VIDEO_FIRST_LEAD_CAP) {
    return { ok: false, error: `This list has ${leads.length} addresses. Prepare at most ${VIDEO_FIRST_LEAD_CAP} at a time. Nothing was written.` };
  }
  return { ok: true, leads, invalid };
}

function cleanName(value: string | undefined): string | null {
  const name = value?.trim() ?? "";
  if (!name || name.length > 80) return null;
  return name;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

export type MembershipClearance = "member" | "clear" | "unverified";
export type VerificationClearance = "verified" | "exclude" | "unverified";

export type LeadFacts = {
  lifecycle: AcquisitionLifecycle | null;
  stripeSubscriptionId: string | null;
  /** Opt-out, complaint, bounce, or blocklist. */
  suppressed: boolean;
  /** A scheduled or claimed fulfillment action is still outstanding. */
  outstandingFulfillment: boolean;
  /** An open video-first journey already exists on a different campaign. */
  openVideoElsewhere: boolean;
  /**
   * Open video-first journey on the Instantly source campaign when that source
   * is being migrated onto a different launch campaign.
   */
  openVideoOnSource: { journeyId: string; sameVideo: boolean } | null;
  /** More than one open video-first journey on the source campaign. */
  sourceAmbiguous: boolean;
  /** Live Clerk/Stripe membership. Omit only for older callers that already checked lifecycle. */
  membership: MembershipClearance;
  /** Instantly verification. Paste-list callers pass verified after format checks. */
  verification: VerificationClearance;
  openOnThisCampaign: {
    journeyId: string;
    videoFirst: boolean;
    sameVideo: boolean;
    ambiguous: boolean;
  } | null;
};

export type LeadDecision =
  | { outcome: "create" }
  | { outcome: "reuse"; journeyId: string }
  /** Close the older open journey, then open a video-first journey. The old row stays. */
  | { outcome: "boundary"; previousJourneyId: string }
  | { outcome: "skip"; reason: string; kind?: "excluded" | "unverified" };

const STOPPED = "This person is opted out, suppressed, bounced, in a trial, or a paid member.";
const MEMBER = "This person has a live trial or paid membership.";
const MEMBER_UNVERIFIED = "Live membership could not be confirmed. They were left unverified.";
const VERIFY_EXCLUDE = "Instantly marked this address invalid, risky, catch-all, or a job change.";
const VERIFY_UNVERIFIED = "Instantly has not verified this address. They were left unverified.";

function memberStop(state: AcquisitionLifecycle | null): boolean {
  return state === "unsubscribed" || state === "suppressed" || state === "trial_started" || state === "paid_member";
}

export function decideLead(facts: LeadFacts): LeadDecision {
  if (facts.verification === "exclude") {
    return { outcome: "skip", reason: VERIFY_EXCLUDE, kind: "excluded" };
  }
  if (facts.verification === "unverified") {
    return { outcome: "skip", reason: VERIFY_UNVERIFIED, kind: "unverified" };
  }
  if (facts.suppressed || memberStop(facts.lifecycle)) {
    return { outcome: "skip", reason: STOPPED, kind: "excluded" };
  }
  if (facts.membership === "member" || facts.stripeSubscriptionId) {
    return { outcome: "skip", reason: facts.stripeSubscriptionId ? STOPPED : MEMBER, kind: "excluded" };
  }
  if (facts.membership === "unverified") {
    return { outcome: "skip", reason: MEMBER_UNVERIFIED, kind: "unverified" };
  }
  if (facts.outstandingFulfillment) {
    return {
      outcome: "skip",
      kind: "excluded",
      reason: "This person still has a scheduled or claimed fulfillment action. It was left in place, and they were not added to the video file.",
    };
  }
  if (facts.openVideoElsewhere) {
    return { outcome: "skip", reason: "This person already has an open video link on another campaign.", kind: "excluded" };
  }
  if (facts.sourceAmbiguous) {
    return { outcome: "skip", reason: "This person has more than one open video link on the source campaign. Nothing was added.", kind: "excluded" };
  }
  if (facts.openOnThisCampaign?.ambiguous) {
    return { outcome: "skip", reason: "This person has more than one open journey on this campaign. Nothing was added.", kind: "excluded" };
  }
  if (facts.openOnThisCampaign?.videoFirst && !facts.openOnThisCampaign.sameVideo) {
    return { outcome: "skip", reason: "This person already has a video link for a different recording on this campaign.", kind: "excluded" };
  }
  if (facts.openOnThisCampaign?.videoFirst && facts.openOnThisCampaign.sameVideo) {
    return { outcome: "reuse", journeyId: facts.openOnThisCampaign.journeyId };
  }
  if (facts.openOnThisCampaign) {
    return { outcome: "boundary", previousJourneyId: facts.openOnThisCampaign.journeyId };
  }
  if (facts.openVideoOnSource) {
    return { outcome: "boundary", previousJourneyId: facts.openVideoOnSource.journeyId };
  }
  return { outcome: "create" };
}

export function recipientVideoUrl(publicToken: string, journeyToken: string): string {
  return `https://summittmindset.com/for/${publicToken}?aj=${encodeURIComponent(journeyToken)}`;
}

export function instantlyLeadCsv(rows: ReadonlyArray<ProspectLead & { videoUrl: string }>): string {
  const lines = ["email,first_name,last_name,video_url"];
  for (const row of rows) {
    lines.push([row.email, row.firstName ?? "", row.lastName ?? "", row.videoUrl].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function skipReport(skips: ReadonlyArray<{ email: string; reason: string }>): string {
  const lines = ["email,reason"];
  for (const skip of skips) lines.push([skip.email, skip.reason].map(csvCell).join(","));
  return `${lines.join("\n")}\n`;
}
