import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildDistributionCommand,
  emptyInstantlyRead,
  showRate,
  sortCampaigns,
  type CampaignView,
  type LedgerAction,
  type LedgerEvent,
  type LedgerMessage,
  type LedgerPerson,
} from "@/lib/acquisition/distribution-command";
import { parseCampaignAnalytics, parseOverview, parseSteps, variantLabel } from "@/lib/acquisition/instantly-analytics";
import { readInstantlyAnalytics } from "@/lib/acquisition/instantly-analytics.server";

const NOW = Date.parse("2026-10-27T16:00:00.000Z");
const START = Date.parse("2026-10-26T04:00:00.000Z");
const END = Date.parse("2026-10-28T04:00:00.000Z");

function person(id: string, campaign: string): LedgerPerson {
  return {
    id,
    lifecycle: "cold_active",
    sourceCampaign: campaign,
    sport: null,
    role: null,
    geography: null,
    offerKey: null,
  };
}

function event(patch: Partial<LedgerEvent> & Pick<LedgerEvent, "eventType" | "personId">): LedgerEvent {
  return {
    provider: "instantly",
    providerEventId: `${patch.personId}:${patch.eventType}:${patch.occurredAt ?? "2026-10-26T12:00:00.000Z"}`,
    occurredAt: "2026-10-26T12:00:00.000Z",
    campaignId: "camp-a",
    sender: "one@trysummittmindset.com",
    rawInstantlyType: null,
    step: 1,
    ...patch,
  };
}

function build(events: LedgerEvent[], people: LedgerPerson[], extra: Partial<Parameters<typeof buildDistributionCommand>[0]> = {}) {
  return buildDistributionCommand({
    readable: true,
    truncated: false,
    rangeLabel: "Last 7 days",
    startMs: START,
    endMs: END,
    nowMs: NOW,
    people,
    events,
    actions: [],
    messages: [],
    openJourneys: 0,
    closedJourneys: 0,
    peopleWithJourney: 0,
    instantly: emptyInstantlyRead("missing", "missing_api_key"),
    ...extra,
  });
}

