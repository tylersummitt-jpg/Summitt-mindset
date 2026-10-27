import {
  nextWarmAction,
  reduceLiveSignal,
  type AcquisitionActionType,
  type AcquisitionLifecycle,
  type AcquisitionSignal,
} from "@/lib/acquisition/model";

const PERSON_GLOBAL: ReadonlySet<AcquisitionSignal> = new Set([
  "unsubscribed",
  "bounced",
  "complained",
  "trial_started",
  "paid_member",
  "trial_expired",
]);

export function signalIsPersonGlobal(signal: AcquisitionSignal): boolean {
  return PERSON_GLOBAL.has(signal);
}

export function journeyLocalStop(lifecycle: AcquisitionLifecycle, closed: boolean): boolean {
  return closed || lifecycle === "not_interested";
}

export type OpenJourneyChoice =
  | { action: "reuse"; journeyId: string }
  | { action: "create" }
  | { action: "ambiguous" };

/** One open journey is reused. None means a new journey. More than one cannot own an action. */
export function chooseOpenJourney(openJourneyIds: readonly string[]): OpenJourneyChoice {
  if (openJourneyIds.length === 1) {
    const journeyId = openJourneyIds[0];
    return journeyId ? { action: "reuse", journeyId } : { action: "ambiguous" };
  }
  if (openJourneyIds.length === 0) return { action: "create" };
  return { action: "ambiguous" };
}

export function journeyLifecycleWrite(
  current: AcquisitionLifecycle,
  signal: AcquisitionSignal,
  force: boolean,
): AcquisitionLifecycle {
  const reduced = reduceLiveSignal(current, signal);
  if (reduced.outcome !== "rejected") return reduced.state;
  if (!force) return current;
  if (signal === "asset_accepted") return "asset_sent";
  if (signal === "video_accepted") return "warm_video_sent";
  if (signal === "trial_followup_accepted") return "trial_invited";
  return current;
}

export function journeyMayClose(current: AcquisitionLifecycle, signal: AcquisitionSignal, force: boolean): boolean {
  if (force) return true;
  return reduceLiveSignal(current, signal).outcome !== "rejected";
}

export function journeyCloses(args: {
  reason: "not_interested" | "campaign_completed" | "fulfillment";
  followUp: "pinned" | "legacy" | "unknown";
  justAccepted: AcquisitionActionType | null;
  /** Scheduled or claimed actions still owed on this journey. */
  outstanding: readonly AcquisitionActionType[];
}): boolean {
  if (args.reason === "not_interested" || args.reason === "campaign_completed") return true;
  if (args.followUp !== "pinned" && args.followUp !== "legacy") return false;
  if (args.justAccepted == null || args.outstanding.length > 0) return false;
  if (args.followUp === "legacy") return nextWarmAction(args.justAccepted) == null;
  return true;
}
