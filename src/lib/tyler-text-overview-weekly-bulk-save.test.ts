import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { bulkApplyWeeklyTtoDraftBodies } from "@/lib/tyler-text-overview-weekly-bulk-save";
import {
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
  SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";
import { getWeekKeyForLocalDateKey } from "@/lib/weekly-sms-week-key";
import {
  MAX_WEEKLY_EDITABLE_BODY,
  weeklyEditableBodyExceedsMax,
} from "@/lib/weekly-tto-length";

const SUNDAY = "2026-07-12";
const OTHER_SUNDAY = "2026-07-19";
const WEEK_KEY = getWeekKeyForLocalDateKey(SUNDAY);
const TEXT = "Same weekly text.\nKeep this line.";

const loadAudience = vi.hoisted(() => vi.fn());

const db = vi.hoisted(() => ({
  drafts: [] as Array<Record<string, unknown>>,
  generations: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
  directWrites: 0,
  rpcCalls: [] as Array<Record<string, unknown>>,
  failDraftIds: new Set<string>(),
}));

function member(id: string, name: string) {
  return {
    clerkUserId: id,
    phoneNumber: "+15555550100",
    timezone: "America/New_York",
    preferredName: name,
  };
}

function generation(args: {
  id: string;
  weekKey?: string;
  weekEnd?: string;
  slot?: string;
  machine?: string;
  shouldSend?: boolean;
  metadata?: Record<string, unknown>;
}) {
  return {
    id: args.id,
    send_slot: args.slot ?? SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
    machine_draft_body: args.machine ?? "machine",
    machine_should_send: args.shouldSend ?? true,
    generation_metadata: {
      week_key: args.weekKey ?? WEEK_KEY,
      week_end: args.weekEnd ?? SUNDAY,
      ...(args.metadata ?? {}),
    },
  };
}

function draft(args: Record<string, unknown>) {
  return {
    send_slot: SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
    status: "current",
    draft_for_day_key: SUNDAY,
    current_body_to_send: "old",
    current_body_source: "machine",
    edited_by_tyler: false,
    machine_should_send: true,
    ...args,
  };
}

vi.mock("@/lib/tyler-text-overview-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tyler-text-overview-admin")>();
  return {
    ...actual,
    loadSendableTylerTextOverviewAudienceMembers: loadAudience,
  };
});

function rowsFor(
  table: string,
  filters: Record<string, unknown>,
  pendingIn: { col: string; vals: unknown[] } | null
) {
  const source =
    table === SMS_DAILY_DRAFTS_TABLE
      ? db.drafts
      : table === SMS_DAILY_DRAFT_GENERATIONS_TABLE
        ? db.generations
        : table === "sms_weekly_send_events"
          ? db.events
          : [];
  return source.filter((row) => {
    for (const [col, val] of Object.entries(filters)) {
      if (row[col] !== val) return false;
    }
    if (pendingIn && !pendingIn.vals.includes(row[pendingIn.col])) return false;
    return true;
  });
}

function makeChain(table: string) {
  const filters: Record<string, unknown> = {};
  let pendingIn: { col: string; vals: unknown[] } | null = null;
  const self: Record<string, unknown> = {};
  const execute = async () => ({ data: rowsFor(table, filters, pendingIn), error: null });
  self.select = vi.fn(() => self);
  self.eq = vi.fn((col: string, val: unknown) => {
    filters[col] = val;
    return self;
  });
  self.in = vi.fn((col: string, vals: unknown[]) => {
    pendingIn = { col, vals };
    return self;
  });
  self.update = vi.fn(() => {
    db.directWrites += 1;
    return self;
  });
  self.insert = vi.fn(() => {
    db.directWrites += 1;
    return self;
  });
  self.upsert = vi.fn(() => {
    db.directWrites += 1;
    return self;
  });
  self.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    execute().then(onFulfilled, onRejected);
  return self;
}

