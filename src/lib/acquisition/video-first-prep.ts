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

export type LeadFacts = {
  lifecycle: AcquisitionLifecycle | null;
  stripeSubscriptionId: string | null;
  /** Opt-out, complaint, bounce, or blocklist. */
  suppressed: boolean;
  /** A scheduled or claimed fulfillment action is still outstanding. */
  outstandingFulfillment: boolean;
  /** An open video-first journey already exists on a different campaign. */
  openVideoElsewhere: boolean;
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
  | { outcome: "skip"; reason: string };

const STOPPED = "This person is opted out, suppressed, bounced, in a trial, or a paid member.";

function memberStop(state: AcquisitionLifecycle | null): boolean {
  return state === "unsubscribed" || state === "suppressed" || state === "trial_started" || state === "paid_member";
}

export function decideLead(facts: LeadFacts): LeadDecision {
  if (facts.suppressed || facts.stripeSubscriptionId || memberStop(facts.lifecycle)) {
    return { outcome: "skip", reason: STOPPED };
  }
  if (facts.outstandingFulfillment) {
    return { outcome: "skip", reason: "This person still has a scheduled or claimed fulfillment action. It was left in place, and they were not added to the video file." };
  }
  if (facts.openVideoElsewhere) {
    return { outcome: "skip", reason: "This person already has an open video link on another campaign." };
  }
  if (facts.openOnThisCampaign?.ambiguous) {
    return { outcome: "skip", reason: "This person has more than one open journey on this campaign. Nothing was added." };
  }
  if (facts.openOnThisCampaign?.videoFirst && !facts.openOnThisCampaign.sameVideo) {
    return { outcome: "skip", reason: "This person already has a video link for a different recording on this campaign." };
  }
  if (facts.openOnThisCampaign?.videoFirst && facts.openOnThisCampaign.sameVideo) {
    return { outcome: "reuse", journeyId: facts.openOnThisCampaign.journeyId };
  }
  if (facts.openOnThisCampaign) {
    return { outcome: "boundary", previousJourneyId: facts.openOnThisCampaign.journeyId };
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
