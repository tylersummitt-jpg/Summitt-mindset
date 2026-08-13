import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const db = vi.hoisted(() => ({
  drafts: [] as Array<Record<string, unknown>>,
  generations: [] as Array<Record<string, unknown>>,
  sendEvents: [] as Array<Record<string, unknown>>,
  audience: null as Record<string, unknown> | null,
  commitment: null as { id: string } | null,
  yesEvents: [] as Array<Record<string, unknown>>,
}));

const sendSMS = vi.hoisted(() =>
  vi.fn(async () => ({ sid: "SM_EVENING_TEST", status: "queued" }))
);
const isTwilioReady = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/supabase-server", () => {
  function from(table: string) {
    const state: {
      filters: Record<string, unknown>;
      updatePayload?: Record<string, unknown>;
      insertPayload?: Record<string, unknown>;
    } = { filters: {} };

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (k: string, v: unknown) => {
        state.filters[k] = v;
        return builder;
      },
      is: () => builder,
      order: () => builder,
      limit: () => builder,
      update: (payload: Record<string, unknown>) => {
        state.updatePayload = payload;
        return builder;
      },
      insert: (payload: Record<string, unknown>) => {
        state.insertPayload = payload;
        return {
          select: () => ({
            maybeSingle: async () => {
              if (table === "sms_send_events") {
                const id = `evt-${db.sendEvents.length + 1}`;
                db.sendEvents.push({ id, ...payload, created_at: new Date().toISOString() });
                return { data: { id }, error: null };
              }
              return { data: null, error: null };
            },
          }),
        };
      },
      maybeSingle: async () => {
        applyPendingUpdate();
        if (table === "sms_daily_drafts") {
          const row = db.drafts.find((d) => {
            if (state.filters.id && d.id !== state.filters.id) return false;
            if (state.filters.clerk_user_id && d.clerk_user_id !== state.filters.clerk_user_id)
              return false;
            if (
              state.filters.draft_for_day_key &&
              d.draft_for_day_key !== state.filters.draft_for_day_key
            )
              return false;
            if (state.filters.send_slot && d.send_slot !== state.filters.send_slot) return false;
            if (state.filters.status && d.status !== state.filters.status) return false;
            return true;
          });
          return { data: row ?? null, error: null };
        }
        if (table === "sms_daily_draft_generations") {
          const row = db.generations.find((g) => g.id === state.filters.id);
          return { data: row ?? null, error: null };
        }
        if (table === "sms_send_events") {
          const row = db.sendEvents.find((e) => {
            if (state.filters.clerk_user_id && e.clerk_user_id !== state.filters.clerk_user_id)
              return false;
            if (state.filters.day_key && e.day_key !== state.filters.day_key) return false;
            if (state.filters.send_slot && e.send_slot !== state.filters.send_slot) return false;
            if (state.filters.id && e.id !== state.filters.id) return false;
            return true;
          });
          return { data: row ?? null, error: null };
        }
        if (table === "sms_audience") {
          return { data: db.audience, error: null };
        }
        if (table === "v2_commitment_event") {
          return { data: db.yesEvents, error: null };
        }
        return { data: null, error: null };
      },
      then: (resolve: (v: { data: unknown; error: null }) => void) => {
        applyPendingUpdate();
        resolve({ data: null, error: null });
      },
    };

    function applyPendingUpdate() {
      if (!state.updatePayload) return;
      if (table === "sms_send_events") {
        const row = db.sendEvents.find((e) => {
          if (state.filters.id && e.id !== state.filters.id) return false;
          if (state.filters.clerk_user_id && e.clerk_user_id !== state.filters.clerk_user_id)
            return false;
          if (state.filters.day_key && e.day_key !== state.filters.day_key) return false;
          if (state.filters.send_slot && e.send_slot !== state.filters.send_slot) return false;
          return true;
        });
        if (row) Object.assign(row, state.updatePayload);
      }
      if (table === "sms_daily_drafts") {
        const row = db.drafts.find((d) => {
          if (state.filters.id && d.id !== state.filters.id) return false;
          if (state.filters.status && d.status !== state.filters.status) return false;
          return true;
        });
        if (row) Object.assign(row, state.updatePayload);
      }
    }
    return builder;
  }
  return { supabaseServer: { from } };
});

vi.mock("@/lib/twilio", () => ({
  sendSMS,
  isTwilioReady,
}));

vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  evaluateOutboundSmsForAccountDeletion: vi.fn(async () => ({ decision: "allowed" })),
  isAccountDeletionOutboundSmsError: () => false,
}));

