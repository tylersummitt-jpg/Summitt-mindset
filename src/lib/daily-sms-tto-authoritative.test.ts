import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { DailySmsBuilt } from "@/lib/daily-sms-build";
import {
  assertMorningTtoDraftAuthoritativeForSend,
  evaluateMorningTtoAuthoritativeFailClosed,
  isLiveFallbackTtoSendSource,
  loadUsableTylerTextOverviewDraftForSend,
  prepareTylerTextOverviewDailyBuild,
  type MorningTtoAuthoritativeGateSuccess,
  type TylerTextOverviewDraftForSendResult,
} from "@/lib/tyler-text-overview-send";
import { TYLER_TEXT_OVERVIEW_ENABLED_ENV } from "@/lib/tyler-text-overview-types";
import { hashSmsSnippet } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";

const db = vi.hoisted(() => ({
  drafts: [] as Array<Record<string, unknown>>,
  generations: [] as Array<Record<string, unknown>>,
}));

function makeChain(state: { table: string; action: string; payload: Record<string, unknown> }) {
  const execute = async () => {
    const { table, payload } = state;

    if (table === "sms_daily_drafts" && state.action === "select") {
      let rows = db.drafts.filter((d) => {
        if (payload.clerk_user_id != null && d.clerk_user_id !== payload.clerk_user_id) {
          return false;
        }
        if (payload.draft_for_day_key != null && d.draft_for_day_key !== payload.draft_for_day_key) {
          return false;
        }
        if (payload.status != null && d.status !== payload.status) {
          return false;
        }
        if (payload.send_slot != null && (d.send_slot ?? "morning") !== payload.send_slot) {
          return false;
        }
        return true;
      });
      if (payload.id) rows = rows.filter((d) => d.id === payload.id);
      return { data: payload.maybeSingle ? rows[0] ?? null : rows, error: null };
    }

    if (table === "sms_daily_draft_generations" && state.action === "select") {
      const row = db.generations.find((g) => g.id === payload.id) ?? null;
      return { data: row, error: null };
    }

    return { data: null, error: null };
  };

  const self: Record<string, unknown> = {};
  self.select = vi.fn(() => self);
  self.eq = vi.fn((col: string, val: unknown) => {
    state.payload[col] = val;
    return self;
  });
  self.maybeSingle = vi.fn(() => {
    state.payload.maybeSingle = true;
    return execute();
  });
  self.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (r: unknown) => unknown) =>
    execute().then(onFulfilled, onRejected);

  return self;
}

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn((table: string) =>
      makeChain({ table, action: "select", payload: {} })
    ),
  },
}));

const MACHINE_BODY = "Did the two hours happen before noon?";
const TYLER_BODY = "Hey — did you get the two hours in this morning?";
const GENERATED_AT = "2026-07-02T17:00:00.000Z";

function seedDraft(overrides?: {
  body?: string | null;
  source?: string;
  edited?: boolean;
  routeKind?: string | null;
  machineShouldSend?: boolean;
  generationId?: string | null;
  generationSendSlot?: string;
}) {
  const generationId = overrides?.generationId === null ? "" : overrides?.generationId ?? "gen-1";
  const routeKind =
    overrides && "routeKind" in overrides
      ? overrides.routeKind
      : "main_active_accountability";
  db.generations =
    generationId === ""
      ? []
      : [
          {
            id: generationId,
            generated_at: GENERATED_AT,
            machine_body_hash: hashSmsSnippet(MACHINE_BODY),
            notebook_verdict: "verified",
            notebook_verdict_reason: "none",
            route_kind: routeKind,
            machine_should_send: overrides?.machineShouldSend ?? true,
            send_slot: overrides?.generationSendSlot ?? "morning",
          },
        ];
  db.drafts = [
    {
      id: "draft-1",
      clerk_user_id: "user_send",
      draft_for_day_key: "2026-07-03",
      current_generation_id: generationId,
      current_body_to_send: overrides?.body ?? MACHINE_BODY,
      current_body_source: overrides?.source ?? "machine",
      edited_by_tyler: overrides?.edited ?? false,
      machine_body_hash: hashSmsSnippet(MACHINE_BODY),
      current_body_hash: hashSmsSnippet(overrides?.body ?? MACHINE_BODY),
      status: "current",
      send_slot: "morning",
    },
  ];
}

