import { ACQUISITION_ASSET_FILES, ACQUISITION_FILE_KEYS, resolveCampaignPromise, type AcquisitionOffer } from "@/lib/acquisition/assets";
import type { AcquisitionFileKey } from "@/lib/acquisition/assets";

export const PLAYBOOK_VIDEO_LABEL = "A personal video from Tyler Summitt";
export const PLAYBOOK_FULFILLMENTS = ["catalog", "video", "catalog_and_video", "manual", "none"] as const;
export const PLAYBOOK_STATUSES = ["current", "superseded", "paused", "retired"] as const;
export const PLAYBOOK_SEND_ACTIONS = ["send_asset", "send_video"] as const;

export type PlaybookFulfillment = (typeof PLAYBOOK_FULFILLMENTS)[number];
export type PlaybookStatus = (typeof PLAYBOOK_STATUSES)[number];
export type PlaybookSendAction = (typeof PLAYBOOK_SEND_ACTIONS)[number];

export type PlaybookVersion = {
  id: string;
  campaignId: string;
  version: number;
  name: string;
  audience: string;
  offerLabel: string | null;
  offerKey: string | null;
  resources: AcquisitionFileKey[];
  manualResource: string | null;
  personalVideoId: string | null;
  permittedActions: PlaybookSendAction[];
  replyGuidance: string | null;
  fulfillment: PlaybookFulfillment;
  status: PlaybookStatus;
  /** False after a pause or retirement. Replacing that version does not turn it back on. */
  schedulingOpen: boolean;
};

export type PlaybookDraft = {
  campaignId: string;
  name: string;
  audience: string;
  offerLabel: string | null;
  offerKey: string | null;
  resources: AcquisitionFileKey[];
  manualResource: string | null;
  personalVideoId: string | null;
  permittedActions: PlaybookSendAction[];
  replyGuidance: string | null;
  fulfillment: PlaybookFulfillment;
};

const CAMPAIGN_ID = /^[A-Za-z0-9_-]{1,80}$/;
const OFFER_KEY = /^[a-z0-9_]{1,64}$/;
const VIDEO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const URL = /https?:\/\/|\bwww\./i;
const GUIDANCE_COMMERCE = /\bfree shipping\b|\bshipping\b|\bshipment\b|\bships\b|\bdelivery date\b|\bdiscount\b|\bcoupon\b|\b% off\b|\bpercent off\b|\brefunds?\b|\$\d/i;

export type PlaybookReadiness = {
  ready: boolean;
  fulfillmentCapable: boolean;
  gaps: string[];
  instantlySequenceStop: "unverified";
  knowledge: "present" | "absent";
  attribution: "unavailable";
  independentJourneys: "unavailable";
};

export function deliverableResources(resources: readonly string[]): AcquisitionFileKey[] {
  const keys: AcquisitionFileKey[] = [];
  for (const key of resources) {
    if (ACQUISITION_FILE_KEYS.includes(key as AcquisitionFileKey) && !keys.includes(key as AcquisitionFileKey)) {
      keys.push(key as AcquisitionFileKey);
    }
  }
  return keys;
}

