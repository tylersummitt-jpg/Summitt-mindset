import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  assertWeeklyTtoDraftAuthoritativeForCronSend,
  assertWeeklyTtoDraftAuthoritativeForManualSend,
  buildWeeklyTtoFinalBodyWithFooter,
  sendWeeklyTtoDraftAuthoritative,
  sendWeeklyTtoDraftManually,
  sendWeeklyTtoDraftViaCron,
  WEEKLY_TTO_COMPLIANCE_FOOTER,
  WEEKLY_TTO_CRON_SEND_SOURCE,
  WEEKLY_TTO_MANUAL_SEND_SOURCE,
} from "@/lib/tyler-text-overview-weekly-send";
import {
  isWeeklyManualSendEligible,
  weeklySendButtonLabel,
  WEEKLY_TTO_AUTHORITY_BANNER,
  WEEKLY_TTO_FOOTER_AT_SEND_COPY,
  WEEKLY_TTO_MANUAL_SEND_NOTE,
  WEEKLY_TTO_SAVE_BEFORE_SEND_COPY,
  EVENING_TTO_SAVE_BEFORE_SEND_COPY,
  eveningSendButtonLabel,
} from "@/lib/tyler-text-overview-dashboard-copy";

const sendSmsMock = vi.hoisted(() => vi.fn());
const isTwilioReadyMock = vi.hoisted(() => vi.fn());
const loadAudienceMock = vi.hoisted(() => vi.fn());
const resolveV2Mock = vi.hoisted(() => vi.fn());
const fetchCommsMock = vi.hoisted(() => vi.fn());
const isPauseActiveMock = vi.hoisted(() => vi.fn());
const getActiveCommitmentMock = vi.hoisted(() => vi.fn());
const upsertThreadMemoryMock = vi.hoisted(() => vi.fn());

const db = vi.hoisted(() => ({
  drafts: [] as Array<Record<string, unknown>>,
  generations: [] as Array<Record<string, unknown>>,
  weeklyEvents: [] as Array<Record<string, unknown>>,
  sendEvents: [] as Array<Record<string, unknown>>,
  commitmentEvents: [] as Array<Record<string, unknown>>,
  forceWeeklyInsertError: null as { code?: string; message?: string } | null,
  smsSendEventsInsertCount: 0,
  checkSentWriteCount: 0,
  commitmentEventInsertCount: 0,
}));

const WEEKLY_BODY = "This week you showed up three times. What made that possible?";
const COMMITMENT_ID = "commit-weekly-1";
const WEEK_KEY = "2026-W29";

function seedWeeklyDraft(overrides?: {
  draft?: Partial<Record<string, unknown>>;
  generation?: Partial<Record<string, unknown>>;
}) {
  db.drafts = [
    {
      id: "draft-weekly-1",
      clerk_user_id: "user_weekly",
      draft_for_day_key: "2026-07-12",
      send_slot: "weekly_review",
      current_generation_id: "gen-weekly-1",
      current_body_to_send: WEEKLY_BODY,
      status: "current",
      updated_at: new Date().toISOString(),
      ...overrides?.draft,
    },
  ];
  db.generations = [
    {
      id: "gen-weekly-1",
      send_slot: "weekly_review",
      commitment_id: COMMITMENT_ID,
      machine_should_send: true,
      machine_no_send_reason: null,
      timezone_snapshot: "America/New_York",
      generation_metadata: {
        week_key: WEEK_KEY,
        week_start: "2026-07-06",
        week_end: "2026-07-12",
        timezone: "America/New_York",
        send_slot: "weekly_review",
        draft_excludes_compliance_footer: true,
      },
      ...overrides?.generation,
    },
  ];
  db.weeklyEvents = [];
  db.sendEvents = [];
  db.commitmentEvents = [];
  db.forceWeeklyInsertError = null;
  db.smsSendEventsInsertCount = 0;
  db.checkSentWriteCount = 0;
  db.commitmentEventInsertCount = 0;
}

