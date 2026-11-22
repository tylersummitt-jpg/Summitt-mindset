import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { InstantlyLeadSnapshot } from "@/lib/acquisition/backfill";
import { freePdfCoachKitHref } from "@/lib/free-pdf";
import {
  acquisitionCampaignPlaybookUrl,
  readSignedAcquisitionCampaignId,
  signAcquisitionCampaignId,
} from "@/lib/acquisition/email-acquired-member-notice";
import { classifyHistoricalAccount, type HistoricalDecision } from "@/lib/historical-never-subscriber";
import { emailBlockedByDomain } from "@/lib/acquisition/instantly-block-import";
import {
  classifyLetterHistory,
  decideLetterFacts,
  emailsWithClearHistory,
  finishLetterClearance,
  LETTER_FACT_BATCH,
  letterActionIsOutstanding,
  letterInstantlyHistory,
  letterJourneyEffect,
  letterMessageEffect,
  letterMembershipVerdict,
  reviewLetterAudience,
  signLetterBatch,
  signLetterOutcomes,
  splitLetterAudience,
  type LetterLocalFacts,
} from "@/lib/acquisition/letter-audience";

const SECRET = "test-secret-at-least-16";
const PAT = "3d63c904-1c4f-4bd2-bc95-52f9a996318d";
const TRY = "5c066c5d-733d-4003-928e-c6c38fe94abc";
const SOURCE = "source-basketball";
const QUIET = new Map<string, "active" | "inactive">([
  [SOURCE, "inactive"],
  ["other-campaign", "inactive"],
]);

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
    addressBlocked: false,
    domainBlocked: false,
    optedOut: false,
    outstandingFulfillment: false,
    hasJourney: false,
    ledgerEmailed: false,
    ledgerReplied: false,
    ledgerBounced: false,
    ledgerStopped: false,
    ledgerSequence: false,
    journeyMember: false,
    journeyUnreadable: false,
    membership: "clear",
    historicalMembership: "clear",
  };
}