export function reviewPlaybookDraft(input: PlaybookDraft): { ok: true; draft: PlaybookDraft } | { ok: false; error: string } {
  const campaignId = input.campaignId.trim();
  const name = input.name.trim();
  const audience = input.audience.trim();
  if (!CAMPAIGN_ID.test(campaignId)) return { ok: false, error: "Enter the Instantly campaign ID." };
  if (!name || name.length > 120) return { ok: false, error: "Enter a campaign name." };
  if (!audience || audience.length > 80) return { ok: false, error: "Enter the audience." };
  if (!PLAYBOOK_FULFILLMENTS.includes(input.fulfillment)) return { ok: false, error: "Choose a fulfillment type." };
  const offerLabel = input.offerLabel?.trim() || null;
  const offerKey = input.offerKey?.trim() || null;
  const manualResource = input.manualResource?.trim() || null;
  const replyGuidance = input.replyGuidance?.trim() || null;
  const personalVideoId = input.personalVideoId?.trim() || null;
  if (offerLabel && offerLabel.length > 120) return { ok: false, error: "The offer name is too long." };
  if (offerKey && !OFFER_KEY.test(offerKey)) return { ok: false, error: "The offer key is not valid." };
  if (manualResource && (manualResource.length > 400 || URL.test(manualResource) || GUIDANCE_COMMERCE.test(manualResource))) {
    return { ok: false, error: "The other resource must stay under 400 characters and cannot include a web address, a price, shipping, or a discount." };
  }
  if (replyGuidance && (replyGuidance.length > 1000 || URL.test(replyGuidance) || GUIDANCE_COMMERCE.test(replyGuidance))) {
    return { ok: false, error: "Reply guidance must stay under 1,000 characters and cannot include a web address, a price, shipping, or a discount." };
  }
  if (personalVideoId && !VIDEO_ID.test(personalVideoId)) return { ok: false, error: "Choose a personal video from the library." };
  const resources = deliverableResources(input.resources);
  const permitted = PLAYBOOK_SEND_ACTIONS.filter((action) => input.permittedActions.includes(action));
  if (input.fulfillment === "none" || input.fulfillment === "manual") {
    if (permitted.length > 0) return { ok: false, error: "This fulfillment type cannot send automatically." };
  }
  if ((input.fulfillment === "catalog" || input.fulfillment === "catalog_and_video") && resources.length === 0) {
    return { ok: false, error: "Choose at least one catalog PDF." };
  }
  if ((input.fulfillment === "video" || input.fulfillment === "catalog_and_video") && !personalVideoId) {
    return { ok: false, error: "Choose a personal video." };
  }
  if (permitted.includes("send_asset") && resources.length === 0) {
    return { ok: false, error: "A PDF send needs a catalog file." };
  }
  if (permitted.includes("send_video") && !personalVideoId) {
    return { ok: false, error: "A video send needs a personal video." };
  }
  if (input.fulfillment === "manual" && !manualResource) {
    return { ok: false, error: "Describe the resource that has to be fulfilled separately." };
  }
  return {
    ok: true,
    draft: {
      campaignId,
      name,
      audience,
      offerLabel,
      offerKey,
      resources,
      manualResource,
      personalVideoId,
      permittedActions: permitted,
      replyGuidance,
      fulfillment: input.fulfillment,
    },
  };
}

export function playbookReadiness(args: {
  draft: PlaybookDraft;
  status: PlaybookStatus;
  videoStatus: "ready" | "not_ready" | "missing" | null;
  knowledgeCount: number;
  schedulingOpen?: boolean;
}): PlaybookReadiness {
  const reviewed = reviewPlaybookDraft(args.draft);
  const gaps: string[] = [];
  gaps.push("Saving this playbook does not authorize automated replies or fulfillment.");
  if (!reviewed.ok) gaps.push(reviewed.error);
  const draft = reviewed.ok ? reviewed.draft : args.draft;
  if (args.status === "paused") gaps.push("This playbook is paused.");
  if (args.status === "retired") gaps.push("This playbook is retired.");
  if (args.status === "superseded" && args.schedulingOpen !== false) gaps.push("This version has been replaced for new journeys.");
  if (args.status === "superseded" && args.schedulingOpen === false) {
    gaps.push("This version was closed. Journeys that pinned it do not start new sends.");
  }
  if (draft.permittedActions.includes("send_video")) {
    if (args.videoStatus === "missing") gaps.push("The selected personal video does not exist.");
    if (args.videoStatus === "not_ready") gaps.push("The selected personal video is not ready.");
    if (args.videoStatus == null) gaps.push("The personal video has not been checked.");
  }
  if (draft.manualResource) {
    gaps.push("The other resource is recorded and cannot be delivered automatically.");
  }
  if (draft.fulfillment === "none") gaps.push("This playbook does not send a resource.");
  if (draft.permittedActions.length === 0 && draft.fulfillment !== "none" && draft.fulfillment !== "manual") {
    gaps.push("No send action is permitted.");
  }
  const knowledgeNeeded = draft.fulfillment === "manual" || Boolean(draft.replyGuidance);
  if (knowledgeNeeded && args.knowledgeCount < 1) {
    gaps.push("No approved knowledge is saved for this campaign or offer.");
  }
  const fulfillmentCapable = reviewed.ok
    && (args.status === "current" || args.status === "superseded")
    && draft.fulfillment !== "manual"
    && draft.fulfillment !== "none"
    && draft.permittedActions.length > 0
    && draft.permittedActions.every((action) => action === "send_asset" || (action === "send_video" && args.videoStatus === "ready"));
  const ready = reviewed.ok && args.status === "current" && fulfillmentCapable && (!knowledgeNeeded || args.knowledgeCount > 0);
  return {
    ready,
    fulfillmentCapable,
    gaps,
    instantlySequenceStop: "unverified",
    knowledge: args.knowledgeCount > 0 ? "present" : "absent",
    attribution: "unavailable",
    independentJourneys: "unavailable",
  };
}