const okBuiltMain = (smsBody: string): Extract<DailySmsBuilt, { ok: true }> => ({
  ok: true,
  smsBody,
  deliveryStateSnapshot: null,
  day2SpecialUsed: false,
  v2Accountability: true,
  v2CommitmentId: "cmt-1",
  v3DailyRelationshipLane: true,
  dailyUnifiedGuardCtx: {
    routeKind: "main_active_accountability",
  },
} as Extract<DailySmsBuilt, { ok: true }>);

function gateSuccess(body = MACHINE_BODY): MorningTtoAuthoritativeGateSuccess {
  return {
    ok: true,
    bodyToSend: body,
    draft: {
      id: "draft-1",
      clerk_user_id: "user_send",
      draft_for_day_key: "2026-07-03",
      current_generation_id: "gen-1",
      current_body_to_send: body,
      current_body_source: "machine",
      edited_by_tyler: false,
      machine_body_hash: hashSmsSnippet(MACHINE_BODY),
      current_body_hash: hashSmsSnippet(body),
      status: "current",
    },
    generation: {
      id: "gen-1",
      generated_at: GENERATED_AT,
      machine_body_hash: hashSmsSnippet(MACHINE_BODY),
      notebook_verdict: "verified",
      notebook_verdict_reason: "none",
      route_kind: "main_active_accountability",
      machine_should_send: true,
    },
    tylerEdited: false,
  };
}

function usableLookup(
  overrides?: Partial<TylerTextOverviewDraftForSendResult>
): TylerTextOverviewDraftForSendResult {
  return {
    usable: true,
    send_source: "machine_draft",
    draft_id: "draft-1",
    generation_id: "gen-1",
    draft_for_day_key: "2026-07-03",
    current_body_to_send: MACHINE_BODY,
    current_body_source: "machine",
    edited_by_tyler: false,
    machine_body_hash: hashSmsSnippet(MACHINE_BODY),
    current_body_hash: hashSmsSnippet(MACHINE_BODY),
    notebook_verdict_at_generation: "verified",
    notebook_verdict_reason_at_generation: "none",
    route_kind: "main_active_accountability",
    stale: false,
    stale_reason: null,
    ...overrides,
  };
}