function applyRpc(args: Record<string, unknown>) {
  db.rpcCalls.push(args);
  const draftId = String(args.p_draft_id);
  if (db.failDraftIds.has(draftId)) {
    return { data: null, error: { message: "rpc_boom" } };
  }
  const clerk = args.p_clerk_user_id;
  const weekKey = args.p_week_key;
  if (db.events.some((event) => event.clerk_user_id === clerk && event.week_key === weekKey)) {
    return { data: [{ ok: false, reason: "send_event_exists" }], error: null };
  }
  const current = db.drafts.filter(
    (row) =>
      row.clerk_user_id === clerk &&
      row.send_slot === SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT &&
      row.status === "current"
  );
  const matches = current.filter((row) => {
    const gen = db.generations.find((item) => item.id === row.current_generation_id);
    const meta = (gen?.generation_metadata ?? {}) as Record<string, unknown>;
    return meta.week_key === weekKey;
  });
  if (matches.length === 0) {
    return { data: [{ ok: false, reason: "no_current_for_week" }], error: null };
  }
  if (matches.length > 1) {
    return { data: [{ ok: false, reason: "ambiguous_week" }], error: null };
  }
  const match = matches[0]!;
  const gen = db.generations.find((item) => item.id === match.current_generation_id);
  const meta = (gen?.generation_metadata ?? {}) as Record<string, unknown>;
  if (
    match.id !== draftId ||
    match.draft_for_day_key !== args.p_draft_for_day_key ||
    !gen ||
    gen.send_slot !== SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT ||
    meta.week_key !== weekKey ||
    meta.week_end !== args.p_draft_for_day_key
  ) {
    return { data: [{ ok: false, reason: !gen ? "missing_generation" : "bad_week_linkage" }], error: null };
  }
  match.current_body_to_send = args.p_body;
  match.current_body_source = "tyler_edit";
  match.edited_by_tyler = true;
  match.edited_at = args.p_edited_at;
  match.edit_distance_chars = args.p_edit_distance_chars;
  match.current_body_hash = args.p_body_hash;
  match.updated_at = args.p_edited_at;
  return { data: [{ ok: true, reason: "applied" }], error: null };
}

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn((table: string) => makeChain(table)),
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn !== "weekly_tto_apply_tyler_body") {
        return { data: null, error: { message: `missing_rpc:${fn}` } };
      }
      return applyRpc(args ?? {});
    }),
  },
}));

