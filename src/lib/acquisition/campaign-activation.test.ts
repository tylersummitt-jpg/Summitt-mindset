import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  applyCampaignActivation,
  campaignListReadable,
  fulfillmentEligible,
  parseCampaignActivations,
  replyEligible,
} from "@/lib/acquisition/campaign-activation";
import {
  conversationOwnsCampaign,
  decideConversationEffect,
  providerInterestSchedulesFulfillment,
  selectAutonomousFulfillment,
  selectAutonomousThreadReplies,
} from "@/lib/acquisition/conversation";
import { outboundSendPlan } from "@/lib/acquisition/instantly-reply";
import { salesEmailMustStop } from "@/lib/acquisition/model";
import { LEGACY_CAMPAIGN_ASSETS } from "@/lib/acquisition/playbook";

const OWNER = "856a5ef5-88c6-44c6-b001-a5b020d641f7";
const CAMPAIGN_A = "364dad9d-cbb5-4d33-b4d5-0ac083f0ebe5";
const CAMPAIGN_B = "ab5b139c-0f7e-44f9-b42a-86726fd024a8";
const DOZEN_B = "80d88a66-78a2-4367-a4ea-6d5a562ebf92";
const NOW = new Date("2026-10-27T15:00:00.000Z");
const LATER = new Date("2026-10-27T16:00:00.000Z");