export function pinDecision(args: { event: "inserted" | "duplicate" | "failed"; latestPlaybookId: string | null }): string | null {
  if (args.event !== "inserted" || !args.latestPlaybookId) return null;
  return args.latestPlaybookId;
}

export type ResolvedCampaign =
  | {
      source: "legacy";
      promise: { offerKey: string | null; assets: AcquisitionFileKey[]; label: string | null } | null;
      guidance: null;
      labels: string[];
      playbookId: null;
      videoId: null;
      obligationLabels: string[];
      obligationPromise: null;
      obligationVideoId: null;
      deliveryVideoId: null;
      useCampaignKnowledge: true;
    }
  | {
      source: "unavailable";
      promise: null;
      guidance: null;
      labels: [];
      playbookId: null;
      videoId: null;
      obligationLabels: [];
      obligationPromise: null;
      obligationVideoId: null;
      deliveryVideoId: null;
      useCampaignKnowledge: false;
    }
  | {
      source: "playbook";
      promise: { offerKey: string | null; assets: AcquisitionFileKey[]; label: string | null } | null;
      guidance: string | null;
      labels: string[];
      playbookId: string;
      videoId: string | null;
      obligationLabels: string[];
      obligationPromise: { offerKey: string | null; assets: AcquisitionFileKey[]; label: string | null } | null;
      obligationVideoId: string | null;
      deliveryVideoId: string | null;
      sendable: boolean;
      useCampaignKnowledge: boolean;
    };

export function unavailableCampaign(): ResolvedCampaign {
  return {
    source: "unavailable",
    promise: null,
    guidance: null,
    labels: [],
    playbookId: null,
    videoId: null,
    obligationLabels: [],
    obligationPromise: null,
    obligationVideoId: null,
    deliveryVideoId: null,
    useCampaignKnowledge: false,
  };
}

function fileLabels(keys: readonly AcquisitionFileKey[]): string[] {
  return keys.map((key) => ACQUISITION_ASSET_FILES[key].label);
}

export function resolvePinnedOrLegacy(args: {
  pinned: PlaybookVersion | null;
  videoReady: boolean;
  campaignValue: unknown;
  offers: ReadonlyMap<string, AcquisitionOffer>;
}): ResolvedCampaign {
  if (!args.pinned) {
    const promise = resolveCampaignPromise({ campaignValue: args.campaignValue, offers: args.offers });
    return {
      source: "legacy",
      promise,
      guidance: null,
      labels: promise ? [...(promise.label ? [promise.label] : []), ...fileLabels(promise.assets)] : [],
      playbookId: null,
      videoId: null,
      obligationLabels: [],
      obligationPromise: null,
      obligationVideoId: null,
      deliveryVideoId: null,
      useCampaignKnowledge: true,
    };
  }
  const version = args.pinned;
  const files = version.permittedActions.includes("send_asset") ? version.resources : [];
  const videoConfigured = version.permittedActions.includes("send_video") && Boolean(version.personalVideoId);
  const videoAllowed = videoConfigured && args.videoReady;
  const closed = version.status === "paused" || version.status === "retired" || !version.schedulingOpen;
  const retired = version.status === "retired";
  const sendable = !closed && (files.length > 0 || videoAllowed);
  const obligationOpen = !retired && (files.length > 0 || videoAllowed);
  const labels = sendable
    ? [...(version.offerLabel ? [version.offerLabel] : []), ...fileLabels(files), ...(videoAllowed ? [PLAYBOOK_VIDEO_LABEL] : [])]
    : [];
  const obligationLabels = obligationOpen
    ? [...(version.offerLabel ? [version.offerLabel] : []), ...fileLabels(files), ...(videoAllowed ? [PLAYBOOK_VIDEO_LABEL] : [])]
    : [];
  const guidance = closed
    ? `${version.name} is ${version.status}. Do not make a campaign-specific promise or offer a resource.`
    : [
        version.name,
        `Audience: ${version.audience}.`,
        version.offerLabel ? `Offer: ${version.offerLabel}.` : null,
        version.replyGuidance && !GUIDANCE_COMMERCE.test(version.replyGuidance) ? version.replyGuidance : null,
        version.manualResource ? `Recorded resource, not an automatic delivery: ${version.manualResource}.` : null,
      ].filter(Boolean).join(" ");
  return {
    source: "playbook",
    promise: sendable && files.length > 0 ? { offerKey: version.offerKey, assets: files, label: version.offerLabel } : null,
    guidance,
    labels,
    playbookId: version.id,
    videoId: sendable && videoAllowed ? version.personalVideoId : null,
    obligationLabels,
    obligationPromise: obligationOpen && files.length > 0 ? { offerKey: version.offerKey, assets: files, label: version.offerLabel } : null,
    obligationVideoId: obligationOpen && videoAllowed ? version.personalVideoId : null,
    deliveryVideoId: videoConfigured ? version.personalVideoId : null,
    sendable,
    useCampaignKnowledge: !closed,
  };
}

