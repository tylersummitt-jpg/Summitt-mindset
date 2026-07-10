import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EVENING_CHECKIN_SMS_MAX_LEN,
  EVENING_PREVIEW_STALE_MS,
  sendTylerTextOverviewEveningDraft,
} from "@/lib/tyler-text-overview-evening-send";
import { finalizeTylerTextOverviewDraftAfterSend } from "@/lib/tyler-text-overview-send";

const sendSmsMock = vi.hoisted(() => vi.fn());
const isTwilioReadyMock = vi.hoisted(() => vi.fn());
const onCheckSentMock = vi.hoisted(() => vi.fn());
const loadAudienceMock = vi.hoisted(() => vi.fn());
const resolveV2Mock = vi.hoisted(() => vi.fn());
const fetchCommsMock = vi.hoisted(() => vi.fn());
const isPauseActiveMock = vi.hoisted(() => vi.fn());
const getActiveCommitmentMock = vi.hoisted(() => vi.fn());
const recentYesMock = vi.hoisted(() => vi.fn());

const db = vi.hoisted(() => ({
  drafts: [] as Array<Record<string, unknown>>,
  generations: [] as Array<Record<string, unknown>>,
  sendEvents: [] as Array<Record<string, unknown>>,
  audience: [] as Array<Record<string, unknown>>,
  commitmentEvents: [] as Array<Record<string, unknown>>,
  checkSentCalls: 0,
}));

const EVENING_BODY = "How did your evening check-in go today?";
const COMMITMENT_ID = "commit-evening-1";

function seedEveningDraft(overrides?: Partial<Record<string, unknown>>) {
  db.drafts = [
    {
      id: "draft-evening-1",
      clerk_user_id: "user_evening",
      draft_for_day_key: "2026-07-03",
      send_slot: "evening_checkin",
      current_generation_id: "gen-evening-1",
      current_body_to_send: EVENING_BODY,
      status: "current",
      updated_at: new Date().toISOString(),
      ...overrides,
    },
  ];
  db.generations = [
    {
      id: "gen-evening-1",
      commitment_id: COMMITMENT_ID,
      machine_should_send: true,
      generated_at: new Date().toISOString(),
      generation_metadata: {
        preview_only: true,
        morning_anchor_source: "send_event",
        morning_anchor_body_preview: "Morning body",
        slot_coaching_context: { current_slot: "evening_checkin" },
        v2_outbound_snapshot: {
          v2_commitment_id: COMMITMENT_ID,
          v2_template_id: 12,
          v2_template_family: "standard",
          v2_effective_ask_text: "Did you follow through today?",
          v2_prior_outcome: null,
          v2_blocker_preview: null,
        },
      },
    },
  ];
  db.sendEvents = [];
  db.audience = [
    {
      clerk_user_id: "user_evening",
      phone_number: "+15551234567",
      sms_enabled: true,
      stopped_at: null,
      timezone: "America/New_York",
      summitt_subscribed: true,
    },
  ];
  db.commitmentEvents = [];
}

function makeChain(state: { table: string; action: string; payload: Record<string, unknown> }) {
  const execute = async () => {
    const { table, payload } = state;

    if (table === "sms_daily_drafts" && state.action === "select") {
      let rows = [...db.drafts];
      if (payload.id) rows = rows.filter((d) => d.id === payload.id);
      return { data: payload.maybeSingle ? rows[0] ?? null : rows, error: null };
    }

    if (table === "sms_daily_draft_generations" && state.action === "select") {
      const row = db.generations.find((g) => g.id === payload.id) ?? null;
      return { data: row, error: null };
    }

    if (table === "sms_send_events" && state.action === "select") {
      const row =
        db.sendEvents.find(
          (e) =>
            e.clerk_user_id === payload.clerk_user_id &&
            e.day_key === payload.day_key &&
            e.send_slot === payload.send_slot
        ) ?? null;
      return { data: payload.maybeSingle ? row : row ? [row] : [], error: null };
    }

    if (table === "sms_send_events" && state.action === "insert") {
      const row = { id: `evt-${db.sendEvents.length + 1}`, ...state.insertPayload };
      db.sendEvents.push(row);
      return { data: { id: row.id }, error: null };
    }

    if (table === "sms_send_events" && state.action === "update") {
      const row = db.sendEvents.find((e) => e.id === payload.id);
      if (row) Object.assign(row, state.updatePayload);
      return { data: null, error: null };
    }

    if (table === "sms_audience" && state.action === "select") {
      const row = db.audience.find((a) => a.clerk_user_id === payload.clerk_user_id) ?? null;
      return { data: payload.maybeSingle ? row : row ? [row] : [], error: null };
    }

    if (table === "v2_commitment_event" && state.action === "select") {
      return { data: db.commitmentEvents, error: null };
    }

    if (table === "sms_daily_drafts" && state.action === "update") {
      const draft = db.drafts.find((d) => d.id === payload.id && d.status === payload.status);
      if (draft) Object.assign(draft, state.updatePayload);
      return { data: draft ?? null, error: null };
    }

    if (table === "sms_daily_draft_generations" && state.action === "update") {
      const gen = db.generations.find((g) => g.id === payload.id);
      if (gen) gen.generation_metadata = state.updatePayload?.generation_metadata;
      return { data: null, error: null };
    }

    return { data: null, error: null };
  };

  const self: Record<string, unknown> = { insertPayload: {}, updatePayload: {} };
  self.select = vi.fn(() => self);
  self.eq = vi.fn((col: string, val: unknown) => {
    state.payload[col] = val;
    return self;
  });
  self.insert = vi.fn((row: Record<string, unknown>) => {
    state.action = "insert";
    state.insertPayload = row;
    return { select: vi.fn(() => ({ maybeSingle: vi.fn(execute) })) };
  });
  self.update = vi.fn((row: Record<string, unknown>) => {
    state.action = "update";
    state.updatePayload = row;
    return self;
  });
  self.order = vi.fn(() => self);
  self.limit = vi.fn(() => self);
  self.maybeSingle = vi.fn(() => {
    state.payload.maybeSingle = true;
    return execute();
  });
  self.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    execute().then(onFulfilled, onRejected);

  return self;
}

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn((table: string) => makeChain({ table, action: "select", payload: {} })),
  },
}));