describe("campaign activation", () => {
  it("activates one campaign and leaves the other closed", () => {
    const activated = applyCampaignActivation({ current: [], campaignId: CAMPAIGN_A, action: "activate", now: NOW });
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    expect(replyEligible({ activations: activated.activations, campaignId: CAMPAIGN_A, receivedAt: "2026-10-27T15:05:00.000Z" })).toBe(true);
    expect(fulfillmentEligible({ activations: activated.activations, campaignId: CAMPAIGN_A, scheduledAt: "2026-10-27T15:05:00.000Z" })).toBe(true);
    expect(replyEligible({ activations: activated.activations, campaignId: CAMPAIGN_B, receivedAt: "2026-10-27T15:05:00.000Z" })).toBe(false);
    expect(fulfillmentEligible({ activations: activated.activations, campaignId: CAMPAIGN_B, scheduledAt: "2026-10-27T15:05:00.000Z" })).toBe(false);
    expect(selectAutonomousThreadReplies([
      { id: "a", campaignId: CAMPAIGN_A, receivedAt: "2026-10-27T15:05:00.000Z" },
      { id: "b", campaignId: CAMPAIGN_B, receivedAt: "2026-10-27T15:05:00.000Z" },
    ], activated.activations).map((row) => row.id)).toEqual(["a"]);
  });

  it("pauses one campaign without closing or releasing the other", () => {
    const first = applyCampaignActivation({ current: [], campaignId: CAMPAIGN_A, action: "activate", now: NOW });
    if (!first.ok) throw new Error(first.error);
    const both = applyCampaignActivation({ current: first.activations, campaignId: CAMPAIGN_B, action: "activate", now: NOW });
    if (!both.ok) throw new Error(both.error);
    const paused = applyCampaignActivation({ current: both.activations, campaignId: CAMPAIGN_A, action: "pause", now: LATER });
    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    expect(paused.activations.find((row) => row.id === CAMPAIGN_B)?.activatedAt).toBe(NOW.toISOString());
    expect(replyEligible({ activations: paused.activations, campaignId: CAMPAIGN_A, receivedAt: "2026-10-27T16:05:00.000Z" })).toBe(false);
    expect(fulfillmentEligible({ activations: paused.activations, campaignId: CAMPAIGN_B, scheduledAt: "2026-10-27T15:05:00.000Z" })).toBe(true);
    expect(providerInterestSchedulesFulfillment({
      interpretation: "pilot",
      pilotCampaigns: paused.activations,
      campaignId: CAMPAIGN_A,
    })).toBe(false);
  });

  it("requires an explicit resume and does not release work from the earlier window", () => {
    const activated = applyCampaignActivation({ current: [], campaignId: CAMPAIGN_A, action: "activate", now: NOW });
    if (!activated.ok) throw new Error(activated.error);
    const paused = applyCampaignActivation({ current: activated.activations, campaignId: CAMPAIGN_A, action: "pause", now: LATER });
    if (!paused.ok) throw new Error(paused.error);
    expect(paused.activatedAt).toBeNull();
    const resumed = applyCampaignActivation({
      current: paused.activations,
      campaignId: CAMPAIGN_A,
      action: "activate",
      now: new Date("2026-10-27T17:00:00.000Z"),
    });
    if (!resumed.ok) throw new Error(resumed.error);
    expect(resumed.activatedAt).toBe("2026-10-27T17:00:00.000Z");
    expect(fulfillmentEligible({
      activations: resumed.activations,
      campaignId: CAMPAIGN_A,
      scheduledAt: "2026-10-27T16:30:00.000Z",
    })).toBe(false);
    expect(replyEligible({
      activations: resumed.activations,
      campaignId: CAMPAIGN_A,
      receivedAt: "2026-10-27T17:01:00.000Z",
    })).toBe(true);
  });

  it("keeps a stored campaign id governed but closed until activation", () => {
    const stored = parseCampaignActivations([OWNER]);
    expect(stored).toEqual([{ id: OWNER, activatedAt: null }]);
    expect(conversationOwnsCampaign({ interpretation: "pilot", pilotCampaigns: stored, campaignId: OWNER })).toBe(true);
    expect(replyEligible({ activations: stored, campaignId: OWNER, receivedAt: "2026-10-27T18:00:00.000Z" })).toBe(false);
    expect(fulfillmentEligible({ activations: stored, campaignId: OWNER, scheduledAt: "2026-10-27T18:00:00.000Z" })).toBe(false);
  });

  it("does not release older scheduled fulfillment when another campaign is activated", () => {
    const activated = applyCampaignActivation({ current: parseCampaignActivations([OWNER]), campaignId: OWNER, action: "activate", now: NOW });
    if (!activated.ok) throw new Error(activated.error);
    const selected = selectAutonomousFulfillment([
      { id: "7e6e0c3c-3e2a-4bbf-b455-7fc10f7d58eb", journeyId: "playbook-journey", scheduledAt: "2026-10-26T12:00:00.000Z" },
      { id: "24903120-178a-400f-bd43-019cb9ecacad", journeyId: "dozen-a", scheduledAt: "2026-10-26T12:00:00.000Z" },
      { id: "0b629c19-f8d4-4b30-941f-ac8018228e99", journeyId: "dozen-b", scheduledAt: "2026-10-26T12:00:00.000Z" },
      { id: "owner-new", journeyId: "owner-journey", scheduledAt: "2026-10-27T15:05:00.000Z" },
      { id: "owner-old", journeyId: "owner-journey", scheduledAt: "2026-10-27T14:00:00.000Z" },
    ], new Map<string, string | null>([
      ["playbook-journey", CAMPAIGN_A],
      ["dozen-a", CAMPAIGN_B],
      ["dozen-b", DOZEN_B],
      ["owner-journey", OWNER],
    ]), activated.activations);
    expect(selected.map((row) => row.id)).toEqual(["owner-new"]);
  });

  it("fails closed when the campaign list cannot be read", () => {
    expect(campaignListReadable(null)).toBe(false);
    expect(campaignListReadable({})).toBe(false);
    expect(campaignListReadable("856a5ef5-88c6-44c6-b001-a5b020d641f7")).toBe(false);
    expect(parseCampaignActivations(null)).toEqual([]);
    expect(parseCampaignActivations({ id: OWNER })).toEqual([]);
    expect(fulfillmentEligible({ activations: [], campaignId: OWNER, scheduledAt: "2026-10-27T15:05:00.000Z" })).toBe(false);
    expect(replyEligible({ activations: [], campaignId: OWNER, receivedAt: "2026-10-27T15:05:00.000Z" })).toBe(false);
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    const personPath = store.slice(store.indexOf("async function applyPersonEvent"), store.indexOf("export async function recordAcquisitionVideoEvent"));
    expect(personPath.indexOf("settings.conversationReadable")).toBeLessThan(personPath.indexOf("scheduleAction"));
    expect(personPath).toContain('settings.automation !== "unavailable"');
  });

  it("keeps duplicate, unsubscribe, complaint, bounce, and subscriber stops in place", () => {
    expect(outboundSendPlan({ status: "sent", providerMessageId: "email-1", claimUntil: null }, NOW)).toBe("leave");
    expect(decideConversationEffect({
      outcome: "unsubscribe",
      journeyId: null,
      hasPromise: false,
      stopped: false,
      suppressed: null,
    })).toEqual({ type: "global_unsubscribe" });
    expect(decideConversationEffect({
      outcome: "complaint",
      journeyId: null,
      hasPromise: false,
      stopped: false,
      suppressed: null,
    })).toEqual({ type: "global_complaint" });
    expect(decideConversationEffect({
      outcome: "accept_offer",
      journeyId: "journey-1",
      hasPromise: true,
      stopped: true,
      suppressed: false,
    })).toEqual({ type: "record", error: "eligibility_stop" });
    expect(salesEmailMustStop("unsubscribed")).toBe(true);
    expect(salesEmailMustStop("paid_member")).toBe(true);
    expect(salesEmailMustStop("trial_started")).toBe(true);
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    expect(store).toContain("duplicate_send");
    expect(store).toContain('event.signal === "bounced" ? "bounce"');
    expect(store).toContain("`acquisition:${personId}:${journeyId}:${action}`");
  });

  it("leaves legacy PDF mappings and existing owner history untouched", () => {
    expect(Object.keys(LEGACY_CAMPAIGN_ASSETS)).toHaveLength(10);
    const server = readFileSync("src/lib/acquisition/campaign-activation.server.ts", "utf8");
    const playbookServer = readFileSync("src/lib/acquisition/playbook.server.ts", "utf8");
    const route = readFileSync("src/app/api/admin/acquisition/campaign-playbooks/route.ts", "utf8");
    expect(server).not.toContain("b9a4a51a-f03e-4522-8af0-34491856b690");
    expect(server).not.toContain("7e6e0c3c-3e2a-4bbf-b455-7fc10f7d58eb");
    expect(playbookServer).not.toContain("conversation_pilot_campaigns");
    expect(playbookServer).not.toContain("setCampaignAutomation");
    const update = server.slice(server.indexOf("conversation_pilot_campaigns: serialized"), server.indexOf('.eq("id", "default")'));
    expect(update).not.toContain("automation_status");
    expect(update).not.toContain("conversation_sending");
    expect(update).not.toContain("instantly_blocklist");
    const release = server.slice(server.indexOf("export async function releaseScheduledFulfillment"));
    expect(release).toContain("scheduled_at: now");
    expect(release).toContain('.eq("status", "scheduled")');
    expect(release).not.toContain('status: "accepted"');
    expect(release).not.toContain('status: "claimed"');
    const post = route.slice(route.indexOf("export async function POST"));
    expect(post.indexOf('intent === "activate"')).toBeLessThan(post.indexOf("saveCampaignPlaybook"));
    expect(post).toContain('intent === "finish"');
    const sql = readFileSync("supabase/migrations/20261024000000_acquisition_conversation_messages.sql", "utf8");
    expect(sql).toContain("jsonb_typeof(conversation_pilot_campaigns) = 'array'");
    const playbook = readFileSync("src/lib/acquisition/playbook.ts", "utf8");
    expect(playbook).toContain('instantlySequenceStop: "unverified"');
  });
});
