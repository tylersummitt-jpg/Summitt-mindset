import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  copiedPlaybookTarget,
  filterCampaigns,
  launchChecklist,
  organizeCampaigns,
  postReplyLabel,
  type CatalogCampaign,
  type LaunchDraft,
} from "@/lib/acquisition/campaign-catalog";
import { listInstantlyCampaignProfiles } from "@/lib/acquisition/instantly-analytics.server";
import { reviewPlaybookDraft, type PlaybookDraft } from "@/lib/acquisition/playbook";

const LABELS = {
  definite_dozen: "Pat Summitt Definite Dozen team discussion guide",
  playbook: "Pat Summitt basketball special-situations playbook",
};

function draft(audience: string, campaignId: string): PlaybookDraft {
  return {
    campaignId,
    name: "Leadership discussion",
    audience,
    offerLabel: "Leadership discussion guide",
    offerKey: null,
    resources: ["definite_dozen"],
    manualResource: null,
    personalVideoId: null,
    permittedActions: ["send_asset"],
    replyGuidance: "Answer the question they asked.",
    fulfillment: "catalog",
  };
}

function rows(count: number): CatalogCampaign[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `campaign-${String(index).padStart(4, "0")}`,
    name: index % 2 === 0 ? `Audience ${index}` : null,
    instantlyStatus: "Unavailable",
    instantlyFilter: "unavailable",
    playbookStatus: "none",
    playbookVersion: null,
    audience: null,
    offerLabel: null,
    resources: [],
    legacyResource: null,
    automation: "not_activated",
    activatedAt: null,
    lastActivatedAt: null,
    outstanding: 0,
    lastActivity: null,
    activity: "unavailable",
  }));
}

