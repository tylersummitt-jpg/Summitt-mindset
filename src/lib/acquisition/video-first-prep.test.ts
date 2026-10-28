import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { choosePlaybookSend, resolvePinnedOrLegacy, reviewPlaybookDraft, type PlaybookDraft } from "@/lib/acquisition/playbook";
import {
  decideLead,
  instantlyLeadCsv,
  isVideoFirstPlaybook,
  parseProspectList,
  recipientVideoUrl,
  type LeadFacts,
} from "@/lib/acquisition/video-first-prep";

const VIDEO = "11111111-1111-4111-8111-111111111111";

function facts(patch: Partial<LeadFacts> = {}): LeadFacts {
  return {
    lifecycle: null,
    stripeSubscriptionId: null,
    suppressed: false,
    outstandingFulfillment: false,
    openVideoElsewhere: false,
    openOnThisCampaign: null,
    ...patch,
  };
}

describe("video-first lead preparation", () => {
  it("accepts a saved video with no automatic send and rejects a playbook that would send", () => {
    expect(isVideoFirstPlaybook({
      id: "pb",
      status: "current",
      personalVideoId: VIDEO,
      permittedActions: [],
      fulfillment: "none",
    }, VIDEO)).toBe(true);
    expect(isVideoFirstPlaybook({
      id: "pb",
      status: "current",
      personalVideoId: VIDEO,
      permittedActions: ["send_video"],
      fulfillment: "video",
    }, VIDEO)).toBe(false);
    const draft: PlaybookDraft = {
      campaignId: "camp",
      name: "Coaches",
      audience: "Head coaches",
      offerLabel: null,
      offerKey: null,
      resources: [],
      manualResource: null,
      personalVideoId: VIDEO,
      permittedActions: [],
      replyGuidance: null,
      fulfillment: "none",
    };
    const reviewed = reviewPlaybookDraft(draft);
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;
    const resolved = resolvePinnedOrLegacy({
      pinned: { ...reviewed.draft, id: "pb", version: 1, status: "current", schedulingOpen: true },
      videoReady: true,
      campaignValue: null,
      offers: new Map(),
    });
    expect(choosePlaybookSend(resolved, "A personal video from Tyler Summitt")).toBeNull();
  });

  it("prepares one row per address and keeps a second campaign on the same person as a separate decision", () => {
    const parsed = parseProspectList("one@school.edu, Pat, Coach\none@school.edu\nbad\nemail,first,last");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.leads).toEqual([{ email: "one@school.edu", firstName: "Pat", lastName: "Coach" }]);
    expect(parsed.invalid).toBe(1);
    expect(decideLead(facts({ lifecycle: "asset_sent" }))).toEqual({ outcome: "create" });
    expect(decideLead(facts({
      lifecycle: "warm_video_sent",
      openOnThisCampaign: { journeyId: "j1", videoFirst: true, sameVideo: true, ambiguous: false },
    }))).toEqual({ outcome: "reuse", journeyId: "j1" });
    expect(decideLead(facts({
      lifecycle: "asset_sent",
      openOnThisCampaign: { journeyId: "old", videoFirst: false, sameVideo: false, ambiguous: false },
    }))).toEqual({ outcome: "boundary", previousJourneyId: "old" });
    expect(decideLead(facts({ openVideoElsewhere: true })).outcome).toBe("skip");
    expect(decideLead(facts({ lifecycle: "paid_member" })).reason).toMatch(/paid/);
    expect(decideLead(facts({ lifecycle: "trial_started" })).reason).toMatch(/trial/);
    expect(decideLead(facts({ lifecycle: "not_interested" }))).toEqual({ outcome: "create" });
    expect(decideLead(facts({ suppressed: true })).outcome).toBe("skip");
    expect(decideLead(facts({ outstandingFulfillment: true })).reason).toMatch(/scheduled or claimed/);
    const csv = instantlyLeadCsv([{ email: "one@school.edu", firstName: "Pat", lastName: null, videoUrl: recipientVideoUrl("tok", "signed") }]);
    expect(csv).toContain("video_url");
    expect(csv).toContain("https://summittmindset.com/for/tok?aj=signed");
    expect(csv).not.toContain("camp");
  });

  it("does not upload, send, or rewrite fulfillment from the preparation path", () => {
    const source = readFileSync(new URL("./video-first-leads.server.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/automation_status|conversation_sending|emails\.send|api\.instantly\.ai/);
    expect(source).not.toMatch(/from\("acquisition_actions"\)[\s\S]{0,80}\.(update|delete)/);
    expect(source).toContain(".update({ closed_at:");
    expect(source).not.toMatch(/from\("acquisition_journeys"\)\s*\.update\(\{[^}]*lifecycle_state/);
  });
});
