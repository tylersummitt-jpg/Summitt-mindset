import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { DailySmsBuilt } from "@/lib/daily-sms-build";
import {
  applyDailySmsBuiltWithTtoPostWriterBypass,
  applyTtoDraftRevalidationSuccess,
  applyTylerTextOverviewDraftBodyToBuilt,
  assertTtoCurrentDraftBodyMatches,
  buildTylerTextOverviewSendContext,
  buildTylerTextOverviewSendMetadata,
  canPinTtoCurrentDraftForSend,
  finalizeTylerTextOverviewDraftAfterSend,
  hasProtectedTtoCurrentDraftForSendDay,
  isDailySmsBuiltSpecialBranch,
  loadUsableTylerTextOverviewDraftForSend,
  markTylerTextOverviewDraftSkippedAfterGuard,
  mergeTylerTextOverviewSendMetadata,
  prepareTylerTextOverviewDailyBuild,
  revalidateCurrentTtoDraftBodyBeforeSend,
  resolveTtoCurrentDraftSendConflict,
  shouldRevalidateTtoCurrentDraftBeforeSend,
  shouldApplyTylerTextOverviewDraftOverlay,
  withTylerTextOverviewPostWriterBypassOnContext,
} from "@/lib/tyler-text-overview-send";
import {
  TTO_CURRENT_DRAFT_ROUTE_CONFLICT,
  TTO_CURRENT_DRAFT_SPECIAL_BRANCH_CONFLICT,
  TTO_CURRENT_DRAFT_FINAL_STALE_REASON,
  TTO_DRAFT_REVALIDATION_REASON_EMPTY,
  TTO_DRAFT_REVALIDATION_REASON_MISSING,
  TTO_DRAFT_REVALIDATION_REASON_NOT_CURRENT,
  TYLER_TEXT_OVERVIEW_ENABLED_ENV,
} from "@/lib/tyler-text-overview-types";
import { hashSmsSnippet } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";

