import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
  SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";

const generateTylerTextOverviewDraftForUser = vi.hoisted(() => vi.fn());
const generateTylerTextOverviewEveningPreviewForUser = vi.hoisted(() => vi.fn());
const loadTylerTextOverviewAudienceRow = vi.hoisted(() => vi.fn());
const generateTylerTextOverviewWeeklyDraftForUser = vi.hoisted(() => vi.fn());
const getActiveCommitment = vi.hoisted(() => vi.fn());
const markCurrentTtoDraftUnusable = vi.hoisted(() => vi.fn());
const supabaseFrom = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: supabaseFrom },
}));

vi.mock("@/lib/tyler-text-overview-generate", () => ({
  generateTylerTextOverviewDraftForUser,
  generateTylerTextOverviewEveningPreviewForUser,
  loadTylerTextOverviewAudienceRow,
}));

vi.mock("@/lib/tyler-text-overview-weekly-generate", () => ({
  generateTylerTextOverviewWeeklyDraftForUser,
}));

vi.mock("@/lib/v2-commitment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-commitment")>();
  return { ...actual, getActiveCommitment };
});

vi.mock("@/lib/tto-mark-current-draft-unusable", () => ({
  markCurrentTtoDraftUnusable,
}));

import { ensureCurrentTtoDraftFreshForSend } from "@/lib/tto-draft-fresh-for-send";

const USER = "user_angela";
const DAY = "2026-09-09";
const NOW = new Date("2026-09-08T16:00:00.000Z");
const ASK_A = "I will be in bed by 9:30 pm nightly.";
const ASK_B = "I will be in bed by 10:30 pm nightly.";
const ASK_B2 = "I will be in bed by 11:00 pm nightly.";
const ASK_C = "I will walk 20 minutes after dinner.";
const AUDIENCE = {
  clerk_user_id: USER,
  phone_number: "+1555",
  sms_enabled: true,
  stopped_at: null,
  timezone: "America/New_York",
  summitt_subscribed: true,
};

type DraftRow = {
  id: string;
  clerk_user_id: string;
  draft_for_day_key: string;
  send_slot: string;
  status: string;
  current_body_to_send: string | null;
  current_body_source: string | null;
  edited_by_tyler: boolean;
  current_generation_id: string | null;
};

type GenerationRow = {
  id: string;
  generation_metadata: Record<string, unknown>;
};

const db = {
  drafts: [] as DraftRow[],
  generations: [] as GenerationRow[],
  draftLookupError: null as string | null,
  generationLookupError: null as string | null,
};