describe("assertMorningTtoDraftAuthoritativeForSend", () => {
  beforeEach(() => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
    seedDraft();
  });

  it("no current morning draft → tto_no_current_morning_draft", async () => {
    db.drafts = [];
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tto_no_current_morning_draft");
  });

  it("blank current_body_to_send → tto_blank_morning_body", async () => {
    seedDraft({ body: "   " });
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tto_blank_morning_body");
  });

  it("missing generation → tto_missing_generation", async () => {
    seedDraft({ generationId: null });
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tto_missing_generation");
  });

  it("generation send_slot mismatch → tto_generation_send_slot_mismatch", async () => {
    seedDraft({ generationSendSlot: "evening_checkin" });
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("tto_generation_send_slot_mismatch");
      expect(r.metadata?.draft_slot).toBe("morning");
      expect(r.metadata?.generation_slot).toBe("evening_checkin");
    }
  });

  it("generation send_slot weekly_review → tto_generation_send_slot_mismatch", async () => {
    seedDraft({ generationSendSlot: "weekly_review" });
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tto_generation_send_slot_mismatch");
  });

  it("machine_should_send=false without Tyler edit → tto_machine_should_send_false", async () => {
    seedDraft({ machineShouldSend: false });
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tto_machine_should_send_false");
  });

  it("machine_should_send=false with Tyler edit → ok with bodyToSend", async () => {
    seedDraft({
      body: TYLER_BODY,
      source: "tyler_edit",
      edited: true,
      machineShouldSend: false,
    });
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bodyToSend).toBe(TYLER_BODY);
      expect(r.tylerEdited).toBe(true);
    }
  });

  it("daily_lane_stale_ask_blocked + Tyler-saved non-empty body → sends", async () => {
    seedDraft({
      body: TYLER_BODY,
      source: "tyler_edit",
      edited: true,
      machineShouldSend: false,
    });
    // machine_no_send_reason is not consulted by the gate — override wins.
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tylerEdited).toBe(true);
  });

  it("lane_post_validate_blocked + Tyler-saved non-empty body → sends", async () => {
    seedDraft({
      body: TYLER_BODY,
      source: "tyler_edit",
      edited: true,
      machineShouldSend: false,
    });
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bodyToSend).toBe(TYLER_BODY);
  });

  it("Tyler-saved blank body → tto_blank_morning_body", async () => {
    seedDraft({
      body: "   ",
      source: "tyler_edit",
      edited: true,
      machineShouldSend: false,
    });
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tto_blank_morning_body");
  });

  it("main_active_accountability + machine_should_send=true → ok", async () => {
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bodyToSend).toBe(MACHINE_BODY);
  });

  it("route_kind NULL + machine_should_send=true + non-empty body → ok", async () => {
    seedDraft({ routeKind: null });
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bodyToSend).toBe(MACHINE_BODY);
  });

  it("route_kind empty string + machine_should_send=true + non-empty body → ok", async () => {
    seedDraft({ routeKind: "   " });
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bodyToSend).toBe(MACHINE_BODY);
  });

  it("route_kind NULL + machine_should_send=false + no Tyler edit → tto_machine_should_send_false", async () => {
    seedDraft({ routeKind: null, machineShouldSend: false });
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tto_machine_should_send_false");
  });

  it("non-main route_kind without Tyler edit → tto_route_not_eligible_v1", async () => {
    seedDraft({ routeKind: "reactivation_nudge" });
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tto_route_not_eligible_v1");
  });

  it.each([
    "pending_resolution",
    "refresh_identity",
    "refresh_commitment",
    "contract_prompt",
    "low_pressure_reactivation",
  ])("non-main route_kind %s blocks without Tyler edit", async (routeKind) => {
    seedDraft({ routeKind });
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tto_route_not_eligible_v1");
  });

  it("non-main route_kind with Tyler edit → ok", async () => {
    seedDraft({
      body: TYLER_BODY,
      source: "tyler_edit",
      edited: true,
      routeKind: "reactivation_nudge",
    });
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bodyToSend).toBe(TYLER_BODY);
  });

  it("435-character Tyler body remains authoritative and valid", async () => {
    const body = "x".repeat(435);
    seedDraft({
      body,
      source: "tyler_edit",
      edited: true,
    });
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bodyToSend).toBe(body);
      expect(r.tylerEdited).toBe(true);
    }
  });

  it("1600-character body is valid and preserved exactly", async () => {
    const body = "x".repeat(1600);
    seedDraft({
      body,
      source: "tyler_edit",
      edited: true,
    });
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bodyToSend).toBe(body);
  });

  it("1601-character body is tto_body_too_long before send reservation", async () => {
    const body = "x".repeat(1601);
    seedDraft({
      body,
      source: "tyler_edit",
      edited: true,
    });
    const r = await assertMorningTtoDraftAuthoritativeForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("tto_body_too_long");
      expect(r.metadata?.draft_id).toBe("draft-1");
      expect(r.metadata?.body_length).toBe(1601);
      expect(r.metadata?.transport_max).toBe(1600);
    }
  });
});

describe("isLiveFallbackTtoSendSource", () => {
  it("detects live fallback sources", () => {
    expect(isLiveFallbackTtoSendSource("live_fallback_no_draft")).toBe(true);
    expect(isLiveFallbackTtoSendSource("live_fallback_empty_body")).toBe(true);
    expect(isLiveFallbackTtoSendSource("live_fallback_special_branch")).toBe(true);
    expect(isLiveFallbackTtoSendSource("live_fallback_error")).toBe(true);
    expect(isLiveFallbackTtoSendSource("machine_draft")).toBe(false);
    expect(isLiveFallbackTtoSendSource(null)).toBe(false);
  });
});