vi.mock("@/lib/tyler-text-overview-generate", () => ({
  loadTylerTextOverviewAudienceRow: vi.fn(async () => ({ clerkUserId: "user_e5" })),
}));

vi.mock("@/lib/v2-cutover-gates", () => ({
  resolveUserFullyOnV2ForCutoverMessaging: vi.fn(async () => ({ fullyOnV2: true })),
}));

vi.mock("@/lib/v2-commitment", () => ({
  getActiveCommitment: vi.fn(async () => db.commitment),
}));

vi.mock("@/lib/v2-sms-comms-preferences", () => ({
  fetchV2UserSmsCommsPreferences: vi.fn(async () => null),
  isPauseActive: vi.fn(() => false),
}));

vi.mock("@/lib/v2-outbound-check-sent", () => ({
  insertV2CheckSentEventBestEffort: vi.fn(async () => undefined),
}));

vi.mock("@/lib/v2-commitment-sms-thread-memory", () => ({
  upsertCommitmentSmsThreadMemoryFromOutbound: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/north-star-sms-context-packet", () => ({
  recentEventsIncludeUserYesOnLocalDay: vi.fn(() => false),
}));

import {
  EVENING_PROACTIVE_SEND_DISABLED,
  EVENING_PROACTIVE_SEND_DISABLED_CODE,
  assertEveningTtoDraftAuthoritativeForCronSend,
  eveningAutoSendUsesStalePreviewGate,
  revalidateEveningTtoBodyBeforeTwilio,
  sendEveningTtoAuthoritativeCronSend,
  sendTylerTextOverviewEveningDraft,
} from "@/lib/tyler-text-overview-evening-send";
import { EVENING_PROACTIVE_SEND_DISABLED_UI_COPY } from "@/lib/tyler-text-overview-dashboard-copy";
import {
  EVENING_LANE_WINDOW_END_MINUTE_EXCLUSIVE,
  EVENING_LANE_WINDOW_START_MINUTE,
  evaluateEveningLaneTiming,
  evaluateMorningLaneTiming,
  isEveningLaneSendEligible,
} from "@/lib/daily-sms-scheduling";

function seedEveningDraft(overrides: Record<string, unknown> = {}) {
  db.drafts = [
    {
      id: "draft-e",
      clerk_user_id: "user_e5",
      draft_for_day_key: "2026-06-27",
      send_slot: "evening_checkin",
      current_generation_id: "gen-e",
      current_body_to_send: "Have a good evening.",
      current_body_source: "machine",
      edited_by_tyler: false,
      status: "current",
      updated_at: "2026-06-27T12:00:00.000Z",
      ...overrides,
    },
  ];
  db.generations = [
    {
      id: "gen-e",
      commitment_id: "c1",
      machine_should_send: true,
      send_slot: "evening_checkin",
      generated_at: "2026-06-27T12:00:00.000Z",
      generation_metadata: { preview_only: true, coaching_stack: "shared_sol_v1" },
    },
  ];
  db.audience = {
    clerk_user_id: "user_e5",
    phone_number: "+15551234567",
    sms_enabled: true,
    stopped_at: null,
    timezone: "America/New_York",
    summitt_subscribed: true,
  };
  db.commitment = { id: "c1" };
  db.sendEvents = [];
  db.yesEvents = [];
}

describe("Evening lane fixed window [19:00, 21:00)", () => {
  it("18:59 ET blocked", () => {
    const now = new Date("2026-06-27T22:59:00.000Z"); // 18:59 EDT
    const d = evaluateEveningLaneTiming({ now, timezone: "America/New_York" });
    expect(d.localHour).toBe(18);
    expect(d.localMinute).toBe(59);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("before_evening_window");
    expect(isEveningLaneSendEligible(now, "America/New_York")).toBe(false);
  });

  it("19:00 ET eligible", () => {
    const now = new Date("2026-06-27T23:00:00.000Z"); // 19:00 EDT
    const d = evaluateEveningLaneTiming({ now, timezone: "America/New_York" });
    expect(d.localHour).toBe(19);
    expect(d.localMinute).toBe(0);
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("inside_evening_window");
    expect(d.windowStartMinute).toBe(EVENING_LANE_WINDOW_START_MINUTE);
    expect(d.windowEndMinuteExclusive).toBe(EVENING_LANE_WINDOW_END_MINUTE_EXCLUSIVE);
  });

  it("20:59 ET eligible", () => {
    const now = new Date("2026-06-28T00:59:00.000Z"); // 20:59 EDT
    const d = evaluateEveningLaneTiming({ now, timezone: "America/New_York" });
    expect(d.localHour).toBe(20);
    expect(d.localMinute).toBe(59);
    expect(d.allowed).toBe(true);
  });

  it("21:00 ET blocked", () => {
    const now = new Date("2026-06-28T01:00:00.000Z"); // 21:00 EDT
    const d = evaluateEveningLaneTiming({ now, timezone: "America/New_York" });
    expect(d.localHour).toBe(21);
    expect(d.localMinute).toBe(0);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("after_evening_window");
  });

  it("Morning window constants unchanged", () => {
    const now = new Date("2026-06-27T11:00:00.000Z"); // 07:00 EDT
    expect(evaluateMorningLaneTiming({ now, timezone: "America/New_York" }).allowed).toBe(true);
    expect(
      evaluateMorningLaneTiming({
        now: new Date("2026-06-27T13:00:00.000Z"),
        timezone: "America/New_York",
      }).allowed
    ).toBe(false);
  });
});