describe("distribution command denominators", () => {
  it("counts one person once when two campaigns both send to that person", () => {
    const report = build([
      event({ personId: "p1", eventType: "email_sent", campaignId: "camp-a", providerEventId: "a" }),
      event({ personId: "p1", eventType: "email_sent", campaignId: "camp-b", providerEventId: "b", sender: "two@trysummittmindset.com" }),
    ], [person("p1", "camp-a")]);
    expect(report.peopleWithWebhookSend).toBe(1);
    expect(report.webhookSends).toBe(2);
    expect(report.campaigns.map((campaign) => campaign.webhookContacted).sort()).toEqual([1, 1]);
    expect(report.mailboxes.find((box) => box.email === "one@trysummittmindset.com")?.campaignIds).toEqual(["camp-a"]);
    expect(report.mailboxes.find((box) => box.email === "two@trysummittmindset.com")?.campaignIds).toEqual(["camp-b"]);
  });

  it("buckets a late-evening New York send on the New York date", () => {
    const report = build([
      event({
        personId: "p1",
        eventType: "email_sent",
        providerEventId: "late",
        occurredAt: "2026-10-27T03:30:00.000Z",
      }),
    ], [person("p1", "camp-a")]);
    expect(report.ledgerDaily).toEqual([{ date: "2026-10-26", sends: 1 }]);
  });

  it("does not rank an immature campaign against a mature one", () => {
    const mature = {
      id: "old",
      name: "Old",
      age: {
        "7": { state: "ready", contacted: 10, sends: 10, replyPeople: 1, note: "" },
        "14": { state: "ready", contacted: 10, sends: 10, replyPeople: 1, note: "" },
        "30": { state: "ready", contacted: 10, sends: 10, replyPeople: 1, note: "" },
      },
      webhookReplyPeople: 0,
      webhookSends: 0,
    } as CampaignView;
    const young = {
      id: "new",
      name: "New",
      age: {
        "7": { state: "immature", contacted: null, sends: null, replyPeople: null, note: "" },
        "14": { state: "immature", contacted: null, sends: null, replyPeople: null, note: "" },
        "30": { state: "immature", contacted: null, sends: null, replyPeople: null, note: "" },
      },
      webhookReplyPeople: 4,
      webhookSends: 20,
    } as CampaignView;
    const ordered = sortCampaigns([young, mature], { sort: "webhook_replies", view: "age", age: "7" });
    expect(ordered.map((campaign) => campaign.id)).toEqual(["old", "new"]);
  });

  it("counts unique people separately from send events", () => {
    const report = build([
      event({ personId: "p1", eventType: "email_sent", providerEventId: "s1" }),
      event({ personId: "p1", eventType: "email_sent", providerEventId: "s2", step: 2 }),
      event({ personId: "p2", eventType: "email_sent", providerEventId: "s3" }),
      event({ personId: "p1", eventType: "reply_received", providerEventId: "r1" }),
      event({ personId: "p1", eventType: "lead_interested", providerEventId: "i1" }),
    ], [person("p1", "camp-a"), person("p2", "camp-a"), person("p3", "camp-a")]);
    expect(report.peopleStored).toBe(3);
    expect(report.webhookSends).toBe(3);
    expect(report.peopleWithWebhookSend).toBe(2);
    expect(report.webhookReplyPeople).toBe(1);
    expect(report.webhookReplyEvents).toBe(1);
    expect(report.interestedWebhookPeople).toBe(1);
    expect(showRate(report.webhookReplyPeople, report.peopleWithWebhookSend)).toBe("50%");
    expect(showRate(report.webhookReplyPeople, report.webhookSends)).toBe("33.3%");
  });

  it("dedupes a repeated provider event and keeps an earlier send for campaign age", () => {
    const report = build([
      event({ personId: "p1", eventType: "email_sent", providerEventId: "same", occurredAt: "2026-10-20T12:00:00.000Z" }),
      event({ personId: "p1", eventType: "email_sent", providerEventId: "same", occurredAt: "2026-10-26T12:00:00.000Z" }),
    ], [person("p1", "camp-a")]);
    expect(report.webhookSends).toBe(0);
    expect(report.peopleWithWebhookSend).toBe(0);
    expect(report.campaigns[0]?.firstRecordedSend).toBe("2026-10-20T12:00:00.000Z");
  });

  it("does not count events outside the calendar range as current sends", () => {
    const report = build([
      event({ personId: "p1", eventType: "email_sent", occurredAt: "2026-10-22T12:00:00.000Z", providerEventId: "old" }),
      event({ personId: "p2", eventType: "email_sent", providerEventId: "new" }),
    ], [person("p1", "camp-a"), person("p2", "camp-a")]);
    expect(report.webhookSends).toBe(1);
    expect(report.peopleWithWebhookSend).toBe(1);
  });

  it("keeps sequence-finished evidence apart from unknown webhook types", () => {
    const report = build([
      event({
        personId: "p1",
        eventType: "unrecognized",
        rawInstantlyType: "campaign_completed_for_lead_without_reply",
        providerEventId: "done",
      }),
      event({
        personId: "p2",
        eventType: "unrecognized",
        rawInstantlyType: "unrecognized",
        providerEventId: "mystery",
      }),
    ], [person("p1", "camp-a"), person("p2", "camp-a")]);
    expect(report.sequenceFinishedEvents).toBe(1);
    expect(report.unknownWebhookEvents).toBe(1);
    expect(report.unknownWebhookTypes).toEqual([{ type: "unrecognized", events: 1 }]);
    expect(report.campaigns[0]?.completionNote).toContain("does not finish the campaign");
  });

  it("labels a young campaign immature and does not give it an age rate", () => {
    const report = build([
      event({ personId: "p1", eventType: "email_sent", providerEventId: "s1" }),
    ], [person("p1", "camp-a")]);
    expect(report.campaigns[0]?.age["30"].state).toBe("immature");
    expect(report.campaigns[0]?.age["30"].contacted).toBeNull();
    expect(report.campaigns[0]?.age["7"].state).toBe("immature");
  });

  it("uses equivalent elapsed days once a campaign is old enough", () => {
    const report = build([
      event({ personId: "p1", eventType: "email_sent", occurredAt: "2026-09-01T12:00:00.000Z", providerEventId: "early" }),
      event({ personId: "p1", eventType: "reply_received", occurredAt: "2026-09-03T12:00:00.000Z", providerEventId: "reply-early" }),
      event({ personId: "p2", eventType: "email_sent", occurredAt: "2026-09-20T12:00:00.000Z", providerEventId: "later" }),
    ], [person("p1", "camp-a"), person("p2", "camp-a")]);
    const week = report.campaigns[0]?.age["7"];
    expect(week?.state).toBe("ready");
    expect(week?.contacted).toBe(1);
    expect(week?.replyPeople).toBe(1);
    expect(report.campaigns[0]?.age["30"].contacted).toBe(2);
  });

  it("groups one mailbox across campaigns without inventing a role or offer", () => {
    const report = build([
      event({ personId: "p1", eventType: "email_sent", campaignId: "camp-a", providerEventId: "a", sender: "Box@TrySummittMindset.com" }),
      event({ personId: "p2", eventType: "email_sent", campaignId: "camp-b", providerEventId: "b", sender: "box@trysummittmindset.com" }),
    ], [person("p1", "camp-a"), person("p2", "camp-b")]);
    expect(report.mailboxes).toHaveLength(1);
    expect(report.mailboxes[0]?.campaignIds).toEqual(["camp-a", "camp-b"]);
    expect(report.mailboxes[0]?.ledgerSends).toBe(2);
    expect(report.domains[0]?.domain).toBe("trysummittmindset.com");
    expect(report.offerFilled).toBe(0);
    expect(report.roleFilled).toBe(0);
    expect(report.campaigns.every((campaign) => campaign.offerStored === false)).toBe(true);
  });

  it("withholds totals when the read is incomplete and does not use zero", () => {
    const report = buildDistributionCommand({
      readable: true,
      truncated: true,
      rangeLabel: "All time",
      startMs: null,
      endMs: END,
      nowMs: NOW,
      people: [],
      events: [],
      actions: [],
      messages: [],
      openJourneys: 0,
      closedJourneys: 0,
      peopleWithJourney: 0,
      instantly: emptyInstantlyRead("missing"),
    });
    expect(report.readable).toBe(false);
    expect(report.peopleStored).toBeNull();
    expect(report.webhookSends).toBeNull();
  });

  it("does not treat a missing action read as zero scheduled PDFs", () => {
    const report = build([], [person("p1", "camp-a")], { actions: null });
    expect(report.fulfillment).toBeNull();
    expect(report.attention.some((item) => item.includes("could not be read"))).toBe(true);
  });
});