const db = vi.hoisted(() => ({
  drafts: [] as Array<Record<string, unknown>>,
  generations: [] as Array<Record<string, unknown>>,
  inbound: [] as Array<Record<string, unknown>>,
  sendEvents: [] as Array<Record<string, unknown>>,
  generationUpdates: 0,
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

    if (table === "sms_inbound_messages" && state.action === "select") {
      const after = payload.gt_received_at as string;
      const rows = db.inbound
        .filter(
          (m) =>
            m.clerk_user_id === payload.clerk_user_id &&
            typeof m.received_at === "string" &&
            (m.received_at as string) > after
        )
        .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
      return { data: rows[0] ?? null, error: null };
    }

    if (table === "sms_daily_draft_generations" && state.action === "update") {
      db.generationUpdates += 1;
      return { data: null, error: null };
    }

    if (table === "sms_daily_drafts" && state.action === "update") {
      const draft = db.drafts.find((d) => d.id === payload.id && d.status === payload.status);
      if (draft) Object.assign(draft, state.updatePayload);
      return { data: draft ?? null, error: null };
    }

    if (table === "sms_send_events" && state.action === "select") {
      const row =
        db.sendEvents.find(
          (e) =>
            e.clerk_user_id === payload.clerk_user_id &&
            e.day_key === payload.day_key &&
            (e.send_slot ?? "morning") === (payload.send_slot ?? "morning")
        ) ?? null;
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
  self.gt = vi.fn((col: string, val: unknown) => {
    if (col === "received_at") state.payload.gt_received_at = val;
    return self;
  });
  self.order = vi.fn(() => self);
  self.limit = vi.fn(() => self);
  self.maybeSingle = vi.fn(() => {
    state.payload.maybeSingle = true;
    return execute();
  });
  self.update = vi.fn((row: Record<string, unknown>) => {
    state.action = "update";
    state.updatePayload = row;
    return self;
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
  routeKind?: string;
}) {
  db.generations = [
    {
      id: "gen-1",
      generated_at: GENERATED_AT,
      machine_body_hash: hashSmsSnippet(MACHINE_BODY),
      notebook_verdict: "verified",
      notebook_verdict_reason: "none",
      route_kind: overrides?.routeKind ?? "main_active_accountability",
    },
  ];
  db.drafts = [
    {
      id: "draft-1",
      clerk_user_id: "user_send",
      draft_for_day_key: "2026-07-03",
      current_generation_id: "gen-1",
      current_body_to_send: overrides?.body ?? MACHINE_BODY,
      current_body_source: overrides?.source ?? "machine",
      edited_by_tyler: overrides?.edited ?? false,
      machine_body_hash: hashSmsSnippet(MACHINE_BODY),
      current_body_hash: hashSmsSnippet(overrides?.body ?? MACHINE_BODY),
      status: "current",
    },
  ];
  db.inbound = [];
  db.sendEvents = [
    { id: "evt-1", clerk_user_id: "user_send", day_key: "2026-07-03" },
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
    clerkUserId: "user_send",
    commitmentId: "cmt-1",
    priorCoachBody: null,
    priorCoachSentAt: null,
    lastInboundBody: null,
    priorOutcome: null,
    pendingPlanProof: null,
    proofOrMilestoneSignal: null,
  },
});

describe("tyler-text-overview-send draft load", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env = { ...env };
    db.drafts = [];
    db.generations = [];
    db.inbound = [];
    db.generationUpdates = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = env;
  });

  it("env disabled → live_fallback_no_draft", async () => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "false";
    const r = await loadUsableTylerTextOverviewDraftForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.usable).toBe(false);
    expect(r.send_source).toBe("live_fallback_no_draft");
  });

  it("usable machine draft → selected body is machine draft", async () => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
    seedDraft();
    const r = await loadUsableTylerTextOverviewDraftForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.usable).toBe(true);
    expect(r.send_source).toBe("machine_draft");
    expect(r.current_body_to_send).toBe(MACHINE_BODY);
  });

  it("usable Tyler edit → selected body is Tyler edit", async () => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
    seedDraft({ body: TYLER_BODY, source: "tyler_edit", edited: true });
    const r = await loadUsableTylerTextOverviewDraftForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.usable).toBe(true);
    expect(r.send_source).toBe("tyler_edit");
    expect(r.current_body_to_send).toBe(TYLER_BODY);
  });

  it("no draft → live_fallback_no_draft", async () => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
    const r = await loadUsableTylerTextOverviewDraftForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.send_source).toBe("live_fallback_no_draft");
  });

  it("current draft remains usable despite inbound-after-generation stale condition", async () => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
    seedDraft();
    db.inbound = [
      {
        clerk_user_id: "user_send",
        received_at: "2026-07-02T18:00:00.000Z",
      },
    ];
    const r = await loadUsableTylerTextOverviewDraftForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.usable).toBe(true);
    expect(r.send_source).toBe("machine_draft");
    expect(r.current_body_to_send).toBe(MACHINE_BODY);
    expect(r.stale).toBe(true);
    expect(r.stale_reason).toBe("inbound_received_after_generation");
  });

  it("null/empty draft body → live_fallback_empty_body", async () => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
    seedDraft({ body: "   " });
    const r = await loadUsableTylerTextOverviewDraftForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.send_source).toBe("live_fallback_empty_body");
  });

  it("missing generation row → live_fallback_error", async () => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
    seedDraft();
    db.generations = [];
    const r = await loadUsableTylerTextOverviewDraftForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(r.send_source).toBe("live_fallback_error");
  });

  it("stale guard uses sms_inbound_messages.received_at", async () => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
    seedDraft();
    db.inbound = [
      { clerk_user_id: "user_send", received_at: "2026-07-02T16:59:00.000Z" },
    ];
    const ok = await loadUsableTylerTextOverviewDraftForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(ok.usable).toBe(true);

    db.inbound = [
      { clerk_user_id: "user_send", received_at: "2026-07-02T17:00:01.000Z" },
    ];
    const stale = await loadUsableTylerTextOverviewDraftForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(stale.usable).toBe(true);
    expect(stale.send_source).toBe("machine_draft");
    expect(stale.stale).toBe(true);
  });
});