function seedAudienceAndDrafts() {
  db.drafts = [
    draft({
      id: "sunday-current",
      clerk_user_id: "user_sunday",
      current_generation_id: "gen-sunday",
      current_body_to_send: "machine sunday",
    }),
    draft({
      id: "other-sunday",
      clerk_user_id: "user_other_sunday",
      draft_for_day_key: OTHER_SUNDAY,
      current_generation_id: "gen-other",
      current_body_to_send: "other sunday",
    }),
    draft({
      id: "morning",
      clerk_user_id: "user_morning",
      send_slot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      current_generation_id: "gen-morning",
      current_body_to_send: "morning body",
    }),
    draft({
      id: "evening",
      clerk_user_id: "user_evening",
      send_slot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      current_generation_id: "gen-evening",
      current_body_to_send: "evening body",
    }),
    draft({
      id: "sent",
      clerk_user_id: "user_sent",
      status: "sent",
      current_generation_id: "gen-sent",
      current_body_to_send: "already sent",
    }),
    draft({
      id: "tyler-text",
      clerk_user_id: "user_tyler_text",
      current_generation_id: "gen-tyler-text",
      current_body_to_send: "prior tyler",
      current_body_source: "tyler_edit",
      edited_by_tyler: true,
    }),
    draft({
      id: "tyler-blank",
      clerk_user_id: "user_tyler_blank",
      current_generation_id: "gen-tyler-blank",
      current_body_to_send: null,
      current_body_source: "tyler_edit",
      edited_by_tyler: true,
    }),
    draft({
      id: "bad-week",
      clerk_user_id: "user_bad_week",
      current_generation_id: "gen-bad-week",
      current_body_to_send: "bad week",
    }),
    draft({
      id: "missing-gen",
      clerk_user_id: "user_missing_gen",
      current_generation_id: "gen-absent",
      current_body_to_send: "no gen",
    }),
    draft({
      id: "ambiguous",
      clerk_user_id: "user_ambiguous",
      current_generation_id: "gen-ambiguous-a",
      current_body_to_send: "ambiguous a",
    }),
    draft({
      id: "ambiguous-other",
      clerk_user_id: "user_ambiguous",
      draft_for_day_key: OTHER_SUNDAY,
      current_generation_id: "gen-ambiguous-b",
      current_body_to_send: "ambiguous b",
    }),
    draft({
      id: "reserved",
      clerk_user_id: "user_reserved",
      current_generation_id: "gen-reserved",
      current_body_to_send: "reserved body",
    }),
    draft({
      id: "accepted",
      clerk_user_id: "user_accepted",
      current_generation_id: "gen-accepted",
      current_body_to_send: "accepted body",
    }),
    draft({
      id: "failed-send",
      clerk_user_id: "user_failed_send",
      current_generation_id: "gen-failed-send",
      current_body_to_send: "failed send body",
    }),
    draft({
      id: "historical-skip",
      clerk_user_id: "user_historical",
      current_generation_id: "gen-historical",
      current_body_to_send: "historical body",
    }),
    draft({
      id: "historical-voice",
      clerk_user_id: "user_historical_voice",
      current_generation_id: "gen-historical-voice",
      current_body_to_send: "voice skip body",
    }),
    draft({
      id: "machine-false",
      clerk_user_id: "user_machine_false",
      current_generation_id: "gen-machine-false",
      current_body_to_send: "machine false body",
    }),
  ];
  db.generations = [
    generation({ id: "gen-sunday" }),
    generation({ id: "gen-other", weekEnd: OTHER_SUNDAY, weekKey: getWeekKeyForLocalDateKey(OTHER_SUNDAY) }),
    generation({ id: "gen-morning", slot: SMS_DAILY_PRODUCTION_SEND_SLOT }),
    generation({ id: "gen-evening", slot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT }),
    generation({ id: "gen-sent" }),
    generation({ id: "gen-tyler-text", machine: "machine before tyler" }),
    generation({ id: "gen-tyler-blank", machine: "machine before blank" }),
    generation({ id: "gen-bad-week", weekKey: "1999-W01", weekEnd: "1999-01-03" }),
    generation({ id: "gen-ambiguous-a" }),
    generation({ id: "gen-ambiguous-b", weekEnd: OTHER_SUNDAY }),
    generation({ id: "gen-reserved" }),
    generation({ id: "gen-accepted" }),
    generation({ id: "gen-failed-send" }),
    generation({ id: "gen-historical" }),
    generation({ id: "gen-historical-voice" }),
    generation({
      id: "gen-machine-false",
      shouldSend: false,
      metadata: { model: "gpt-test", untouched: true },
    }),
  ];
  db.events = [
    { clerk_user_id: "user_reserved", week_key: WEEK_KEY, status: "reserved" },
    { clerk_user_id: "user_accepted", week_key: WEEK_KEY, status: "accepted" },
    { clerk_user_id: "user_failed_send", week_key: WEEK_KEY, status: "send_failed" },
    {
      clerk_user_id: "user_historical",
      week_key: WEEK_KEY,
      status: "skipped_legacy_weekly_deprecated",
    },
    {
      clerk_user_id: "user_historical_voice",
      week_key: WEEK_KEY,
      status: "skipped_no_safe_v3_voice",
    },
  ];
  db.directWrites = 0;
  db.rpcCalls = [];
  db.failDraftIds = new Set();
  loadAudience.mockResolvedValue([
    member("user_sunday", "Sunday"),
    member("user_other_sunday", "Other"),
    member("user_morning", "Morning"),
    member("user_evening", "Evening"),
    member("user_sent", "Sent"),
    member("user_tyler_text", "TylerText"),
    member("user_tyler_blank", "TylerBlank"),
    member("user_missing", "Missing"),
    member("user_bad_week", "BadWeek"),
    member("user_missing_gen", "MissingGen"),
    member("user_ambiguous", "Ambiguous"),
    member("user_reserved", "Reserved"),
    member("user_accepted", "Accepted"),
    member("user_failed_send", "FailedSend"),
    member("user_historical", "Historical"),
    member("user_historical_voice", "HistoricalVoice"),
    member("user_machine_false", "MachineFalse"),
  ]);
}