describe("Evening authoritative gate + cron send", () => {
  beforeEach(() => {
    sendSMS.mockClear();
    isTwilioReady.mockReturnValue(true);
    seedEveningDraft();
  });

  it("manual admin send remains disabled without Twilio", async () => {
    expect(EVENING_PROACTIVE_SEND_DISABLED).toBe(true);
    const result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-e",
      requestedByClerkUserId: "admin",
      mode: "manual_one",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusalCode).toBe(EVENING_PROACTIVE_SEND_DISABLED_CODE);
    expect(sendSMS).not.toHaveBeenCalled();
  });

  it("no draft → tto_no_current_evening_draft", async () => {
    db.drafts = [];
    const gate = await assertEveningTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_e5",
      draftForDayKey: "2026-06-27",
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.result.refusalCode).toBe("tto_no_current_evening_draft");
  });

  it("previous-day draft ignored for exact day lookup", async () => {
    seedEveningDraft({ draft_for_day_key: "2026-06-26" });
    const gate = await assertEveningTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_e5",
      draftForDayKey: "2026-06-27",
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.result.refusalCode).toBe("tto_no_current_evening_draft");
  });

  it("blank current body → tto_blank_evening_body", async () => {
    seedEveningDraft({ current_body_to_send: null, edited_by_tyler: true, current_body_source: "tyler_edit" });
    const gate = await assertEveningTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_e5",
      draftForDayKey: "2026-06-27",
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.result.refusalCode).toBe("tto_blank_evening_body");
  });

  it("MSS=false without Tyler override → skip", async () => {
    seedEveningDraft();
    db.generations[0].machine_should_send = false;
    const gate = await assertEveningTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_e5",
      draftForDayKey: "2026-06-27",
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.result.refusalCode).toBe("tto_machine_should_send_false");
  });

  it("MSS=false with Tyler nonblank → eligible", async () => {
    seedEveningDraft({
      current_body_to_send: "Have a good evening.",
      current_body_source: "tyler_edit",
      edited_by_tyler: true,
    });
    db.generations[0].machine_should_send = false;
    const gate = await assertEveningTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_e5",
      draftForDayKey: "2026-06-27",
    });
    expect(gate.ok).toBe(true);
    if (gate.ok) {
      expect(gate.draft.bodyToSend).toBe("Have a good evening.");
      expect(gate.draft.tylerEdited).toBe(true);
      expect(gate.draft.machineShouldSend).toBe(false);
    }
  });

  it("preview_only metadata does not block gate", async () => {
    seedEveningDraft();
    expect(db.generations[0].generation_metadata).toMatchObject({ preview_only: true });
    const gate = await assertEveningTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_e5",
      draftForDayKey: "2026-06-27",
    });
    expect(gate.ok).toBe(true);
  });

  it("outside window blocks before Twilio", async () => {
    seedEveningDraft({ draft_for_day_key: "2026-06-27" });
    const result = await sendEveningTtoAuthoritativeCronSend({
      clerkUserId: "user_e5",
      phoneNumber: "+15551234567",
      timezone: "America/New_York",
      now: new Date("2026-06-27T22:59:00.000Z"), // 18:59
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusalCode).toBe("outside_evening_window");
    expect(sendSMS).not.toHaveBeenCalled();
  });

  it("inside window sends current body only", async () => {
    seedEveningDraft({
      draft_for_day_key: "2026-06-27",
      current_body_to_send: "Current A",
    });
    const result = await sendEveningTtoAuthoritativeCronSend({
      clerkUserId: "user_e5",
      phoneNumber: "+15551234567",
      timezone: "America/New_York",
      now: new Date("2026-06-27T23:05:00.000Z"), // 19:05 EDT
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalBodySent).toBe("Current A");
      expect(result.sendSlot).toBe("evening_checkin");
      expect(result.draftForDayKey).toBe("2026-06-27");
    }
    expect(sendSMS).toHaveBeenCalledTimes(1);
    expect(sendSMS.mock.calls[0]?.[0]?.body).toBe("Current A");
    expect(db.sendEvents[0]?.send_slot).toBe("evening_checkin");
    expect(db.sendEvents[0]?.day_key).toBe("2026-06-27");
    expect(db.sendEvents[0]?.status).toBe("sent");
    expect(db.sendEvents[0]?.sms_body).toBe("Current A");
    expect(db.sendEvents[0]?.message_sid).toBe("SM_EVENING_TEST");
    const meta = db.sendEvents[0]?.metadata as Record<string, unknown>;
    expect(meta.sms_body).toBe("Current A");
    expect(meta.final_sms_body).toBe("Current A");
    expect(meta.final_body_sent).toBe("Current A");
  });

  it("Tyler B sends B not machine A", async () => {
    seedEveningDraft({
      draft_for_day_key: "2026-06-27",
      current_body_to_send: "Tyler B",
      current_body_source: "tyler_edit",
      edited_by_tyler: true,
    });
    const result = await sendEveningTtoAuthoritativeCronSend({
      clerkUserId: "user_e5",
      phoneNumber: "+15551234567",
      timezone: "America/New_York",
      now: new Date("2026-06-27T23:10:00.000Z"),
    });
    expect(result.ok).toBe(true);
    expect(sendSMS.mock.calls[0]?.[0]?.body).toBe("Tyler B");
  });

  it("pre-Twilio revalidation blanks abort without Twilio", async () => {
    seedEveningDraft({ draft_for_day_key: "2026-06-27", current_body_to_send: "A" });
    db.drafts[0].current_body_to_send = null;
    db.drafts[0].edited_by_tyler = true;
    db.drafts[0].current_body_source = "tyler_edit";
    const reval = await revalidateEveningTtoBodyBeforeTwilio({
      draftId: "draft-e",
      clerkUserId: "user_e5",
      draftForDayKey: "2026-06-27",
      pinnedBody: "A",
    });
    expect(reval.ok).toBe(false);
    if (!reval.ok) expect(reval.result.refusalCode).toBe("tto_blank_evening_body");

    seedEveningDraft({
      draft_for_day_key: "2026-06-27",
      current_body_to_send: "Pinned A",
    });
    // Simulate Tyler edit A→B between gate and Twilio via revalidation
    const mid = await revalidateEveningTtoBodyBeforeTwilio({
      draftId: "draft-e",
      clerkUserId: "user_e5",
      draftForDayKey: "2026-06-27",
      pinnedBody: "Pinned A",
    });
    expect(mid.ok).toBe(true);
    if (mid.ok) {
      db.drafts[0].current_body_to_send = "Tyler B";
      const refreshed = await revalidateEveningTtoBodyBeforeTwilio({
        draftId: "draft-e",
        clerkUserId: "user_e5",
        draftForDayKey: "2026-06-27",
        pinnedBody: "Pinned A",
      });
      expect(refreshed.ok).toBe(true);
      if (refreshed.ok) {
        expect(refreshed.bodyToSend).toBe("Tyler B");
        expect(refreshed.refreshed).toBe(true);
      }
    }
  });

  it("bulk-style blank before handoff aborts stale A; apply B wins over stale A", async () => {
    seedEveningDraft({
      draft_for_day_key: "2026-06-27",
      current_body_to_send: "A",
      current_body_source: "machine",
      edited_by_tyler: false,
    });
    // Simulate bulk blank Save fields
    db.drafts[0].current_body_to_send = null;
    db.drafts[0].current_body_source = "tyler_edit";
    db.drafts[0].edited_by_tyler = true;
    const blanked = await revalidateEveningTtoBodyBeforeTwilio({
      draftId: "draft-e",
      clerkUserId: "user_e5",
      draftForDayKey: "2026-06-27",
      pinnedBody: "A",
    });
    expect(blanked.ok).toBe(false);
    if (!blanked.ok) expect(blanked.result.refusalCode).toBe("tto_blank_evening_body");

    seedEveningDraft({
      draft_for_day_key: "2026-06-27",
      current_body_to_send: "Evening B",
      current_body_source: "tyler_edit",
      edited_by_tyler: true,
    });
    const applied = await revalidateEveningTtoBodyBeforeTwilio({
      draftId: "draft-e",
      clerkUserId: "user_e5",
      draftForDayKey: "2026-06-27",
      pinnedBody: "A",
    });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.bodyToSend).toBe("Evening B");
      expect(applied.refreshed).toBe(true);
    }
  });

  it("rerun does not resend after accepted handoff", async () => {
    seedEveningDraft({ draft_for_day_key: "2026-06-27" });
    const first = await sendEveningTtoAuthoritativeCronSend({
      clerkUserId: "user_e5",
      phoneNumber: "+15551234567",
      timezone: "America/New_York",
      now: new Date("2026-06-27T23:10:00.000Z"),
    });
    expect(first.ok).toBe(true);
    sendSMS.mockClear();
    // Restore current draft for gate, but send event already has SID
    seedEveningDraft({ draft_for_day_key: "2026-06-27" });
    db.sendEvents = [
      {
        id: "evt-1",
        clerk_user_id: "user_e5",
        day_key: "2026-06-27",
        send_slot: "evening_checkin",
        status: "sent",
        message_sid: "SM_EVENING_TEST",
        created_at: new Date().toISOString(),
        metadata: {},
      },
    ];
    const second = await sendEveningTtoAuthoritativeCronSend({
      clerkUserId: "user_e5",
      phoneNumber: "+15551234567",
      timezone: "America/New_York",
      now: new Date("2026-06-27T23:15:00.000Z"),
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.refusalCode).toBe("already_sent_evening_today");
    expect(sendSMS).not.toHaveBeenCalled();
  });

  it("no 4h stale rule in auto-send", () => {
    expect(eveningAutoSendUsesStalePreviewGate()).toBe(false);
    const src = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-evening-send.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/ageMs > EVENING_PREVIEW_STALE_MS/);
    expect(src).not.toMatch(/stale_preview/);
  });

  it("Twilio success finalize writes canonical sms_body fields without changing reservation insert", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-evening-send.ts"),
      "utf8"
    );
    const insertStart = src.indexOf("const { data: inserted, error } = await supabaseServer");
    const insertEnd = src.indexOf("if (error)", insertStart);
    const insertBlock = src.slice(insertStart, insertEnd);
    expect(insertBlock).toContain('status: "reserved"');
    expect(insertBlock).not.toMatch(/sms_body:/);

    const finalizeStart = src.indexOf("const sentAtIso = now.toISOString();");
    const finalizeEnd = src.indexOf("if (eventUpdErr)", finalizeStart);
    const finalizeBlock = src.slice(finalizeStart, finalizeEnd);
    expect(finalizeBlock).toMatch(/sms_body:\s*smsBody/);
    expect(finalizeBlock).toContain("final_sms_body: smsBody");
    expect(finalizeBlock).toContain("final_body_sent: smsBody");
    expect(finalizeBlock).toContain('status: "sent"');
  });
});

