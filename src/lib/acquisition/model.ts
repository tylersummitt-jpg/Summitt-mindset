import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { normalizeCheckoutEmail } from "@/lib/stripe-first-checkout/email-typo";

export const ACQUISITION_LIFECYCLE = [
  "cold_active",
  "cold_no_response",
  "reply_needs_review",
  "asset_requested",
  "asset_sent",
  "warm_video_sent",
  "trial_invited",
  "trial_started",
  "paid_member",
  "not_interested",
  "unsubscribed",
  "suppressed",
  "trial_expired",
] as const;

export type AcquisitionLifecycle = (typeof ACQUISITION_LIFECYCLE)[number];

export const ACQUISITION_ASSETS = ["definite_dozen", "playbook"] as const;
export type AcquisitionAsset = (typeof ACQUISITION_ASSETS)[number];

export const ACQUISITION_ACTIONS = ["send_asset", "send_video", "send_trial_followup"] as const;
export type AcquisitionActionType = (typeof ACQUISITION_ACTIONS)[number];

export type AcquisitionAutomation = "off" | "pilot" | "active" | "paused" | "unavailable";

export type AcquisitionSignal =
  | "email_sent"
  | "reply_received"
  | "interested"
  | "not_interested"
  | "unsubscribed"
  | "bounced"
  | "complained"
  | "campaign_completed"
  | "wrong_person"
  | "asset_accepted"
  | "video_accepted"
  | "trial_followup_accepted"
  | "trial_started"
  | "paid_member"
  | "trial_expired"
  | "observe";

export type ReduceResult = {
  outcome: "advance" | "unchanged" | "rejected";
  state: AcquisitionLifecycle;
};

const TARGET: Record<AcquisitionSignal, AcquisitionLifecycle | null> = {
  email_sent: null,
  reply_received: "reply_needs_review",
  interested: "asset_requested",
  not_interested: "not_interested",
  unsubscribed: "unsubscribed",
  bounced: "suppressed",
  complained: "suppressed",
  campaign_completed: "cold_no_response",
  wrong_person: "reply_needs_review",
  asset_accepted: "asset_sent",
  video_accepted: "warm_video_sent",
  trial_followup_accepted: "trial_invited",
  trial_started: "trial_started",
  paid_member: "paid_member",
  trial_expired: "trial_expired",
  observe: null,
};

const SALES_STATES: readonly AcquisitionLifecycle[] = [
  "cold_active",
  "cold_no_response",
  "reply_needs_review",
  "asset_requested",
  "asset_sent",
  "warm_video_sent",
  "trial_invited",
];

const ALLOWED: Record<AcquisitionSignal, readonly AcquisitionLifecycle[]> = {
  email_sent: [],
  reply_received: ["cold_active", "cold_no_response"],
  interested: ["cold_active", "cold_no_response", "reply_needs_review"],
  not_interested: SALES_STATES,
  unsubscribed: SALES_STATES,
  bounced: SALES_STATES,
  complained: SALES_STATES,
  campaign_completed: ["cold_active"],
  wrong_person: ["cold_active", "cold_no_response"],
  asset_accepted: ["asset_requested"],
  video_accepted: ["asset_sent"],
  trial_followup_accepted: ["warm_video_sent"],
  trial_started: [
    ...SALES_STATES,
    "not_interested",
    "unsubscribed",
    "suppressed",
    "trial_expired",
  ],
  paid_member: [
    ...SALES_STATES,
    "not_interested",
    "unsubscribed",
    "suppressed",
    "trial_started",
    "trial_expired",
  ],
  trial_expired: ["trial_started"],
  observe: [],
};

export function isAcquisitionLifecycle(value: string): value is AcquisitionLifecycle {
  return (ACQUISITION_LIFECYCLE as readonly string[]).includes(value);
}

export function normalizeAcquisitionEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  return normalizeCheckoutEmail(raw);
}

export function reduceLiveSignal(
  current: AcquisitionLifecycle,
  signal: AcquisitionSignal
): ReduceResult {
  const target = TARGET[signal];
  if (!target || target === current) return { outcome: "unchanged", state: current };
  if (ALLOWED[signal].includes(current)) return { outcome: "advance", state: target };
  return { outcome: "rejected", state: current };
}

