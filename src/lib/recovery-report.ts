import {
  evaluateAutomation,
  type RecoveryAutomationStatus,
  type RecoverySettings,
} from "@/lib/recovery-engine";

export type RecoveryReplyView = {
  id: string;
  firstName: string;
  receivedLabel: string;
  stepLabel: string;
  preview: string;
  status: "needs_reply" | "handled";
};

export type RecoveryAttention = {
  status: RecoveryAutomationStatus;
  sending: string;
  blockers: string[];
  enrollment: string;
  control: string;
  recovery: string;
  attempted: string;
  accepted: string;
  delivered: string;
  failed: string;
  suppressed: string;
  unsubscribes: string;
  complaints: string;
  repliesLabel: string;
  repliesNeeding: number | null;
  inboundReceived: string;
  countryRule: string;
  trialConversion: string;
  payments: string;
  retention: string;
  nextAction: string;
  mailboxNote: string;
  replies: RecoveryReplyView[];
};

const NOT_AVAILABLE = "Not available";

export function emptyRecoveryAttention(): RecoveryAttention {
  return attentionFrom({
    status: "unavailable",
    sendingAuthorized: false,
    inboundReady: false,
    suppressionCheckReady: false,
    suppressionReadable: false,
    postalAddress: null,
    enrollmentStartsAtMs: null,
    dailyCap: 25,
  }, null);
}

export function attentionFrom(
  settings: RecoverySettings,
  counts: {
    control: number | null;
    recovery: number | null;
    attempted: number | null;
    accepted: number | null;
    delivered: number | null;
    failed: number | null;
    suppressed: number | null;
    unsubscribes: number | null;
    complaints: number | null;
    repliesNeeding: number | null;
    repliesReceived?: number | null;
    matchedReplies?: number | null;
  } | null,
  replies: RecoveryReplyView[] = []
): RecoveryAttention {
  const blockers = recoveryBlockers(settings);
  const matched = counts?.matchedReplies ?? 0;
  const matchingConfirmed = matched > 0 && counts != null;
  return {
    status: settings.status,
    sending: evaluateAutomation(settings).process
      ? "Sending gates are open. Missing country is not labeled United States. A known restricted country is excluded."
      : "Sending is off.",
    blockers,
    enrollment: settings.enrollmentStartsAtMs == null
      ? "Enrollment start is not set. Accounts created earlier stay out."
      : `Enrollment starts ${new Date(settings.enrollmentStartsAtMs).toISOString()}. Earlier accounts stay out.`,
    control: count(counts?.control),
    recovery: count(counts?.recovery),
    attempted: count(counts?.attempted),
    accepted: count(counts?.accepted),
    delivered: count(counts?.delivered),
    failed: count(counts?.failed),
    suppressed: count(counts?.suppressed),
    unsubscribes: count(counts?.unsubscribes),
    complaints: count(counts?.complaints),
    repliesLabel: matchingConfirmed
      ? `A reply matched to a recovery message has been received. Human replies waiting: ${counts?.repliesNeeding ?? 0}.`
      : "Not confirmed. Reply monitoring is not connected. Mail sent only to the inbound address does not match a recovery message.",
    repliesNeeding: matchingConfirmed ? counts?.repliesNeeding ?? 0 : null,
    inboundReceived: counts?.repliesReceived == null ? NOT_AVAILABLE : String(counts.repliesReceived),
    countryRule:
      "Missing country stays unknown and is not labeled United States. Canada, the United Kingdom, the EEA, Switzerland, Australia, and New Zealand are excluded. Any other explicit country is outside this initial program. Country is not inferred.",
    trialConversion: "Not available. No recovery assignment has a mature 14-day trial window.",
    payments: NOT_AVAILABLE,
    retention: "Not available. Recovered members are not classified until an assignment and a paid outcome both exist.",
    nextAction: "Leave sending off. Connect reply monitoring, verify suppression, record the mailing address, and set an enrollment start before any authorization.",
    mailboxNote: "Open tyler@summittmindset.com in the mailbox. A direct link to one message is not connected.",
    replies: matchingConfirmed ? replies : [],
  };
}

export function recoveryBlockers(settings: RecoverySettings): string[] {
  const blockers: string[] = [];
  if (settings.status !== "pilot" && settings.status !== "active") {
    blockers.push(`Automation status is ${settings.status}.`);
  }
  if (!settings.sendingAuthorized) blockers.push("Sending authorization is not set.");
  if (!settings.inboundReady) {
    blockers.push("The recovery reply route is not configured.");
  }
  if (!settings.suppressionCheckReady || !settings.suppressionReadable) {
    blockers.push("Marketing suppression is not verified. A missing list is not zero opt-outs.");
  }
  if (!settings.postalAddress?.trim()) blockers.push("The physical mailing address is not recorded.");
  if (settings.enrollmentStartsAtMs == null) {
    blockers.push("Enrollment start is not set, so historical accounts are not emailed.");
  }
  return blockers;
}

export function formatRecoveryOperations(view: RecoveryAttention): string[] {
  return [
    "RECOVERY AUTOMATION",
    view.sending,
    view.countryRule,
    view.enrollment,
    `Control group: ${view.control}.`,
    `Recovery group: ${view.recovery}.`,
    `Emails attempted: ${view.attempted}. Accepted: ${view.accepted}. Delivered: ${view.delivered}. Failed: ${view.failed}. Suppressed: ${view.suppressed}.`,
    `Unsubscribes: ${view.unsubscribes}. Complaints: ${view.complaints}.`,
    `Replies needing attention: ${view.repliesLabel}.`,
    `Inbound mail received: ${view.inboundReceived}.`,
    `Trial conversion in the 14-day window: ${view.trialConversion}`,
    `Confirmed payments from recovery: ${view.payments}.`,
    `Mature retention of recovered members: ${view.retention}`,
    "Blockers",
    ...view.blockers.map((line) => `- ${line}`),
    view.nextAction,
  ];
}

function count(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return NOT_AVAILABLE;
  return String(value);
}
