import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  foldSkipKinds,
  gateInstantlyLead,
  membershipMapOrUnverified,
} from "@/lib/acquisition/audience-clearance";
import { instantlyVerificationClearance } from "@/lib/acquisition/instantly";
import { readInstantlyLead } from "@/lib/acquisition/instantly-existing-leads";
import { decideLead, type LeadFacts } from "@/lib/acquisition/video-first-prep";

const LEAD = "01a1884a-39ec-7de1-b365-2a2c9aa0cd9d";

function facts(patch: Partial<LeadFacts> = {}): LeadFacts {
  return {
    lifecycle: null,
    stripeSubscriptionId: null,
    suppressed: false,
    outstandingFulfillment: false,
    openVideoElsewhere: false,
    openVideoOnSource: null,
    sourceAmbiguous: false,
    membership: "clear",
    verification: "verified",
    openOnThisCampaign: null,
    ...patch,
  };
}

describe("audience clearance", () => {
  it("maps Instantly verification statuses and refuses unverified imports", () => {
    expect(instantlyVerificationClearance(1)).toBe("verified");
    expect(instantlyVerificationClearance(-1)).toBe("exclude");
    expect(instantlyVerificationClearance(-2)).toBe("exclude");
    expect(instantlyVerificationClearance(-3)).toBe("exclude");
    expect(instantlyVerificationClearance(-4)).toBe("exclude");
    expect(instantlyVerificationClearance(0)).toBe("unverified");
    expect(instantlyVerificationClearance(11)).toBe("unverified");
    expect(instantlyVerificationClearance(12)).toBe("unverified");
    expect(instantlyVerificationClearance(null)).toBe("unverified");
    const verified = readInstantlyLead({
      id: LEAD,
      email: "coach@school.edu",
      campaign: "source-1",
      status: 1,
      verification_status: 1,
      payload: { firstName: "Pat", lastName: "Summitt" },
    });
    expect(verified?.verification).toBe("verified");
    expect(gateInstantlyLead(verified!, "source-1").ok).toBe(true);
    const invalid = readInstantlyLead({
      id: LEAD,
      email: "bad@school.edu",
      campaign: "source-1",
      status: 1,
      verification_status: -1,
      payload: {},
    });
    expect(gateInstantlyLead(invalid!, "source-1")).toMatchObject({ ok: false, kind: "excluded" });
    const pending = readInstantlyLead({
      id: LEAD,
      email: "pending@school.edu",
      campaign: "source-1",
      status: 1,
      verification_status: 11,
      payload: {},
    });
    expect(gateInstantlyLead(pending!, "source-1")).toMatchObject({ ok: false, kind: "unverified" });
    expect(gateInstantlyLead(verified!, "other").kind).toBe("excluded");
  });

  it("excludes bounced, unsubscribed, members, held fulfillment, and launch overlaps", () => {
    const bounced = readInstantlyLead({
      id: LEAD,
      email: "bounce@school.edu",
      campaign: "source-1",
      status: -1,
      verification_status: 1,
      payload: {},
    });
    expect(gateInstantlyLead(bounced!, "source-1").kind).toBe("excluded");
    expect(decideLead(facts({ membership: "member" })).kind).toBe("excluded");
    expect(decideLead(facts({ membership: "unverified" })).kind).toBe("unverified");
    expect(decideLead(facts({ outstandingFulfillment: true })).kind).toBe("excluded");
    expect(decideLead(facts({ openVideoElsewhere: true })).reason).toMatch(/another campaign/);
    expect(decideLead(facts({
      openVideoOnSource: { journeyId: "old-video", sameVideo: true },
    }))).toEqual({ outcome: "boundary", previousJourneyId: "old-video" });
    expect(decideLead(facts({
      openOnThisCampaign: { journeyId: "launch-j", videoFirst: true, sameVideo: true, ambiguous: false },
      openVideoOnSource: { journeyId: "old-video", sameVideo: true },
    }))).toEqual({ outcome: "reuse", journeyId: "launch-j" });
  });

  it("marks a missing membership map as unverified instead of cleared", () => {
    const map = membershipMapOrUnverified(["a@school.edu", "b@school.edu"], null);
    expect(map.get("a@school.edu")).toBe("unverified");
    expect(map.get("b@school.edu")).toBe("unverified");
    expect(foldSkipKinds([
      { kind: "excluded" },
      { kind: "unverified" },
      { kind: "unverified" },
      {},
    ])).toEqual({ excluded: 2, unverified: 2 });
  });

  it("keeps attribution on source migration and does not send, activate, or release held PDFs", () => {
    const server = readFileSync(new URL("./audience-clearance.server.ts", import.meta.url), "utf8");
    const membership = readFileSync(new URL("./audience-membership.server.ts", import.meta.url), "utf8");
    const issuer = readFileSync(new URL("./video-first-leads.server.ts", import.meta.url), "utf8");
    const route = readFileSync(new URL("../../app/api/admin/acquisition/audience-clearance/route.ts", import.meta.url), "utf8");
    const panel = readFileSync(new URL("../../app/admin/distribution/campaign-playbooks/video-first-lead-panel.tsx", import.meta.url), "utf8");
    expect(server).toContain("sourceCampaignId");
    expect(server).toContain("issueVideoFirstLinks");
    expect(server).toContain("liveMembershipByEmail");
    expect(server).toContain("import_csv");
    expect(server).not.toMatch(/activate|emails\/reply|automation_status|conversation_sending|method:\s*"DELETE"|fulfillment_status/);
    expect(issuer).toContain("openVideoOnSource");
    expect(issuer).toContain("sourceCampaignId");
    expect(issuer).toContain("closed_at");
    expect(issuer).not.toMatch(/\.update\(\{[^}]*source_campaign/);
    expect(membership).toContain("listClerkUsersByIds");
    expect(membership).toContain("listClerkUsersByEmail");
    expect(membership).toContain("clerkUserSummittSubscribed");
    expect(route).toContain("isTylerOwnerSession");
    expect(route).toContain("maxDuration = 300");
    expect(panel).toContain("Check and Prepare Audience");
    expect(panel).toContain("/api/admin/acquisition/audience-clearance");
    expect(panel).toContain("Source audience");
  });
});
