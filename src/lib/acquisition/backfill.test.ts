import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  backfillExecuteAllowed,
  consumeInstantlyPages,
  continueAfterRangePage,
  INSTANTLY_PAGE_CAP,
  parseInstantlyListPayload,
  planInstantlyBackfill,
  type CampaignName,
  type ExistingBackfillPerson,
  type InstantlyPage,
} from "@/lib/acquisition/backfill";
import { backfillMayApply } from "@/lib/acquisition/model";

const sent = "2026-01-01T00:00:00.000Z";
const later = "2026-06-01T00:00:00.000Z";

function lead(overrides: Record<string, unknown>) {
  return { id: "lead", email: "coach@school.edu", status: 1, ...overrides };
}

function completeArgs(
  leads: unknown[],
  campaigns: CampaignName[] = [],
  current: ReadonlyMap<string, "cold_active" | "paid_member" | "unsubscribed" | "asset_sent" | "trial_started" | "cold_no_response" | "reply_needs_review" | ExistingBackfillPerson> = new Map(),
) {
  return {
    leads,
    currentByEmail: current,
    campaigns,
    paginationComplete: true,
    apiError: null,
    campaignNamesLoaded: true,
    campaignError: null,
  };
}

describe("acquisition backfill trust", () => {
  it("reads past 2,000 leads and reports a stopped or failed page", () => {
    const pages: InstantlyPage[] = Array.from({ length: 25 }, (_, index) => ({
      ok: true,
      status: 200,
      items: Array.from({ length: 100 }, (_, row) => ({ id: `p${index}-${row}` })),
      nextCursor: index === 24 ? null : `cursor-${index + 1}`,
    }));
    const full = consumeInstantlyPages(pages);
    expect(full.items).toHaveLength(2500);
    expect(full.complete).toBe(true);
    expect(full.error).toBeNull();
    expect(full.pages).toBe(25);

    const capped = consumeInstantlyPages(pages, 20);
    expect(capped.complete).toBe(false);
    expect(capped.error).toBe("page_cap");
    expect(capped.items).toHaveLength(2000);

    const failed = consumeInstantlyPages([
      pages[0],
      { ok: false, status: 503, items: [], nextCursor: null },
    ]);
    expect(failed.complete).toBe(false);
    expect(failed.error).toBe("http_503");
    expect(failed.items).toHaveLength(100);

    const stuck = consumeInstantlyPages([
      { ok: true, status: 200, items: [{ id: "a" }], nextCursor: "same" },
      { ok: true, status: 200, items: [{ id: "b" }], nextCursor: "same" },
    ]);
    expect(stuck.complete).toBe(false);
    expect(stuck.error).toBe("cursor_repeated");
    const emptyCursor = consumeInstantlyPages([
      { ok: true, status: 200, items: [], nextCursor: "more" },
    ]);
    expect(emptyCursor.complete).toBe(false);
    expect(emptyCursor.error).toBe("empty_page_with_cursor");
    expect(parseInstantlyListPayload({ next_starting_after: "more" }).ok).toBe(false);
    expect(parseInstantlyListPayload([]).ok).toBe(false);
    expect(parseInstantlyListPayload({ items: [{ id: "a" }], next_starting_after: "next" })).toEqual({
      ok: true,
      items: [{ id: "a" }],
      nextCursor: "next",
    });
    expect(INSTANTLY_PAGE_CAP).toBeGreaterThan(20);
  });

  it("does not call an unsent lead cold_active, including a draft Pat campaign", () => {
    const plan = planInstantlyBackfill(completeArgs(
      [lead({ id: "draft", email: "draft@school.edu", status: 1, campaign: "pat-draft", payload: { note: "very interested" } })],
      [{ id: "pat-draft", name: "Pat Tennessee Draft", status: 0 }],
    ));
    expect(plan.proposals).toEqual([]);
    expect(plan.coldActive).toBe(0);
    expect(plan.uncontacted).toBe(1);
    expect(plan.neverSent).toBe(1);
    expect(plan.patCampaigns?.[0]?.uncontacted).toBe(1);
    expect(plan.regions?.tennessee.records).toBe(1);
  });

  it("can call a sent active lead cold_active", () => {
    const plan = planInstantlyBackfill(completeArgs([
      lead({
        id: "sent",
        email: "sent@school.edu",
        status: 1,
        timestamp_last_contact: sent,
        email_reply_count: 0,
      }),
    ]));
    expect(plan.proposals.map((row) => row.lifecycle)).toEqual(["cold_active"]);
    expect(plan.sent).toBe(1);
    expect(plan.coldNoResponse).toBe(0);
    const missingCount = planInstantlyBackfill(completeArgs([
      lead({ id: "nocount", email: "nocount@school.edu", status: 1, timestamp_last_contact: sent }),
    ]));
    expect(missingCount.proposals).toEqual([]);
    expect(missingCount.coldActive).toBe(0);
    expect(missingCount.unclassifiable.reasons.reply_unproven).toBe(1);
  });

  it("uses cold_no_response only when a send and a zero reply count are both present", () => {
    const proven = planInstantlyBackfill(completeArgs([
      lead({
        id: "done",
        email: "done@school.edu",
        status: 3,
        timestamp_last_contact: sent,
        email_reply_count: 0,
      }),
    ]));
    expect(proven.proposals[0]?.lifecycle).toBe("cold_no_response");

    const missingReply = planInstantlyBackfill(completeArgs([
      lead({ id: "unknown", email: "unknown@school.edu", status: 3, timestamp_last_contact: sent }),
    ]));
    expect(missingReply.proposals).toEqual([]);
    expect(missingReply.unclassifiable.reasons.completed_reply_unproven).toBe(1);

    const noSend = planInstantlyBackfill(completeArgs([
      lead({ id: "quiet", email: "quiet@school.edu", status: 3, email_reply_count: 0 }),
    ]));
    expect(noSend.coldNoResponse).toBe(0);
    expect(noSend.unclassifiable.reasons.completed_without_send).toBe(1);

    const replied = planInstantlyBackfill(completeArgs([
      lead({
        id: "replied",
        email: "replied@school.edu",
        status: 3,
        timestamp_last_contact: sent,
        email_reply_count: 1,
        timestamp_last_reply: later,
      }),
    ]));
    expect(replied.coldNoResponse).toBe(0);
    expect(replied.proposals[0]?.lifecycle).toBe("reply_needs_review");
  });

  it("lets interested outrank a generic reply and lets bounce or unsubscribe outrank interest", () => {
    const interest = planInstantlyBackfill(completeArgs([
      lead({ id: "reply", email: "both@school.edu", status: 1, email_reply_count: 2, timestamp_last_reply: sent, timestamp_updated: sent }),
      lead({ id: "interest", email: "both@school.edu", status: 1, lt_interest_status: 1, timestamp_updated: later }),
    ]));
    expect(interest.proposals[0]?.lifecycle).toBe("asset_requested");
    expect(interest.replies).toBe(0);

    const reversed = planInstantlyBackfill(completeArgs([
      lead({ id: "interest", email: "both@school.edu", status: 1, lt_interest_status: 1, timestamp_updated: sent }),
      lead({ id: "reply", email: "both@school.edu", status: 1, email_reply_count: 2, timestamp_last_reply: later, timestamp_updated: later }),
    ]));
    expect(reversed.proposals[0]?.lifecycle).toBe("asset_requested");

    const bounced = planInstantlyBackfill(completeArgs([
      lead({ id: "b", email: "bounce@school.edu", status: -1, lt_interest_status: 1 }),
    ]));
    expect(bounced.proposals[0]?.lifecycle).toBe("suppressed");
    expect(bounced.interested).toBe(0);

    const unsubscribed = planInstantlyBackfill(completeArgs([
      lead({ id: "u", email: "stop@school.edu", status: -2, lt_interest_status: 1, email_reply_count: 3 }),
    ]));
    expect(unsubscribed.proposals[0]?.lifecycle).toBe("unsubscribed");
  });

  it("breaks an equal rank with the newer authoritative timestamp, not API order", () => {
    const older = lead({
      id: "older",
      email: "dup@school.edu",
      status: 1,
      campaign: "old-camp",
      timestamp_last_contact: sent,
      timestamp_updated: sent,
      email_reply_count: 0,
    });
    const newer = lead({
      id: "newer",
      email: "dup@school.edu",
      status: 1,
      campaign: "new-camp",
      timestamp_last_contact: later,
      timestamp_updated: later,
      email_reply_count: 0,
    });
    for (const leads of [[older, newer], [newer, older]]) {
      const plan = planInstantlyBackfill(completeArgs(leads, [
        { id: "old-camp", name: "Old", status: 1 },
        { id: "new-camp", name: "New", status: 1 },
      ]));
      expect(plan.proposals[0]?.campaignId).toBe("new-camp");
      expect(plan.duplicateEmails).toBe(1);
      expect(plan.duplicateConflicts).toBe(1);
      expect(plan.duplicates[0]?.discarded.map((row) => row.leadId)).toEqual(["older"]);
      expect(plan.multiCampaignEmails).toBe(1);
    }

    const tieFirst = planInstantlyBackfill(completeArgs([
      lead({ id: "aaa", email: "tie@school.edu", status: 1, timestamp_last_contact: sent, timestamp_updated: sent, email_reply_count: 0, campaign: "a" }),
      lead({ id: "zzz", email: "tie@school.edu", status: 1, timestamp_last_contact: sent, timestamp_updated: sent, email_reply_count: 0, campaign: "z" }),
    ]));
    const tieReversed = planInstantlyBackfill(completeArgs([
      lead({ id: "zzz", email: "tie@school.edu", status: 1, timestamp_last_contact: sent, timestamp_updated: sent, email_reply_count: 0, campaign: "z" }),
      lead({ id: "aaa", email: "tie@school.edu", status: 1, timestamp_last_contact: sent, timestamp_updated: sent, email_reply_count: 0, campaign: "a" }),
    ]));
    expect(tieFirst.proposals[0]?.campaignId).toBe("z");
    expect(tieReversed.proposals[0]?.campaignId).toBe("z");

    const overlap = planInstantlyBackfill(completeArgs([
      lead({ id: "same", email: "once@school.edu", status: 1, timestamp_last_contact: sent, timestamp_updated: sent, email_reply_count: 0 }),
      lead({ id: "same", email: "once@school.edu", status: 1, timestamp_last_contact: later, timestamp_updated: later, email_reply_count: 0 }),
    ]));
    expect(overlap.sent).toBe(1);
    expect(overlap.repeatedLeadIds).toBe(1);
    expect(overlap.uniqueEmails).toBe(1);
    expect(overlap.proposals).toHaveLength(1);
  });

  it("leaves historical interest at asset_requested and does not schedule a warm email", () => {
    const plan = planInstantlyBackfill(completeArgs(
      [lead({
        id: "tn",
        email: "tn.coach@school.edu",
        status: 3,
        lt_interest_status: 1,
        campaign: "tn",
        timestamp_last_contact: sent,
        email_reply_count: 1,
      })],
      [{ id: "tn", name: "Tennessee Coaches", status: 3 }],
    ));
    expect(plan.proposals[0]?.lifecycle).toBe("asset_requested");
    expect(plan.proposals[0]?.historicalFulfillment).toBe("unknown");
    expect(plan.proposals[0]?.schedulesWarmEmail).toBe(false);
    expect(plan.historicalFulfillmentUnknown).toBe(1);
    expect(plan.assetSentProven).toBe(0);
    expect(plan.schedulesWarmEmail).toBe(false);
    expect(plan.tennesseeInterested.reliable).toBe(true);
    expect(plan.tennesseeInterested.total).toBe(1);
    expect(plan.tennesseeInterested.rows[0]).toMatchObject({
      email: "tn.coach@school.edu",
      fulfillment: "unknown",
      sent: true,
    });
    expect(JSON.stringify(plan)).not.toContain("send_asset");
  });

  it("reports region and Pat breakdowns from campaign names and withholds them when names are missing", () => {
    const campaigns: CampaignName[] = [
      { id: "tn", name: "Tennessee", status: 1 },
      { id: "ms", name: "Mississippi", status: 1 },
      { id: "sc", name: "South Carolina", status: 1 },
      { id: "wi", name: "Wisconsin", status: 1 },
      { id: "mn", name: "Minnesota", status: 1 },
      { id: "wy", name: "Wyoming", status: 1 },
      { id: "pat", name: "Pat Followup", status: 0 },
    ];
    const plan = planInstantlyBackfill(completeArgs([
      lead({ id: "1", email: "a@school.edu", campaign: "tn", status: 1 }),
      lead({ id: "2", email: "b@school.edu", campaign: "ms", status: 1, lt_interest_status: 1 }),
      lead({ id: "3", email: "c@school.edu", campaign: "sc", status: 1 }),
      lead({ id: "4", email: "d@school.edu", campaign: "wi", status: 1 }),
      lead({ id: "5", email: "e@school.edu", campaign: "mn", status: 1 }),
      lead({ id: "6", email: "f@school.edu", campaign: "wy", status: 1 }),
      lead({ id: "7", email: "g@school.edu", campaign: "pat", status: 1 }),
    ], campaigns));
    expect(plan.regions?.mississippi.interested).toBe(1);
    expect(plan.regions?.south_carolina.records).toBe(1);
    expect(plan.regions?.wisconsin.records).toBe(1);
    expect(plan.regions?.minnesota.records).toBe(1);
    expect(plan.regions?.wyoming.records).toBe(1);
    expect(plan.regions?.tennessee.records).toBe(1);
    expect(plan.patCampaigns?.map((row) => row.campaignId)).toEqual(["pat"]);

    const unnamed = planInstantlyBackfill({
      leads: [lead({ id: "1", email: "a@school.edu", campaign: "tn", lt_interest_status: 1 })],
      currentByEmail: new Map(),
      paginationComplete: true,
      apiError: null,
      campaignNamesLoaded: false,
      campaignError: "http_500",
    });
    expect(unnamed.complete).toBe(false);
    expect(unnamed.regions).toBeNull();
    expect(unnamed.patCampaigns).toBeNull();
    expect(unnamed.tennesseeInterested.reliable).toBe(false);
    expect(unnamed.tennesseeInterested.total).toBeNull();
    expect(backfillExecuteAllowed(unnamed)).toBe(false);
  });

  it("lists every wouldApply update without changing counts or scheduling mail", () => {
    const creates = Array.from({ length: 26 }, (_, index) => lead({
      id: `new-${index}`,
      email: `new${index}@school.edu`,
      status: 1,
      timestamp_last_contact: sent,
      email_reply_count: 0,
    }));
    const plan = planInstantlyBackfill(completeArgs([
      ...creates,
      lead({
        id: "interest",
        email: "apply@school.edu",
        status: 1,
        lt_interest_status: 1,
        campaign: "tn-other",
        payload: { asset: "definite_dozen" },
      }),
      lead({
        id: "reply",
        email: "reply@school.edu",
        status: 1,
        timestamp_last_contact: sent,
        email_reply_count: 1,
        timestamp_last_reply: later,
        campaign: "tn-bball",
      }),
      lead({
        id: "paid",
        email: "paid@school.edu",
        status: 1,
        lt_interest_status: 1,
        campaign: "tn-other",
      }),
    ], [
      { id: "tn-other", name: "TN OTHER Girls Sports", status: 1 },
      { id: "tn-bball", name: "TN Basketball", status: 1 },
    ], new Map([
      ["apply@school.edu", "cold_active"],
      ["reply@school.edu", "cold_no_response"],
      ["paid@school.edu", "paid_member"],
    ])));
    expect(plan.wouldCreate).toBe(26);
    expect(plan.wouldApply).toBe(2);
    expect(plan.wouldSkipStronger).toBe(1);
    expect(plan.wouldApplyDetails).toHaveLength(plan.wouldApply);
    expect(plan.wouldApplyDetails.map((row) => row.email).sort()).toEqual(["apply@school.edu", "reply@school.edu"]);
    expect(plan.wouldApplyDetails.find((row) => row.email === "apply@school.edu")).toMatchObject({
      existingLifecycle: "cold_active",
      proposedLifecycle: "asset_requested",
      existingRequestedAssetLoaded: false,
      proposedRequestedAsset: "definite_dozen",
      existingSourceCampaignLoaded: false,
      proposedCampaignId: "tn-other",
      proposedCampaignName: "TN OTHER Girls Sports",
      reasonCode: "interested",
      lifecycleChanges: true,
      requestedAssetWouldChange: false,
      sourceCampaignWouldChange: false,
      createsEvent: true,
      createsAction: false,
      schedulesWarmEmail: false,
    });
    expect(plan.wouldApplyDetails.find((row) => row.email === "reply@school.edu")).toMatchObject({
      existingLifecycle: "cold_no_response",
      proposedLifecycle: "reply_needs_review",
      reasonCode: "reply",
      lifecycleChanges: true,
      createsAction: false,
    });
    expect(plan.wouldApplyDetails.some((row) => row.email === "paid@school.edu")).toBe(false);
    expect(plan.proposals.some((row) => row.email === "paid@school.edu")).toBe(false);
    expect(plan.wouldCreateDetails).toHaveLength(plan.wouldCreateDetailsLimit);
    expect(plan.wouldCreateDetailsTruncated).toBe(true);
    expect(plan.wouldCreateDetails.every((row) => row.existingLifecycle === null && row.schedulesWarmEmail === false)).toBe(true);
    expect(plan.schedulesWarmEmail).toBe(false);
    expect(JSON.stringify(plan.wouldApplyDetails)).not.toContain("send_asset");
    const apply = readFileSync("src/lib/acquisition/store.ts", "utf8");
    const applyFn = apply.slice(
      apply.indexOf("export async function applyInstantlyBackfill"),
      apply.indexOf("export async function refreshInstantlySenderSignals"),
    );
    expect(applyFn).not.toContain("scheduleAction");
    expect(backfillExecuteAllowed({ ...plan, complete: false })).toBe(false);
  });

  it("compares loaded requested asset and source campaign without changing who would apply", () => {
    const current = new Map<string, ExistingBackfillPerson>([
      ["set@school.edu", { lifecycle: "cold_active", requestedAsset: null, sourceCampaign: null }],
      ["replace@school.edu", { lifecycle: "cold_active", requestedAsset: "playbook", sourceCampaign: "already-stored" }],
      ["keep@school.edu", { lifecycle: "reply_needs_review", requestedAsset: "definite_dozen", sourceCampaign: "tn-other" }],
      ["paid@school.edu", { lifecycle: "paid_member", requestedAsset: "playbook", sourceCampaign: "old" }],
    ]);
    const plan = planInstantlyBackfill(completeArgs([
      lead({
        id: "set",
        email: "set@school.edu",
        status: 1,
        lt_interest_status: 1,
        campaign: "tn-other",
        payload: { asset: "definite_dozen" },
      }),
      lead({
        id: "replace",
        email: "replace@school.edu",
        status: 3,
        timestamp_last_contact: sent,
        email_reply_count: 0,
        campaign: "tn-bball",
      }),
      lead({
        id: "keep",
        email: "keep@school.edu",
        status: 1,
        lt_interest_status: 1,
        campaign: "tn-other",
        payload: { asset: "definite_dozen" },
      }),
      lead({
        id: "paid",
        email: "paid@school.edu",
        status: 1,
        lt_interest_status: 1,
        campaign: "tn-other",
        payload: { asset: "definite_dozen" },
      }),
    ], [
      { id: "tn-other", name: "TN OTHER Girls Sports", status: 1 },
      { id: "tn-bball", name: "TN Basketball", status: 1 },
    ], current));
    expect(plan.wouldApply).toBe(3);
    expect(plan.wouldSkipStronger).toBe(1);
    expect(plan.wouldApplyDetails).toHaveLength(3);
    expect(plan.wouldApplyDetails.find((row) => row.email === "set@school.edu")).toMatchObject({
      existingRequestedAsset: null,
      existingRequestedAssetLoaded: true,
      proposedRequestedAsset: "definite_dozen",
      requestedAssetValuesDiffer: true,
      requestedAssetWouldChange: true,
      existingSourceCampaign: null,
      existingSourceCampaignLoaded: true,
      proposedCampaignId: "tn-other",
      sourceCampaignValuesDiffer: true,
      sourceCampaignWouldChange: true,
      reasonCode: "interested",
    });
    expect(plan.wouldApplyDetails.find((row) => row.email === "set@school.edu")?.reason).toContain("cold_active would become asset_requested");
    expect(plan.wouldApplyDetails.find((row) => row.email === "replace@school.edu")).toMatchObject({
      existingLifecycle: "cold_active",
      proposedLifecycle: "cold_no_response",
      existingRequestedAsset: "playbook",
      proposedRequestedAsset: null,
      requestedAssetValuesDiffer: true,
      requestedAssetWouldChange: false,
      existingSourceCampaign: "already-stored",
      proposedCampaignId: "tn-bball",
      sourceCampaignValuesDiffer: true,
      sourceCampaignWouldChange: false,
      reasonCode: "completed_no_reply",
    });
    expect(plan.wouldApplyDetails.find((row) => row.email === "replace@school.edu")?.requestedAssetNote).toContain("does not clear");
    expect(plan.wouldApplyDetails.find((row) => row.email === "replace@school.edu")?.sourceCampaignNote).toContain("keeps the campaign already stored");
    expect(plan.wouldApplyDetails.find((row) => row.email === "keep@school.edu")).toMatchObject({
      existingRequestedAsset: "definite_dozen",
      proposedRequestedAsset: "definite_dozen",
      requestedAssetWouldChange: false,
      existingSourceCampaign: "tn-other",
      proposedCampaignId: "tn-other",
      sourceCampaignWouldChange: false,
      sourceCampaignValuesDiffer: false,
    });
    expect(plan.wouldApplyDetails.some((row) => row.email === "paid@school.edu")).toBe(false);
    expect(plan.proposals.map((row) => row.lifecycle).sort()).toEqual(["asset_requested", "asset_requested", "cold_no_response"]);
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    const peopleRead = store.slice(store.indexOf("async function readPeopleForBackfill"), store.indexOf("export async function dryRunInstantlyBackfill"));
    expect(peopleRead).toContain("requested_asset, source_campaign");
    expect(store).toContain("if (!existing.source_campaign && args.campaignId)");
    const apply = store.slice(store.indexOf("export async function applyInstantlyBackfill"), store.indexOf("export async function refreshInstantlySenderSignals"));
    expect(apply).not.toContain("scheduleAction");
  });

  it("does not downgrade a stronger canonical state and does not resurrect a suppressed person", () => {
    const leads = [
      lead({ id: "paid", email: "paid@school.edu", status: 1, timestamp_last_contact: sent, email_reply_count: 0 }),
      lead({ id: "asset", email: "asset@school.edu", status: 1, lt_interest_status: 1 }),
      lead({ id: "stop", email: "stop@school.edu", status: 1, timestamp_last_contact: sent, email_reply_count: 0 }),
      lead({ id: "trial", email: "trial@school.edu", status: 1, lt_interest_status: 1 }),
      lead({ id: "cold", email: "cold@school.edu", status: 3, timestamp_last_contact: sent, email_reply_count: 0 }),
    ];
    const plan = planInstantlyBackfill(completeArgs(leads, [], new Map([
      ["paid@school.edu", "paid_member"],
      ["asset@school.edu", "asset_sent"],
      ["stop@school.edu", "unsubscribed"],
      ["trial@school.edu", "trial_started"],
      ["cold@school.edu", "cold_active"],
    ])));
    expect(plan.proposals.map((row) => row.email)).toEqual(["cold@school.edu"]);
    expect(plan.wouldSkipStronger).toBe(4);
    expect(plan.wouldApply).toBe(1);
    expect(backfillMayApply("cold_active", "reply_needs_review")).toBe("apply");
    expect(backfillMayApply("reply_needs_review", "asset_requested")).toBe("apply");
    expect(backfillMayApply("reply_needs_review", "cold_active")).toBe("skip_stronger");
    expect(backfillMayApply("reply_needs_review", "suppressed")).toBe("apply");
    expect(backfillMayApply("asset_sent", "reply_needs_review")).toBe("skip_stronger");
    expect(backfillMayApply("unsubscribed", "cold_active")).toBe("skip_stronger");
    expect(backfillMayApply("cold_no_response", "cold_active")).toBe("skip_stronger");
  });

  it("marks an API failure incomplete and performs no writes from the planner", () => {
    const plan = planInstantlyBackfill({
      leads: [lead({ id: "partial", email: "partial@school.edu", status: 1, timestamp_last_contact: sent, email_reply_count: 0 })],
      currentByEmail: new Map(),
      fetched: 100,
      pages: 1,
      paginationComplete: false,
      apiError: "http_500",
      campaignNamesLoaded: false,
      campaignError: "missing_api_key",
    });
    expect(plan.fetched).toBe(100);
    expect(plan.paginationComplete).toBe(false);
    expect(plan.apiError).toBe("http_500");
    expect(plan.complete).toBe(false);
    expect(plan.proposals).toHaveLength(1);
    expect(backfillExecuteAllowed(plan)).toBe(false);
    const source = readFileSync("src/lib/acquisition/backfill.ts", "utf8");
    expect(source).not.toMatch(/supabase|resend|scheduleAction|fetch\(/);
    const route = readFileSync("src/app/api/admin/acquisition/backfill/route.ts", "utf8");
    expect(route).toContain("backfillExecuteAllowed");
    expect(route).not.toContain("fetchInstantlyLeads");
    const people = continueAfterRangePage({ pageNumber: 50, pageCap: 50, rowCount: 1000, pageSize: 1000 });
    expect(people.complete).toBe(false);
    expect(people.error).toBe("people_page_cap");
    expect(continueAfterRangePage({ pageNumber: 1, pageCap: 50, rowCount: 4, pageSize: 1000 }).complete).toBe(true);
  });
});