function commitment(overrides: Partial<ActiveV2CommitmentRow> = {}): ActiveV2CommitmentRow {
  return {
    id: "cmt_angela",
    clerk_user_id: USER,
    status: "active",
    behavior_statement: ASK_A,
    title: "Bed",
    success_criteria: null,
    blocker_capture_expires_at: null,
    blocker_capture_after_event: null,
    adaptive_ask_text: null,
    adaptive_ask_active_from: null,
    adaptive_ask_expires_at: null,
    adaptive_proposal_text: null,
    adaptive_proposal_created_at: null,
    adaptive_proposal_expires_at: null,
    accountability_phase: "active_accountability",
    reactivation_entered_at: null,
    reactivation_last_sent_at: null,
    reactivation_entry_reason_code: null,
    refresh_session: null,
    commitment_refresh_last_prompted_at: null,
    pending_resolution_kind: null,
    pending_resolution_created_at: null,
    pending_resolution_expires_at: null,
    pending_resolution_payload: null,
    updated_at: "2026-09-07T12:00:00.000Z",
    started_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function seedMachineDraft(args: {
  sendSlot: string;
  body: string;
  generationAsk?: string | null;
  draftId?: string;
  generationId?: string;
  editedByTyler?: boolean;
  currentBodySource?: string | null;
}) {
  const draftId = args.draftId ?? `d-${args.sendSlot}`;
  const generationId = args.generationId ?? `g-${args.sendSlot}`;
  db.drafts = [
    {
      id: draftId,
      clerk_user_id: USER,
      draft_for_day_key: DAY,
      send_slot: args.sendSlot,
      status: "current",
      current_body_to_send: args.body,
      current_body_source: args.currentBodySource ?? "machine",
      edited_by_tyler: args.editedByTyler === true,
      current_generation_id: generationId,
    },
  ];
  const metadata: Record<string, unknown> = {};
  if (args.generationAsk != null) {
    metadata.generation_effective_ask = args.generationAsk;
  }
  db.generations = [{ id: generationId, generation_metadata: metadata }];
}

function persistFreshBody(sendSlot: string, body: string, ask: string | null) {
  const draft = db.drafts.find((d) => d.send_slot === sendSlot && d.status === "current");
  if (!draft) return;
  const generationId = `g-fresh-${sendSlot}`;
  draft.current_body_to_send = body;
  draft.current_generation_id = generationId;
  const metadata: Record<string, unknown> = {};
  if (ask != null) {
    metadata.generation_effective_ask = ask;
  }
  db.generations.push({
    id: generationId,
    generation_metadata: metadata,
  });
}

function installSupabase() {
  supabaseFrom.mockImplementation((table: string) => {
    const state: { id?: string; sendSlot?: string } = {};
    const execute = () => {
      if (table === "sms_daily_drafts") {
        if (db.draftLookupError) {
          return { data: null, error: { message: db.draftLookupError } };
        }
        const row = db.drafts.find(
          (d) =>
            d.clerk_user_id === USER &&
            d.draft_for_day_key === DAY &&
            d.status === "current" &&
            (state.sendSlot ? d.send_slot === state.sendSlot : true)
        );
        return { data: row ?? null, error: null };
      }
      if (table === "sms_daily_draft_generations") {
        if (db.generationLookupError) {
          return { data: null, error: { message: db.generationLookupError } };
        }
        const row = db.generations.find((g) => g.id === state.id) ?? null;
        return { data: row, error: null };
      }
      return { data: null, error: { message: `unexpected_table:${table}` } };
    };
    const chain = {
      select: () => chain,
      eq: (col: string, val: string) => {
        if (col === "id") state.id = val;
        if (col === "send_slot") state.sendSlot = val;
        return chain;
      },
      maybeSingle: () => Promise.resolve(execute()),
    };
    return chain;
  });
}

async function freshFor(sendSlot: typeof SMS_DAILY_PRODUCTION_SEND_SLOT | typeof SMS_DAILY_EVENING_PREVIEW_SEND_SLOT | typeof SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT) {
  return ensureCurrentTtoDraftFreshForSend({
    clerkUserId: USER,
    sendSlot,
    draftForDayKey: DAY,
    now: NOW,
  });
}

describe("ensureCurrentTtoDraftFreshForSend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.drafts = [];
    db.generations = [];
    db.draftLookupError = null;
    db.generationLookupError = null;
    installSupabase();
    getActiveCommitment.mockResolvedValue(commitment());
    loadTylerTextOverviewAudienceRow.mockResolvedValue(AUDIENCE);
    markCurrentTtoDraftUnusable.mockResolvedValue(true);
    generateTylerTextOverviewDraftForUser.mockImplementation(async () => {
      persistFreshBody("morning", "FRESH MORNING", ASK_A);
      return { ok: true };
    });
    generateTylerTextOverviewEveningPreviewForUser.mockImplementation(async () => {
      persistFreshBody("evening_checkin", "FRESH EVENING", ASK_A);
      return { ok: true };
    });
    generateTylerTextOverviewWeeklyDraftForUser.mockImplementation(async () => {
      persistFreshBody("weekly_review", "FRESH WEEKLY", ASK_A);
      return { ok: true };
    });
  });

  it("A. temp B generated then overlay expires to current A is stale", async () => {
    seedMachineDraft({ sendSlot: "morning", body: "BODY B", generationAsk: ASK_B });
    getActiveCommitment.mockResolvedValue(
      commitment({
        adaptive_ask_text: ASK_B,
        adaptive_ask_expires_at: "2026-09-01T00:00:00.000Z",
      })
    );
    const result = await freshFor("morning");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("regenerated");
    expect(generateTylerTextOverviewDraftForUser).toHaveBeenCalledTimes(1);
  });

  it("B. stale Morning regenerates, persists, and re-reads fresh body", async () => {
    seedMachineDraft({ sendSlot: "morning", body: "STALE MORNING", generationAsk: ASK_B });
    const result = await freshFor("morning");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("regenerated");
    expect(result.currentBodyToSend).toBe("FRESH MORNING");
    expect(generateTylerTextOverviewDraftForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        draftForDayKey: DAY,
        generationReason: "pre_send_stale_refresh",
        protectTylerProvenanceOnly: true,
      })
    );
  });

  it("C. stale Evening regenerates, persists, and re-reads fresh body", async () => {
    seedMachineDraft({ sendSlot: "evening_checkin", body: "STALE EVENING", generationAsk: ASK_B });
    const result = await freshFor("evening_checkin");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("regenerated");
    expect(result.currentBodyToSend).toBe("FRESH EVENING");
    expect(generateTylerTextOverviewEveningPreviewForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        draftForDayKey: DAY,
        protectTylerProvenanceOnly: true,
      })
    );
    expect(generateTylerTextOverviewDraftForUser).not.toHaveBeenCalled();
  });

  it("D. stale Weekly regenerates, persists, and re-reads fresh body", async () => {
    seedMachineDraft({ sendSlot: "weekly_review", body: "STALE WEEKLY", generationAsk: ASK_B });
    const result = await freshFor("weekly_review");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("regenerated");
    expect(result.currentBodyToSend).toBe("FRESH WEEKLY");
    expect(generateTylerTextOverviewWeeklyDraftForUser).toHaveBeenCalledTimes(1);
  });

  it("E. same effective ask does zero regeneration", async () => {
    seedMachineDraft({ sendSlot: "morning", body: "CURRENT MORNING", generationAsk: ASK_A });
    const result = await freshFor("morning");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("fresh");
    expect(result.currentBodyToSend).toBe("CURRENT MORNING");
    expect(generateTylerTextOverviewDraftForUser).not.toHaveBeenCalled();
    expect(generateTylerTextOverviewEveningPreviewForUser).not.toHaveBeenCalled();
    expect(generateTylerTextOverviewWeeklyDraftForUser).not.toHaveBeenCalled();
  });

  it("F. saved new chapter mismatch is caught", async () => {
    seedMachineDraft({ sendSlot: "morning", body: "OLD CHAPTER", generationAsk: ASK_A });
    getActiveCommitment.mockResolvedValue(
      commitment({ id: "cmt_new_chapter", behavior_statement: ASK_C })
    );
    generateTylerTextOverviewDraftForUser.mockImplementation(async () => {
      persistFreshBody("morning", "NEW CHAPTER", ASK_C);
      return { ok: true };
    });
    const result = await freshFor("morning");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("regenerated");
    expect(generateTylerTextOverviewDraftForUser).toHaveBeenCalledTimes(1);
  });

  it("G. temp replace same commitment id mismatch is caught", async () => {
    seedMachineDraft({ sendSlot: "morning", body: "BODY B", generationAsk: ASK_B });
    getActiveCommitment.mockResolvedValue(
      commitment({
        id: "cmt_angela",
        adaptive_ask_text: ASK_B2,
        adaptive_ask_expires_at: "2026-09-15T00:00:00.000Z",
      })
    );
    const result = await freshFor("morning");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("regenerated");
    expect(generateTylerTextOverviewDraftForUser).toHaveBeenCalledTimes(1);
  });

  it("H. temp revert same commitment id mismatch is caught", async () => {
    seedMachineDraft({ sendSlot: "morning", body: "BODY B", generationAsk: ASK_B });
    getActiveCommitment.mockResolvedValue(commitment({ id: "cmt_angela" }));
    const result = await freshFor("morning");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("regenerated");
    expect(generateTylerTextOverviewDraftForUser).toHaveBeenCalledTimes(1);
  });

  it("I. missing generation_effective_ask on machine draft regenerates", async () => {
    seedMachineDraft({ sendSlot: "morning", body: "LEGACY MACHINE", generationAsk: null });
    const result = await freshFor("morning");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("regenerated");
    expect(generateTylerTextOverviewDraftForUser).toHaveBeenCalledTimes(1);
  });

  it("J. Tyler-protected stale draft is not regenerated", async () => {
    seedMachineDraft({
      sendSlot: "morning",
      body: "TYLER EXACT DRAFT",
      generationAsk: ASK_B,
      editedByTyler: true,
      currentBodySource: "tyler_edit",
    });
    const result = await freshFor("morning");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("tyler_protected");
    expect(result.currentBodyToSend).toBe("TYLER EXACT DRAFT");
    expect(generateTylerTextOverviewDraftForUser).not.toHaveBeenCalled();
    expect(getActiveCommitment).not.toHaveBeenCalled();
  });

  it("K. regeneration failure does not send stale machine draft", async () => {
    seedMachineDraft({ sendSlot: "morning", body: "STALE MACHINE", generationAsk: ASK_B });
    generateTylerTextOverviewDraftForUser.mockResolvedValue({ ok: false, reason: "insert_failed" });
    markCurrentTtoDraftUnusable.mockResolvedValue(true);
    const result = await freshFor("morning");
    expect(result).toEqual({ ok: false, reason: "stale_draft_disabled" });
    expect(markCurrentTtoDraftUnusable).toHaveBeenCalledTimes(1);
  });

  it("L. disable-write failure stays unresolved with no stale Twilio", async () => {
    seedMachineDraft({ sendSlot: "morning", body: "STALE MACHINE", generationAsk: ASK_B });
    generateTylerTextOverviewDraftForUser.mockResolvedValue({ ok: false, reason: "insert_failed" });
    markCurrentTtoDraftUnusable.mockResolvedValue(false);
    const result = await freshFor("morning");
    expect(result).toEqual({ ok: false, reason: "stale_draft_could_not_be_disabled" });
  });

  it("M. relationship load failure fail-closes machine send", async () => {
    seedMachineDraft({ sendSlot: "morning", body: "MACHINE", generationAsk: ASK_A });
    getActiveCommitment.mockRejectedValue(new Error("commitment_lookup_failed"));
    const result = await freshFor("morning");
    expect(result).toEqual({ ok: false, reason: "relationship_unproven" });
    expect(generateTylerTextOverviewDraftForUser).not.toHaveBeenCalled();
  });

  it("N. fresh ordinary Morning does not regenerate", async () => {
    seedMachineDraft({ sendSlot: "morning", body: "ORDINARY MORNING", generationAsk: ASK_A });
    const result = await freshFor("morning");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("fresh");
    expect(result.currentBodyToSend).toBe("ORDINARY MORNING");
    expect(generateTylerTextOverviewDraftForUser).not.toHaveBeenCalled();
  });

  it("O. fresh ordinary Evening does not regenerate", async () => {
    seedMachineDraft({
      sendSlot: "evening_checkin",
      body: "ORDINARY EVENING",
      generationAsk: ASK_A,
    });
    const result = await freshFor("evening_checkin");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("fresh");
    expect(result.currentBodyToSend).toBe("ORDINARY EVENING");
    expect(generateTylerTextOverviewEveningPreviewForUser).not.toHaveBeenCalled();
  });

  it("P. fresh ordinary Weekly does not regenerate", async () => {
    seedMachineDraft({
      sendSlot: "weekly_review",
      body: "ORDINARY WEEKLY",
      generationAsk: ASK_A,
    });
    const result = await freshFor("weekly_review");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("fresh");
    expect(result.currentBodyToSend).toBe("ORDINARY WEEKLY");
    expect(generateTylerTextOverviewWeeklyDraftForUser).not.toHaveBeenCalled();
  });

  it("Q. exact persisted fresh body is the re-read send authority", async () => {
    seedMachineDraft({ sendSlot: "morning", body: "STALE", generationAsk: ASK_B });
    const result = await freshFor("morning");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.currentBodyToSend).toBe("FRESH MORNING");
    expect(result.currentBodyToSend).not.toBe("STALE");
  });

  it("regenerated machine draft still missing generation_effective_ask fails closed with no second regeneration", async () => {
    seedMachineDraft({ sendSlot: "morning", body: "STALE MACHINE", generationAsk: ASK_B });
    generateTylerTextOverviewDraftForUser.mockImplementation(async () => {
      persistFreshBody("morning", "STILL UNPROVEN", null);
      return { ok: true };
    });
    const result = await freshFor("morning");
    expect(result).toEqual({ ok: false, reason: "generation_effective_ask_unproven" });
    expect(generateTylerTextOverviewDraftForUser).toHaveBeenCalledTimes(1);
  });

  it("R. no body NLP", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/tto-draft-fresh-for-send.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/current_body_to_send\.(includes|match|replace|split)/);
    expect(src).not.toMatch(/parseBody|bodyNlp|nlp/i);
  });

  it("S. no inbound NLP", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/tto-draft-fresh-for-send.ts"),
      "utf8"
    );
    expect(src).not.toContain("sol-goal-change-semantic");
    expect(src).not.toContain("inbound");
    expect(src).not.toContain("runSolGoalChange");
  });

  it("T. no expiry-specific state machine", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/tto-draft-fresh-for-send.ts"),
      "utf8"
    );
    expect(src).not.toContain("adaptive_ask_expires_at");
    expect(src).not.toContain("expiry");
    expect(src).not.toContain("expired");
  });
});