describe("Instantly analytics parsing", () => {
  it("drops open and click counts and keeps missing numbers null", () => {
    const parsed = parseCampaignAnalytics([{
      campaign_id: "camp-a",
      campaign_name: "Coaches",
      campaign_status: 3,
      leads_count: 10,
      contacted_count: 8,
      emails_sent_count: 20,
      reply_count_unique: 1,
      open_count: 99,
      link_click_count: 40,
      bounced_count: 2,
    }]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.campaigns[0]).not.toHaveProperty("openCount");
    expect(JSON.stringify(parsed.campaigns[0])).not.toContain("99");
    expect(parsed.campaigns[0]?.statusFilter).toBe("completed");
    expect(parsed.campaigns[0]?.unsubscribedCount).toBeNull();
    expect(parsed.campaigns[0]?.totalOpportunities).toBeNull();
    expect(parsed.campaigns[0]?.replyCountUnique).toBe(1);
  });

  it("does not turn rows without a campaign id into zero campaigns", () => {
    expect(parseCampaignAnalytics([{ leads_count: 4, contacted_count: 0 }]).ok).toBe(false);
  });

  it("rejects a non-array analytics body", () => {
    expect(parseCampaignAnalytics({ leads_count: 0 }).ok).toBe(false);
    expect(parseOverview([]).ok).toBe(false);
  });

  it("labels variants from Instantly's zero-based index and leaves a null variant unattributed", () => {
    expect(variantLabel("0")).toBe("A");
    expect(variantLabel("1")).toBe("B");
    expect(variantLabel(null)).toBe("Not attributed");
    const parsed = parseSteps([{ step: null, variant: null, sent: 3, unique_replies: 1, opened: 8 }]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0]?.variantLabel).toBe("Not attributed");
    expect(JSON.stringify(parsed.rows[0])).not.toContain("opened");
  });

  it("does not call Instantly when the credential is missing", async () => {
    const fetchImpl = vi.fn();
    const read = await readInstantlyAnalytics({
      apiKey: null,
      startDate: "2026-10-01",
      endDate: "2026-10-27",
      daySpan: 27,
      selectedCampaignId: null,
      fetchImpl,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(read.credential).toBe("missing");
    expect(read.analytics).toBeNull();
  });

  it("surfaces an HTTP failure without inventing zeros", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 401 }));
    const read = await readInstantlyAnalytics({
      apiKey: "test-key",
      startDate: null,
      endDate: null,
      daySpan: null,
      selectedCampaignId: null,
      fetchImpl,
      cache: new Map(),
    });
    expect(read.credential).toBe("present");
    expect(read.analytics).toBeNull();
    expect(read.analyticsError).toBe("http_401");
    expect(read.overview).toBeNull();
    const called = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(called.some((url) => url.includes("/api/v2/campaigns/analytics"))).toBe(true);
    expect(called.some((url) => url.includes("/leads/list"))).toBe(false);
    expect(called.join(" ")).not.toContain("test-key");
  });
});