describe("tyler-text-overview-send body overlay", () => {
  it("draft body applied before guard via overlay helper", () => {
    const built = okBuiltMain("live build body");
    expect(
      applyTylerTextOverviewDraftBodyToBuilt(built, MACHINE_BODY).smsBody
    ).toBe(MACHINE_BODY);
  });

  it("special branch live-fallback does not overlay draft", () => {
    const built: Extract<DailySmsBuilt, { ok: true }> = {
      ...okBuiltMain(MACHINE_BODY),
      v2RefreshOutboundPlan: { kind: "identity_first", session: { session_id: "s", step: "identity" } },
    };
    expect(isDailySmsBuiltSpecialBranch(built)).toBe(true);
    expect(
      shouldApplyTylerTextOverviewDraftOverlay({
        lookup: {
          usable: true,
          send_source: "machine_draft",
          draft_id: "draft-1",
          generation_id: "gen-1",
          draft_for_day_key: "2026-07-03",
          current_body_to_send: MACHINE_BODY,
          current_body_source: "machine",
          edited_by_tyler: false,
          machine_body_hash: null,
          current_body_hash: null,
          notebook_verdict_at_generation: null,
          notebook_verdict_reason_at_generation: null,
          route_kind: "main_active_accountability",
          stale: false,
          stale_reason: null,
        },
        builtRaw: built,
      })
    ).toBe(false);
  });

  it("prepareTylerTextOverviewDailyBuild overlays usable machine draft", async () => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
    seedDraft();
    const buildMock = vi.fn(async () => okBuiltMain("live body from build"));
    const r = await prepareTylerTextOverviewDailyBuild({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
      now: new Date("2026-07-03T12:00:00.000Z"),
      build: buildMock,
    });
    expect(r.draftBodyUsed).toBe(true);
    expect(r.builtMainRaw.ok && r.builtMainRaw.smsBody).toBe(MACHINE_BODY);
    expect(r.sendContext?.metadataBlock?.send_source).toBe("machine_draft");
  });

  it("machine draft override passed to build for no-send lane recovery", async () => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
    seedDraft();
    const buildMock = vi.fn(async (override: string | null) => {
      if (override) return okBuiltMain(override);
      return { ok: false, error: "daily_v3_lane_no_send" };
    });
    const r = await prepareTylerTextOverviewDailyBuild({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
      now: new Date("2026-07-03T12:00:00.000Z"),
      build: buildMock,
    });
    expect(buildMock).toHaveBeenCalledWith(MACHINE_BODY);
    expect(r.draftBodyUsed).toBe(true);
    expect(r.builtMainRaw.ok && r.builtMainRaw.smsBody).toBe(MACHINE_BODY);
  });

  it("Tyler edit over machine no-send passes override to build", async () => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
    seedDraft({ body: TYLER_BODY, source: "tyler_edit", edited: true });
    const buildMock = vi.fn(async (override: string | null) => {
      if (override) return okBuiltMain(override);
      return { ok: false, error: "daily_v3_lane_no_send" };
    });
    const r = await prepareTylerTextOverviewDailyBuild({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
      now: new Date("2026-07-03T12:00:00.000Z"),
      build: buildMock,
    });
    expect(buildMock).toHaveBeenCalledWith(TYLER_BODY);
    expect(r.draftBodyUsed).toBe(true);
    expect(r.builtMainRaw.ok && r.builtMainRaw.smsBody).toBe(TYLER_BODY);
  });
});