describe("campaign catalog", () => {
  it("pages 100 and 1,000 campaigns without dropping the last page", () => {
    for (const count of [100, 1000]) {
      const page = filterCampaigns(rows(count), {
        query: "",
        instantly: "all",
        playbook: "all",
        automation: "all",
        page: Math.ceil(count / 25),
        pageSize: 25,
      });
      expect(page.total).toBe(count);
      expect(page.pages).toBe(count / 25);
      expect(page.rows).toHaveLength(25);
      expect(page.rows.at(-1)?.id).toBe(`campaign-${String(count - 1).padStart(4, "0")}`);
    }
  });

  it("accepts a corporate audience and copies configuration onto a different campaign", () => {
    for (const audience of ["Corporate leaders", "HR professionals"]) {
      const reviewed = reviewPlaybookDraft(draft(audience, "corporate-leadership-1"));
      expect(reviewed.ok).toBe(true);
      if (reviewed.ok) expect(reviewed.draft.audience).toBe(audience);
    }
    const same = copiedPlaybookTarget("corporate-leadership-1", "corporate-leadership-1");
    expect(same.ok).toBe(false);
    const copied = copiedPlaybookTarget("corporate-leadership-1", "school-leaders-2");
    expect(copied).toEqual({ ok: true, campaignId: "school-leaders-2" });
  });

  it("keeps a missing Instantly name and status unavailable", async () => {
    const source = readFileSync("src/lib/acquisition/instantly-analytics.server.ts", "utf8");
    const catalog = source.slice(source.indexOf("export async function listInstantlyCampaignProfiles"));
    expect(catalog.indexOf("missing_api_key")).toBeLessThan(catalog.indexOf("listPages"));
    if (!process.env.INSTANTLY_API_KEY?.trim()) {
      await expect(listInstantlyCampaignProfiles()).resolves.toEqual({
        credential: "missing",
        profiles: null,
        truncated: false,
        error: "missing_api_key",
      });
    }
    const organized = organizeCampaigns({
      instantly: [{ id: "school-leaders-2", name: null, statusLabel: "Unknown", statusFilter: "unknown" }],
      playbooks: [{
        campaignId: "corporate-leadership-1",
        version: 1,
        status: "current",
        audience: "Corporate leaders",
        offerLabel: "Leadership discussion guide",
        resources: ["definite_dozen"],
      }],
      activations: [{ id: "corporate-leadership-1", state: "inactive", activatedAt: null, lastActivatedAt: null }],
      legacyAssets: { "364dad9d-cbb5-4d33-b4d5-0ac083f0ebe5": "playbook" },
      resourceLabelsByKey: LABELS,
      fulfillmentCounts: { "364dad9d-cbb5-4d33-b4d5-0ac083f0ebe5": 2 },
      activity: null,
    });
    expect(organized.instantly).toBe("ready");
    const school = organized.campaigns.find((row) => row.id === "school-leaders-2");
    const corporate = organized.campaigns.find((row) => row.id === "corporate-leadership-1");
    const legacy = organized.campaigns.find((row) => row.id === "364dad9d-cbb5-4d33-b4d5-0ac083f0ebe5");
    expect(school?.name).toBeNull();
    expect(school?.instantlyStatus).toBe("Unknown");
    expect(corporate?.audience).toBe("Corporate leaders");
    expect(corporate?.automation).toBe("inactive");
    expect(corporate?.resources).toEqual([LABELS.definite_dozen]);
    expect(legacy?.legacyResource).toBe(LABELS.playbook);
    expect(legacy?.outstanding).toBe(2);
    expect(legacy?.name).toBeNull();
    expect(legacy?.instantlyStatus).toBe("Not returned by Instantly");
    const unavailable = organizeCampaigns({
      instantly: null,
      playbooks: [],
      activations: null,
      legacyAssets: { "364dad9d-cbb5-4d33-b4d5-0ac083f0ebe5": "playbook" },
      resourceLabelsByKey: LABELS,
      fulfillmentCounts: {},
      activity: new Map(),
    });
    expect(unavailable.instantly).toBe("unavailable");
    expect(unavailable.campaigns[0]?.name).toBeNull();
    expect(unavailable.campaigns[0]?.instantlyStatus).toBe("Unavailable");
    expect(unavailable.campaigns[0]?.automation).toBe("unavailable");
    expect(unavailable.campaigns[0]?.activity).toBe("not_in_window");
  });

  it("uses one checklist for every audience and does not call held mail ready to send", () => {
    const gates = { automation: "off", interpretation: "pilot", sending: "off", blocklist: "on" };
    const setup: LaunchDraft = {
      audience: "",
      offerLabel: "Leadership discussion guide",
      resources: ["definite_dozen"],
      personalVideoId: "",
      manualResource: "",
      replyGuidance: "Answer the question they asked.",
      fulfillment: "catalog",
      permittedActions: ["send_asset"],
    };
    const marks = ["Basketball coaches", "Athletic directors", "Corporate leaders", "HR professionals", "Pat Summitt Leadership Group contacts"].map((audience) => (
      launchChecklist({
        campaign: {
          id: "campaign-7",
          name: "Campaign 7",
          playbookStatus: "current",
          automation: "active",
          instantlyStatus: "Active",
        },
        instantly: "ready",
        copySource: null,
        draft: { ...setup, audience },
        gates,
      }).steps.map((step) => step.mark)
    ));
    expect(new Set(marks.map((row) => row.join(",")))).toEqual(new Set(["done,done,done,unverified,held"]));
    const checklist = launchChecklist({
      campaign: {
        id: "campaign-7",
        name: "Campaign 7",
        playbookStatus: "current",
        automation: "active",
        instantlyStatus: "Active",
      },
      instantly: "ready",
      copySource: null,
      draft: { ...setup, audience: "Corporate leaders" },
      gates,
    });
    expect(checklist.steps[3]?.mark).toBe("unverified");
    expect(checklist.steps[4]?.detail).toContain("Mail stays held");
    expect(checklist.next).toContain("Mail stays held");
    expect(postReplyLabel({ automation: "active", gates })).toBe("On for this campaign. Account-wide switches are holding mail.");
    expect(postReplyLabel({ automation: "active", gates: { automation: "pilot", sending: "on" } })).toBe(
      "On for this campaign. Mail can send after this campaign's activation time.",
    );
    const blank = launchChecklist({
      campaign: null,
      instantly: "unavailable",
      copySource: null,
      draft: { ...setup, audience: "", replyGuidance: "" },
      gates,
    });
    expect(blank.steps[0]?.detail).toContain("Instantly names are unavailable");
    expect(blank.steps[2]?.mark).not.toBe("done");
    expect(blank.next).toContain("Instantly names are unavailable");
    const noGuidance = launchChecklist({
      campaign: {
        id: "campaign-7",
        name: "Campaign 7",
        playbookStatus: "current",
        automation: "not_activated",
        instantlyStatus: "Active",
      },
      instantly: "ready",
      copySource: null,
      draft: { ...setup, audience: "HR professionals", replyGuidance: "" },
      gates,
    });
    expect(noGuidance.steps[2]?.mark).toBe("needs_you");
    expect(noGuidance.steps[2]?.detail).toContain("Guidance is blank");
    expect(noGuidance.steps.every((step) => step.mark !== "done" || step.step !== 4)).toBe(true);
  });
});
