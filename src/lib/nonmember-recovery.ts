/**
 * Read-only recovery view on top of the existing nonmember census.
 * It does not send email or SMS, export addresses, or insert an experiment.
 */

import {
  NONMEMBER_CATEGORY_LABEL,
  type NonmemberCensusData,
  type NonmemberCategory,
} from "@/lib/nonmember-census";

const NOT_AVAILABLE = "Not available";

const JOURNEY_CATEGORIES = [
  "checkout_never_recorded",
  "checkout_creation_failed",
  "checkout_pending",
  "checkout_expired",
  "checkout_completed_without_trial",
] as const satisfies readonly NonmemberCategory[];

export type NonmemberRecovery = {
  coverage: string;
  verifiedNonmembers: string;
  noVerifiedTrial: string;
  uncertainMembership: string;
  currentMembersExcluded: string;
  formerMembersExcluded: string;
  outsideCoverage: string;
  potentialProspects: string;
  doNotEmail: string;
  suppressionUnverified: string;
  notEligible: string;
  smsPermission: string;
  stages: Array<{ label: string; value: string }>;
  journeyNote: string;
  sendReady: string;
  experiment: string[];
  safety: string[];
  limitations: string[];
  sending: string;
};

export function buildNonmemberRecovery(census: NonmemberCensusData): NonmemberRecovery {
  const failed = census.coverage === "failed";
  const prospects = subtract(census.nonmembers, census.categories.previously_subscribed, failed);
  const noVerifiedTrial = sumCategories(census, JOURNEY_CATEGORIES, failed);

  return {
    coverage: coverageText(census),
    verifiedNonmembers: count(census.nonmembers, failed),
    noVerifiedTrial,
    uncertainMembership: count(census.unknownEntitlement, failed),
    currentMembersExcluded: count(census.members, failed),
    formerMembersExcluded: count(
      failed ? null : census.categories.previously_subscribed,
      failed
    ),
    outsideCoverage: outsideCoverage(census),
    potentialProspects: prospectText(prospects),
    doNotEmail:
      "Not available. Known unsubscribes, complaints, and permanent bounces are not in this scan. A missing list is not zero.",
    suppressionUnverified: suppressionText(prospects),
    notEligible: notEligibleText(
      addCounts(
        [census.members, census.categories.previously_subscribed, census.unknownEntitlement],
        failed
      )
    ),
    smsPermission:
      "Email and SMS use different rules. Coaching-text consent and STOP apply only to coaching texts. This app does not send marketing texts.",
    stages: stageLines(census, failed),
    journeyNote:
      "These stages come from the census checkout record for that account. A missing step is unknown. Pricing-page views and membership clicks are not joined to these accounts.",
    sendReady:
      "None. A prospect is not send-ready while sending is off. Missing country is not labeled United States. A known restricted country is excluded.",
    experiment: [
      "Plan only. This is not in the experiment registry and has no declared winner. A holdout is stored only after sending is separately authorized.",
      "Control: no new recovery message.",
      "Challenger: one helpful follow-up that honors opt-out and the other applicable rules.",
      "Primary outcome: a verified free-trial start inside a window declared before anyone is assigned.",
      "Secondary outcomes, only when recorded: confirmed first payment, opt-outs or complaints, and mature D30, D60, and D90 retention.",
      "Nobody is classified as a recovered member until an assignment and an outcome both exist.",
    ],
    safety: [
      "The sender rechecks, immediately before sending, that the person is still a verified nonmember, is not suppressed, is not in a known restricted country, and has a valid address.",
      "It keeps a holdout, a three-email limit, a daily cap, duplicate-send prevention, an opt-out, and delivery tracking.",
      "It does not send to current members or to people whose membership is uncertain.",
      "Sending is off until it is separately authorized. This page does not export addresses.",
    ],
    limitations: [
      "U.S. commercial email does not require advance marketing opt-in. An unsubscribe still blocks email.",
      "Marketing suppression records are not connected. A missing list is not zero unsubscribes.",
      "Coaching SMS consent and STOP are not promotional email permission.",
      "Challenge email signup and challenge unsubscribe are not a marketing list.",
      "Instantly, Kit, and ActiveCampaign are not connected.",
      "This comparison does not change the landing-page experiment. Sending stays off until a separate authorization.",
    ],
    sending: "No recovery email or text is sent from this page.",
  };
}