describe("bulkApplyWeeklyTtoDraftBodies", () => {
  beforeEach(() => {
    seedAudienceAndDrafts();
  });

  it("updates only safe current Weekly drafts for the selected Sunday", async () => {
    const result = await bulkApplyWeeklyTtoDraftBodies({
      draftForDayKey: SUNDAY,
      body: `  ${TEXT}  `,
      now: new Date("2026-07-12T15:00:00.000Z"),
    });
    expect("status" in result).toBe(false);
    if ("status" in result) return;

    expect(result.textsSentByThisAction).toBe(0);
    expect(result.updated).toBe(4);
    expect(result.ok).toBe(true);
    expect(result.skippedMissing).toBe(4);
    expect(result.skippedNonCurrent).toBe(1);
    expect(result.skippedBadWeekLinkage).toBe(1);
    expect(result.skippedMissingGeneration).toBe(1);
    expect(result.skippedSendEvent).toBe(5);
    expect(result.skippedAmbiguous).toBe(1);
    expect(result.audience).toBe(17);
    expect(db.directWrites).toBe(0);

    const byId = (id: string) => db.drafts.find((row) => row.id === id);
    for (const id of ["sunday-current", "tyler-text", "tyler-blank", "machine-false"]) {
      expect(byId(id)?.current_body_to_send).toBe(TEXT);
      expect(byId(id)?.current_body_source).toBe("tyler_edit");
      expect(byId(id)?.edited_by_tyler).toBe(true);
    }
    expect(byId("other-sunday")?.current_body_to_send).toBe("other sunday");
    expect(byId("morning")?.current_body_to_send).toBe("morning body");
    expect(byId("evening")?.current_body_to_send).toBe("evening body");
    expect(byId("sent")?.status).toBe("sent");
    expect(byId("sent")?.current_body_to_send).toBe("already sent");
    expect(byId("bad-week")?.current_body_to_send).toBe("bad week");
    expect(byId("missing-gen")?.current_body_to_send).toBe("no gen");
    expect(byId("ambiguous")?.current_body_to_send).toBe("ambiguous a");
    expect(byId("ambiguous-other")?.current_body_to_send).toBe("ambiguous b");
    expect(byId("reserved")?.current_body_to_send).toBe("reserved body");
    expect(byId("accepted")?.current_body_to_send).toBe("accepted body");
    expect(byId("failed-send")?.current_body_to_send).toBe("failed send body");
    expect(byId("historical-skip")?.current_body_to_send).toBe("historical body");
    expect(byId("historical-voice")?.current_body_to_send).toBe("voice skip body");
    expect(db.drafts.some((row) => row.clerk_user_id === "user_missing")).toBe(false);

    const machineGen = db.generations.find((row) => row.id === "gen-machine-false");
    expect(machineGen?.machine_should_send).toBe(false);
    expect(machineGen?.generation_metadata).toMatchObject({ model: "gpt-test", untouched: true });
    expect(byId("machine-false")?.status).toBe("current");

    const rpcDraftIds = db.rpcCalls.map((call) => call.p_draft_id);
    expect(rpcDraftIds).toEqual(
      expect.arrayContaining(["sunday-current", "tyler-text", "tyler-blank", "machine-false"])
    );
    expect(rpcDraftIds).not.toContain("morning");
    expect(rpcDraftIds).not.toContain("sent");
    expect(rpcDraftIds).not.toContain("reserved");
    expect(db.rpcCalls[0]?.p_body).toBe(TEXT);
    expect(String(db.rpcCalls[0]?.p_body)).toContain("\n");
  });

  it("rejects an empty body and a footer-overflow body before any RPC", async () => {
    const empty = await bulkApplyWeeklyTtoDraftBodies({
      draftForDayKey: SUNDAY,
      body: "   ",
    });
    expect(empty).toMatchObject({ ok: false, status: 400 });
    expect(db.rpcCalls).toHaveLength(0);

    const over = "y".repeat(MAX_WEEKLY_EDITABLE_BODY + 1);
    expect(weeklyEditableBodyExceedsMax(over)).toBe(true);
    const tooLong = await bulkApplyWeeklyTtoDraftBodies({
      draftForDayKey: SUNDAY,
      body: over,
    });
    expect(tooLong).toMatchObject({ ok: false, status: 400 });
    expect(db.rpcCalls).toHaveLength(0);

    const atMax = "y".repeat(MAX_WEEKLY_EDITABLE_BODY);
    expect(weeklyEditableBodyExceedsMax(atMax)).toBe(false);
    const ok = await bulkApplyWeeklyTtoDraftBodies({
      draftForDayKey: SUNDAY,
      body: atMax,
    });
    expect("status" in ok).toBe(false);
    if ("status" in ok) return;
    expect(ok.updated).toBeGreaterThan(0);
    expect(db.rpcCalls.some((call) => call.p_body === atMax)).toBe(true);
  });

  it("reports the updated count when a later RPC fails and can reapply the same text", async () => {
    loadAudience.mockResolvedValue([
      member("user_sunday", "Sunday"),
      member("user_tyler_text", "TylerText"),
    ]);
    db.failDraftIds.add("tyler-text");
    const first = await bulkApplyWeeklyTtoDraftBodies({
      draftForDayKey: SUNDAY,
      body: TEXT,
    });
    expect("status" in first).toBe(false);
    if ("status" in first) return;
    expect(first.ok).toBe(false);
    expect(first.updated).toBe(1);
    expect(first.failed).toHaveLength(1);
    expect(first.failed[0]?.preferredName).toBe("TylerText");
    expect(first.failed[0]).not.toHaveProperty("clerkUserId");
    expect(first.textsSentByThisAction).toBe(0);
    expect(first.message).toContain("Updated 1");
    expect(first.message).not.toMatch(/nothing happened/i);
    expect(db.drafts.find((row) => row.id === "sunday-current")?.current_body_to_send).toBe(TEXT);

    db.failDraftIds.clear();
    const second = await bulkApplyWeeklyTtoDraftBodies({
      draftForDayKey: SUNDAY,
      body: TEXT,
    });
    expect("status" in second).toBe(false);
    if ("status" in second) return;
    expect(second.ok).toBe(true);
    expect(second.updated).toBe(2);
    expect(second.textsSentByThisAction).toBe(0);
    expect(db.drafts.find((row) => row.id === "tyler-text")?.current_body_source).toBe("tyler_edit");
    expect(db.drafts.find((row) => row.id === "tyler-text")?.current_body_to_send).toBe(TEXT);
  });

  it("does not call OpenAI or SMS and does not fall back to a direct draft write", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-weekly-bulk-save.ts"),
      "utf8"
    );
    expect(src).toContain('rpc("weekly_tto_apply_tyler_body"');
    expect(src).not.toContain("updateTylerTextOverviewDraftBody");
    expect(src).not.toContain("openai");
    expect(src).not.toContain("sendSMS");
    expect(src).not.toContain("blank_all");
    expect(src).toContain("TTO_GENERATE_ALL_CONCURRENCY");
    const dashboard = readFileSync(
      join(process.cwd(), "src/app/admin/tyler-text-overview/tyler-text-overview-weekly-dashboard.tsx"),
      "utf8"
    );
    const copy = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-dashboard-copy.ts"),
      "utf8"
    );
    expect(copy).toContain("Apply same text to all");
    expect(copy).toContain("This click sends no SMS.");
    expect(copy).toContain("Search does not narrow it.");
    expect(dashboard).toContain("/api/admin/tyler-text-overview/weekly-bulk-save");
    expect(dashboard).not.toContain("operation: \"blank_all\"");
    const morning = readFileSync(
      join(process.cwd(), "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx"),
      "utf8"
    );
    expect(morning).not.toContain("weekly-bulk-save");
  });
});