export function recoverPlaybookAcceptance(
  resolved: ResolvedCampaign,
  outcome: string | null,
  acceptedResource: string | null,
  mode: "new" | "established" = "new",
): string | null {
  if (acceptedResource) return acceptedResource;
  if (outcome !== "accept_offer" || resolved.source !== "playbook") return null;
  if (mode === "new" && !resolved.sendable) return null;
  const labels = mode === "established" ? resolved.obligationLabels : resolved.labels;
  const videoId = mode === "established" ? resolved.obligationVideoId : resolved.videoId;
  const resources = labels.filter((label) => label !== PLAYBOOK_VIDEO_LABEL);
  if (videoId && resources.length === 0) return PLAYBOOK_VIDEO_LABEL;
  if (!videoId && resources.length > 0) return resources[0] ?? null;
  return null;
}

export function choosePlaybookSend(
  resolved: ResolvedCampaign,
  acceptedResource: string | null,
  mode: "new" | "established" = "new",
): "send_asset" | "send_video" | null {
  if (resolved.source !== "playbook" || !acceptedResource) return null;
  if (mode === "new" && !resolved.sendable) return null;
  const labels = mode === "established" ? resolved.obligationLabels : resolved.labels;
  const videoId = mode === "established" ? resolved.obligationVideoId : resolved.videoId;
  const promise = mode === "established"
    ? resolved.obligationLabels.some((label) => label !== PLAYBOOK_VIDEO_LABEL)
    : Boolean(resolved.promise);
  if (videoId && acceptedResource === PLAYBOOK_VIDEO_LABEL) return "send_video";
  if (promise && labels.includes(acceptedResource) && acceptedResource !== PLAYBOOK_VIDEO_LABEL) return "send_asset";
  return null;
}

export function unpinnedCampaignSource(args: {
  playbooksPresent: boolean;
  journeyCreatedAt: string | null;
  playbookCreatedAt: string | null;
}): "legacy" | "unavailable" {
  if (!args.playbooksPresent) return "legacy";
  const journeyAt = args.journeyCreatedAt ? Date.parse(args.journeyCreatedAt) : Number.NaN;
  const playbookAt = args.playbookCreatedAt ? Date.parse(args.playbookCreatedAt) : Number.NaN;
  if (!Number.isFinite(journeyAt) || !Number.isFinite(playbookAt)) return "unavailable";
  if (journeyAt < playbookAt) return "legacy";
  return "unavailable";
}