describe("Evening cron wiring", () => {
  it("vercel.json schedules evening-sms every 5 minutes", () => {
    const vercel = readFileSync(join(process.cwd(), "vercel.json"), "utf8");
    expect(vercel).toContain('/api/cron/evening-sms');
    expect(vercel).toMatch(/"path":\s*"\/api\/cron\/evening-sms"[\s\S]*?"schedule":\s*"\*\/5 \* \* \* \*"/);
  });

  it("evening-sms route uses cron auth and authoritative send", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/cron/evening-sms/route.ts"),
      "utf8"
    );
    expect(src).toContain("validateCronSecret");
    expect(src).toContain("sendEveningTtoAuthoritativeCronSend");
    expect(src).toContain("evaluateEveningLaneTiming");
    expect(src).not.toContain("openai");
    expect(src).not.toContain("generateEvening");
    expect(src).not.toContain("reply_rate");
    expect(src).not.toContain("preferred_send_window");
  });

  it("daily-sms is not branched for Evening", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/cron/daily-sms/route.ts"),
      "utf8"
    );
    expect(src).not.toContain("sendEveningTtoAuthoritativeCronSend");
    expect(src).not.toContain("evaluateEveningLaneTiming");
  });

  it("admin copy describes auto-send window", () => {
    expect(EVENING_PROACTIVE_SEND_DISABLED_UI_COPY).toContain("7–9 PM");
    expect(EVENING_PROACTIVE_SEND_DISABLED_UI_COPY).toContain("local time");
  });
});
