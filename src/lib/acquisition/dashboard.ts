import type { AcquisitionLifecycle } from "@/lib/acquisition/model";

export type AcquisitionCountKey =
  | "cold_prospects"
  | "cold_active"
  | "cold_no_response"
  | "reply_needs_review"
  | "asset_requested"
  | "asset_sent"
  | "warm_video_sent"
  | "trial_invited"
  | "video_visited"
  | "video_played"
  | "cta_clicked"
  | "trial_started"
  | "trial_expired"
  | "paid_member"
  | "not_interested"
  | "unsubscribed"
  | "suppressed";

export type AcquisitionNeedsItem = {
  id: string;
  name: string;
  reason: string;
};

export type AcquisitionSenderRow = {
  senderEmail: string;
  connectionStatus: string;
  detail: string | null;
  observedAt: string;
};

export type AcquisitionDashboard = {
  readable: boolean;
  automation: string;
  counts: Record<AcquisitionCountKey, number> | null;
  needsTyler: AcquisitionNeedsItem[] | null;
  senders: AcquisitionSenderRow[] | null;
  note: string;
};

const ZERO: Record<AcquisitionCountKey, number> = {
  cold_prospects: 0,
  cold_active: 0,
  cold_no_response: 0,
  reply_needs_review: 0,
  asset_requested: 0,
  asset_sent: 0,
  warm_video_sent: 0,
  trial_invited: 0,
  video_visited: 0,
  video_played: 0,
  cta_clicked: 0,
  trial_started: 0,
  trial_expired: 0,
  paid_member: 0,
  not_interested: 0,
  unsubscribed: 0,
  suppressed: 0,
};

export function emptyAcquisitionDashboard(note: string): AcquisitionDashboard {
  return {
    readable: false,
    automation: "unavailable",
    counts: null,
    needsTyler: null,
    senders: null,
    note,
  };
}

export function buildAcquisitionDashboard(args: {
  automation: string;
  people: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    lifecycle: AcquisitionLifecycle;
    requestedAsset: string | null;
    offerKey?: string | null;
    offerLabel?: string | null;
  }>;
  actions: Array<{ personId: string; actionType: string; status: string }>;
  videoEvents: Array<{ personId: string; eventType: string }>;
  senders: AcquisitionSenderRow[];
}): AcquisitionDashboard {
  const counts: Record<AcquisitionCountKey, number> = {
    ...ZERO,
    cold_prospects: args.people.length,
  };
  for (const person of args.people) {
    counts[person.lifecycle] += 1;
  }
  const seen = new Set<string>();
  for (const event of args.videoEvents) {
    const key = `${event.personId}:${event.eventType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (event.eventType === "personal_video_visited") counts.video_visited += 1;
    if (event.eventType === "personal_video_played") counts.video_played += 1;
    if (event.eventType === "personal_video_cta_clicked") counts.cta_clicked += 1;
  }
  const openAsset = new Set(
    args.actions
      .filter((action) => action.actionType === "send_asset" && (action.status === "scheduled" || action.status === "claimed" || action.status === "accepted" || action.status === "delivered"))
      .map((action) => action.personId)
  );
  const needs: AcquisitionNeedsItem[] = [];
  for (const person of args.people) {
    const name = [person.firstName, person.lastName].filter(Boolean).join(" ") || "Name not recorded";
    if (person.lifecycle === "reply_needs_review") {
      needs.push({ id: person.id, name, reason: "Reply needs a decision" });
    }
    if (person.lifecycle === "asset_requested" && !person.requestedAsset && !person.offerKey && !openAsset.has(person.id)) {
      needs.push({ id: person.id, name, reason: "Asset was requested and the asset type is not set" });
    }
  }
  for (const action of args.actions) {
    if (action.status !== "blocked" && action.status !== "uncertain") continue;
    const person = args.people.find((row) => row.id === action.personId);
    const name = person
      ? [person.firstName, person.lastName].filter(Boolean).join(" ") || "Name not recorded"
      : "Name not recorded";
    needs.push({
      id: action.personId,
      name,
      reason: action.status === "blocked" ? "A warm email is blocked" : "A warm email result is uncertain",
    });
  }
  return {
    readable: true,
    automation: args.automation,
    counts,
    needsTyler: needs.slice(0, 25),
    senders: args.senders.slice(0, 20),
    note: "These are current lifecycle headcounts for the loaded people. The people read stops at 5,000 rows, so a full page may be incomplete. The date range does not filter them. A CTA click is not a trial. Stripe remains the trial and payment record.",
  };
}

export function formatAcquisitionReport(dashboard: AcquisitionDashboard): string[] {
  if (!dashboard.readable || !dashboard.counts) {
    return [
      "CURRENT PROSPECT STATUS — ALL TIME",
      dashboard.note,
      "Needs Tyler: Not available",
    ];
  }
  const c = dashboard.counts;
  return [
    "CURRENT PROSPECT STATUS — ALL TIME",
    `Automation: ${dashboard.automation}.`,
    `Cold prospects: ${c.cold_prospects}`,
    `Cold active: ${c.cold_active}`,
    `Cold no response: ${c.cold_no_response}`,
    `Replies needing review: ${c.reply_needs_review}`,
    `Asset requested: ${c.asset_requested}`,
    `Assets sent: ${c.asset_sent}`,
    `Warm videos sent: ${c.warm_video_sent}`,
    `Video visited: ${c.video_visited}`,
    `Video played: ${c.video_played}`,
    `CTA clicked: ${c.cta_clicked}`,
    `Trials started: ${c.trial_started}`,
    `Trial expired: ${c.trial_expired}`,
    `Paid members: ${c.paid_member}`,
    `Not interested: ${c.not_interested}`,
    `Unsubscribed: ${c.unsubscribed}`,
    `Bounced or suppressed: ${c.suppressed}`,
    `Needs Tyler: ${dashboard.needsTyler?.length ?? 0}`,
    dashboard.note,
  ];
}