export function formatNonmemberRecovery(recovery: NonmemberRecovery): string[] {
  return [
    "NONMEMBER RECOVERY",
    recovery.coverage,
    `Verified nonmembers in this scan: ${recovery.verifiedNonmembers}.`,
    `No verified trial, from recorded checkout stages: ${recovery.noVerifiedTrial}.`,
    `Membership status unknown: ${recovery.uncertainMembership}. Unknown is not a nonmember.`,
    `Current members excluded: ${recovery.currentMembersExcluded}.`,
    `Former members excluded from the prospect group: ${recovery.formerMembersExcluded}.`,
    `Accounts outside this scan: ${recovery.outsideCoverage}.`,
    `Potential recovery prospects: ${recovery.potentialProspects}`,
    `Do not email: ${recovery.doNotEmail}`,
    `Suppression status not verified: ${recovery.suppressionUnverified}`,
    `Not eligible: ${recovery.notEligible}`,
    `SMS: ${recovery.smsPermission}`,
    "Recorded stopping points",
    ...recovery.stages.map((row) => `- ${row.label}: ${row.value}`),
    recovery.journeyNote,
    `Send-ready: ${recovery.sendReady}`,
    recovery.sending,
    ...recovery.experiment,
    ...recovery.safety,
  ];
}

function coverageText(census: NonmemberCensusData): string {
  if (census.coverage === "failed") {
    return "Census coverage: the Clerk list could not be read. Counts below are not zero.";
  }
  if (census.coverage === "partial") {
    return `Census coverage: partial. ${count(census.examined, false)} of ${count(census.clerkTotal, false)} Clerk accounts were examined. This is the newest accounts, at most 200.`;
  }
  return `Census coverage: complete for the accounts examined (${count(census.examined, false)}).`;
}

function outsideCoverage(census: NonmemberCensusData): string {
  if (census.coverage === "failed") return NOT_AVAILABLE;
  if (census.coverage === "complete") return "0";
  if (census.clerkTotal == null || census.examined == null) return NOT_AVAILABLE;
  if (census.clerkTotal < census.examined) return NOT_AVAILABLE;
  return String(census.clerkTotal - census.examined);
}

function stageLines(census: NonmemberCensusData, failed: boolean) {
  const categories: NonmemberCategory[] = [
    ...JOURNEY_CATEGORIES,
    "insufficient_history",
    "unknown",
  ];
  return categories.map((category) => ({
    label: NONMEMBER_CATEGORY_LABEL[category],
    value: count(failed ? null : census.categories[category], failed),
  }));
}

function sumCategories(
  census: NonmemberCensusData,
  categories: readonly NonmemberCategory[],
  failed: boolean
): string {
  if (failed) return NOT_AVAILABLE;
  let total = 0;
  for (const category of categories) {
    const value = census.categories[category];
    if (value == null || !Number.isFinite(value) || value < 0) return NOT_AVAILABLE;
    total += value;
  }
  return String(total);
}

function subtract(total: number | null, part: number | null | undefined, failed: boolean): string {
  if (failed || total == null || part == null) return NOT_AVAILABLE;
  if (part > total || part < 0 || total < 0) return NOT_AVAILABLE;
  return String(total - part);
}

function prospectText(countLabel: string): string {
  if (countLabel === NOT_AVAILABLE) {
    return "Not available. Verified never-members would be the group that could be considered for U.S. opt-out email after the remaining checks.";
  }
  return `${countLabel}. Verified never-members who could be considered for U.S. opt-out email after geography, provider rules, a valid address, and a suppression check. Not send-ready.`;
}

function suppressionText(countLabel: string): string {
  if (countLabel === NOT_AVAILABLE) {
    return "Not available. Marketing opt-out records are not connected, and a missing list is not zero unsubscribes.";
  }
  return `${countLabel}. Marketing opt-out, complaint, and bounce records are not connected for these prospects. This is not zero unsubscribes.`;
}

function notEligibleText(countLabel: string): string {
  if (countLabel === NOT_AVAILABLE) {
    return "Not available. Current members, former members, and unknown membership stay out of the prospect group.";
  }
  return `${countLabel}. Current members, former members, and unknown membership. Geography and provider limits are not checked yet, so they are not included in this number.`;
}

function addCounts(values: Array<number | null | undefined>, failed: boolean): string {
  if (failed) return NOT_AVAILABLE;
  let total = 0;
  for (const value of values) {
    if (value == null || !Number.isFinite(value) || value < 0) return NOT_AVAILABLE;
    total += value;
  }
  return String(total);
}

function count(value: number | null, failed: boolean): string {
  if (failed || value == null || !Number.isFinite(value)) return NOT_AVAILABLE;
  return String(value);
}