function action(patch: Partial<LedgerAction> & Pick<LedgerAction, "actionType" | "status">): LedgerAction {
  return {
    personId: "p1",
    campaignId: "camp-a",
    attemptCount: 0,
    delivered: patch.status === "delivered",
    claimed: patch.status === "claimed",
    ...patch,
  };
}

function message(patch: Partial<LedgerMessage>): LedgerMessage {
  return {
    personId: "p1",
    direction: "inbound",
    processingStatus: "interpreted",
    aiOutcome: "accept_offer",
    campaignId: "camp-a",
    occurredAt: "2026-10-26T12:00:00.000Z",
    ...patch,
  };
}

describe("unified distribution funnel", () => {
  it("keeps one person in two campaigns on each campaign without doubling the person", () => {
    const report = build([
      event({ personId: "p1", eventType: "email_sent", campaignId: "camp-a", providerEventId: "a" }),
      event({ personId: "p1", eventType: "email_sent", campaignId: "camp-b", providerEventId: "b" }),
      event({ personId: "p1", eventType: "reply_received", campaignId: "camp-a", providerEventId: "r" }),
    ], [person("p1", "camp-a")], {
      messages: [
        message({ campaignId: "camp-a" }),
        message({ campaignId: "camp-b", personId: "p1" }),
      ],
      actions: [
        action({ campaignId: "camp-a", actionType: "send_asset", status: "delivered" }),
        action({ campaignId: "camp-b", actionType: "send_asset", status: "accepted", delivered: false }),
      ],
    });
    expect(report.peopleWithWebhookSend).toBe(1);
    expect(report.resourceRequestPeople).toBe(1);
    expect(report.webhookSends).toBe(2);
    const first = report.campaigns.find((campaign) => campaign.id === "camp-a");
    const second = report.campaigns.find((campaign) => campaign.id === "camp-b");
    expect(first?.resourceRequestPeople).toBe(1);
    expect(second?.resourceRequestPeople).toBe(1);
    expect(first?.deliveredAssets).toBe(1);
    expect(first?.acceptedAssets).toBe(0);
    expect(second?.acceptedAssets).toBe(1);
    expect(second?.deliveredAssets).toBe(0);
  });

  it("counts a retried video play once and does not treat a visit as a play", () => {
    const report = build([
      event({
        personId: "p1",
        provider: "personal_video",
        eventType: "personal_video_visited",
        providerEventId: "recipient:1:personal_video_visited",
        campaignId: null,
        sender: null,
        step: null,
      }),
      event({
        personId: "p1",
        provider: "personal_video",
        eventType: "personal_video_played",
        providerEventId: "recipient:1:personal_video_played",
        campaignId: null,
        sender: null,
        step: null,
      }),
      event({
        personId: "p1",
        provider: "personal_video",
        eventType: "personal_video_played",
        providerEventId: "recipient:1:personal_video_played",
        campaignId: null,
        sender: null,
        step: null,
      }),
    ], [person("p1", "camp-a")]);
    expect(report.videoVisitPeople).toBe(1);
    expect(report.videoPlayPeople).toBe(1);
    expect(report.videoPlayEvents).toBe(1);
    expect(report.videoCtaPeople).toBe(0);
    expect(report.unattributedVideoEvents).toBe(2);
    expect(report.campaigns[0]?.videoPlayPeople).toBe(0);
    expect(report.rates.videoToTrial).toBeNull();
    expect(report.rates.playToCta).toBe("0%");
  });

  it("counts a play on the campaign stored on the event and not on the person's other campaign", () => {
    const report = build([
      event({ personId: "p1", eventType: "email_sent", campaignId: "camp-a", providerEventId: "a" }),
      event({ personId: "p1", eventType: "email_sent", campaignId: "camp-b", providerEventId: "b" }),
      event({
        personId: "p1",
        provider: "personal_video",
        eventType: "personal_video_played",
        providerEventId: "recipient:1:personal_video_played",
        campaignId: "camp-b",
        journeyId: "11111111-1111-4111-8111-111111111111",
        sender: null,
        step: null,
      }),
    ], [person("p1", "camp-a")]);
    expect(report.campaigns.find((campaign) => campaign.id === "camp-a")?.videoPlayPeople).toBe(0);
    expect(report.campaigns.find((campaign) => campaign.id === "camp-b")?.videoPlayPeople).toBe(1);
    expect(report.campaigns.find((campaign) => campaign.id === "camp-a")?.attributedTrials).toBe(0);
  });

  it("leaves campaign video counts at zero when no video event was recorded", () => {
    const report = build([], [person("p1", "camp-a")]);
    expect(report.videoPlayPeople).toBe(0);
    expect(report.campaigns[0]?.videoVisitPeople).toBe(0);
    expect(report.campaigns[0]?.videoPlayPeople).toBe(0);
    expect(report.campaigns[0]?.videoCtaPeople).toBe(0);
    expect(report.rates.playToCta).toBeNull();
  });

  it("separates an accepted PDF from a delivered PDF and keeps a scheduled reminder unsent", () => {
    const report = build([], [person("p1", "camp-a")], {
      actions: [
        action({ actionType: "send_asset", status: "accepted", delivered: false }),
        action({ personId: "p2", actionType: "send_asset", status: "delivered" }),
        action({ actionType: "send_video_reminder", status: "scheduled", delivered: false, claimed: false }),
        action({ actionType: "send_video_reminder_final", status: "canceled", delivered: false, claimed: false }),
      ],
    });
    expect(report.fulfillment?.["send_asset:accepted"]).toBe(1);
    expect(report.fulfillment?.["send_asset:delivered"]).toBe(1);
    const campaign = report.campaigns[0];
    expect(campaign?.acceptedAssets).toBe(1);
    expect(campaign?.deliveredAssets).toBe(1);
    expect(campaign?.firstReminderScheduled).toBe(1);
    expect(campaign?.firstReminderAccepted).toBe(0);
    expect(campaign?.firstReminderDelivered).toBe(0);
    expect(campaign?.remindersCanceled).toBe(1);
    expect(report.remindersCanceledByPlay).toBeNull();
    expect(report.rates.videoSentToPlay).toBeNull();
  });

  it("does not credit an email-only trial or a lead_interested label", () => {
    const report = build([
      event({ personId: "p1", eventType: "lead_interested", providerEventId: "interest" }),
      event({
        personId: "p2",
        provider: "stripe",
        eventType: "trial_started",
        providerEventId: "trial:sub",
        campaignId: null,
        journeyId: null,
        sender: null,
        step: null,
      }),
    ], [person("p1", "camp-a"), person("p2", "camp-a")]);
    expect(report.resourceRequestPeople).toBe(0);
    expect(report.interestedWebhookPeople).toBe(1);
    expect(report.webhookReplyPeople).toBe(0);
    expect(report.attributedTrialPeople).toBe(0);
    expect(report.emailOnlyTrialPeople).toBe(1);
    expect(report.campaigns[0]?.attributedTrials).toBe(0);
  });

  it("does not mix an older webhook send into the current range or into Instantly's total", () => {
    const report = build([
      event({ personId: "p1", eventType: "email_sent", occurredAt: "2026-10-01T12:00:00.000Z", providerEventId: "old" }),
      event({
        personId: "p1",
        provider: "personal_video",
        eventType: "personal_video_played",
        occurredAt: "2026-10-01T12:00:00.000Z",
        providerEventId: "old-play",
        campaignId: "camp-a",
        sender: null,
        step: null,
      }),
    ], [person("p1", "camp-a")]);
    expect(report.webhookSends).toBe(0);
    expect(report.videoPlayPeople).toBe(0);
    expect(report.campaigns[0]?.instantlySent).toBeNull();
    expect(report.campaigns[0]?.webhookSends).toBe(0);
    expect(report.campaigns[0]?.firstReminderScheduled).toBe(0);
  });

  it("calculates trial-to-paid only for all time when every paid member also has a trial", () => {
    const trial = event({
      personId: "p1",
      provider: "stripe",
      eventType: "trial_started",
      providerEventId: "trial",
      campaignId: "camp-a",
      journeyId: "11111111-1111-4111-8111-111111111111",
      sender: null,
      step: null,
    });
    const paid = event({
      personId: "p1",
      provider: "stripe",
      eventType: "paid_member",
      providerEventId: "paid",
      campaignId: "camp-a",
      journeyId: "11111111-1111-4111-8111-111111111111",
      sender: null,
      step: null,
    });
    const ranged = build([trial, paid], [person("p1", "camp-a")]);
    expect(ranged.attributedTrialPeople).toBe(1);
    expect(ranged.attributedPaidPeople).toBe(1);
    expect(ranged.rates.trialToPaid).toBeNull();
    const allTime = build([trial, paid], [person("p1", "camp-a")], { startMs: null, rangeLabel: "All time" });
    expect(allTime.rates.trialToPaid).toBe("100%");
  });

  it("counts the same video on two campaigns only where the journey is stored", () => {
    const report = build([
      event({
        personId: "p1",
        provider: "personal_video",
        eventType: "personal_video_watched_25",
        providerEventId: "a-25",
        campaignId: "camp-a",
        journeyId: "journey-a",
        videoId: "video-1",
        sender: null,
        step: null,
      }),
      event({
        personId: "p1",
        provider: "personal_video",
        eventType: "personal_video_watched_25",
        providerEventId: "b-25",
        campaignId: "camp-b",
        journeyId: "journey-b",
        videoId: "video-1",
        sender: null,
        step: null,
      }),
      event({
        personId: "p1",
        provider: "system",
        eventType: "video_link_prepared",
        providerEventId: "prep-a",
        campaignId: "camp-a",
        journeyId: "journey-a",
        videoId: "video-1",
        sender: null,
        step: null,
      }),
    ], [person("p1", "camp-a")]);
    const a = report.campaigns.find((campaign) => campaign.id === "camp-a");
    const b = report.campaigns.find((campaign) => campaign.id === "camp-b");
    expect(a?.videoWatched25People).toBe(1);
    expect(b?.videoWatched25People).toBe(1);
    expect(a?.linksPrepared).toBe(1);
    expect(b?.linksPrepared).toBe(0);
    expect(a?.videoIds).toEqual(["video-1"]);
    expect(report.videoWatched25People).toBe(1);
    expect(a?.attributedTrials).toBe(0);
  });

  it("counts a video-first trial separately from an earlier journey on the same campaign", () => {
    const report = build([
      event({
        personId: "p1",
        provider: "system",
        eventType: "video_link_prepared",
        providerEventId: "prep",
        campaignId: "camp-a",
        journeyId: "journey-video",
        videoId: "video-1",
        sender: null,
        step: null,
      }),
      event({
        personId: "p1",
        provider: "stripe",
        eventType: "trial_started",
        providerEventId: "trial-new",
        campaignId: "camp-a",
        journeyId: "journey-video",
        sender: null,
        step: null,
      }),
      event({
        personId: "p2",
        provider: "stripe",
        eventType: "trial_started",
        providerEventId: "trial-old",
        campaignId: "camp-a",
        journeyId: "journey-pdf",
        sender: null,
        step: null,
      }),
    ], [person("p1", "camp-a"), person("p2", "camp-a")]);
    const campaign = report.campaigns.find((item) => item.id === "camp-a");
    expect(campaign?.attributedTrials).toBe(2);
    expect(campaign?.videoFirstTrials).toBe(1);
    expect(campaign?.videoFirstPaid).toBe(0);
  });
});

describe("distribution page boundaries", () => {
  it("keeps the website funnel and leaves subscriber growth alone", () => {
    const screen = readFileSync("src/app/admin/operating-screen.tsx", "utf8");
    const growth = readFileSync("src/app/admin/subscriber-growth/page.tsx", "utf8");
    expect(screen).toContain("Website and company acquisition");
    expect(screen).toContain("Unique visitors");
    expect(screen).toContain("People stored");
    expect(screen).not.toContain("Cold prospects");
    expect(growth).not.toContain("distribution-command");
    expect(growth).not.toContain("acquisition");
  });
});