function makeChain(state: {
  table: string;
  action: string;
  payload: Record<string, unknown>;
  insertPayload?: Record<string, unknown>;
  updatePayload?: Record<string, unknown>;
}) {
  const execute = async () => {
    const { table, payload } = state;

    if (table === "sms_daily_drafts" && state.action === "select") {
      let rows = [...db.drafts];
      if (payload.id) rows = rows.filter((d) => d.id === payload.id);
      if (payload.clerk_user_id) {
        rows = rows.filter((d) => d.clerk_user_id === payload.clerk_user_id);
      }
      if (payload.send_slot) {
        rows = rows.filter((d) => d.send_slot === payload.send_slot);
      }
      if (payload.status) {
        rows = rows.filter((d) => d.status === payload.status);
      }
      return { data: payload.maybeSingle ? rows[0] ?? null : rows, error: null };
    }

    if (table === "sms_daily_draft_generations" && state.action === "select") {
      const row = db.generations.find((g) => g.id === payload.id) ?? null;
      return { data: row, error: null };
    }

    if (table === "sms_weekly_send_events" && state.action === "insert") {
      if (db.forceWeeklyInsertError) {
        return { data: null, error: db.forceWeeklyInsertError };
      }
      const existing = db.weeklyEvents.find(
        (e) =>
          e.clerk_user_id === state.insertPayload?.clerk_user_id &&
          e.week_key === state.insertPayload?.week_key
      );
      if (existing) {
        return {
          data: null,
          error: { code: "23505", message: "duplicate key value violates unique constraint" },
        };
      }
      const row = {
        id: `weekly-evt-${db.weeklyEvents.length + 1}`,
        ...state.insertPayload,
      };
      db.weeklyEvents.push(row);
      return { data: { id: row.id }, error: null };
    }

    if (table === "sms_weekly_send_events" && state.action === "update") {
      const row = db.weeklyEvents.find(
        (e) =>
          e.clerk_user_id === payload.clerk_user_id && e.week_key === payload.week_key
      );
      if (row && state.updatePayload) Object.assign(row, state.updatePayload);
      return { data: null, error: null };
    }

    if (table === "sms_send_events" && state.action === "insert") {
      db.smsSendEventsInsertCount += 1;
      db.sendEvents.push({ id: `sse-${db.sendEvents.length + 1}`, ...state.insertPayload });
      return { data: { id: `sse-${db.sendEvents.length}` }, error: null };
    }

    if (table === "sms_send_events") {
      return { data: null, error: null };
    }

    if (table === "v2_commitment_event" && state.action === "insert") {
      db.commitmentEventInsertCount += 1;
      db.checkSentWriteCount += 1;
      return { data: null, error: null };
    }

    if (table === "sms_daily_drafts" && state.action === "update") {
      const draft = db.drafts.find((d) => d.id === payload.id && d.status === payload.status);
      if (draft && state.updatePayload) Object.assign(draft, state.updatePayload);
      return { data: draft ?? null, error: null };
    }

    if (table === "sms_daily_draft_generations" && state.action === "update") {
      const gen = db.generations.find((g) => g.id === payload.id);
      if (gen && state.updatePayload) {
        if (state.updatePayload.generation_metadata != null) {
          gen.generation_metadata = state.updatePayload.generation_metadata;
        }
        Object.assign(gen, state.updatePayload);
      }
      return { data: null, error: null };
    }

    return { data: null, error: null };
  };

  const self: Record<string, unknown> = {};
  self.select = vi.fn(() => self);
  self.eq = vi.fn((col: string, val: unknown) => {
    state.payload[col] = val;
    return self;
  });
  self.insert = vi.fn((row: Record<string, unknown>) => {
    state.action = "insert";
    state.insertPayload = row;
    return {
      select: vi.fn(() => ({
        maybeSingle: vi.fn(execute),
      })),
    };
  });
  self.update = vi.fn((row: Record<string, unknown>) => {
    state.action = "update";
    state.updatePayload = row;
    return self;
  });
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

vi.mock("@/lib/account-deletion/deletion-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/account-deletion/deletion-guards")>();
  return {
    ...actual,
    evaluateOutboundSmsForAccountDeletion: vi.fn(async () => ({
      decision: "allowed" as const,
    })),
  };
});

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

vi.mock("@/lib/v2-commitment-sms-thread-memory", () => ({
  upsertCommitmentSmsThreadMemoryFromOutbound: upsertThreadMemoryMock,
}));