describe("evaluateMorningTtoAuthoritativeFailClosed", () => {
  it("blocks when draftBodyUsed is false", () => {
    const r = evaluateMorningTtoAuthoritativeFailClosed({
      gate: gateSuccess(),
      draftBodyUsed: false,
      lookup: usableLookup(),
      smsBody: MACHINE_BODY,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tto_draft_body_not_used");
  });

  it("blocks when lookup.usable is false", () => {
    const r = evaluateMorningTtoAuthoritativeFailClosed({
      gate: gateSuccess(),
      draftBodyUsed: true,
      lookup: usableLookup({ usable: false, send_source: "live_fallback_no_draft" }),
      smsBody: MACHINE_BODY,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tto_lookup_not_usable");
  });

  it("blocks live_fallback send_source even when usable flag is true", () => {
    const r = evaluateMorningTtoAuthoritativeFailClosed({
      gate: gateSuccess(),
      draftBodyUsed: true,
      lookup: usableLookup({ send_source: "live_fallback_no_draft" }),
      smsBody: MACHINE_BODY,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tto_live_fallback_blocked");
  });

  it("blocks body mismatch after revalidation", () => {
    const r = evaluateMorningTtoAuthoritativeFailClosed({
      gate: gateSuccess(MACHINE_BODY),
      draftBodyUsed: true,
      lookup: usableLookup(),
      smsBody: "Different body entirely",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tto_authoritative_body_mismatch");
  });

  it("passes when gate body matches final smsBody", () => {
    const r = evaluateMorningTtoAuthoritativeFailClosed({
      gate: gateSuccess(MACHINE_BODY),
      draftBodyUsed: true,
      lookup: usableLookup(),
      smsBody: MACHINE_BODY,
    });
    expect(r.ok).toBe(true);
  });
});

describe("morning authoritative send path integration", () => {
  beforeEach(() => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
    seedDraft();
  });

  it("Tyler edit on special route is usable for prepare overlay", async () => {
    seedDraft({
      body: TYLER_BODY,
      source: "tyler_edit",
      edited: true,
      routeKind: "reactivation_nudge",
    });
    const lookup = await loadUsableTylerTextOverviewDraftForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(lookup.usable).toBe(true);
    expect(lookup.send_source).toBe("tyler_edit");

    const r = await prepareTylerTextOverviewDailyBuild({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
      now: new Date(),
      build: async (override) => okBuiltMain(override ?? "wrong"),
    });
    expect(r.draftBodyUsed).toBe(true);
    expect(r.builtMainRaw.ok).toBe(true);
    if (r.builtMainRaw.ok) {
      expect(r.builtMainRaw.smsBody).toBe(TYLER_BODY);
    }
  });

  it("live_fallback lookup cannot pass fail-closed", () => {
    for (const source of [
      "live_fallback_no_draft",
      "live_fallback_empty_body",
      "live_fallback_special_branch",
    ] as const) {
      const r = evaluateMorningTtoAuthoritativeFailClosed({
        gate: gateSuccess(),
        draftBodyUsed: true,
        lookup: usableLookup({ send_source: source, usable: false }),
        smsBody: MACHINE_BODY,
      });
      expect(r.ok).toBe(false);
    }
  });
});

describe("daily-sms route authoritative wiring", () => {
  const route = readFileSync(
    join(process.cwd(), "src/app/api/cron/daily-sms/route.ts"),
    "utf8"
  );

  it("calls assertMorningTtoDraftAuthoritativeForSend before reserve on first-send path", () => {
    const mainGateIdx = route.indexOf("morningTtoAuthoritativeGateMain");
    const reserveAfterMain = route.indexOf("reserveTodaySendOrSkip", mainGateIdx);
    expect(mainGateIdx).toBeGreaterThan(-1);
    expect(reserveAfterMain).toBeGreaterThan(mainGateIdx);
    expect(route).toContain("hasSendEventRow: false");
  });

  it("calls authoritative gate on retry path before attemptMorningTtoTwilioSend", () => {
    const retryGateIdx = route.indexOf("morningTtoAuthoritativeGateRetry");
    const attemptAfterRetry = route.indexOf("attemptMorningTtoTwilioSend", retryGateIdx);
    expect(retryGateIdx).toBeGreaterThan(-1);
    expect(attemptAfterRetry).toBeGreaterThan(retryGateIdx);
  });

  it("exact body resolution runs inside attemptMorningTtoTwilioSend before Twilio", () => {
    expect(route).toContain("resolveMorningTtoExactBodyImmediatelyBeforeTwilio");
    expect(route).toContain("attemptMorningTtoTwilioSend");
    const attemptIdx = route.indexOf("async function attemptMorningTtoTwilioSend");
    const twilioIdx = route.indexOf("await sendSMS(");
    expect(attemptIdx).toBeGreaterThan(-1);
    expect(twilioIdx).toBeGreaterThan(attemptIdx);
  });

  it("pre-reserve gate failures do not create terminal skipped_tto rows", () => {
    expect(route).toContain("tto_no_current_morning_draft");
    expect(route).not.toMatch(/status:\s*"skipped_tto_no_current_morning_draft"/);
    expect(route).not.toMatch(/status:\s*"skipped_tto_blank_morning_body"/);
    expect(route).toContain("skippedTtoBodyTooLong");
    expect(route).toContain("tto_body_too_long");
  });

  it("post-reserve gate failures use send_failed not terminal skipped status", () => {
    expect(route).toContain('status: "send_failed"');
    expect(route).toContain("tto_authoritative_gate: true");
  });
});