function decision(overrides: Partial<Parameters<typeof classifyHistoricalAccount>[0]> = {}): HistoricalDecision {
  return classifyHistoricalAccount({
    email: "coach@school.edu",
    createdAtMs: Date.UTC(2026, 0, 1),
    metadataClaimsMembership: false,
    identity: "no_customer",
    stripeCustomerFound: false,
    subscriptionListComplete: true,
    sessionListComplete: true,
    stripeFinding: "none",
    apple: "none",
    ...overrides,
  });
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
    expect(letterInstantlyHistory([leads[0]!], SOURCE, QUIET).outcome).toBe("never");
    expect(letterInstantlyHistory([leads[3]!, leads[2]!], SOURCE, QUIET)).toMatchObject({
      outcome: "excluded",
      reason: expect.stringMatching(/verified Instantly send/),
    });
    expect(letterInstantlyHistory([
      lead({ id: "waiting", email: "waiting@school.edu" }),
      lead({ id: "waiting-other", email: "waiting@school.edu", campaignId: "other-campaign", sent: false }),
    ], SOURCE, QUIET).outcome).toBe("never");
    expect(letterInstantlyHistory([
      lead({ id: "live", email: "live@school.edu" }),
      lead({ id: "live-other", email: "live@school.edu", campaignId: "other-campaign", sent: false, leadStatus: "active" }),
    ], SOURCE, new Map([[SOURCE, "inactive"], ["other-campaign", "active"]]))).toMatchObject({
      outcome: "excluded",
      reason: expect.stringMatching(/another active Instantly sequence/),
    });
    expect(letterInstantlyHistory([
      lead({ id: "unknown-list", email: "unknown-list@school.edu" }),
      lead({ id: "unknown-other", email: "unknown-list@school.edu", campaignId: "missing-campaign", sent: false }),
    ], SOURCE, QUIET).outcome).toBe("unverified");
    expect(emailsWithClearHistory(SOURCE, leads, QUIET)).toEqual(["new@school.edu"]);
    const local = new Map<string, LetterLocalFacts>([
      ["new@school.edu", clearLocal()],
      ["former@school.edu", { ...clearLocal(), lifecycle: "trial_expired" }],
    ]);
    const reviewed = reviewLetterAudience({
      sourceCampaignId: SOURCE,
      leads: [...leads, lead({ id: "former", email: "former@school.edu" })],
      localByEmail: local,
      campaignActivity: QUIET,
    });
    expect(reviewed.eligible.map((row) => row.email)).toEqual(["new@school.edu"]);
    expect(reviewed.skips).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: "sent@school.edu", kind: "excluded" }),
      expect.objectContaining({ email: "cross@school.edu", kind: "excluded" }),
      expect.objectContaining({ email: "odd@school.edu", kind: "unverified" }),
      expect.objectContaining({ email: "former@school.edu", kind: "excluded" }),
    ]));
    const missing = reviewLetterAudience({ sourceCampaignId: SOURCE, leads, localByEmail: null, campaignActivity: QUIET });
    expect(missing.eligible).toEqual([]);
    expect(missing.skips.some((skip) => skip.email === "new@school.edu" && skip.kind === "unverified")).toBe(true);
  });

  it("excludes current and former members and refuses an incomplete membership read", () => {
    expect(letterMembershipVerdict({
      decision: decision({ stripeFinding: "active", identity: "resolved_customer", stripeCustomerFound: true }),
    })).toBe("member");
    expect(letterMembershipVerdict({
      decision: decision({ stripeFinding: "former", identity: "resolved_customer", stripeCustomerFound: true }),
    })).toBe("member");
    expect(letterMembershipVerdict({
      decision: decision({ stripeFinding: "none", identity: "resolved_customer", stripeCustomerFound: true, createdAtMs: Date.UTC(2024, 0, 1) }),
      subscriptions: [{ status: "canceled" }],
    })).toBe("member");
    expect(letterMembershipVerdict({
      decision: decision({ stripeFinding: "abandoned_incomplete", identity: "resolved_customer", stripeCustomerFound: true }),
      subscriptions: [{ status: "incomplete_expired" }],
    })).toBe("member");
    const verified = letterMembershipVerdict({
      decision: decision({ stripeFinding: "none", identity: "resolved_customer", stripeCustomerFound: true, createdAtMs: Date.UTC(2024, 0, 1) }),
    });
    expect(verified).toBe("clear");
    expect(letterMembershipVerdict({ decision: null })).toBe("unverified");
    expect(letterMembershipVerdict({
      decision: decision({ identity: "lookup_failed", subscriptionListComplete: false, sessionListComplete: false, stripeFinding: "unreadable" }),
    })).toBe("unverified");

    const reviewed = reviewLetterAudience({
      sourceCampaignId: SOURCE,
      leads: [
        lead({ id: "current", email: "current@school.edu" }),
        lead({ id: "former", email: "canceled@school.edu" }),
        lead({ id: "never", email: "never@school.edu" }),
        lead({ id: "unknown", email: "unknown@school.edu" }),
      ],
      localByEmail: new Map([
        ["current@school.edu", { ...clearLocal(), historicalMembership: "member" }],
        ["canceled@school.edu", { ...clearLocal(), lifecycle: null, historicalMembership: "member" }],
        ["never@school.edu", clearLocal()],
        ["unknown@school.edu", { ...clearLocal(), historicalMembership: "unverified" }],
      ]),
      campaignActivity: QUIET,
    });
    expect(reviewed.eligible.map((row) => row.email)).toEqual(["never@school.edu"]);
    expect(reviewed.skips).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: "current@school.edu", kind: "excluded" }),
      expect.objectContaining({ email: "canceled@school.edu", kind: "excluded" }),
      expect.objectContaining({ email: "unknown@school.edu", kind: "unverified" }),
    ]));
  });

  it("never treats a blocked domain, including wcs.edu subdomains, as eligible", () => {
    expect(emailBlockedByDomain("coach@wcs.edu", ["wcs.edu"])).toBe(true);
    expect(emailBlockedByDomain("coach@mail.wcs.edu", ["WCS.EDU"])).toBe(true);
    expect(emailBlockedByDomain("coach@notwcs.edu", ["wcs.edu"])).toBe(false);
    expect(emailBlockedByDomain("coach@wcs.edu.example.com", ["wcs.edu"])).toBe(false);
    const reviewed = reviewLetterAudience({
      sourceCampaignId: SOURCE,
      leads: [
        lead({ id: "blocked", email: "coach@wcs.edu" }),
        lead({ id: "child", email: "coach@mail.wcs.edu" }),
        lead({ id: "open", email: "coach@other.edu" }),
      ],
      localByEmail: new Map([
        ["coach@wcs.edu", { ...clearLocal(), domainBlocked: true, historicalMembership: "unverified" }],
        ["coach@mail.wcs.edu", { ...clearLocal(), domainBlocked: true, addressBlocked: true }],
        ["coach@other.edu", clearLocal()],
      ]),
      campaignActivity: QUIET,
    });
    expect(reviewed.eligible.map((row) => row.email)).toEqual(["coach@other.edu"]);
    const blocked = reviewed.skips.find((skip) => skip.email === "coach@wcs.edu");
    expect(blocked).toMatchObject({ kind: "excluded", reason: "Instantly has this email domain blocked." });
    expect(blocked?.reasons).toEqual(expect.arrayContaining([
      "Instantly has this email domain blocked.",
      "Historical membership could not be confirmed. They were left unverified.",
    ]));
    expect(reviewed.skips.find((skip) => skip.email === "coach@mail.wcs.edu")?.reasons[0]).toBe(
      "Instantly has this email domain blocked.",
    );
  });

  it("keeps unsent leads out of the previously-contacted label and separates ledger reasons", () => {
    const quiet = new Map([[SOURCE, "inactive" as const], ["other-campaign", "inactive" as const]]);
    const live = new Map([[SOURCE, "inactive" as const], ["other-campaign", "active" as const]]);
    expect(letterInstantlyHistory([
      lead({ id: "paused-source", email: "paused@school.edu" }),
      lead({ id: "paused-other", email: "paused@school.edu", campaignId: "other-campaign", sent: false, leadStatus: "paused" }),
    ], SOURCE, live)).toMatchObject({
      outcome: "excluded",
      reason: "This address is enrolled in another active Instantly sequence. Nothing was sent.",
    });
    expect(letterInstantlyHistory([
      lead({ id: "paused-quiet", email: "quiet-paused@school.edu" }),
      lead({ id: "paused-quiet-other", email: "quiet-paused@school.edu", campaignId: "other-campaign", sent: false, leadStatus: "paused" }),
    ], SOURCE, quiet).outcome).toBe("never");
    const both = letterInstantlyHistory([
      lead({ id: "bounce", email: "both@school.edu", leadStatus: "bounced", sent: false }),
      lead({ id: "sent-too", email: "both@school.edu", campaignId: "other-campaign", sent: true }),
    ], SOURCE, quiet);
    expect(both.outcome).toBe("excluded");
    if (both.outcome === "excluded") {
      expect(both.reasons[0]).toMatch(/bounced/);
      expect(both.reasons.some((reason) => reason.includes("verified Instantly send"))).toBe(true);
    }
    const reviewed = reviewLetterAudience({
      sourceCampaignId: SOURCE,
      leads: [
        lead({ id: "seq", email: "seq@school.edu" }),
        lead({ id: "mailed", email: "mailed@school.edu" }),
        lead({ id: "stopped", email: "stopped@school.edu" }),
      ],
      localByEmail: new Map([
        ["seq@school.edu", { ...clearLocal(), lifecycle: "cold_active" }],
        ["mailed@school.edu", { ...clearLocal(), ledgerEmailed: true, ledgerSequence: true }],
        ["stopped@school.edu", { ...clearLocal(), optedOut: true, ledgerEmailed: true }],
      ]),
      campaignActivity: quiet,
    });
    expect(reviewed.eligible.map((row) => row.email)).toEqual(["seq@school.edu"]);
    expect(reviewed.skips.find((skip) => skip.email === "mailed@school.edu")?.reasons).toEqual([
      "The acquisition ledger shows a previous email.",
    ]);
    expect(reviewed.skips.find((skip) => skip.email === "stopped@school.edu")?.reason).toMatch(/suppressed or opted out/);
  });

  it("releases a dormant unsent journey and keeps operative work excluded", () => {
    expect(letterJourneyEffect({ lifecycle: "cold_active", closed: false })).toMatchObject({ operative: false, emailed: false, unreadable: false });
    expect(letterJourneyEffect({ lifecycle: "cold_no_response", closed: false }).operative).toBe(false);
    expect(letterJourneyEffect({ lifecycle: "asset_sent", closed: false })).toMatchObject({ operative: true, emailed: true });
    expect(letterJourneyEffect({ lifecycle: "asset_sent", closed: true })).toMatchObject({ operative: false, emailed: true });
    expect(letterJourneyEffect({ lifecycle: "reply_needs_review", closed: false })).toMatchObject({ operative: true, replied: true });
    expect(letterJourneyEffect({ lifecycle: "not_interested", closed: true }).stopped).toBe(true);
    expect(letterJourneyEffect({ lifecycle: "paid_member", closed: false }).member).toBe(true);
    expect(letterJourneyEffect({ lifecycle: null, closed: false }).unreadable).toBe(true);
    expect(letterJourneyEffect({ lifecycle: "mystery", closed: false }).unreadable).toBe(true);
    expect(letterMessageEffect("outbound")).toBe("email");
    expect(letterMessageEffect("inbound")).toBe("reply");
    expect(letterMessageEffect("sideways")).toBe("unreadable");
    expect(letterActionIsOutstanding("scheduled")).toBe(true);
    expect(letterActionIsOutstanding("claimed")).toBe(true);
    expect(letterActionIsOutstanding("accepted")).toBe(false);
    expect(letterActionIsOutstanding("canceled")).toBe(false);

    const reviewed = reviewLetterAudience({
      sourceCampaignId: SOURCE,
      sourceCampaignIds: ["tennessee-video"],
      leads: [
        lead({ id: "dormant-a", email: "dormant@school.edu", campaignId: SOURCE }),
        lead({ id: "dormant-b", email: "dormant@school.edu", campaignId: "tennessee-video" }),
        lead({ id: "active-j", email: "active-journey@school.edu" }),
        lead({ id: "paused-j", email: "paused-journey@school.edu" }),
        lead({ id: "held-j", email: "held@school.edu" }),
        lead({ id: "sent-j", email: "sent-journey@school.edu" }),
        lead({ id: "stop-j", email: "optout@school.edu" }),
        lead({ id: "block-j", email: "coach@wcs.edu" }),
        lead({ id: "member-j", email: "member@school.edu" }),
        lead({ id: "unread-j", email: "unread@school.edu" }),
      ],
      localByEmail: new Map([
        ["dormant@school.edu", { ...clearLocal(), lifecycle: "cold_active", ledgerSequence: true, hasJourney: false }],
        ["active-journey@school.edu", { ...clearLocal(), lifecycle: "cold_active", hasJourney: true }],
        ["paused-journey@school.edu", { ...clearLocal(), lifecycle: "cold_active", outstandingFulfillment: true }],
        ["held@school.edu", { ...clearLocal(), outstandingFulfillment: true }],
        ["sent-journey@school.edu", { ...clearLocal(), ledgerEmailed: true }],
        ["optout@school.edu", { ...clearLocal(), optedOut: true }],
        ["coach@wcs.edu", { ...clearLocal(), domainBlocked: true }],
        ["member@school.edu", { ...clearLocal(), historicalMembership: "member" }],
        ["unread@school.edu", { ...clearLocal(), journeyUnreadable: true }],
      ]),
      campaignActivity: QUIET,
    });
    expect(reviewed.eligible.map((row) => row.email)).toEqual(["dormant@school.edu"]);
    expect(reviewed.skips.find((skip) => skip.email === "active-journey@school.edu")?.reason).toMatch(/open acquisition journey/);
    expect(reviewed.skips.find((skip) => skip.email === "paused-journey@school.edu")?.reason).toMatch(/scheduled or claimed/);
    expect(reviewed.skips.find((skip) => skip.email === "held@school.edu")?.reason).toMatch(/scheduled or claimed/);
    expect(reviewed.skips.find((skip) => skip.email === "sent-journey@school.edu")?.reason).toMatch(/previous email/);
    expect(reviewed.skips.find((skip) => skip.email === "optout@school.edu")?.reason).toMatch(/opted out/);
    expect(reviewed.skips.find((skip) => skip.email === "coach@wcs.edu")?.reason).toMatch(/domain blocked/);
    expect(reviewed.skips.find((skip) => skip.email === "member@school.edu")?.kind).toBe("excluded");
    expect(reviewed.skips.find((skip) => skip.email === "unread@school.edu")?.kind).toBe("unverified");
    const dormant = reviewed.eligible.find((row) => row.email === "dormant@school.edu");
    expect(dormant).toBeTruthy();
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

  it("clears a large overlapping roster without treating a partial batch as final", () => {
    const original = "tennessee-original";
    const video = "tennessee-video";
    const leads = [];
    for (let index = 0; index < 3000; index += 1) {
      leads.push(lead({ id: `a-${index}`, email: `coach${index}@school.edu`, campaignId: original }));
    }
    for (let index = 2800; index < 3200; index += 1) {
      leads.push(lead({ id: `b-${index}`, email: `coach${index}@school.edu`, campaignId: video }));
    }
    leads.push(lead({ id: "sent-row", email: "coach0@school.edu", campaignId: "other-campaign", sent: true }));
    leads.push(lead({ id: "blocked-row", email: "coach1@wcs.edu", campaignId: original }));
    const activity = new Map<string, "active" | "inactive">([
      [original, "inactive"],
      [video, "inactive"],
      ["other-campaign", "inactive"],
    ]);
    const classified = classifyLetterHistory({
      sourceCampaignIds: [original, video],
      leads,
      campaignActivity: activity,
    });
    const emails = new Set([...classified.pending.map((row) => row.email), ...classified.skips.map((row) => row.email)]);
    expect(emails.size).toBe(3201);
    expect(classified.pending.some((row) => row.email === "coach0@school.edu")).toBe(false);
    expect(classified.skips.find((row) => row.email === "coach0@school.edu")?.reason).toMatch(/verified Instantly send/);
    const locals = new Map(classified.pending.map((row) => [row.email, clearLocal()]));
    const blocked = classified.pending.find((row) => row.email === "coach1@wcs.edu");
    const uncertain = classified.pending.find((row) => row.email === "coach2@school.edu");
    expect(blocked && uncertain).toBeTruthy();
    locals.set(blocked!.email, { ...clearLocal(), domainBlocked: true, historicalMembership: "unverified" });
    locals.set(uncertain!.email, { ...clearLocal(), historicalMembership: "unverified" });
    const facts = decideLetterFacts(classified.pending, locals);
    expect(facts.eligible.some((row) => row.email === "coach0@school.edu" || row.email === "coach1@wcs.edu" || row.email === "coach2@school.edu")).toBe(false);
    const signed = signLetterBatch({
      secret: SECRET,
      sourceCampaignIds: [original, video],
      launchCampaignId: PAT,
      pairCampaignId: TRY,
      pending: classified.pending,
      historySkips: classified.skips,
    });
    expect(signed).not.toBeNull();
    const outcomes = signLetterOutcomes({
      secret: SECRET,
      manifest: signed!.manifest,
      eligible: facts.eligible,
      skips: facts.skips,
    });
    expect(outcomes).not.toBeNull();
    expect(LETTER_FACT_BATCH).toBe(20);
    const partial = finishLetterClearance({
      secret: SECRET,
      manifest: signed!.manifest,
      sourceCampaignIds: [original, video],
      launchCampaignId: PAT,
      pairCampaignId: TRY,
      pending: classified.pending,
      historySkips: classified.skips,
      outcomes: outcomes!.slice(1),
    });
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.error).toMatch(/no import file was created/i);
    const forged = outcomes!.map((outcome, index) => index === 0 ? { ...outcome, token: `${outcome.token}x` } : outcome);
    const forgedResult = finishLetterClearance({
      secret: SECRET,
      manifest: signed!.manifest,
      sourceCampaignIds: [original, video],
      launchCampaignId: PAT,
      pairCampaignId: TRY,
      pending: classified.pending,
      historySkips: classified.skips,
      outcomes: forged,
    });
    expect(forgedResult.ok).toBe(false);
    const finished = finishLetterClearance({
      secret: SECRET,
      manifest: signed!.manifest,
      sourceCampaignIds: [original, video],
      launchCampaignId: PAT,
      pairCampaignId: TRY,
      pending: classified.pending,
      historySkips: classified.skips,
      outcomes: outcomes!,
    });
    const again = finishLetterClearance({
      secret: SECRET,
      manifest: signed!.manifest,
      sourceCampaignIds: [original, video],
      launchCampaignId: PAT,
      pairCampaignId: TRY,
      pending: classified.pending,
      historySkips: classified.skips,
      outcomes: outcomes!,
    });
    expect(finished.ok).toBe(true);
    expect(again).toEqual(finished);
    if (finished.ok) {
      expect(finished.eligible + finished.excluded + finished.unverified).toBe(finished.unique);
      expect(finished.unique).toBe(3201);
      const allocated = finished.groups.flatMap((group) => group.leads.map((row) => row.email));
      expect(new Set(allocated).size).toBe(allocated.length);
      expect(allocated).not.toContain("coach0@school.edu");
      expect(allocated).not.toContain("coach1@wcs.edu");
      expect(allocated).not.toContain("coach2@school.edu");
    }
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
    expect(letter).toContain("readHistoricalLetterDecisions");
    expect(letter).toContain("letterMembershipVerdict");
    expect(letter).toContain("LETTER_FACT_BATCH");
    expect(letter).toContain("This is not a cleared audience");
    expect(letter).not.toContain(".insert(");
    expect(letter).not.toContain(".update(");
    expect(letter).not.toContain(".delete(");
    const historical = readFileSync(new URL("../historical-never-subscriber.server.ts", import.meta.url), "utf8");
    expect(historical).toContain("classifyHistoricalAccount");
    expect(historical).toContain("customers.list");
    expect(letterRoute).toContain("isTylerOwnerSession");
    expect(linkRoute).toContain("isTylerOwnerSession");
    expect(linkRoute).not.toContain("CRON_SECRET");
    expect(panel).toContain("Check and Prepare Audience");
    expect(panel).toContain("Check eligibility");
    expect(panel).toContain("No import file was created");
    expect(panel).toContain("Additional letter audiences");
    expect(panel).toContain("/api/admin/acquisition/letter-audience");
    expect(panel).toContain("/api/admin/acquisition/playbook-link");
  });
});
