import { pdfHeaderValid } from "@/lib/acquisition/assets";
import {
  actionMatchesState,
  evaluateWarmSend,
  salesEmailMustStop,
  settleAcceptedSend,
  settleFailedSend,
  type AcquisitionActionType,
  type AcquisitionAsset,
  type AcquisitionAutomation,
  type AcquisitionLifecycle,
  type ActionSettle,
} from "@/lib/acquisition/model";

export type PassPerson = {
  id: string;
  email: string;
  firstName: string | null;
  lifecycle: AcquisitionLifecycle;
  requestedAsset: AcquisitionAsset | null;
  offerKey: string | null;
  clerkUserId: string | null;
};

export type PassAttachment = {
  filename: string;
  label: string;
  bytes: Buffer;
};

export type PassAction = {
  id: string;
  personId: string;
  actionType: AcquisitionActionType;
  attemptCount: number;
  idempotencyKey: string;
};

export type PassSendRequest = {
  action: PassAction;
  person: PassPerson;
  attachments: PassAttachment[];
  offerLabel: string | null;
  videoToken: string | null;
  unsubscribeToken: string;
};

export type PassEffect =
  | { kind: "accept"; actionId: string; settle: ActionSettle; providerMessageId: string | null }
  | { kind: "retry"; actionId: string }
  | { kind: "release"; actionId: string }
  | {
      kind: "stop";
      actionId: string;
      status: "canceled" | "failed" | "blocked" | "uncertain" | "suppressed";
      cancelSiblings: boolean;
    };

export function providerKind(outcome: "accepted" | "temporary_failure" | "permanent_failure" | "provider_rejected" | "unknown"): "accepted" | "temporary" | "permanent" | "uncertain" {
  if (outcome === "accepted") return "accepted";
  if (outcome === "temporary_failure") return "temporary";
  if (outcome === "unknown") return "uncertain";
  return "permanent";
}

export async function runAcquisitionPass(args: {
  now: Date;
  automation: AcquisitionAutomation;
  dailyCap: number;
  acceptedToday: number;
  due: PassAction[];
  claim: (action: PassAction) => Promise<boolean>;
  person: (id: string) => Promise<PassPerson | null>;
  suppression: (email: string) => Promise<boolean | null>;
  clerkSubscribed: (clerkUserId: string | null) => Promise<boolean | null>;
  assetFiles: (person: PassPerson) => Promise<{ label: string | null; files: PassAttachment[] } | null>;
  videoToken: (person: PassPerson) => Promise<string | null>;
  unsubscribeToken: () => string;
  send: (request: PassSendRequest) => Promise<{
    outcome: "accepted" | "temporary_failure" | "permanent_failure" | "provider_rejected" | "unknown";
    providerMessageId: string | null;
  }>;
  apply: (effect: PassEffect) => Promise<void>;
}): Promise<{ examined: number; accepted: number; skipped: string }> {
  if (args.automation !== "pilot" && args.automation !== "active") {
    return { examined: 0, accepted: 0, skipped: "automation_off" };
  }
  let accepted = 0;
  let acceptedToday = args.acceptedToday;
  for (const action of args.due) {
    if (acceptedToday >= args.dailyCap) {
      return { examined: args.due.length, accepted, skipped: "cap" };
    }
    if (!(await args.claim(action))) continue;
    const person = await args.person(action.personId);
    if (!person) {
      await args.apply({ kind: "stop", actionId: action.id, status: "canceled", cancelSiblings: false });
      continue;
    }
    const suppressed = await args.suppression(person.email);
    const subscribed = await args.clerkSubscribed(person.clerkUserId);
    if (subscribed === null) {
      await args.apply({ kind: "release", actionId: action.id });
      continue;
    }
    const gate = evaluateWarmSend({
      automation: args.automation,
      state: person.lifecycle,
      action: action.actionType,
      suppressed,
      clerkSubscribed: subscribed === true,
      acceptedToday,
      dailyCap: args.dailyCap,
    });
    if (gate === "cap") {
      await args.apply({ kind: "release", actionId: action.id });
      return { examined: args.due.length, accepted, skipped: "cap" };
    }
    if (gate === "suppression_unknown") {
      await args.apply({ kind: "release", actionId: action.id });
      continue;
    }
    if (gate === "suppressed" || gate === "member" || gate === "state") {
      await args.apply({
        kind: "stop",
        actionId: action.id,
        status: gate === "suppressed" ? "suppressed" : "canceled",
        cancelSiblings: gate !== "state",
      });
      continue;
    }
    if (!actionMatchesState(action.actionType, person.lifecycle)) {
      await args.apply({ kind: "stop", actionId: action.id, status: "canceled", cancelSiblings: false });
      continue;
    }
    const fresh = await args.person(action.personId);
    if (!fresh || !actionMatchesState(action.actionType, fresh.lifecycle) || salesEmailMustStop(fresh.lifecycle)) {
      await args.apply({
        kind: "stop",
        actionId: action.id,
        status: "canceled",
        cancelSiblings: true,
      });
      continue;
    }
    const bundle = action.actionType === "send_asset" ? await args.assetFiles(fresh) : null;
    if (
      action.actionType === "send_asset" &&
      (!bundle || bundle.files.length === 0 || bundle.files.some((file) => !pdfHeaderValid(file.bytes)))
    ) {
      await args.apply({ kind: "stop", actionId: action.id, status: "blocked", cancelSiblings: false });
      continue;
    }
    const videoToken = action.actionType === "send_video" ? await args.videoToken(fresh) : null;
    if (action.actionType === "send_video" && !videoToken) {
      await args.apply({ kind: "stop", actionId: action.id, status: "blocked", cancelSiblings: false });
      continue;
    }
    const request: PassSendRequest = {
      action,
      person: fresh,
      attachments: bundle?.files ?? [],
      offerLabel: bundle?.label ?? null,
      videoToken,
      unsubscribeToken: args.unsubscribeToken(),
    };
    const result = await args.send(request);
    const kind = providerKind(result.outcome);
    if (kind === "accepted") {
      const settle = settleAcceptedSend(action.actionType, fresh.lifecycle);
      await args.apply({ kind: "accept", actionId: action.id, settle, providerMessageId: result.providerMessageId });
      if (settle.status === "accepted") accepted += 1;
      acceptedToday += 1;
      continue;
    }
    const settle = settleFailedSend({
      state: fresh.lifecycle,
      attemptCount: action.attemptCount,
      kind,
    });
    if (settle.status === "scheduled") {
      await args.apply({ kind: "retry", actionId: action.id });
    } else {
      await args.apply({
        kind: "stop",
        actionId: action.id,
        status: settle.status === "failed" || settle.status === "uncertain" ? settle.status : "failed",
        cancelSiblings: false,
      });
    }
  }
  return { examined: args.due.length, accepted, skipped: "done" };
}