/** Historical Instantly rows may fill a cold person. They must not walk a warmer state backward. */
export function backfillMayApply(
  current: AcquisitionLifecycle | null,
  proposed: AcquisitionLifecycle
): "create" | "apply" | "skip_same" | "skip_stronger" {
  if (!current) return "create";
  if (current === proposed) return "skip_same";
  if (current !== "cold_active" && current !== "cold_no_response") return "skip_stronger";
  if (proposed === "cold_active") return "skip_stronger";
  if (
    proposed === "cold_no_response" ||
    proposed === "asset_requested" ||
    proposed === "not_interested" ||
    proposed === "unsubscribed" ||
    proposed === "suppressed"
  ) {
    return "apply";
  }
  return "skip_stronger";
}

export function salesEmailMustStop(state: AcquisitionLifecycle): boolean {
  return (
    state === "trial_started" ||
    state === "paid_member" ||
    state === "trial_expired" ||
    state === "unsubscribed" ||
    state === "suppressed" ||
    state === "not_interested"
  );
}

export function actionMatchesState(
  action: AcquisitionActionType,
  state: AcquisitionLifecycle
): boolean {
  if (action === "send_asset") return state === "asset_requested";
  if (action === "send_video") return state === "asset_sent";
  return state === "warm_video_sent";
}

export type WarmSendGate =
  | "send"
  | "automation_off"
  | "suppression_unknown"
  | "suppressed"
  | "member"
  | "state"
  | "cap";

export function evaluateWarmSend(args: {
  automation: AcquisitionAutomation;
  state: AcquisitionLifecycle;
  action: AcquisitionActionType;
  suppressed: boolean | null;
  clerkSubscribed: boolean;
  acceptedToday: number;
  dailyCap: number;
}): WarmSendGate {
  if (args.automation !== "pilot" && args.automation !== "active") return "automation_off";
  if (args.suppressed === null) return "suppression_unknown";
  if (args.suppressed) return "suppressed";
  if (args.clerkSubscribed || salesEmailMustStop(args.state)) return "member";
  if (!actionMatchesState(args.action, args.state)) return "state";
  if (args.acceptedToday >= args.dailyCap) return "cap";
  return "send";
}

export function nextWarmAction(
  accepted: AcquisitionActionType
): AcquisitionActionType | null {
  if (accepted === "send_asset") return "send_video";
  if (accepted === "send_video") return "send_trial_followup";
  return null;
}

export type ActionSettle =
  | { status: "accepted"; state: AcquisitionLifecycle; schedule: AcquisitionActionType | null }
  | { status: "scheduled"; state: AcquisitionLifecycle; schedule: null }
  | { status: "failed" | "uncertain" | "blocked" | "suppressed" | "canceled"; state: AcquisitionLifecycle; schedule: null };

export function settleAcceptedSend(
  action: AcquisitionActionType,
  state: AcquisitionLifecycle
): ActionSettle {
  const reduced = reduceLiveSignal(
    state,
    action === "send_asset"
      ? "asset_accepted"
      : action === "send_video"
        ? "video_accepted"
        : "trial_followup_accepted"
  );
  if (reduced.outcome !== "advance") {
    return { status: "canceled", state, schedule: null };
  }
  return { status: "accepted", state: reduced.state, schedule: nextWarmAction(action) };
}

export function settleFailedSend(args: {
  state: AcquisitionLifecycle;
  attemptCount: number;
  kind: "temporary" | "permanent" | "uncertain" | "blocked";
}): ActionSettle {
  if (args.kind === "uncertain") return { status: "uncertain", state: args.state, schedule: null };
  if (args.kind === "blocked") return { status: "blocked", state: args.state, schedule: null };
  if (args.kind === "permanent" || args.attemptCount >= 1) {
    return { status: "failed", state: args.state, schedule: null };
  }
  return { status: "scheduled", state: args.state, schedule: null };
}

export function newAcquisitionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function acquisitionTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function previewText(value: unknown, limit = 140): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.slice(0, limit);
}

export function parseAcquisitionAsset(value: unknown): AcquisitionAsset | null {
  if (value === "definite_dozen" || value === "playbook") return value;
  return null;
}

export function assetFromCampaign(
  campaignId: string | null,
  campaignAssets: Record<string, unknown> | null
): AcquisitionAsset | null {
  if (!campaignId || !campaignAssets) return null;
  return parseAcquisitionAsset(campaignAssets[campaignId]);
}

export const ACQUISITION_RETRY_MS = 15 * 60 * 1000;
export const ACQUISITION_CLAIM_MS = 5 * 60 * 1000;

export function automationSends(status: AcquisitionAutomation): boolean {
  return status === "pilot" || status === "active";
}

export function secretHeaderMatches(header: string | null, secret: string | null): boolean {
  if (!header || !secret) return false;
  const left = Buffer.from(header);
  const right = Buffer.from(secret);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}