describe("tyler-text-overview-send protected current draft send", () => {
  const northStarMutator = vi.fn(async (built: Extract<DailySmsBuilt, { ok: true }>) => ({
    ...built,
    smsBody: "north star mutated body",
  }));

  beforeEach(() => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
    seedDraft();
    northStarMutator.mockClear();
  });

  it("bypasses post-TTO writers and keeps exact current_body_to_send for machine draft", async () => {
    const lookup = await loadUsableTylerTextOverviewDraftForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    const builtRaw = okBuiltMain("live body from build");
    const gated = await applyDailySmsBuiltWithTtoPostWriterBypass({
      builtRaw,
      lookup,
      draftBodyUsed: true,
      applyNorthStarGate: northStarMutator,
    });
    expect(gated.postTtoWritersBypassed).toBe(true);
    expect(gated.built.ok && gated.built.smsBody).toBe(MACHINE_BODY);
    expect(northStarMutator).not.toHaveBeenCalled();
  });

  it("bypasses post-TTO writers for tyler_edit draft", async () => {
    seedDraft({ body: TYLER_BODY, source: "tyler_edit", edited: true });
    const lookup = await loadUsableTylerTextOverviewDraftForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    const gated = await applyDailySmsBuiltWithTtoPostWriterBypass({
      builtRaw: okBuiltMain("live body"),
      lookup,
      draftBodyUsed: true,
      applyNorthStarGate: northStarMutator,
    });
    expect(gated.built.ok && gated.built.smsBody).toBe(TYLER_BODY);
    expect(northStarMutator).not.toHaveBeenCalled();
  });

  it("still runs north star gate when no protected current draft pin", async () => {
    const gated = await applyDailySmsBuiltWithTtoPostWriterBypass({
      builtRaw: okBuiltMain("live body"),
      lookup: null,
      draftBodyUsed: false,
      applyNorthStarGate: northStarMutator,
    });
    expect(gated.postTtoWritersBypassed).toBe(false);
    expect(gated.built.ok && gated.built.smsBody).toBe("north star mutated body");
    expect(northStarMutator).toHaveBeenCalledTimes(1);
  });

  it("assertTtoCurrentDraftBodyMatches blocks mutated body", () => {
    const mismatch = assertTtoCurrentDraftBodyMatches({
      smsBody: "mutated",
      currentBodyToSend: MACHINE_BODY,
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.reason).toBe("tto_current_draft_body_mismatch");
    }
    const ok = assertTtoCurrentDraftBodyMatches({
      smsBody: `  ${MACHINE_BODY}  `,
      currentBodyToSend: MACHINE_BODY,
    });
    expect(ok.ok).toBe(true);
  });

  it("protected metadata flags are set on send context", () => {
    const ctx = withTylerTextOverviewPostWriterBypassOnContext(
      buildTylerTextOverviewSendContext({
        lookup: {
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
          stale: true,
          stale_reason: "inbound_received_after_generation",
        },
        builtRaw: okBuiltMain(MACHINE_BODY),
        draftBodyUsed: true,
      }),
      true,
      MACHINE_BODY
    );
    expect(ctx?.metadataBlock?.tto_current_draft_protected).toBe(true);
    expect(ctx?.metadataBlock?.post_tto_writers_bypassed).toBe(true);
    expect(ctx?.metadataBlock?.sent_body_equals_current_body_to_send).toBe(true);
    expect(ctx?.metadataBlock?.stale_check_ignored_reason).toBe(
      TTO_CURRENT_DRAFT_FINAL_STALE_REASON
    );
    expect(ctx?.metadataBlock?.live_fallback_used).toBe(false);
    expect(ctx?.metadataBlock?.post_tto_guards_skipped).toContain("north_star_mutation");
  });

  const JULY2_BAD_STRINGS = [
    "I will stay composed in the first stressful leadership moment I face today.",
    "Paul, today, I will name three specific things I am grateful for in prayer.",
    "I will text or call each day to help us get back on track and build your Victory Room together.",
  ] as const;

  it.each(JULY2_BAD_STRINGS)(
    "only sends July 2 bad string when current_body_to_send exactly matches: %s",
    async (badString) => {
      seedDraft({ body: badString });
      const lookup = await loadUsableTylerTextOverviewDraftForSend({
        clerkUserId: "user_send",
        draftForDayKey: "2026-07-03",
      });
      const gated = await applyDailySmsBuiltWithTtoPostWriterBypass({
        builtRaw: okBuiltMain("behavior_statement leak"),
        lookup,
        draftBodyUsed: true,
        applyNorthStarGate: northStarMutator,
      });
      expect(gated.built.ok && gated.built.smsBody).toBe(badString);
      expect(gated.built.smsBody).not.toBe("behavior_statement leak");
    }
  );
});

