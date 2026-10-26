import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ACQUISITION_ASSET_FILES } from "@/lib/acquisition/assets";
import { decideConversationEffect } from "@/lib/acquisition/conversation";
import { prepareInterpreterKnowledge } from "@/lib/acquisition/email-knowledge";
import {
  LEGACY_CAMPAIGN_ASSETS,
  PLAYBOOK_VIDEO_LABEL,
  choosePlaybookSend,
  applyPlaybookStatus,
  commitPlaybookSave,
  fulfillmentObligation,
  pinDecision,
  playbookReadiness,
  recoverPlaybookAcceptance,
  resolvePinnedOrLegacy,
  reviewPlaybookDraft,
  unavailableCampaign,
  unpinnedCampaignSource,
  type PlaybookDraft,
  type PlaybookVersion,
} from "@/lib/acquisition/playbook";

const VIDEO = "11111111-1111-4111-8111-111111111111";
const LEGACY_ACTION = "b9a4a51a-f03e-4522-8af0-34491856b690";

function draft(overrides: Partial<PlaybookDraft> = {}): PlaybookDraft {
  return {
    campaignId: "camp-coaches",
    name: "Coach guide",
    audience: "Basketball coaches",
    offerLabel: "Team guide",
    offerKey: null,
    resources: ["definite_dozen"],
    manualResource: null,
    personalVideoId: null,
    permittedActions: ["send_asset"],
    replyGuidance: null,
    fulfillment: "catalog",
    ...overrides,
  };
}

function version(overrides: Partial<PlaybookVersion> = {}): PlaybookVersion {
  const status = overrides.status ?? "current";
  return {
    id: "playbook-1",
    version: 1,
    schedulingOpen: status === "current" || status === "superseded",
    ...draft(),
    status,
    ...overrides,
  };
}