vi.mock("@/lib/twilio", () => ({
  sendSMS: sendSmsMock,
  isTwilioReady: isTwilioReadyMock,
}));

vi.mock("@/lib/v2-outbound-check-sent", () => ({
  onV2StandardCheckSentOutboundSendSuccess: onCheckSentMock,
}));

vi.mock("@/lib/tyler-text-overview-generate", () => ({
  loadTylerTextOverviewAudienceRow: loadAudienceMock,
}));

vi.mock("@/lib/v2-cutover-gates", () => ({
  resolveUserFullyOnV2ForCutoverMessaging: resolveV2Mock,
}));

vi.mock("@/lib/v2-sms-comms-preferences", () => ({
  fetchV2UserSmsCommsPreferences: fetchCommsMock,
  isPauseActive: isPauseActiveMock,
}));

vi.mock("@/lib/v2-commitment", () => ({
  getActiveCommitment: getActiveCommitmentMock,
}));

vi.mock("@/lib/north-star-sms-context-packet", () => ({
  recentEventsIncludeUserYesOnLocalDay: recentYesMock,
}));

describe("tyler-text-overview-evening-send", () => {
  beforeEach(() => {
    seedEveningDraft();
    sendSmsMock.mockReset();
    sendSmsMock.mockResolvedValue({ sid: "SM-evening-1", status: "queued" });
    isTwilioReadyMock.mockReturnValue(true);
    onCheckSentMock.mockReset();
    onCheckSentMock.mockResolvedValue(undefined);
    loadAudienceMock.mockResolvedValue({
      clerk_user_id: "user_evening",
      phone_number: "+15551234567",
      sms_enabled: true,
      stopped_at: null,
      timezone: "America/New_York",
      summitt_subscribed: true,
    });
    resolveV2Mock.mockResolvedValue({ fullyOnV2: true });
    fetchCommsMock.mockResolvedValue(null);
    isPauseActiveMock.mockReturnValue(false);
    getActiveCommitmentMock.mockResolvedValue({ id: COMMITMENT_ID });
    recentYesMock.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("manual send sends Twilio exactly once and writes evening sms_send_events", async () => {
    const result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    expect(result.sendSlot).toBe("evening_checkin");
    expect(result.twilioMessageSid).toBe("SM-evening-1");
    expect(db.sendEvents).toHaveLength(1);
    expect(db.sendEvents[0].send_slot).toBe("evening_checkin");
    expect(db.sendEvents[0].message_sid).toBe("SM-evening-1");
  });

  it("updates sms_daily_drafts sent fields and generation preview_only=false", async () => {
    const result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(true);
    expect(db.drafts[0].status).toBe("sent");
    expect(db.drafts[0].final_body_sent).toBe(EVENING_BODY);
    expect(db.drafts[0].twilio_message_sid).toBe("SM-evening-1");
    expect((db.generations[0].generation_metadata as Record<string, unknown>).preview_only).toBe(
      false
    );
  });

  it("creates V2 check_sent with :evening_checkin idempotency key", async () => {
    const result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(onCheckSentMock).toHaveBeenCalledTimes(1);
    expect(result.checkSentIdempotencyKey).toBe(
      `v2_check_sent:${COMMITMENT_ID}:2026-07-03:evening_checkin`
    );
    const args = onCheckSentMock.mock.calls[0]?.[0];
    expect(args.checkPayloadJson.send_slot).toBe("evening_checkin");
    expect(args.promptKind).toBe("standard_accountability");
    expect(args.expectedReplySemantics).toBe("yes_no_partial");
  });

  it("refuses already sent evening sms_send_events row", async () => {
    db.sendEvents.push({
      id: "evt-existing",
      clerk_user_id: "user_evening",
      day_key: "2026-07-03",
      send_slot: "evening_checkin",
      status: "queued",
      message_sid: "SM-old",
      metadata: { twilio_message_sid: "SM-old" },
    });

    const result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("already_sent_evening_today");
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it("refuses reserved evening sms_send_events row", async () => {
    db.sendEvents.push({
      id: "evt-reserved",
      clerk_user_id: "user_evening",
      day_key: "2026-07-03",
      send_slot: "evening_checkin",
      status: "reserved",
      metadata: {},
    });

    const result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("already_reserved_evening_today");
  });

  it("refuses machine_should_send=false", async () => {
    db.generations[0].machine_should_send = false;
    const result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("machine_should_send_false");
  });

  it("sends edited current_body_to_send and finalizes that body", async () => {
    const edited = "Tyler edited evening check-in body.";
    seedEveningDraft({
      current_body_to_send: edited,
      edited_by_tyler: true,
      current_body_source: "tyler_edit",
    });
    const result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sendSmsMock).toHaveBeenCalledWith(
      expect.objectContaining({ body: edited })
    );
    expect(result.finalBodySent).toBe(edited);
    expect(db.drafts[0].final_body_sent).toBe(edited);
    expect(db.sendEvents[0].sms_body).toBe(edited);
    expect(onCheckSentMock.mock.calls[0]?.[0].smsBody).toBe(edited);
  });

  it("machine_should_send=false still blocks when draft is Tyler-edited", async () => {
    seedEveningDraft({
      current_body_to_send: "Edited but machine said no",
      edited_by_tyler: true,
      current_body_source: "tyler_edit",
    });
    db.generations[0].machine_should_send = false;
    const result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("machine_should_send_false");
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it("refuses no phone", async () => {
    db.audience[0].phone_number = "";
    const result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("no_phone");
  });

  it("refuses sms disabled and stopped/unsubscribed", async () => {
    db.audience[0].sms_enabled = false;
    let result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("sms_disabled");

    seedEveningDraft();
    db.audience[0].stopped_at = "2026-01-01T00:00:00.000Z";
    result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("stopped_or_unsubscribed");
  });

  it("refuses paused/canceled subscription", async () => {
    isPauseActiveMock.mockReturnValue(true);
    let result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("paused_or_canceled");

    seedEveningDraft();
    db.audience[0].summitt_subscribed = false;
    result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("paused_or_canceled");
  });

  it("refuses user_yes today but allows when only user_no/partial today", async () => {
    recentYesMock.mockReturnValue(true);
    db.commitmentEvents.push({
      event_type: "user_yes",
      occurred_at: "2026-07-03T12:00:00.000Z",
    });
    let result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("user_completed_today");

    seedEveningDraft();
    recentYesMock.mockReturnValue(false);
    db.commitmentEvents.push({
      event_type: "user_no",
      occurred_at: "2026-07-03T12:00:00.000Z",
    });
    result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(true);
  });

  it("refuses empty and too-long body", async () => {
    db.drafts[0].current_body_to_send = "   ";
    let result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("body_empty");

    seedEveningDraft();
    db.drafts[0].current_body_to_send = "x".repeat(EVENING_CHECKIN_SMS_MAX_LEN + 1);
    result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("body_too_long");
  });

  it("refuses stale preview older than 4 hours", async () => {
    const stale = new Date(Date.now() - EVENING_PREVIEW_STALE_MS - 60_000).toISOString();
    db.generations[0].generated_at = stale;
    const result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("stale_preview");
  });

  it("Twilio failure marks send_failed and does not mark draft sent", async () => {
    sendSmsMock.mockRejectedValue(new Error("twilio_down"));
    const result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("twilio_failed");
    expect(db.drafts[0].status).toBe("current");
    expect(db.sendEvents[0].status).toBe("send_failed");
    expect(onCheckSentMock).not.toHaveBeenCalled();
  });

  it("post-send bookkeeping failure does not re-send Twilio", async () => {
    onCheckSentMock.mockRejectedValue(new Error("check_sent_failed"));
    const result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("post_send_bookkeeping_failed");
    expect(result.twilioMessageSid).toBe("SM-evening-1");
    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    expect(db.drafts[0].status).toBe("sent");
  });

  it("morning finalize path still refuses evening preview draft", async () => {
    seedEveningDraft();
    const result = await finalizeTylerTextOverviewDraftAfterSend({
      draftId: "draft-evening-1",
      clerkUserId: "user_evening",
      dayKey: "2026-07-03",
      twilioMessageSid: "SM123",
      finalBodySent: EVENING_BODY,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("preview_only_draft_not_sendable");
  });

  it("does not modify daily-sms cron route", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/cron/daily-sms/route.ts"),
      "utf8"
    );
    expect(src).not.toContain("tyler-text-overview-evening-send");
    expect(src).not.toContain("evening-send");
  });

  it("evening send module does not add deterministic English phrase routing", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-evening-send.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/user replied|phrase|regex.*done/i);
    expect(src).not.toContain("completeDay");
  });
});

describe("evening-send admin route", () => {
  it("uses requireTylerAdmin and evening send service", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/admin/tyler-text-overview/evening-send/route.ts"),
      "utf8"
    );
    expect(src).toContain("requireTylerAdmin");
    expect(src).toContain("sendTylerTextOverviewEveningDraft");
    expect(src).toContain("manual_one");
  });
});