describe("tyler-text-overview-send route conflict guard", () => {
  beforeEach(() => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
    seedDraft();
  });

  it("detects protected current draft on send day", async () => {
    const lookup = await loadUsableTylerTextOverviewDraftForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(hasProtectedTtoCurrentDraftForSendDay(lookup)).toBe(true);
  });

  it("does not treat empty draft body as protected", async () => {
    seedDraft({ body: "   " });
    const lookup = await loadUsableTylerTextOverviewDraftForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(hasProtectedTtoCurrentDraftForSendDay(lookup)).toBe(false);
  });

  it("allows pin when main draft overlays successfully", async () => {
    const lookup = await loadUsableTylerTextOverviewDraftForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    const builtRaw = okBuiltMain("live body");
    expect(
      canPinTtoCurrentDraftForSend({ lookup, builtRaw, draftBodyUsed: true })
    ).toBe(true);
    expect(
      resolveTtoCurrentDraftSendConflict({ lookup, builtRaw, draftBodyUsed: true })
    ).toBeNull();
  });

  it("blocks special-branch live build when protected draft pin would not apply", async () => {
    const lookup = await loadUsableTylerTextOverviewDraftForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    const specialBuilt: Extract<DailySmsBuilt, { ok: true }> = {
      ...okBuiltMain("refresh live body"),
      v2RefreshOutboundPlan: {
        kind: "identity_first",
        session: { session_id: "s", step: "identity" },
      },
    };
    const conflict = resolveTtoCurrentDraftSendConflict({
      lookup,
      builtRaw: specialBuilt,
      draftBodyUsed: false,
    });
    expect(conflict?.status).toBe("skipped_tto_current_draft_special_branch_conflict");
    expect(conflict?.reason).toBe(TTO_CURRENT_DRAFT_SPECIAL_BRANCH_CONFLICT);
    expect(
      shouldApplyTylerTextOverviewDraftOverlay({ lookup, builtRaw: specialBuilt })
    ).toBe(false);
  });

  it("blocks build failure when protected current draft exists", async () => {
    const lookup = await loadUsableTylerTextOverviewDraftForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    const builtRaw: DailySmsBuilt = { ok: false, error: "daily_v3_lane_no_send" };
    const conflict = resolveTtoCurrentDraftSendConflict({
      lookup,
      builtRaw,
      draftBodyUsed: false,
    });
    expect(conflict?.status).toBe("skipped_tto_current_draft_route_conflict");
    expect(conflict?.reason).toBe(TTO_CURRENT_DRAFT_ROUTE_CONFLICT);
  });

  it("blocks when generation route_kind is not main but draft body exists", async () => {
    seedDraft({ routeKind: "refresh" });
    const lookup = await loadUsableTylerTextOverviewDraftForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(lookup.usable).toBe(false);
    expect(hasProtectedTtoCurrentDraftForSendDay(lookup)).toBe(true);
    const conflict = resolveTtoCurrentDraftSendConflict({
      lookup,
      builtRaw: okBuiltMain("live main body"),
      draftBodyUsed: false,
    });
    expect(conflict?.status).toBe("skipped_tto_current_draft_route_conflict");
  });

  it("does not block when no current draft exists", () => {
    expect(
      resolveTtoCurrentDraftSendConflict({
        lookup: {
          usable: false,
          send_source: "live_fallback_no_draft",
          draft_id: null,
          generation_id: null,
          draft_for_day_key: "2026-07-03",
          current_body_to_send: null,
          current_body_source: null,
          edited_by_tyler: false,
          machine_body_hash: null,
          current_body_hash: null,
          notebook_verdict_at_generation: null,
          notebook_verdict_reason_at_generation: null,
          route_kind: null,
          stale: false,
          stale_reason: null,
        },
        builtRaw: okBuiltMain("live only"),
        draftBodyUsed: false,
      })
    ).toBeNull();
  });
});

