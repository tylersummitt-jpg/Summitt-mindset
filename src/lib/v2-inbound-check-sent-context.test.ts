import { describe, expect, it } from "vitest";

import { buildV2ActiveReplyContext } from "@/lib/v2-active-reply-context";
import {
  findLatestCheckSentEvent,
  resolveAccountabilityPromptLiveState,
  resolveInboundCheckSentPrompt,
} from "@/lib/v2-inbound-check-sent-context";
import type { V2EventRowForAi } from "@/lib/v2-commitment";

const DEFAULT_CTX = {
  commitmentTitle: "Distribution",
  behaviorStatement: "Spend an hour on distribution.",
  effectiveAsk: "Spend an hour on distribution.",
};

function morningCheck(at: string): V2EventRowForAi {
  return {
    event_type: "check_sent",
    occurred_at: at,
    payload_json: {
      send_slot: "morning",
      body_preview: "Morning check — did you do distribution today?",
    },
  };
}

function eveningCheck(at: string): V2EventRowForAi {
  return {
    event_type: "check_sent",
    occurred_at: at,
    payload_json: {
      send_slot: "evening_checkin",
      body_preview: "Evening check — did you follow through today?",
    },
  };
}

describe("resolveInboundCheckSentPrompt", () => {
  it("chooses morning when only morning exists", () => {
    const events = [morningCheck("2026-07-07T14:00:00.000Z")];
    const r = resolveInboundCheckSentPrompt(events);
    expect(r.latestOutboundSendSlot).toBe("morning");
    expect(r.activeCheckSentSendSlot).toBe("morning");
    expect(r.lastOutboundSmsPreview).toContain("Morning check");
  });

  it("chooses evening_checkin when it is newer than morning", () => {
    const events = [
      eveningCheck("2026-07-07T23:00:00.000Z"),
      morningCheck("2026-07-07T14:00:00.000Z"),
    ];
    const r = resolveInboundCheckSentPrompt(events);
    expect(r.latestOutboundSendSlot).toBe("evening_checkin");
    expect(r.activeCheckSentSendSlot).toBe("evening_checkin");
    expect(r.lastOutboundSmsPreview).toContain("Evening check");
  });

  it("evening is live after morning user_yes", () => {
    const events = [
      eveningCheck("2026-07-07T23:00:00.000Z"),
      {
        event_type: "user_yes",
        occurred_at: "2026-07-07T15:00:00.000Z",
        payload_json: {},
      },
      morningCheck("2026-07-07T14:00:00.000Z"),
    ];
    const live = resolveAccountabilityPromptLiveState(events);
    expect(live.hasLiveAccountabilityPrompt).toBe(true);
    expect(live.activeCheckSentSendSlot).toBe("evening_checkin");
    expect(live.latestOutboundSendSlot).toBe("evening_checkin");
  });

  it("morning is not live after morning user_yes when no evening check", () => {
    const events = [
      {
        event_type: "user_yes",
        occurred_at: "2026-07-07T15:00:00.000Z",
        payload_json: {},
      },
      morningCheck("2026-07-07T14:00:00.000Z"),
    ];
    const live = resolveAccountabilityPromptLiveState(events);
    expect(live.hasLiveAccountabilityPrompt).toBe(false);
    expect(live.activeCheckSentSendSlot).toBeNull();
    expect(live.latestOutboundSendSlot).toBe("morning");
  });
});

describe("buildV2ActiveReplyContext — slot fields", () => {
  it("exposes latest_outbound_send_slot and active_check_sent_send_slot", () => {
    const events = [
      eveningCheck("2026-07-07T23:00:00.000Z"),
      morningCheck("2026-07-07T14:00:00.000Z"),
    ];
    const ctx = buildV2ActiveReplyContext({
      inboundText: "done",
      eventsNewestFirst: events,
      nowMs: Date.parse("2026-07-07T23:30:00.000Z"),
      ...DEFAULT_CTX,
    });
    expect(ctx.latest_outbound_send_slot).toBe("evening_checkin");
    expect(ctx.active_check_sent_send_slot).toBe("evening_checkin");
    expect(ctx.has_live_accountability_prompt).toBe(true);
  });

  it("bare Yes after answered morning still forces clarification without evening", () => {
    const events = [
      {
        event_type: "user_yes",
        occurred_at: "2026-05-02T21:27:53.000Z",
        payload_json: {},
      },
      {
        event_type: "check_sent",
        occurred_at: "2026-05-02T19:00:52.000Z",
        payload_json: { send_slot: "morning" },
      },
    ];
    const ctx = buildV2ActiveReplyContext({
      inboundText: "Yes",
      eventsNewestFirst: events,
      nowMs: Date.parse("2026-05-03T01:15:00.000Z"),
      ...DEFAULT_CTX,
    });
    expect(ctx.should_force_clarification_for_ambiguous_short_reply).toBe(true);
    expect(ctx.active_check_sent_send_slot).toBeNull();
  });

  it("done after evening with live evening prompt allows scoring path", () => {
    const events = [
      eveningCheck("2026-07-07T23:00:00.000Z"),
      {
        event_type: "user_yes",
        occurred_at: "2026-07-07T15:00:00.000Z",
        payload_json: {},
      },
      morningCheck("2026-07-07T14:00:00.000Z"),
    ];
    const ctx = buildV2ActiveReplyContext({
      inboundText: "done",
      eventsNewestFirst: events,
      nowMs: Date.parse("2026-07-07T23:30:00.000Z"),
      ...DEFAULT_CTX,
    });
    expect(ctx.has_live_accountability_prompt).toBe(true);
    expect(ctx.active_check_sent_send_slot).toBe("evening_checkin");
    expect(ctx.should_allow_bare_accountability_score).toBe(true);
  });
});

describe("findLatestCheckSentEvent — legacy payloads", () => {
  it("defaults missing send_slot to morning", () => {
    const events: V2EventRowForAi[] = [
      {
        event_type: "check_sent",
        occurred_at: "2026-07-07T14:00:00.000Z",
        payload_json: { body_preview: "Legacy morning" },
      },
    ];
    expect(findLatestCheckSentEvent(events).sendSlot).toBe("morning");
  });
});