describe("campaign playbooks", () => {
  it("keeps the ten legacy PDF mappings when no playbook is pinned", () => {
    for (const [campaignId, asset] of Object.entries(LEGACY_CAMPAIGN_ASSETS)) {
      const resolved = resolvePinnedOrLegacy({
        pinned: null,
        videoReady: false,
        campaignValue: asset,
        offers: new Map(),
      });
      expect(resolved.source).toBe("legacy");
      expect(resolved.promise?.assets).toEqual([asset]);
      expect(campaignId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("sends the team guide for a basketball-coach playbook and not a video", () => {
    const resolved = resolvePinnedOrLegacy({ pinned: version(), videoReady: false, campaignValue: "playbook", offers: new Map() });
    expect(choosePlaybookSend(resolved, "Team guide")).toBe("send_asset");
    expect(choosePlaybookSend(resolved, PLAYBOOK_VIDEO_LABEL)).toBeNull();
    expect(resolved.promise?.assets).toEqual(["definite_dozen"]);
  });

  it("keeps an athletic-director PDF and video as separate accepts", () => {
    const resolved = resolvePinnedOrLegacy({
      pinned: version({
        id: "ad-1",
        audience: "Athletic directors",
        resources: ["definite_dozen", "definite_dozen_ad"],
        personalVideoId: VIDEO,
        permittedActions: ["send_asset", "send_video"],
        fulfillment: "catalog_and_video",
        offerLabel: "Director packet",
      }),
      videoReady: true,
      campaignValue: "definite_dozen",
      offers: new Map(),
    });
    expect(choosePlaybookSend(resolved, ACQUISITION_ASSET_FILES.definite_dozen_ad.label)).toBe("send_asset");
    expect(choosePlaybookSend(resolved, PLAYBOOK_VIDEO_LABEL)).toBe("send_video");
    expect(resolved.promise?.assets).toEqual(["definite_dozen", "definite_dozen_ad"]);
  });

  it("sends only the video for a video-only playbook", () => {
    const resolved = resolvePinnedOrLegacy({
      pinned: version({ resources: [], personalVideoId: VIDEO, permittedActions: ["send_video"], fulfillment: "video", offerLabel: null }),
      videoReady: true,
      campaignValue: null,
      offers: new Map(),
    });
    expect(choosePlaybookSend(resolved, PLAYBOOK_VIDEO_LABEL)).toBe("send_video");
    expect(resolved.promise).toBeNull();
  });

  it("records a campaign with no asset and does not send", () => {
    const reviewed = reviewPlaybookDraft(draft({ resources: [], permittedActions: [], fulfillment: "none", offerLabel: null }));
    expect(reviewed.ok).toBe(true);
    const resolved = resolvePinnedOrLegacy({
      pinned: version({ resources: [], permittedActions: [], fulfillment: "none", offerLabel: null }),
      videoReady: false,
      campaignValue: "definite_dozen",
      offers: new Map(),
    });
    expect(resolved.source).toBe("playbook");
    expect(choosePlaybookSend(resolved, "Team guide")).toBeNull();
  });

  it("records a Leadership Kit without authorizing a shipment", () => {
    const kit = version({
      fulfillment: "manual",
      resources: [],
      permittedActions: [],
      manualResource: "Physical Pat Summitt Leadership Kit. Fulfillment is separate.",
      offerLabel: "Leadership Kit",
    });
    const resolved = resolvePinnedOrLegacy({ pinned: kit, videoReady: true, campaignValue: null, offers: new Map() });
    expect(resolved.sendable).toBe(false);
    expect(choosePlaybookSend(resolved, "Leadership Kit")).toBeNull();
    const readiness = playbookReadiness({ draft: kit, status: "current", videoStatus: null, knowledgeCount: 1 });
    expect(readiness.fulfillmentCapable).toBe(false);
    expect(readiness.gaps.join(" ")).toMatch(/cannot be delivered automatically/);
  });

  it("does not give the Leadership Group the Leadership Kit", () => {
    const group = version({
      id: "group-1",
      campaignId: "camp-leadership-group",
      audience: "Pat Summitt Leadership Group",
      fulfillment: "none",
      resources: [],
      permittedActions: [],
      manualResource: null,
      offerLabel: null,
    });
    const resolved = resolvePinnedOrLegacy({ pinned: group, videoReady: false, campaignValue: null, offers: new Map() });
    expect(JSON.stringify(resolved)).not.toMatch(/leadership kit/i);
    const knowledge = prepareInterpreterKnowledge([
      {
        id: "kit",
        topic: "leadership_kit",
        statement: "The physical Leadership Kit is for one coach campaign.",
        category: "offer",
        scope: "campaign",
        campaignId: "camp-coaches",
        offerKey: null,
        status: "active",
        approvedAt: "2026-10-26T00:00:00.000Z",
        supersedesId: null,
      },
    ], { campaignId: "camp-leadership-group", offerKey: null });
    expect(knowledge.statements).toHaveLength(0);
  });

  it("makes no campaign promise for an unknown, paused, retired, or invalid-video campaign", () => {
    expect(resolvePinnedOrLegacy({ pinned: null, videoReady: false, campaignValue: null, offers: new Map() }).promise).toBeNull();
    for (const status of ["paused", "retired"] as const) {
      const resolved = resolvePinnedOrLegacy({
        pinned: version({ status }),
        videoReady: true,
        campaignValue: "definite_dozen",
        offers: new Map(),
      });
      expect(resolved.sendable).toBe(false);
      expect(resolved.useCampaignKnowledge).toBe(false);
    }
    const invalid = resolvePinnedOrLegacy({
      pinned: version({ personalVideoId: VIDEO, permittedActions: ["send_video"], fulfillment: "video", resources: [] }),
      videoReady: false,
      campaignValue: null,
      offers: new Map(),
    });
    expect(invalid.sendable).toBe(false);
    expect(playbookReadiness({
      draft: draft({ personalVideoId: VIDEO, permittedActions: ["send_video"], fulfillment: "video", resources: [] }),
      status: "current",
      videoStatus: "missing",
      knowledgeCount: 0,
    }).gaps.join(" ")).toMatch(/does not exist/);
  });

  it("keeps the original version after the current playbook changes", () => {
    const first = version({ id: "v1", version: 1, status: "superseded", resources: ["definite_dozen"], offerLabel: "Team guide" });
    const resolved = resolvePinnedOrLegacy({
      pinned: first,
      videoReady: false,
      campaignValue: "playbook",
      offers: new Map(),
    });
    expect(resolved.playbookId).toBe("v1");
    expect(resolved.promise?.assets).toEqual(["definite_dozen"]);
  });

  it("pins a playbook only when the journey is first created", () => {
    expect(pinDecision({ event: "inserted", latestPlaybookId: "v1" })).toBe("v1");
    expect(pinDecision({ event: "duplicate", latestPlaybookId: "v2" })).toBeNull();
    expect(pinDecision({ event: "inserted", latestPlaybookId: null })).toBeNull();
  });

  it("recovers one permitted accept after an interrupted effect and does not guess between a PDF and a video", () => {
    const pdf = resolvePinnedOrLegacy({ pinned: version(), videoReady: false, campaignValue: null, offers: new Map() });
    expect(recoverPlaybookAcceptance(pdf, "accept_offer", null)).toBe("Team guide");
    const both = resolvePinnedOrLegacy({
      pinned: version({ resources: ["definite_dozen_ad"], personalVideoId: VIDEO, permittedActions: ["send_asset", "send_video"], fulfillment: "catalog_and_video" }),
      videoReady: true,
      campaignValue: null,
      offers: new Map(),
    });
    expect(recoverPlaybookAcceptance(both, "accept_offer", null)).toBeNull();
    expect(recoverPlaybookAcceptance(both, "accept_offer", PLAYBOOK_VIDEO_LABEL)).toBe(PLAYBOOK_VIDEO_LABEL);
  });

  it("leaves unsubscribe global and does not follow a playbook send with another action", () => {
    expect(decideConversationEffect({
      outcome: "unsubscribe",
      journeyId: "journey-1",
      hasPromise: true,
      stopped: false,
      suppressed: false,
    }).type).toBe("global_unsubscribe");
    expect(choosePlaybookSend(
      resolvePinnedOrLegacy({ pinned: version(), videoReady: true, campaignValue: null, offers: new Map() }),
      "Team guide",
    )).toBe("send_asset");
  });

  it("shows Instantly sequence stop as unverified and leaves attribution unavailable", () => {
    const readiness = playbookReadiness({ draft: draft(), status: "current", videoStatus: null, knowledgeCount: 0 });
    expect(readiness.instantlySequenceStop).toBe("unverified");
    expect(readiness.attribution).toBe("unavailable");
    expect(readiness.independentJourneys).toBe("unavailable");
    expect(readiness.ready).toBe(true);
  });

  it("keeps a failed or concurrent save from dropping or duplicating the open version", () => {
    const current = version({ id: "v1", version: 1 });
    const failed = commitPlaybookSave({
      versions: [current],
      draft: draft({ name: "Replacement" }),
      newId: "v2",
      persist: "failed",
    });
    expect(failed).toEqual([current]);
    const paused = version({ id: "v1", version: 1, status: "paused", schedulingOpen: false });
    const first = commitPlaybookSave({ versions: [paused], draft: draft({ name: "Next" }), newId: "v2", persist: "committed" });
    const raced = commitPlaybookSave({
      versions: first,
      draft: draft({ name: "Later", resources: ["playbook"], offerLabel: "Playbook" }),
      newId: "v3",
      persist: "committed",
    });
    expect(raced.filter((item) => item.status === "current" || item.status === "paused")).toHaveLength(1);
    expect(raced.find((item) => item.id === "v1")).toMatchObject({ status: "superseded", schedulingOpen: false, resources: ["definite_dozen"] });
    expect(raced.find((item) => item.id === "v3")).toMatchObject({ status: "paused", schedulingOpen: false });
  });

  it("does not reopen scheduling when a closed playbook is edited", () => {
    const created = commitPlaybookSave({ versions: [], draft: draft(), newId: "v1", persist: "committed" });
    expect(created).toMatchObject([{ id: "v1", status: "current", schedulingOpen: true }]);
    const edited = commitPlaybookSave({
      versions: created,
      draft: draft({ name: "Coach guide revised", resources: ["playbook"] }),
      newId: "v2",
      persist: "committed",
    });
    expect(edited.find((item) => item.id === "v1")).toMatchObject({ status: "superseded", schedulingOpen: true, resources: ["definite_dozen"] });
    expect(edited.find((item) => item.id === "v2")).toMatchObject({ status: "current", schedulingOpen: true, resources: ["playbook"] });

    const paused = applyPlaybookStatus(edited, "pause");
    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    expect(paused.versions.find((item) => item.id === "v1")?.schedulingOpen).toBe(true);
    expect(paused.versions.find((item) => item.id === "v2")).toMatchObject({ status: "paused", schedulingOpen: false });
    const pausedEdit = commitPlaybookSave({ versions: paused.versions, draft: draft({ name: "Still paused" }), newId: "v3", persist: "committed" });
    expect(pausedEdit.find((item) => item.id === "v1")).toMatchObject({ status: "superseded", schedulingOpen: true, resources: ["definite_dozen"] });
    expect(pausedEdit.find((item) => item.id === "v2")).toMatchObject({ status: "superseded", schedulingOpen: false });
    expect(pausedEdit.find((item) => item.id === "v3")).toMatchObject({ status: "paused", schedulingOpen: false });
    expect(pausedEdit.some((item) => item.status === "current")).toBe(false);

    const retired = applyPlaybookStatus([version({ id: "old", version: 1, status: "retired", schedulingOpen: false, resources: ["definite_dozen"] })], "retire");
    expect(retired.ok).toBe(false);
    const retiredEdit = commitPlaybookSave({
      versions: [version({ id: "old", version: 1, status: "retired", schedulingOpen: false, resources: ["definite_dozen"] })],
      draft: draft({ name: "Retired edit", resources: ["playbook"] }),
      newId: "new",
      persist: "committed",
    });
    expect(retiredEdit.find((item) => item.id === "old")).toMatchObject({ status: "retired", schedulingOpen: false, resources: ["definite_dozen"] });
    expect(retiredEdit.find((item) => item.id === "new")).toMatchObject({ status: "retired", schedulingOpen: false });

    const closedHistory = commitPlaybookSave({
      versions: [version({ id: "closed", version: 2, status: "superseded", schedulingOpen: false })],
      draft: draft({ name: "After a closed version" }),
      newId: "next",
      persist: "committed",
    });
    expect(closedHistory.find((item) => item.id === "next")).toMatchObject({ status: "paused", schedulingOpen: false });

    const resumed = applyPlaybookStatus(pausedEdit, "resume");
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.versions.find((item) => item.id === "v2")).toMatchObject({ status: "superseded", schedulingOpen: false });
    expect(resumed.versions.find((item) => item.id === "v3")).toMatchObject({ status: "current", schedulingOpen: true });
    const afterResume = commitPlaybookSave({
      versions: resumed.versions,
      draft: draft({ name: "After resume" }),
      newId: "v4",
      persist: "committed",
    });
    expect(afterResume.find((item) => item.id === "v3")).toMatchObject({ status: "superseded", schedulingOpen: true });
    expect(afterResume.find((item) => item.id === "v4")).toMatchObject({ status: "current", schedulingOpen: true });
    expect(applyPlaybookStatus(created, "resume").ok).toBe(false);
  });

  it("keeps an accepted obligation through pause and stops a retired campaign from starting one", () => {
    const paused = resolvePinnedOrLegacy({
      pinned: version({ status: "paused", schedulingOpen: false }),
      videoReady: true,
      campaignValue: "playbook",
      offers: new Map(),
    });
    expect(choosePlaybookSend(paused, "Team guide", "new")).toBeNull();
    expect(choosePlaybookSend(paused, "Team guide", "established")).toBe("send_asset");
    expect(paused.obligationPromise?.assets).toEqual(["definite_dozen"]);
    expect(paused.deliveryVideoId).toBeNull();
    const retired = resolvePinnedOrLegacy({
      pinned: version({ status: "retired", schedulingOpen: false, personalVideoId: VIDEO, permittedActions: ["send_asset", "send_video"], fulfillment: "catalog_and_video" }),
      videoReady: true,
      campaignValue: "definite_dozen",
      offers: new Map(),
    });
    expect(choosePlaybookSend(retired, "Team guide", "established")).toBeNull();
    expect(retired.deliveryVideoId).toBe(VIDEO);
    expect(retired.promise).toBeNull();
    expect(fulfillmentObligation({ stage: "scheduled", campaignStatus: "paused", schedulingOpen: false, suppressed: false })).toBe("send");
    expect(fulfillmentObligation({ stage: "claimed", campaignStatus: "retired", schedulingOpen: false, suppressed: false })).toBe("send");
    expect(fulfillmentObligation({ stage: "provider_accepted", campaignStatus: "paused", schedulingOpen: false, suppressed: false })).toBe("keep");
    expect(fulfillmentObligation({ stage: "requested", campaignStatus: "retired", schedulingOpen: false, suppressed: false })).toBe("hold");
    expect(fulfillmentObligation({ stage: "scheduled", campaignStatus: "paused", schedulingOpen: false, suppressed: true })).toBe("stop");
  });

  it("does not use a legacy PDF when the playbook read fails or the campaign is unknown", () => {
    expect(unavailableCampaign().promise).toBeNull();
    expect(unavailableCampaign().labels).toEqual([]);
    expect(resolvePinnedOrLegacy({ pinned: null, videoReady: false, campaignValue: null, offers: new Map() }).promise).toBeNull();
    expect(unpinnedCampaignSource({
      playbooksPresent: true,
      journeyCreatedAt: "2026-10-26T12:00:00.000Z",
      playbookCreatedAt: "2026-10-26T11:00:00.000Z",
    })).toBe("unavailable");
    expect(unpinnedCampaignSource({
      playbooksPresent: true,
      journeyCreatedAt: "2026-10-20T12:00:00.000Z",
      playbookCreatedAt: "2026-10-26T11:00:00.000Z",
    })).toBe("legacy");
    expect(reviewPlaybookDraft(draft({ replyGuidance: "Shipping is free and the price is $19." })).ok).toBe(false);
  });

  it("does not rewrite settings, the accepted PDF action, or an existing journey row", () => {
    const migration = readFileSync("supabase/migrations/20261026180000_acquisition_campaign_playbooks.sql", "utf8");
    const server = readFileSync("src/lib/acquisition/playbook.server.ts", "utf8");
    const route = readFileSync("src/app/api/admin/acquisition/campaign-playbooks/route.ts", "utf8");
    expect(migration).not.toContain(LEGACY_ACTION);
    expect(migration).not.toContain("acquisition_settings");
    expect(migration).not.toContain("UPDATE public.acquisition_actions");
    expect(migration).not.toContain("UPDATE public.acquisition_journeys");
    expect(server).not.toContain("acquisition_settings");
    expect(server).not.toContain(LEGACY_ACTION);
    const handler = route.slice(route.indexOf("export async function GET"));
    expect(handler.indexOf("isTylerOwnerSession")).toBeLessThan(handler.indexOf("listCampaignPlaybooks"));
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    expect(store).toContain("pinJourneyPlaybook");
    expect(store).toContain("followUp === \"legacy\" && effect.settle.schedule");
    expect(store).toContain("acquisition:${personId}:${journeyId}:${action}");
    expect(store).not.toContain(LEGACY_ACTION);
    const saveFn = migration.slice(migration.indexOf("CREATE FUNCTION public.acquisition_save_campaign_playbook"));
    const supersede = saveFn.slice(saveFn.indexOf("UPDATE"), saveFn.indexOf("INSERT"));
    expect(migration).toContain("scheduling_open BOOLEAN NOT NULL DEFAULT false");
    expect(saveFn).toContain("pg_advisory_xact_lock");
    expect(saveFn).toContain("v_new_status, v_new_open");
    expect(saveFn).not.toContain("'current', true");
    expect(supersede).toContain("status = 'superseded'");
    expect(supersede).not.toContain("scheduling_open");
    expect(server).not.toContain("status: \"superseded\"");
    expect(server).toContain("Only a paused or retired playbook can be resumed.");
  });
});
