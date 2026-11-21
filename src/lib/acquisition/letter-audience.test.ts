import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { InstantlyLeadSnapshot } from "@/lib/acquisition/backfill";
import { freePdfCoachKitHref } from "@/lib/free-pdf";
import {
  acquisitionCampaignPlaybookUrl,
  readSignedAcquisitionCampaignId,
  signAcquisitionCampaignId,
} from "@/lib/acquisition/email-acquired-member-notice";
import {
  campaignHistoryContact,
  emailsWithClearHistory,
  reviewLetterAudience,
  splitLetterAudience,
  type LetterLocalFacts,
} from "@/lib/acquisition/letter-audience";

const SECRET = "test-secret-at-least-16";
const PAT = "3d63c904-1c4f-4bd2-bc95-52f9a996318d";
const TRY = "5c066c5d-733d-4003-928e-c6c38fe94abc";
const SOURCE = "source-basketball";

function lead(patch: Partial<InstantlyLeadSnapshot> & Pick<InstantlyLeadSnapshot, "id" | "email">): InstantlyLeadSnapshot {
  return {
    firstName: "Pat",
    lastName: "Summitt",
    jobTitle: "Head Coach",
    campaignId: SOURCE,
    status: 1,
    interest: null,
    sport: "basketball",
    geography: "Tennessee",
    asset: null,
    sent: false,
    replied: false,
    replyCountKnown: true,
    noReplyProven: true,
    interestLabel: null,
    leadStatus: "active",
    evidenceAt: null,
    evidenceMs: null,
    ...patch,
  };
}

function clearLocal(): LetterLocalFacts {
  return {
    lifecycle: null,
    suppressed: false,
    outstandingFulfillment: false,
    hasJourney: false,
    recordedOutreach: false,
    membership: "clear",
  };
}

describe("personal letter audience", () => {
  it("keeps a never-contacted coach eligible and refuses contacted, former members, and unknown history", () => {
    const leads = [
      lead({ id: "new", email: "new@school.edu" }),
      lead({ id: "sent-source", email: "sent@school.edu", sent: true }),
      lead({ id: "other", email: "cross@school.edu", campaignId: "other-campaign", sent: true }),
      lead({ id: "cross-source", email: "cross@school.edu" }),
      lead({ id: "odd", email: "odd@school.edu", leadStatus: "completed", sent: false }),
    ];
    expect(campaignHistoryContact([leads[0]!], SOURCE)).toBe("never");
    expect(campaignHistoryContact([leads[3]!, leads[2]!], SOURCE)).toBe("contacted");
    expect(campaignHistoryContact([
      lead({ id: "waiting", email: "waiting@school.edu" }),
      lead({ id: "waiting-other", email: "waiting@school.edu", campaignId: "other-campaign", sent: false }),
    ], SOURCE)).toBe("contacted");
    expect(emailsWithClearHistory(SOURCE, leads)).toEqual(["new@school.edu"]);
    const local = new Map<string, LetterLocalFacts>([
      ["new@school.edu", clearLocal()],
      ["former@school.edu", { ...clearLocal(), lifecycle: "trial_expired" }],
    ]);
    const reviewed = reviewLetterAudience({
      sourceCampaignId: SOURCE,
      leads: [...leads, lead({ id: "former", email: "former@school.edu" })],
      localByEmail: local,
    });
    expect(reviewed.eligible.map((row) => row.email)).toEqual(["new@school.edu"]);
    expect(reviewed.skips).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: "sent@school.edu", kind: "excluded" }),
      expect.objectContaining({ email: "cross@school.edu", kind: "excluded" }),
      expect.objectContaining({ email: "odd@school.edu", kind: "unverified" }),
      expect.objectContaining({ email: "former@school.edu", kind: "excluded" }),
    ]));
    const missing = reviewLetterAudience({ sourceCampaignId: SOURCE, leads, localByEmail: null });
    expect(missing.eligible).toEqual([]);
    expect(missing.skips.some((skip) => skip.email === "new@school.edu" && skip.kind === "unverified")).toBe(true);
  });

  it("splits the same cleared list into stable nonoverlapping groups", () => {
    const leads = ["a", "b", "c", "d"].map((name, index) => ({
      email: `${name}@school.edu`,
      firstName: name,
      lastName: "Coach",
      state: index % 2 === 0 ? "tennessee" : "georgia",
      role: index < 2 ? "head" : "assistant",
      level: "high",
      provider: "edu",
    }));
    const first = splitLetterAudience(leads, [PAT, TRY]);
    const second = splitLetterAudience([...leads].reverse(), [PAT, TRY]);
    expect(first).toEqual(second);
    const pat = new Set(first.groups[0]?.leads.map((row) => row.email));
    const tryGroup = new Set(first.groups[1]?.leads.map((row) => row.email));
    expect(pat.size + tryGroup.size).toBe(4);
    for (const email of pat) expect(tryGroup.has(email)).toBe(false);
    expect(first.groups[0]?.campaignId).toBe(PAT);
    expect(first.groups[1]?.campaignId).toBe(TRY);
  });

  it("forwards a signed playbook token into the leadership kit without creating a charge", () => {
    const token = signAcquisitionCampaignId(PAT, SECRET);
    const url = acquisitionCampaignPlaybookUrl(PAT, SECRET) ?? "";
    const ac = new URL(url).searchParams.get("ac");
    expect(readSignedAcquisitionCampaignId(ac, SECRET)).toBe(PAT);
    const href = freePdfCoachKitHref(false, token);
    expect(href).toContain("src%3Dcoach");
    expect(href).toContain(encodeURIComponent(token ?? ""));
    expect(href).not.toContain("aj=");
  });

  it("keeps video preparation unchanged and keeps letter clearance read-only", () => {
    const video = readFileSync(new URL("./video-first-leads.server.ts", import.meta.url), "utf8");
    const videoRoute = readFileSync(new URL("./audience-clearance.server.ts", import.meta.url), "utf8");
    const letter = readFileSync(new URL("./letter-audience.server.ts", import.meta.url), "utf8");
    const letterRoute = readFileSync(new URL("../../app/api/admin/acquisition/letter-audience/route.ts", import.meta.url), "utf8");
    const linkRoute = readFileSync(new URL("../../app/api/admin/acquisition/playbook-link/route.ts", import.meta.url), "utf8");
    const panel = readFileSync(new URL("../../app/admin/distribution/campaign-playbooks/video-first-lead-panel.tsx", import.meta.url), "utf8");
    expect(video).toContain("Choose the video saved on this campaign's current playbook. Automatic sending has to stay off. Nothing was written.");
    expect(videoRoute).toContain("issueVideoFirstLinks");
    expect(videoRoute).toContain("personalVideoId");
    expect(letter).not.toContain("issueVideoFirstLinks");
    expect(letter).not.toContain("writeAndVerifyVideoUrl");
    expect(letter).not.toContain(".insert(");
    expect(letter).not.toContain(".update(");
    expect(letter).not.toContain(".delete(");
    expect(letterRoute).toContain("isTylerOwnerSession");
    expect(linkRoute).toContain("isTylerOwnerSession");
    expect(linkRoute).not.toContain("CRON_SECRET");
    expect(panel).toContain("Check and Prepare Audience");
    expect(panel).toContain("Check eligibility");
    expect(panel).toContain("/api/admin/acquisition/letter-audience");
    expect(panel).toContain("/api/admin/acquisition/playbook-link");
  });
});