describe("tyler-text-overview-send pre-twilio revalidation", () => {
  const northStarMutator = vi.fn(async (built: Extract<DailySmsBuilt, { ok: true }>) => ({
    ...built,
    smsBody: "north star mutated body",
  }));

  beforeEach(() => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
    seedDraft();
    northStarMutator.mockClear();
  });

  async function pinnedSendState(initialBody: string) {
    const lookup = await loadUsableTylerTextOverviewDraftForSend({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    const gated = await applyDailySmsBuiltWithTtoPostWriterBypass({
      builtRaw: okBuiltMain("live body from build"),
      lookup,
      draftBodyUsed: true,
      applyNorthStarGate: northStarMutator,
    });
    const ctx = withTylerTextOverviewPostWriterBypassOnContext(
      buildTylerTextOverviewSendContext({
        lookup,
        builtRaw: gated.built,
        draftBodyUsed: true,
      }),
      true,
      gated.built.ok ? gated.built.smsBody : null
    );
    return {
      lookup,
      built: gated.built,
      ctx,
      pinnedBody: initialBody,
    };
  }

  it("revalidation same body keeps pinned body and metadata flags", async () => {
    const { lookup, built, ctx, pinnedBody } = await pinnedSendState(MACHINE_BODY);
    expect(built.ok && built.smsBody).toBe(MACHINE_BODY);

    const revalidation = await revalidateCurrentTtoDraftBodyBeforeSend({
      lookup,
      pinnedBody,
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(revalidation.ok).toBe(true);
    if (!revalidation.ok) return;
    expect(revalidation.bodyToSend).toBe(MACHINE_BODY);
    expect(revalidation.refreshed).toBe(false);
    expect(revalidation.metadataExtras.tto_current_draft_revalidated_before_twilio).toBe(true);
    expect(revalidation.metadataExtras.tto_current_draft_body_refreshed_before_twilio).toBe(false);
    expect(northStarMutator).not.toHaveBeenCalled();

    const applied = applyTtoDraftRevalidationSuccess({
      built: built as Extract<DailySmsBuilt, { ok: true }>,
      tylerTextOverviewCtx: ctx!,
      revalidation,
    });
    expect(applied.built.smsBody).toBe(MACHINE_BODY);
    expect(applied.tylerTextOverviewCtx.metadataBlock?.sent_body_equals_current_body_to_send).toBe(
      true
    );
  });

  it("revalidation newer body replaces pinned snapshot with latest saved body", async () => {
    const { lookup, built, ctx, pinnedBody } = await pinnedSendState(MACHINE_BODY);
    db.drafts[0].current_body_to_send = TYLER_BODY;
    db.drafts[0].current_body_source = "tyler_edit";
    db.drafts[0].edited_by_tyler = true;
    db.drafts[0].current_body_hash = hashSmsSnippet(TYLER_BODY);

    const revalidation = await revalidateCurrentTtoDraftBodyBeforeSend({
      lookup,
      pinnedBody,
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(revalidation.ok).toBe(true);
    if (!revalidation.ok) return;
    expect(revalidation.bodyToSend).toBe(TYLER_BODY);
    expect(revalidation.refreshed).toBe(true);
    expect(revalidation.metadataExtras.tto_current_draft_body_refreshed_before_twilio).toBe(true);
    expect(revalidation.metadataExtras.tto_current_draft_previous_body_hash).toBe(
      hashSmsSnippet(MACHINE_BODY)
    );
    expect(revalidation.metadataExtras.sent_body_equals_current_body_to_send).toBe(true);

    const applied = applyTtoDraftRevalidationSuccess({
      built: built as Extract<DailySmsBuilt, { ok: true }>,
      tylerTextOverviewCtx: ctx!,
      revalidation,
    });
    expect(applied.built.smsBody).toBe(TYLER_BODY);
    expect(applied.built.smsBody).not.toBe(MACHINE_BODY);
    expect(applied.tylerTextOverviewCtx.lookup.current_body_to_send).toBe(TYLER_BODY);
    expect(applied.tylerTextOverviewCtx.metadataBlock?.final_body_sent_hash).toBe(
      hashSmsSnippet(TYLER_BODY)
    );
  });

  it("revalidation missing row returns explicit no-send reason", async () => {
    const { lookup, pinnedBody } = await pinnedSendState(MACHINE_BODY);
    db.drafts = [];

    const revalidation = await revalidateCurrentTtoDraftBodyBeforeSend({
      lookup,
      pinnedBody,
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(revalidation.ok).toBe(false);
    if (revalidation.ok) return;
    expect(revalidation.skipStatus).toBe("skipped_tto_current_draft_revalidation_failed");
    expect(revalidation.reason).toBe(TTO_DRAFT_REVALIDATION_REASON_MISSING);
    expect(revalidation.metadataExtras.tto_current_draft_revalidation_failed).toBe(true);
    expect(revalidation.metadataExtras.live_fallback_used).toBe(false);
  });

  it("revalidation no longer current returns explicit no-send reason", async () => {
    const { lookup, pinnedBody } = await pinnedSendState(MACHINE_BODY);
    db.drafts[0].status = "sent";

    const revalidation = await revalidateCurrentTtoDraftBodyBeforeSend({
      lookup,
      pinnedBody,
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(revalidation.ok).toBe(false);
    if (revalidation.ok) return;
    expect(revalidation.skipStatus).toBe("skipped_tto_current_draft_no_longer_current");
    expect(revalidation.reason).toBe(TTO_DRAFT_REVALIDATION_REASON_NOT_CURRENT);
  });

  it("revalidation empty body returns explicit no-send reason without live fallback", async () => {
    const { lookup, pinnedBody } = await pinnedSendState(MACHINE_BODY);
    db.drafts[0].current_body_to_send = "   ";

    const revalidation = await revalidateCurrentTtoDraftBodyBeforeSend({
      lookup,
      pinnedBody,
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
    });
    expect(revalidation.ok).toBe(false);
    if (revalidation.ok) return;
    expect(revalidation.skipStatus).toBe("skipped_tto_current_draft_empty_on_revalidation");
    expect(revalidation.reason).toBe(TTO_DRAFT_REVALIDATION_REASON_EMPTY);
    expect(revalidation.metadataExtras.live_fallback_used).toBe(false);
  });

  it("retry-path wiring revalidates before mismatch block", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/cron/daily-sms/route.ts"),
      "utf8"
    );
    const retrySection = route.slice(route.indexOf("const revalidatedRetry"));
    expect(retrySection).toContain("applyTtoCurrentDraftRevalidationBeforeTwilio");
    expect(retrySection.indexOf("applyTtoCurrentDraftRevalidationBeforeTwilio")).toBeLessThan(
      retrySection.indexOf("blockSendOnTtoCurrentDraftBodyMismatch")
    );
    expect(retrySection.indexOf("blockSendOnTtoCurrentDraftBodyMismatch")).toBeLessThan(
      retrySection.indexOf("sendSMS(")
    );
  });

  it("main-path wiring revalidates before mismatch block", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/cron/daily-sms/route.ts"),
      "utf8"
    );
    const mainSection = route.slice(route.indexOf("const revalidatedMain"));
    expect(mainSection).toContain("applyTtoCurrentDraftRevalidationBeforeTwilio");
    expect(mainSection.indexOf("applyTtoCurrentDraftRevalidationBeforeTwilio")).toBeLessThan(
      mainSection.indexOf("blockSendOnTtoCurrentDraftBodyMismatch")
    );
    expect(mainSection.indexOf("blockSendOnTtoCurrentDraftBodyMismatch")).toBeLessThan(
      mainSection.indexOf("sendSMS(")
    );
  });

  it("no revalidation when no protected current draft", () => {
    expect(
      shouldRevalidateTtoCurrentDraftBeforeSend({
        tylerTextOverviewCtx: null,
        tylerDraftBodyUsed: false,
        built: okBuiltMain("live only"),
      })
    ).toBe(false);
  });

  it("no revalidation when TTO disabled", () => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "false";
    expect(
      shouldRevalidateTtoCurrentDraftBeforeSend({
        tylerTextOverviewCtx: buildTylerTextOverviewSendContext({
          lookup: {
            usable: true,
            send_source: "machine_draft",
            draft_id: "draft-1",
            generation_id: "gen-1",
            draft_for_day_key: "2026-07-03",
            current_body_to_send: MACHINE_BODY,
            current_body_source: "machine",
            edited_by_tyler: false,
            machine_body_hash: null,
            current_body_hash: null,
            notebook_verdict_at_generation: null,
            notebook_verdict_reason_at_generation: null,
            route_kind: "main_active_accountability",
            stale: false,
            stale_reason: null,
          },
          builtRaw: okBuiltMain(MACHINE_BODY),
          draftBodyUsed: true,
          postTtoWritersBypassed: true,
        }),
        tylerDraftBodyUsed: true,
        built: okBuiltMain(MACHINE_BODY),
      })
    ).toBe(false);
  });
});

describe("tyler-text-overview-send finalize and metadata", () => {
  beforeEach(() => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
    seedDraft();
    db.generationUpdates = 0;
  });

  it("Twilio success finalizes sms_daily_drafts sent fields", async () => {
    const result = await finalizeTylerTextOverviewDraftAfterSend({
      draftId: "draft-1",
      clerkUserId: "user_send",
      dayKey: "2026-07-03",
      twilioMessageSid: "SM123",
      finalBodySent: MACHINE_BODY,
      now: new Date("2026-07-03T12:00:00.000Z"),
    });
    expect(result.ok).toBe(true);
    expect(db.drafts[0].status).toBe("sent");
    expect(db.drafts[0].twilio_message_sid).toBe("SM123");
    expect(db.drafts[0].final_body_sent).toBe(MACHINE_BODY);
    expect(db.drafts[0].source_sms_send_event_id).toBe("evt-1");
  });

  it("success metadata includes tyler_text_overview block", () => {
    const block = buildTylerTextOverviewSendMetadata({
      lookup: {
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
      },
      effectiveSendSource: "machine_draft",
      finalBodySent: MACHINE_BODY,
    });
    expect(block.enabled).toBe(true);
    expect(block.send_source).toBe("machine_draft");
    expect(block.final_body_sent_hash).toBe(hashSmsSnippet(MACHINE_BODY));
    expect(JSON.stringify(block)).not.toContain("writer_openai");
  });

  it("skip metadata includes tyler_text_overview block", () => {
    const ctx = buildTylerTextOverviewSendContext({
      lookup: {
        usable: true,
        send_source: "tyler_edit",
        draft_id: "draft-1",
        generation_id: "gen-1",
        draft_for_day_key: "2026-07-03",
        current_body_to_send: TYLER_BODY,
        current_body_source: "tyler_edit",
        edited_by_tyler: true,
        machine_body_hash: null,
        current_body_hash: hashSmsSnippet(TYLER_BODY),
        notebook_verdict_at_generation: null,
        notebook_verdict_reason_at_generation: null,
        route_kind: "main_active_accountability",
        stale: false,
        stale_reason: null,
      },
      builtRaw: okBuiltMain(TYLER_BODY),
      draftBodyUsed: true,
    });
    const merged = mergeTylerTextOverviewSendMetadata(
      { note: "reserved_by_cron" },
      ctx?.metadataBlock ?? null
    );
    expect(merged.tyler_text_overview).toBeTruthy();
  });

  it("final guard block marks draft skipped", async () => {
    await markTylerTextOverviewDraftSkippedAfterGuard({
      draftId: "draft-1",
      clerkUserId: "user_send",
      dayKey: "2026-07-03",
      now: new Date("2026-07-03T12:00:00.000Z"),
    });
    expect(db.drafts[0].status).toBe("skipped");
    expect(db.drafts[0].final_body_sent).toBeNull();
  });

  it("failure to update draft after Twilio success is non-blocking", async () => {
    db.drafts = [];
    const result = await finalizeTylerTextOverviewDraftAfterSend({
      draftId: "missing",
      clerkUserId: "user_send",
      dayKey: "2026-07-03",
      twilioMessageSid: "SM123",
      finalBodySent: MACHINE_BODY,
    });
    expect(result.ok).toBe(true);
  });

  it("sms_daily_draft_generations is never updated", async () => {
    await finalizeTylerTextOverviewDraftAfterSend({
      draftId: "draft-1",
      clerkUserId: "user_send",
      dayKey: "2026-07-03",
      twilioMessageSid: "SM123",
      finalBodySent: MACHINE_BODY,
    });
    await markTylerTextOverviewDraftSkippedAfterGuard({
      draftId: "draft-1",
      clerkUserId: "user_send",
      dayKey: "2026-07-03",
    });
    expect(db.generationUpdates).toBe(0);
  });
});

describe("tyler-text-overview Phase 5 scope guards", () => {
  it("env disabled prepare does not require draft tables", async () => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "false";
    const buildMock = vi.fn(async () => okBuiltMain("live only"));
    const r = await prepareTylerTextOverviewDailyBuild({
      clerkUserId: "user_send",
      draftForDayKey: "2026-07-03",
      now: new Date(),
      build: buildMock,
    });
    expect(r.sendContext).toBeNull();
    expect(r.draftBodyUsed).toBe(false);
  });

  it("no second Twilio helper import/path in Phase 5 files", () => {
    for (const rel of [
      "src/lib/tyler-text-overview-send.ts",
      "src/lib/tyler-text-overview-types.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src).not.toContain("@/lib/twilio");
      expect(src).not.toContain("sendSMS");
    }
    const route = readFileSync(
      join(process.cwd(), "src/app/api/cron/daily-sms/route.ts"),
      "utf8"
    );
    expect(route).toContain("tyler-text-overview-send");
    expect((route.match(/sendSMS\(/g) ?? []).length).toBeGreaterThan(0);
  });

  it("no notebook rebuild imports in send lib", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/tyler-text-overview-send.ts"), "utf8");
    expect(src).not.toContain("buildDailySmsContent");
    expect(src).not.toContain("produceDailyV3RelationshipSms");
    expect(src).not.toContain('from "openai"');
  });

  it("no new env vars in Phase 5 send lib", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/tyler-text-overview-send.ts"), "utf8");
    expect(src.match(/process\.env\.[A-Z0-9_]+/g) ?? []).toEqual([]);
  });

  it("daily-sms-build has narrow tyler override option only", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/daily-sms-build.ts"), "utf8");
    expect(src).toContain("tylerTextOverviewOverrideBody");
    expect(src).toContain("routeKind === \"main_active_accountability\"");
  });

  it("daily route wires prepareTylerTextOverviewDailyBuild", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/cron/daily-sms/route.ts"),
      "utf8"
    );
    expect(route).toContain("prepareTylerTextOverviewDailyBuild");
    expect(route).toContain("finalizeTylerTextOverviewAfterOutboundBestEffort");
    expect(route).not.toContain("tyler-text-overview-generate");
  });
});