const REPO = process.cwd();

describe("assertWeeklyTtoDraftAuthoritativeForManualSend", () => {
  beforeEach(() => {
    seedWeeklyDraft();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires weekly_review current draft", async () => {
    const result = await assertWeeklyTtoDraftAuthoritativeForManualSend({
      draftId: "draft-weekly-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.weekKey).toBe(WEEK_KEY);
    expect(result.draft.bodyWithoutFooter).toBe(WEEKLY_BODY);
  });

  it("blocks wrong slot", async () => {
    seedWeeklyDraft({ draft: { send_slot: "morning" } });
    const result = await assertWeeklyTtoDraftAuthoritativeForManualSend({
      draftId: "draft-weekly-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("wrong_slot");
  });

  it("blocks no draft", async () => {
    db.drafts = [];
    const result = await assertWeeklyTtoDraftAuthoritativeForManualSend({
      draftId: "missing",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("no_draft");
  });

  it("blocks sent / non-current draft", async () => {
    seedWeeklyDraft({ draft: { status: "sent" } });
    const result = await assertWeeklyTtoDraftAuthoritativeForManualSend({
      draftId: "draft-weekly-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("draft_not_current");
  });

  it("blocks missing generation", async () => {
    seedWeeklyDraft({ draft: { current_generation_id: null } });
    const result = await assertWeeklyTtoDraftAuthoritativeForManualSend({
      draftId: "draft-weekly-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("missing_generation");
  });

  it("blocks week_key mismatch", async () => {
    const result = await assertWeeklyTtoDraftAuthoritativeForManualSend({
      draftId: "draft-weekly-1",
      weekKey: "2026-W28",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("week_key_mismatch");
  });

  it("blocks blank body", async () => {
    seedWeeklyDraft({ draft: { current_body_to_send: "   " } });
    const result = await assertWeeklyTtoDraftAuthoritativeForManualSend({
      draftId: "draft-weekly-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("blank_body");
  });

  it("blocks machine_should_send=false", async () => {
    seedWeeklyDraft({
      generation: { machine_should_send: false, machine_no_send_reason: "no_safe_voice" },
    });
    const result = await assertWeeklyTtoDraftAuthoritativeForManualSend({
      draftId: "draft-weekly-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("machine_should_send_false");
  });
});

describe("sendWeeklyTtoDraftManually", () => {
  beforeEach(async () => {
    seedWeeklyDraft();
    sendSmsMock.mockReset();
    sendSmsMock.mockResolvedValue({ sid: "SM-weekly-1", status: "queued" });
    isTwilioReadyMock.mockReturnValue(true);
    loadAudienceMock.mockResolvedValue({
      clerk_user_id: "user_weekly",
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
    upsertThreadMemoryMock.mockResolvedValue({ ok: true });
    const { evaluateOutboundSmsForAccountDeletion } = await import(
      "@/lib/account-deletion/deletion-guards"
    );
    vi.mocked(evaluateOutboundSmsForAccountDeletion).mockResolvedValue({
      decision: "allowed",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends Tyler-edited current_body_to_send with footer", async () => {
    const edited = "Tyler edited weekly body — keep this exact text.";
    seedWeeklyDraft({ draft: { current_body_to_send: edited } });

    const result = await sendWeeklyTtoDraftManually({
      draftId: "draft-weekly-1",
      requestedByClerkUserId: "admin_tyler",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    const call = sendSmsMock.mock.calls[0]?.[0];
    expect(call.body).toBe(buildWeeklyTtoFinalBodyWithFooter(edited));
    expect(call.body).toContain(WEEKLY_TTO_COMPLIANCE_FOOTER);
    expect(call.lastOutbound.messageKind).toBe("weekly");
    expect(result.bodyWithoutFooter).toBe(edited);
    expect(result.finalBodySent).toBe(call.body);
  });

  it("does not call weekly writer / proof pack / produceWeeklyV3RelationshipSms", async () => {
    await sendWeeklyTtoDraftManually({
      draftId: "draft-weekly-1",
      requestedByClerkUserId: "admin_tyler",
    });
    const sendSrc = readFileSync(
      join(REPO, "src/lib/tyler-text-overview-weekly-send.ts"),
      "utf8"
    );
    expect(sendSrc).not.toContain("produceWeeklyV3RelationshipSms");
    expect(sendSrc).not.toContain("buildV2WeeklyProofPack");
    expect(sendSrc).not.toMatch(/openai/i);
    expect(sendSrc).not.toContain("v3-weekly-outbound-relationship-lane");
    expect(sendSrc).not.toContain("v2-weekly-proof-sms");
  });

  it("reserves sms_weekly_send_events before Twilio", async () => {
    sendSmsMock.mockImplementation(async () => {
      expect(db.weeklyEvents).toHaveLength(1);
      expect(db.weeklyEvents[0].status).toBe("reserved");
      expect(db.weeklyEvents[0].message_sid).toBeUndefined();
      return { sid: "SM-weekly-1", status: "queued" };
    });

    const result = await sendWeeklyTtoDraftManually({
      draftId: "draft-weekly-1",
      requestedByClerkUserId: "admin_tyler",
    });
    expect(result.ok).toBe(true);
    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    expect(db.weeklyEvents).toHaveLength(1);
    expect(db.weeklyEvents[0].message_sid).toBe("SM-weekly-1");
  });

  it("blocks duplicate sms_weekly_send_events and does not send", async () => {
    db.weeklyEvents.push({
      id: "existing",
      clerk_user_id: "user_weekly",
      week_key: WEEK_KEY,
      status: "queued",
    });

    const result = await sendWeeklyTtoDraftManually({
      draftId: "draft-weekly-1",
      requestedByClerkUserId: "admin_tyler",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("duplicate_weekly_send");
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it("Twilio failure updates event to send_failed and does not mark draft sent", async () => {
    sendSmsMock.mockRejectedValue(new Error("twilio boom"));

    const result = await sendWeeklyTtoDraftManually({
      draftId: "draft-weekly-1",
      requestedByClerkUserId: "admin_tyler",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("twilio_failed");
    expect(db.weeklyEvents[0].status).toBe("send_failed");
    expect(db.drafts[0].status).toBe("current");
    expect(db.drafts[0].final_body_sent).toBeUndefined();
  });

  it("APP-041B2b blocked_due_to_deletion → terminal skipped_account_deletion, no Twilio", async () => {
    const { evaluateOutboundSmsForAccountDeletion } = await import(
      "@/lib/account-deletion/deletion-guards"
    );
    vi.mocked(evaluateOutboundSmsForAccountDeletion).mockResolvedValueOnce({
      decision: "blocked_due_to_deletion",
      scope: "unresolved",
    });

    const result = await sendWeeklyTtoDraftManually({
      draftId: "draft-weekly-1",
      requestedByClerkUserId: "admin_tyler",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("account_deletion_blocks_sms");
    expect(result.recoverable).toBe(false);
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(db.weeklyEvents).toHaveLength(0);
    expect(db.drafts[0].status).toBe("current");
  });

  it("APP-041B2b lookup_failed after reserve → send_failed retryable, not skipped_account_deletion", async () => {
    const { AccountDeletionOutboundSmsError } = await import(
      "@/lib/account-deletion/deletion-guards"
    );
    sendSmsMock.mockRejectedValueOnce(
      new AccountDeletionOutboundSmsError("lookup_failed")
    );

    const result = await sendWeeklyTtoDraftManually({
      draftId: "draft-weekly-1",
      requestedByClerkUserId: "admin_tyler",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("deletion_lookup_failed");
    expect(result.recoverable).toBe(true);
    expect(db.weeklyEvents[0].status).toBe("send_failed");
    expect((db.weeklyEvents[0].metadata as { note?: string }).note).toBe(
      "deletion_lookup_failed"
    );
    expect(db.drafts[0].status).toBe("current");
    expect(db.drafts[0].final_body_sent).toBeUndefined();
  });

  it("success updates weekly event metadata and finalizes draft as sent", async () => {
    const result = await sendWeeklyTtoDraftManually({
      draftId: "draft-weekly-1",
      requestedByClerkUserId: "admin_tyler",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const evt = db.weeklyEvents[0];
    expect(evt.message_sid).toBe("SM-weekly-1");
    expect(evt.status).toBe("queued");
    const meta = evt.metadata as Record<string, unknown>;
    expect(meta.send_source).toBe(WEEKLY_TTO_MANUAL_SEND_SOURCE);
    expect(meta.draft_id).toBe("draft-weekly-1");
    expect(meta.generation_id).toBe("gen-weekly-1");
    expect(meta.week_key).toBe(WEEK_KEY);
    expect(meta.body_without_footer).toBe(WEEKLY_BODY);
    expect(meta.sms_body).toBe(buildWeeklyTtoFinalBodyWithFooter(WEEKLY_BODY));
    expect(meta.draft_excludes_compliance_footer).toBe(true);
    expect(meta.stripped_compliance_footer).toBe(true);
    expect(typeof meta.sent_at).toBe("string");

    expect(db.drafts[0].status).toBe("sent");
    expect(db.drafts[0].final_body_sent).toBe(buildWeeklyTtoFinalBodyWithFooter(WEEKLY_BODY));
    expect(db.drafts[0].twilio_message_sid).toBe("SM-weekly-1");
    expect(db.drafts[0].source_sms_send_event_id).toBe(evt.id);
  });

  it("writes thread memory with weekly_sms source and body without footer", async () => {
    await sendWeeklyTtoDraftManually({
      draftId: "draft-weekly-1",
      requestedByClerkUserId: "admin_tyler",
    });
    expect(upsertThreadMemoryMock).toHaveBeenCalledTimes(1);
    const args = upsertThreadMemoryMock.mock.calls[0]?.[0];
    expect(args.source).toBe("weekly_sms");
    expect(args.sentBody).toBe(WEEKLY_BODY);
    expect(args.sentBody).not.toContain(WEEKLY_TTO_COMPLIANCE_FOOTER);
    expect(args.commitmentId).toBe(COMMITMENT_ID);
  });

  it("does not write sms_send_events, check_sent, or v2_commitment_event", async () => {
    await sendWeeklyTtoDraftManually({
      draftId: "draft-weekly-1",
      requestedByClerkUserId: "admin_tyler",
    });
    expect(db.smsSendEventsInsertCount).toBe(0);
    expect(db.sendEvents).toHaveLength(0);
    expect(db.checkSentWriteCount).toBe(0);
    expect(db.commitmentEventInsertCount).toBe(0);

    const sendSrc = readFileSync(
      join(REPO, "src/lib/tyler-text-overview-weekly-send.ts"),
      "utf8"
    );
    expect(sendSrc).not.toContain('from("sms_send_events")');
    expect(sendSrc).not.toContain("onV2StandardCheckSent");
    expect(sendSrc).not.toContain("v2_commitment_event");
    expect(sendSrc).not.toContain('event_type: "check_sent"');
  });

  it("returns twilio_not_ready when Twilio is not configured", async () => {
    isTwilioReadyMock.mockReturnValue(false);
    const result = await sendWeeklyTtoDraftManually({
      draftId: "draft-weekly-1",
      requestedByClerkUserId: "admin_tyler",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("twilio_not_ready");
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(db.weeklyEvents).toHaveLength(0);
  });
});

describe("assertWeeklyTtoDraftAuthoritativeForCronSend", () => {
  beforeEach(() => {
    seedWeeklyDraft();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads current weekly_review draft by clerk_user_id + week_key", async () => {
    const result = await assertWeeklyTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_weekly",
      weekKey: WEEK_KEY,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.draftId).toBe("draft-weekly-1");
    expect(result.draft.bodyWithoutFooter).toBe(WEEKLY_BODY);
  });

  it("no draft = no_draft", async () => {
    db.drafts = [];
    const result = await assertWeeklyTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_weekly",
      weekKey: WEEK_KEY,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("no_draft");
  });

  it("week_key mismatch blocks", async () => {
    const result = await assertWeeklyTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_weekly",
      weekKey: "2026-W28",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("week_key_mismatch");
  });

  it("ambiguous multiple current drafts for same week blocks", async () => {
    db.drafts.push({
      id: "draft-weekly-2",
      clerk_user_id: "user_weekly",
      draft_for_day_key: "2026-07-12",
      send_slot: "weekly_review",
      current_generation_id: "gen-weekly-2",
      current_body_to_send: "Second draft",
      status: "current",
    });
    db.generations.push({
      id: "gen-weekly-2",
      send_slot: "weekly_review",
      commitment_id: COMMITMENT_ID,
      machine_should_send: true,
      generation_metadata: { week_key: WEEK_KEY },
    });
    const result = await assertWeeklyTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_weekly",
      weekKey: WEEK_KEY,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("ambiguous_weekly_draft");
  });

  it("blank body / machine false / missing generation block", async () => {
    seedWeeklyDraft({ draft: { current_body_to_send: "  " } });
    let result = await assertWeeklyTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_weekly",
      weekKey: WEEK_KEY,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.result.refusalCode).toBe("blank_body");

    seedWeeklyDraft({ generation: { machine_should_send: false } });
    result = await assertWeeklyTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_weekly",
      weekKey: WEEK_KEY,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.result.refusalCode).toBe("machine_should_send_false");

    seedWeeklyDraft({ draft: { current_generation_id: null } });
    result = await assertWeeklyTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_weekly",
      weekKey: WEEK_KEY,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.result.refusalCode).toBe("missing_generation");
  });
});

describe("sendWeeklyTtoDraftViaCron / shared core", () => {
  beforeEach(() => {
    seedWeeklyDraft();
    sendSmsMock.mockReset();
    sendSmsMock.mockResolvedValue({ sid: "SM-cron-1", status: "accepted" });
    isTwilioReadyMock.mockReturnValue(true);
    getActiveCommitmentMock.mockResolvedValue({ id: COMMITMENT_ID });
    upsertThreadMemoryMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("cron send uses send_source weekly_tto_cron and footer body", async () => {
    const result = await sendWeeklyTtoDraftViaCron({
      clerkUserId: "user_weekly",
      weekKey: WEEK_KEY,
      phoneTo: "+15551234567",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    expect(sendSmsMock.mock.calls[0]?.[0].body).toBe(
      buildWeeklyTtoFinalBodyWithFooter(WEEKLY_BODY)
    );
    expect(sendSmsMock.mock.calls[0]?.[0].lastOutbound.messageKind).toBe("weekly");
    expect(db.weeklyEvents[0].metadata).toMatchObject({
      send_source: WEEKLY_TTO_CRON_SEND_SOURCE,
      body_without_footer: WEEKLY_BODY,
    });
    expect(db.drafts[0].status).toBe("sent");
    expect(db.drafts[0].final_body_sent).toBe(buildWeeklyTtoFinalBodyWithFooter(WEEKLY_BODY));
  });

  it("manual-sent duplicate blocks cron before Twilio", async () => {
    db.weeklyEvents.push({
      id: "existing-manual",
      clerk_user_id: "user_weekly",
      week_key: WEEK_KEY,
      status: "accepted",
      metadata: { send_source: WEEKLY_TTO_MANUAL_SEND_SOURCE },
    });
    const result = await sendWeeklyTtoDraftViaCron({
      clerkUserId: "user_weekly",
      weekKey: WEEK_KEY,
      phoneTo: "+15551234567",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe("duplicate_weekly_send");
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it("shared core does not double-append footer", async () => {
    const auth = await assertWeeklyTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_weekly",
      weekKey: WEEK_KEY,
    });
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    await sendWeeklyTtoDraftAuthoritative({
      draft: auth.draft,
      sendSource: WEEKLY_TTO_CRON_SEND_SOURCE,
      phoneTo: "+15551234567",
    });
    const body = sendSmsMock.mock.calls[0]?.[0].body as string;
    const footerCount = body.split(WEEKLY_TTO_COMPLIANCE_FOOTER).length - 1;
    expect(footerCount).toBe(1);
  });
});

describe("weekly send route / UI static contracts", () => {
  it("route exists and is POST-only one-row", () => {
    const routePath = join(
      REPO,
      "src/app/api/admin/tyler-text-overview/weekly-send/route.ts"
    );
    expect(existsSync(routePath)).toBe(true);
    const src = readFileSync(routePath, "utf8");
    expect(src).toContain("requireTylerAdmin");
    expect(src).toContain("sendWeeklyTtoDraftManually");
    expect(src).toContain("draft_id");
    expect(src).toContain("bulk_not_supported");
    expect(src).not.toContain("export async function GET");
  });

  it("UI shows Send Weekly Text only via eligibility helper path", () => {
    const dash = readFileSync(
      join(REPO, "src/app/admin/tyler-text-overview/tyler-text-overview-weekly-dashboard.tsx"),
      "utf8"
    );
    expect(dash).toContain("weeklySendButtonLabel");
    expect(dash).toContain("weekly-send");
    expect(dash).toContain("isWeeklyManualSendEligible");
    expect(dash).toContain("WEEKLY_TTO_SAVE_BEFORE_SEND_COPY");
    expect(dash).toContain("WEEKLY_TTO_FOOTER_AT_SEND_COPY");
    expect(dash).toContain("confirmSendRow.currentBodyToSend");
    expect(dash).not.toContain("Send all");
    expect(dash).not.toContain("bulk");
    expect(dash.toLowerCase()).not.toContain("cron cutover");
  });

  it("eligibility helper gates correctly", () => {
    const base = {
      rowState: "draft_current" as const,
      draftStatus: "current",
      sendSlot: "weekly_review",
      draftId: "d1",
      currentBodyToSend: WEEKLY_BODY,
      machineShouldSend: true as boolean | null,
      dirty: false,
      sending: false,
    };
    expect(isWeeklyManualSendEligible(base)).toBe(true);
    expect(isWeeklyManualSendEligible({ ...base, dirty: true })).toBe(false);
    expect(isWeeklyManualSendEligible({ ...base, machineShouldSend: false })).toBe(false);
    expect(isWeeklyManualSendEligible({ ...base, currentBodyToSend: "  " })).toBe(false);
    expect(isWeeklyManualSendEligible({ ...base, rowState: "draft_sent" })).toBe(false);
    expect(isWeeklyManualSendEligible({ ...base, sendSlot: "morning" })).toBe(false);
  });

  it("copy labels exist and morning/evening labels unchanged", () => {
    expect(weeklySendButtonLabel(false)).toBe("Send Weekly Text");
    expect(weeklySendButtonLabel(true)).toBe("Sending Weekly Text…");
    expect(WEEKLY_TTO_SAVE_BEFORE_SEND_COPY).toBe("Save changes before sending.");
    expect(WEEKLY_TTO_MANUAL_SEND_NOTE).toContain("sends this saved Weekly TTO draft now");
    expect(WEEKLY_TTO_MANUAL_SEND_NOTE).toContain("draft-authoritative");
    expect(WEEKLY_TTO_MANUAL_SEND_NOTE).toContain("sms_weekly_send_events");
    expect(WEEKLY_TTO_MANUAL_SEND_NOTE).toContain("cron will not send another one");
    expect(WEEKLY_TTO_MANUAL_SEND_NOTE).not.toContain("does not change the weekly cron yet");
    expect(WEEKLY_TTO_FOOTER_AT_SEND_COPY).toContain("STOP/HELP");
    expect(WEEKLY_TTO_AUTHORITY_BANNER).toContain("draft-authoritative");
    expect(WEEKLY_TTO_AUTHORITY_BANNER).toContain("only sends current Weekly TTO drafts");
    expect(WEEKLY_TTO_AUTHORITY_BANNER).not.toContain("not cut over yet");
    expect(eveningSendButtonLabel(false)).toBe("Send Evening Text");
    expect(EVENING_TTO_SAVE_BEFORE_SEND_COPY).toBe("Save changes before sending.");
  });
});

describe("weekly send does not touch forbidden paths", () => {
  it("weekly-sms cron is TTO draft-authoritative and imports weekly-send", () => {
    const src = readFileSync(join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    expect(src).toContain("tyler-text-overview-weekly-send");
    expect(src).not.toContain("produceWeeklyV3RelationshipSms");
    expect(src).not.toContain("buildV2WeeklyProofPack");
    expect(src).toContain("assertWeeklyTtoDraftAuthoritativeForCronSend");
  });

  it("vercel.json unchanged for weekly", () => {
    const vercel = readFileSync(join(REPO, "vercel.json"), "utf8");
    expect(vercel).toContain("/api/cron/weekly-sms");
    expect(vercel).not.toContain("weekly-tto");
  });
});