function nextSavedPlaybook(latest: PlaybookVersion | null): { status: PlaybookStatus; schedulingOpen: boolean; supersede: boolean } {
  if (!latest) return { status: "current", schedulingOpen: true, supersede: false };
  if (latest.status === "retired") return { status: "retired", schedulingOpen: false, supersede: false };
  if ((latest.status === "current" || latest.status === "superseded") && latest.schedulingOpen) {
    return { status: "current", schedulingOpen: true, supersede: latest.status === "current" };
  }
  return { status: "paused", schedulingOpen: false, supersede: latest.status === "current" || latest.status === "paused" };
}

export function commitPlaybookSave(args: {
  versions: readonly PlaybookVersion[];
  draft: PlaybookDraft;
  newId: string;
  persist: "committed" | "failed";
}): readonly PlaybookVersion[] {
  if (args.persist === "failed") return args.versions;
  const ordered = [...args.versions].sort((left, right) => left.version - right.version);
  const latest = ordered[ordered.length - 1] ?? null;
  const next = nextSavedPlaybook(latest);
  const otherOpen = ordered.some((version) =>
    version.id !== latest?.id && (version.status === "current" || version.status === "paused"),
  );
  if (otherOpen && (next.status === "current" || next.status === "paused")) return args.versions;
  const kept = ordered.map((version) =>
    next.supersede && latest && version.id === latest.id
      ? { ...version, status: "superseded" as const }
      : version,
  );
  return [
    ...kept,
    {
      ...args.draft,
      id: args.newId,
      version: (latest?.version ?? 0) + 1,
      status: next.status,
      schedulingOpen: next.schedulingOpen,
    },
  ];
}

export function applyPlaybookStatus(
  versions: readonly PlaybookVersion[],
  action: "pause" | "resume" | "retire",
): { ok: true; versions: PlaybookVersion[] } | { ok: false; error: string; versions: readonly PlaybookVersion[] } {
  const ordered = [...versions].sort((left, right) => left.version - right.version);
  const latest = ordered[ordered.length - 1];
  if (!latest) return { ok: false, error: "No playbook exists for that campaign.", versions };
  if (action === "pause" && latest.status !== "current") return { ok: false, error: "Only the open playbook can be paused.", versions };
  if (action === "retire" && latest.status !== "current" && latest.status !== "paused") {
    return { ok: false, error: "Only the open playbook can be retired.", versions };
  }
  if (action === "resume" && latest.status !== "paused" && latest.status !== "retired") {
    return { ok: false, error: "Only a paused or retired playbook can be resumed.", versions };
  }
  const status: PlaybookStatus = action === "pause" ? "paused" : action === "retire" ? "retired" : "current";
  return {
    ok: true,
    versions: ordered.map((version) => version.id === latest.id
      ? { ...version, status, schedulingOpen: action === "resume" }
      : version),
  };
}

export function fulfillmentObligation(args: {
  stage: "requested" | "scheduled" | "claimed" | "provider_accepted" | "delivered";
  campaignStatus: PlaybookStatus;
  schedulingOpen: boolean;
  suppressed: boolean;
}): "keep" | "send" | "schedule" | "hold" | "stop" {
  if (args.suppressed) return "stop";
  if (args.stage === "delivered" || args.stage === "provider_accepted") return "keep";
  if (args.stage === "scheduled" || args.stage === "claimed") return "send";
  if (args.campaignStatus === "retired") return "hold";
  return "schedule";
}

export const LEGACY_CAMPAIGN_ASSETS: Record<string, "playbook" | "definite_dozen"> = {
  "2d81d1ee-2108-4c51-ad12-b784847b32db": "playbook",
  "364dad9d-cbb5-4d33-b4d5-0ac083f0ebe5": "playbook",
  "80d88a66-78a2-4367-a4ea-6d5a562ebf92": "definite_dozen",
  "ab5b139c-0f7e-44f9-b42a-86726fd024a8": "definite_dozen",
  "b6c4a6a8-0e85-401e-9eed-1813077adc43": "playbook",
  "cddc8102-2418-408c-ba9e-9443741e6463": "definite_dozen",
  "e079d4c5-6f79-420d-b478-4f53c8a57523": "definite_dozen",
  "ebf3f9c1-5709-4bb8-ac72-edf4a8e36930": "playbook",
  "ec893791-3436-483d-924e-0d205c072cee": "playbook",
  "f48843c3-2c26-4de3-bdc8-9829e2ffe814": "playbook",
};
