import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  computeTylerTextOverviewAdminCounts,
  computeTylerTextOverviewEdited,
  levenshteinCharDistance,
  listCurrentTylerTextOverviewDrafts,
  listSendableTylerTextOverviewRows,
  loadSendableTylerTextOverviewAudienceMembers,
  mapDraftRowsToAdminDto,
  matchesTylerTextOverviewSearchQuery,
  normalizeTylerTextOverviewDraftBodyInput,
  parseWriterOpenAiMessages,
  pickTylerTextOverviewDraftOverlay,
  resolveAdminListSendSlot,
  resolveTylerTextOverviewRowState,
  updateTylerTextOverviewDraftBody,
} from "@/lib/tyler-text-overview-admin";
import { hashSmsSnippet } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";

const requireTylerAdminMock = vi.hoisted(() => vi.fn());

type DraftRow = {
  id: string;
  clerk_user_id: string;
  draft_for_day_key: string;
  current_generation_id: string;
  current_body_to_send: string | null;
  status: string;
  send_slot?: string;
  current_body_source?: string;
  edited_by_tyler?: boolean;
  edited_at?: string | null;
  edit_distance_chars?: number | null;
  current_body_hash?: string | null;
  updated_at?: string;
};

type GenerationRow = {
  id: string;
  generation_number?: number;
  clerk_user_id?: string;
  draft_for_day_key?: string;
  send_slot?: string;
  writer_openai_messages: unknown;
  writer_prompt_path?: string | null;
  machine_draft_body: string | null;
  machine_should_send?: boolean;
  machine_no_send_reason?: string | null;
  notebook_hash?: string | null;
  generation_metadata?: Record<string, unknown>;
  phone_number?: string;
  notebook_verdict?: string;
};

type SmsAudienceRow = {
  clerk_user_id: string;
  phone_number: string | null;
  sms_enabled: boolean;
  summitt_subscribed: boolean;
  stopped_at: string | null;
  timezone?: string | null;
};

type V2CommitmentRow = {
  clerk_user_id: string;
  status: string;
  behavior_statement: string | null;
};

type V2CommsPrefsRow = {
  clerk_user_id: string;
  pause_until: string | null;
};

type UserProfileRow = {
  clerk_user_id: string;
  preferred_name: string | null;
};

const db = vi.hoisted(() => ({
  drafts: [] as DraftRow[],
  generations: [] as GenerationRow[],
  smsAudience: [] as SmsAudienceRow[],
  v2Commitments: [] as V2CommitmentRow[],
  v2CommsPrefs: [] as V2CommsPrefsRow[],
  userProfiles: [] as UserProfileRow[],
  smsSendEventsWrites: 0,
  generationUpdateCalls: 0,
}));

function filterDrafts(payload: Record<string, unknown>): DraftRow[] {
  let rows = [...db.drafts];
  if (typeof payload.status === "string") {
    rows = rows.filter((d) => d.status === payload.status);
  }
  if (Array.isArray(payload.in_status)) {
    const allowed = payload.in_status as string[];
    rows = rows.filter((d) => allowed.includes(d.status));
  }
  if (typeof payload.send_slot === "string") {
    rows = rows.filter((d) => ((d as { send_slot?: string }).send_slot ?? "morning") === payload.send_slot);
  }
  if (typeof payload.draft_for_day_key === "string") {
    rows = rows.filter((d) => d.draft_for_day_key === payload.draft_for_day_key);
  }
  if (Array.isArray(payload.in_clerk_user_id)) {
    const allowed = payload.in_clerk_user_id as string[];
    rows = rows.filter((d) => allowed.includes(d.clerk_user_id));
  }
  if (typeof payload.id === "string") {
    rows = rows.filter((d) => d.id === payload.id);
  }
  rows.sort((a, b) => {
    const dayCmp = b.draft_for_day_key.localeCompare(a.draft_for_day_key);
    if (dayCmp !== 0) return dayCmp;
    return a.clerk_user_id.localeCompare(b.clerk_user_id);
  });
  return rows;
}

function makeChain(handlers: {
  table: string;
  action: string;
  payload: Record<string, unknown>;
  updatePayload?: Record<string, unknown>;
}) {
  const state = handlers;

  const execute = async () => {
    const { table, action, payload } = state;

    if (table === "sms_send_events") {
      db.smsSendEventsWrites += 1;
      return { data: null, error: null };
    }

    if (table === "sms_daily_drafts" && action === "select") {
      const rows = filterDrafts(payload);
      if (payload.maybeSingle) {
        return { data: rows[0] ?? null, error: null };
      }
      return { data: rows, error: null };
    }

    if (table === "sms_audience" && action === "select") {
      let rows = [...db.smsAudience];
      if (payload.summitt_subscribed === true) {
        rows = rows.filter((r) => r.summitt_subscribed === true);
      }
      if (payload.sms_enabled === true) {
        rows = rows.filter((r) => r.sms_enabled === true);
      }
      if (typeof payload.clerk_user_id === "string") {
        rows = rows.filter((r) => r.clerk_user_id === payload.clerk_user_id);
      }
      if (payload.maybeSingle) {
        return { data: rows[0] ?? null, error: null };
      }
      return { data: rows, error: null };
    }

    if (table === "v2_commitment" && action === "select") {
      let rows = [...db.v2Commitments];
      if (payload.status === "active") {
        rows = rows.filter((r) => r.status === "active");
      }
      if (Array.isArray(payload.in_clerk_user_id)) {
        const allowed = payload.in_clerk_user_id as string[];
        rows = rows.filter((r) => allowed.includes(r.clerk_user_id));
      }
      return { data: rows, error: null };
    }

    if (table === "v2_user_sms_comms_preferences" && action === "select") {
      let rows = [...db.v2CommsPrefs];
      if (Array.isArray(payload.in_clerk_user_id)) {
        const allowed = payload.in_clerk_user_id as string[];
        rows = rows.filter((r) => allowed.includes(r.clerk_user_id));
      }
      if (payload.maybeSingle) {
        return { data: rows[0] ?? null, error: null };
      }
      return { data: rows, error: null };
    }

    if (table === "user_profiles" && action === "select") {
      let rows = [...db.userProfiles];
      if (Array.isArray(payload.in_clerk_user_id)) {
        const allowed = payload.in_clerk_user_id as string[];
        rows = rows.filter((r) => allowed.includes(r.clerk_user_id));
      }
      return { data: rows, error: null };
    }

    if (table === "sms_daily_draft_generations" && action === "select") {
      const ids = (payload.in_id as string[] | undefined) ?? [];
      if (typeof payload.id === "string") {
        const row = db.generations.find((g) => g.id === payload.id) ?? null;
        return { data: row, error: null };
      }
      if (ids.length > 0) {
        const rows = db.generations.filter((g) => ids.includes(g.id));
        return { data: rows, error: null };
      }
      const clerkIds = payload.in_clerk_user_id as string[] | undefined;
      const dayKeys = payload.in_draft_for_day_key as string[] | undefined;
      if (clerkIds && dayKeys) {
        let rows = db.generations.filter(
          (g) =>
            typeof g.clerk_user_id === "string" &&
            typeof g.draft_for_day_key === "string" &&
            clerkIds.includes(g.clerk_user_id) &&
            dayKeys.includes(g.draft_for_day_key)
        );
        if (typeof payload.send_slot === "string") {
          rows = rows.filter(
            (g) => (g.send_slot ?? "morning") === payload.send_slot
          );
        }
        return { data: rows, error: null };
      }
      return { data: [], error: null };
    }

    if (table === "sms_daily_draft_generations" && action === "update") {
      db.generationUpdateCalls += 1;
      return { data: null, error: null };
    }

    if (table === "sms_daily_drafts" && action === "update") {
      const update = state.updatePayload ?? {};
      const rows = db.drafts.filter(
        (d) =>
          (payload.id == null || d.id === payload.id) &&
          (payload.status == null || d.status === payload.status)
      );
      if (rows.length === 0) {
        return { data: null, error: null };
      }
      const draft = rows[0];
      Object.assign(draft, update);
      return { data: draft, error: null };
    }

    return { data: null, error: null };
  };

  const self: Record<string, unknown> = {};
  self.select = vi.fn((cols?: string) => {
    if (cols) state.payload.select = cols;
    if (state.action === "update") {
      return { maybeSingle: vi.fn(execute) };
    }
    return self;
  });
  self.eq = vi.fn((col: string, val: unknown) => {
    state.payload[col] = val;
    return self;
  });
  self.in = vi.fn((col: string, val: unknown) => {
    if (col === "id") state.payload.in_id = val;
    if (col === "clerk_user_id") state.payload.in_clerk_user_id = val;
    if (col === "draft_for_day_key") state.payload.in_draft_for_day_key = val;
    if (col === "status") state.payload.in_status = val;
    return self;
  });
  self.order = vi.fn(() => self);
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

vi.mock("@/lib/auth/require-tyler-admin", () => ({
  requireTylerAdmin: requireTylerAdminMock,
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn((name: string) =>
      makeChain({ table: name, action: "select", payload: {} })
    ),
  },
}));

const WRITER_MESSAGES = [
  { role: "system" as const, content: "You are a coach." },
  { role: "user" as const, content: "DAILY_SMS_WRITING_BRIEF_V1\n{}" },
  { role: "assistant" as const, content: "Did the two hours happen?" },
];

const MACHINE_BODY = "Did the two hours happen before noon?";

function seedSendableUser(args: {
  clerkUserId: string;
  phone?: string;
  preferredName?: string;
  paused?: boolean;
  notV2?: boolean;
  stopped?: boolean;
  smsDisabled?: boolean;
  notSubscribed?: boolean;
  noPhone?: boolean;
}) {
  db.smsAudience = db.smsAudience.filter((row) => row.clerk_user_id !== args.clerkUserId);
  db.v2Commitments = db.v2Commitments.filter((row) => row.clerk_user_id !== args.clerkUserId);
  db.v2CommsPrefs = db.v2CommsPrefs.filter((row) => row.clerk_user_id !== args.clerkUserId);
  db.userProfiles = db.userProfiles.filter((row) => row.clerk_user_id !== args.clerkUserId);

  db.smsAudience.push({
    clerk_user_id: args.clerkUserId,
    phone_number: args.noPhone ? null : (args.phone ?? "+15551234567"),
    sms_enabled: args.smsDisabled ? false : true,
    summitt_subscribed: args.notSubscribed ? false : true,
    stopped_at: args.stopped ? "2026-01-01T00:00:00.000Z" : null,
    timezone: "America/New_York",
  });

  if (!args.notV2) {
    db.v2Commitments.push({
      clerk_user_id: args.clerkUserId,
      status: "active",
      behavior_statement: "I will train daily",
    });
  }

  if (args.paused) {
    db.v2CommsPrefs.push({
      clerk_user_id: args.clerkUserId,
      pause_until: "2099-01-01T00:00:00.000Z",
    });
  }

  if (args.preferredName) {
    db.userProfiles.push({
      clerk_user_id: args.clerkUserId,
      preferred_name: args.preferredName,
    });
  }
}

function seedCurrentDraft(
  overrides?: Partial<DraftRow> & {
    generation?: Partial<GenerationRow>;
    preferredName?: string;
  }
) {
  const clerkUserId = overrides?.clerk_user_id ?? "user_admin_test";
  if (!db.smsAudience.some((row) => row.clerk_user_id === clerkUserId)) {
    seedSendableUser({
      clerkUserId,
      preferredName: overrides?.preferredName ?? "Admin Test",
    });
  }
  const generationId = overrides?.current_generation_id ?? "gen-1";
  db.generations = [
    {
      id: generationId,
      generation_number: 1,
      clerk_user_id: "user_admin_test",
      draft_for_day_key: "2026-07-03",
      writer_openai_messages: WRITER_MESSAGES,
      writer_prompt_path: "daily_writing_brief_v1",
      machine_draft_body: MACHINE_BODY,
      machine_should_send: true,
      machine_no_send_reason: null,
      notebook_hash: "hash-abc",
      phone_number: "+15551234567",
      notebook_verdict: "verified",
      generation_metadata: { capture_present: true },
      ...overrides?.generation,
    },
  ];
  db.drafts = [
    {
      id: "draft-1",
      clerk_user_id: "user_admin_test",
      draft_for_day_key: "2026-07-03",
      current_generation_id: generationId,
      current_body_to_send: MACHINE_BODY,
      status: "current",
      ...overrides,
    },
  ];
}

describe("resolveAdminListSendSlot", () => {
  it("defaults invalid values to morning", () => {
    expect(resolveAdminListSendSlot(undefined)).toBe("morning");
    expect(resolveAdminListSendSlot(null)).toBe("morning");
    expect(resolveAdminListSendSlot("bogus")).toBe("morning");
    expect(resolveAdminListSendSlot("morning")).toBe("morning");
  });

  it("accepts evening_checkin", () => {
    expect(resolveAdminListSendSlot("evening_checkin")).toBe("evening_checkin");
  });

  it("accepts weekly_review without coercing to morning", () => {
    expect(resolveAdminListSendSlot("weekly_review")).toBe("weekly_review");
  });
});

describe("tyler-text-overview-admin read model", () => {
  beforeEach(() => {
    db.drafts = [];
    db.generations = [];
    db.smsAudience = [];
    db.v2Commitments = [];
    db.v2CommsPrefs = [];
    db.userProfiles = [];
    db.smsSendEventsWrites = 0;
    db.generationUpdateCalls = 0;
    vi.clearAllMocks();
  });

  it("list returns current drafts joined to current generation", async () => {
    seedCurrentDraft();
    const rows = await listCurrentTylerTextOverviewDrafts();
    expect(rows).toHaveLength(1);
    expect(rows[0].draftId).toBe("draft-1");
    expect(rows[0].writerOpenAiMessages).toEqual(WRITER_MESSAGES);
  });

  it("list defaults to morning send_slot filter", async () => {
    seedCurrentDraft();
    db.drafts.push({
      id: "draft-evening",
      clerk_user_id: "user_evening",
      draft_for_day_key: "2026-07-03",
      current_generation_id: "gen-evening",
      current_body_to_send: "Evening preview body",
      status: "current",
      send_slot: "evening_checkin",
    });
    seedSendableUser({ clerkUserId: "user_evening", preferredName: "Evening User" });
    db.generations.push({
      id: "gen-evening",
      generation_number: 1,
      clerk_user_id: "user_evening",
      draft_for_day_key: "2026-07-03",
      send_slot: "evening_checkin",
      writer_openai_messages: WRITER_MESSAGES,
      machine_draft_body: "Evening preview body",
      machine_should_send: true,
      generation_metadata: { preview_only: true, morning_anchor_source: "send_event" },
    });

    const morningRows = await listCurrentTylerTextOverviewDrafts();
    expect(morningRows).toHaveLength(1);
    expect(morningRows[0].sendSlot).toBe("morning");

    const eveningRows = await listCurrentTylerTextOverviewDrafts({
      sendSlot: "evening_checkin",
    });
    expect(eveningRows).toHaveLength(1);
    expect(eveningRows[0].sendSlot).toBe("evening_checkin");
    expect(eveningRows[0].previewOnly).toBe(true);
    expect(eveningRows[0].morningAnchorSource).toBe("send_event");
  });

  it("latest generation lookup is scoped by send_slot", async () => {
    seedCurrentDraft();
    db.generations.push({
      id: "gen-2",
      generation_number: 2,
      clerk_user_id: "user_admin_test",
      draft_for_day_key: "2026-07-03",
      send_slot: "morning",
      writer_openai_messages: WRITER_MESSAGES,
      machine_draft_body: MACHINE_BODY,
      machine_should_send: true,
      generation_metadata: { capture_present: true },
    });

    const rows = await listCurrentTylerTextOverviewDrafts();
    expect(rows[0].latestGenerationNumber).toBe(2);
    expect(rows[0].isLatestGeneration).toBe(false);
  });

  it("DTO includes draft body and notebook provenance fields", () => {
    seedCurrentDraft();
    const dto = mapDraftRowsToAdminDto({
      drafts: db.drafts,
      generationsById: new Map(db.generations.map((g) => [g.id, g])),
      latestGenerationsByKey: new Map([
        ["user_admin_test:2026-07-03:morning", { id: "gen-1", generation_number: 1 }],
      ]),
    })[0];
    expect(dto.draftId).toBe("draft-1");
    expect(dto.rowState).toBe("draft_current");
    expect(dto.clerkUserId).toBe("user_admin_test");
    expect(dto.draftForDayKey).toBe("2026-07-03");
    expect(dto.sendSlot).toBe("morning");
    expect(dto.currentBodyToSend).toBe(MACHINE_BODY);
    expect(dto.writerOpenAiMessages).toEqual(WRITER_MESSAGES);
    expect(dto.writerPromptPath).toBe("daily_writing_brief_v1");
    expect(dto.notebookMessageCount).toBe(3);
    expect(dto.machineShouldSend).toBe(true);
    expect(dto.capturePresent).toBe(true);
    expect(dto.isLatestGeneration).toBe(true);
  });

  it("DTO exposes phone when audience overlay is provided", () => {
    seedCurrentDraft();
    const dto = mapDraftRowsToAdminDto({
      drafts: db.drafts,
      generationsById: new Map(db.generations.map((g) => [g.id, g])),
      audienceByUserId: new Map([
        [
          "user_admin_test",
          {
            clerkUserId: "user_admin_test",
            phoneNumber: "+15551234567",
            timezone: "America/New_York",
            preferredName: "Admin Test",
          },
        ],
      ]),
    })[0];
    expect(dto.phoneNumber).toBe("+15551234567");
    expect(dto.preferredName).toBe("Admin Test");
  });

  it("DTO does not expose raw generation metadata blob", () => {
    seedCurrentDraft();
    const dto = mapDraftRowsToAdminDto({
      drafts: db.drafts,
      generationsById: new Map(db.generations.map((g) => [g.id, g])),
    })[0];
    const json = JSON.stringify(dto);
    expect(dto).not.toHaveProperty("phone_number");
    expect(dto).not.toHaveProperty("generationMetadata");
    expect(dto.phoneNumber).toBeNull();
    expect(json).not.toContain('"debug":true');
  });

  it("empty writer_openai_messages maps to [] with writer_skipped family", () => {
    const dto = mapDraftRowsToAdminDto({
      drafts: [
        {
          id: "draft-1",
          clerk_user_id: "user",
          draft_for_day_key: "2026-07-03",
          current_generation_id: "gen-1",
          current_body_to_send: null,
          status: "current",
        },
      ],
      generationsById: new Map([
        [
          "gen-1",
          {
            id: "gen-1",
            generation_number: 1,
            writer_openai_messages: null,
            machine_draft_body: null,
            machine_should_send: false,
            machine_no_send_reason: "silence_cadence_space_day9",
            generation_metadata: {
              intentional_space: true,
              silence_cadence_route: "no_send_space_day9",
              silence_day: 9,
              capture_present: false,
              skip_source: "silence_cadence_no_send",
            },
          },
        ],
      ]),
    })[0];
    expect(dto.writerOpenAiMessages).toEqual([]);
    expect(dto.notebookFamily).toBe("writer_skipped");
    expect(dto.notebookDisplayMode).toBe("writer_skipped_intentional");
    expect(dto.silenceCadenceRoute).toBe("no_send_space_day9");
    expect(dto.silenceDay).toBe(9);
    expect(dto.intentionalSpace).toBe(true);
    expect(parseWriterOpenAiMessages(undefined)).toEqual([]);
  });

  it("list exposes notebook metadata and stale generation detection", async () => {
    seedCurrentDraft({
      generation: {
        generation_metadata: {
          capture_present: true,
          slot_coaching_context: {
            version: "1",
            current_slot: "morning",
            previous_slot: "evening_checkin",
            previous_outbound_summary: "Set the 5 AM alarm now.",
            user_replies_since_previous_outbound: null,
            active_coaching_thread: "Thread focus: Wake up / alarm",
            slot_role_recommendation: "wake_up_check",
            checkin_focus: "Wake up / alarm",
            should_send_recommendation: "writer_decides",
            skip_reason_hint: null,
          },
        },
      },
    });
    db.generations.push({
      id: "gen-2",
      generation_number: 2,
      clerk_user_id: "user_admin_test",
      draft_for_day_key: "2026-07-03",
      writer_openai_messages: WRITER_MESSAGES,
      writer_prompt_path: "daily_writing_brief_v1",
      machine_draft_body: "Newer machine body",
      machine_should_send: true,
      machine_no_send_reason: null,
      generation_metadata: { capture_present: true },
    });
    const rows = await listCurrentTylerTextOverviewDrafts();
    expect(rows[0].writerPromptPath).toBe("daily_writing_brief_v1");
    expect(rows[0].notebookMessageCount).toBe(3);
    expect(rows[0].machineShouldSend).toBe(true);
    expect(rows[0].slotCoachingContext?.slotRoleRecommendation).toBe("wake_up_check");
    expect(rows[0].slotCoachingContext?.checkinFocus).toMatch(/wake/i);
    expect(rows[0].latestGenerationNumber).toBe(2);
    expect(rows[0].latestGenerationId).toBe("gen-2");
    expect(rows[0].isLatestGeneration).toBe(false);
  });
});

describe("tyler-text-overview-admin save model", () => {
  const now = new Date("2026-07-02T17:00:00.000Z");

  beforeEach(() => {
    seedCurrentDraft();
    db.smsSendEventsWrites = 0;
    db.generationUpdateCalls = 0;
    vi.clearAllMocks();
  });

  it("save updates sms_daily_drafts only", async () => {
    const result = await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body: "Tyler edited body",
      now,
    });
    expect(result.ok).toBe(true);
    expect(db.drafts[0].current_body_to_send).toBe("Tyler edited body");
    expect(db.generations[0].machine_draft_body).toBe(MACHINE_BODY);
  });

  it("save does not update sms_daily_draft_generations", async () => {
    await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body: "Tyler edited body",
      now,
    });
    expect(db.generationUpdateCalls).toBe(0);
  });

  it("save changed body sets current_body_source=tyler_edit", async () => {
    await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body: "Different text",
      now,
    });
    expect(db.drafts[0].current_body_source).toBe("tyler_edit");
  });

  it("save changed body sets edited_by_tyler=true", async () => {
    await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body: "Different text",
      now,
    });
    expect(db.drafts[0].edited_by_tyler).toBe(true);
  });

  it("save changed body sets edited_at", async () => {
    await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body: "Different text",
      now,
    });
    expect(db.drafts[0].edited_at).toBe(now.toISOString());
  });

  it("save changed body sets current_body_hash", async () => {
    const body = "Different text";
    await updateTylerTextOverviewDraftBody({ draftId: "draft-1", body, now });
    expect(db.drafts[0].current_body_hash).toBe(hashSmsSnippet(body));
  });

  it("save changed body sets edit_distance_chars", async () => {
    const body = "Different text";
    await updateTylerTextOverviewDraftBody({ draftId: "draft-1", body, now });
    expect(db.drafts[0].edit_distance_chars).toBe(
      levenshteinCharDistance(MACHINE_BODY, body)
    );
  });

  it("save exact machine body resets source to machine and edited_by_tyler=false", async () => {
    db.drafts[0].current_body_source = "tyler_edit";
    db.drafts[0].edited_by_tyler = true;
    db.drafts[0].edited_at = now.toISOString();

    await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body: MACHINE_BODY,
      now,
    });

    expect(db.drafts[0].current_body_source).toBe("machine");
    expect(db.drafts[0].edited_by_tyler).toBe(false);
    expect(db.drafts[0].edited_at).toBeNull();
    expect(computeTylerTextOverviewEdited({
      normalizedBody: normalizeTylerTextOverviewDraftBodyInput(MACHINE_BODY),
      machineDraftBody: MACHINE_BODY,
    })).toBe(false);
  });

  it("save empty body stores null and is allowed", async () => {
    const result = await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body: "   ",
      now,
    });
    expect(result.ok).toBe(true);
    expect(db.drafts[0].current_body_to_send).toBeNull();
    expect(db.drafts[0].current_body_hash).toBeNull();
  });

  it("save rejects non-current draft", async () => {
    db.drafts[0].status = "superseded";
    const result = await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body: "Nope",
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("not current");
    }
  });

  it("save allows current evening_checkin preview draft", async () => {
    db.drafts[0].send_slot = "evening_checkin";
    const result = await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body: "Evening Tyler edit",
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(db.drafts[0].current_body_to_send).toBe("Evening Tyler edit");
    expect(db.drafts[0].edited_by_tyler).toBe(true);
    expect(db.drafts[0].current_body_source).toBe("tyler_edit");
    expect(db.drafts[0].current_generation_id).toBe("gen-1");
    expect(result.row.sendSlot).toBe("evening_checkin");
  });

  it("save allows current weekly_review draft and preserves send_slot", async () => {
    db.drafts[0].send_slot = "weekly_review";
    db.generations[0].send_slot = "weekly_review";
    db.generations[0].generation_metadata = {
      week_key: "2026-W28",
      week_start: "2026-07-06",
      week_end: "2026-07-12",
      send_slot: "weekly_review",
    };
    const result = await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body: "Weekly Tyler edit",
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(db.drafts[0].current_body_to_send).toBe("Weekly Tyler edit");
    expect(db.drafts[0].edited_by_tyler).toBe(true);
    expect(db.drafts[0].current_body_source).toBe("tyler_edit");
    expect(db.drafts[0].current_generation_id).toBe("gen-1");
    expect(result.row.sendSlot).toBe("weekly_review");
    expect(result.row.weekKey).toBe("2026-W28");
  });

  it("save rejects sent evening_checkin draft", async () => {
    db.drafts[0].send_slot = "evening_checkin";
    db.drafts[0].status = "sent";
    const result = await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body: "Should not save",
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("not current");
    }
  });

  it("save rejects non-current evening_checkin draft", async () => {
    db.drafts[0].send_slot = "evening_checkin";
    db.drafts[0].status = "skipped";
    const result = await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body: "Should not save",
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("not current");
    }
  });
});

describe("tyler-text-overview-admin API auth", () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...env, TYLER_CLERK_USER_ID: "user_tyler" };
  });

  afterEach(() => {
    process.env = env;
  });

  it("unauthorized GET rejected", async () => {
    const err = Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
    requireTylerAdminMock.mockRejectedValueOnce(err);
    const { GET } = await import("@/app/api/admin/tyler-text-overview/route");
    const res = await GET(new Request("http://localhost/api/admin/tyler-text-overview"));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it("unauthorized PATCH rejected", async () => {
    const err = Object.assign(new Error("FORBIDDEN"), { status: 403 });
    requireTylerAdminMock.mockRejectedValueOnce(err);
    const { PATCH } = await import("@/app/api/admin/tyler-text-overview/[draftId]/route");
    const res = await PATCH(
      new Request("http://localhost/api/admin/tyler-text-overview/draft-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentBodyToSend: "hi" }),
      }),
      { params: Promise.resolve({ draftId: "draft-1" }) }
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it("GET defaults sendSlot to morning", async () => {
    requireTylerAdminMock.mockResolvedValue(undefined);
    seedCurrentDraft();
    const { GET } = await import("@/app/api/admin/tyler-text-overview/route");
    const res = await GET(new Request("http://localhost/api/admin/tyler-text-overview"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.sendSlot).toBe("morning");
    expect(json.counts).toBeDefined();
    expect(json.counts.sendableUsers).toBeGreaterThanOrEqual(1);
  });

  it("GET evening list includes sent rows and sendable users without preview", async () => {
    requireTylerAdminMock.mockResolvedValue(undefined);
    seedSendableUser({ clerkUserId: "user_no_evening", preferredName: "No Evening" });
    db.drafts = [
      {
        id: "draft-evening-sent",
        clerk_user_id: "user_evening",
        draft_for_day_key: "2026-07-03",
        current_generation_id: "gen-evening",
        current_body_to_send: "Evening body",
        status: "sent",
        send_slot: "evening_checkin",
        sent_at: "2026-07-03T23:00:00.000Z",
        final_body_sent: "Evening body sent",
        twilio_message_sid: "SM999",
        source_sms_send_event_id: "evt-evening",
      },
    ];
    seedSendableUser({ clerkUserId: "user_evening", preferredName: "Evening User" });
    db.generations = [
      {
        id: "gen-evening",
        generation_number: 1,
        clerk_user_id: "user_evening",
        draft_for_day_key: "2026-07-03",
        send_slot: "evening_checkin",
        writer_openai_messages: [],
        machine_draft_body: "Evening body",
        machine_should_send: true,
        generation_metadata: { preview_only: false },
      },
    ];
    const { GET } = await import("@/app/api/admin/tyler-text-overview/route");
    const res = await GET(
      new Request(
        "http://localhost/api/admin/tyler-text-overview?send_slot=evening_checkin"
      )
    );
    const json = await res.json();
    expect(json.rows.some((row: { clerkUserId: string }) => row.clerkUserId === "user_evening")).toBe(
      true
    );
    expect(json.rows.some((row: { clerkUserId: string }) => row.clerkUserId === "user_no_evening")).toBe(
      true
    );
    const sentRow = json.rows.find(
      (row: { clerkUserId: string }) => row.clerkUserId === "user_evening"
    );
    expect(sentRow.draftStatus).toBe("sent");
    expect(sentRow.twilioMessageSid).toBe("SM999");
    const noPreviewRow = json.rows.find(
      (row: { clerkUserId: string }) => row.clerkUserId === "user_no_evening"
    );
    expect(noPreviewRow.rowState).toBe("no_draft_yet");
  });

  it("GET accepts send_slot=evening_checkin", async () => {
    requireTylerAdminMock.mockResolvedValue(undefined);
    seedCurrentDraft();
    db.drafts = [];
    db.drafts.push({
      id: "draft-evening",
      clerk_user_id: "user_evening",
      draft_for_day_key: "2026-07-03",
      current_generation_id: "gen-evening",
      current_body_to_send: "Evening body",
      status: "current",
      send_slot: "evening_checkin",
    });
    seedSendableUser({ clerkUserId: "user_evening", preferredName: "Evening User" });
    db.generations = [
      {
        id: "gen-evening",
        generation_number: 1,
        clerk_user_id: "user_evening",
        draft_for_day_key: "2026-07-03",
        send_slot: "evening_checkin",
        writer_openai_messages: WRITER_MESSAGES,
        machine_draft_body: "Evening body",
        machine_should_send: true,
        generation_metadata: { preview_only: true },
      },
    ];
    const { GET } = await import("@/app/api/admin/tyler-text-overview/route");
    const res = await GET(
      new Request(
        "http://localhost/api/admin/tyler-text-overview?send_slot=evening_checkin"
      )
    );
    const json = await res.json();
    expect(json.sendSlot).toBe("evening_checkin");
    expect(json.rows.some((row: { clerkUserId: string }) => row.clerkUserId === "user_evening")).toBe(
      true
    );
  });

  it("GET invalid send_slot defaults to morning", async () => {
    requireTylerAdminMock.mockResolvedValue(undefined);
    seedCurrentDraft();
    const { GET } = await import("@/app/api/admin/tyler-text-overview/route");
    const res = await GET(
      new Request("http://localhost/api/admin/tyler-text-overview?send_slot=not_a_slot")
    );
    const json = await res.json();
    expect(json.sendSlot).toBe("morning");
  });
});

describe("tyler-text-overview sendable audience coverage", () => {
  beforeEach(() => {
    db.drafts = [];
    db.generations = [];
    db.smsAudience = [];
    db.v2Commitments = [];
    db.v2CommsPrefs = [];
    db.userProfiles = [];
    vi.clearAllMocks();
  });

  it("sendable V2 user with no draft appears", async () => {
    seedSendableUser({ clerkUserId: "user_no_draft", preferredName: "Jordan" });
    const { rows } = await listSendableTylerTextOverviewRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].rowState).toBe("no_draft_yet");
    expect(rows[0].draftId).toBeNull();
    expect(rows[0].preferredName).toBe("Jordan");
  });

  it("sendable V2 user with current draft appears", async () => {
    seedCurrentDraft();
    const { rows } = await listSendableTylerTextOverviewRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].rowState).toBe("draft_current");
    expect(rows[0].draftId).toBe("draft-1");
  });

  it("sendable V2 user with sent morning draft appears", async () => {
    seedSendableUser({ clerkUserId: "user_sent", preferredName: "Aron" });
    db.drafts = [
      {
        id: "draft-sent",
        clerk_user_id: "user_sent",
        draft_for_day_key: "2026-07-03",
        current_generation_id: "gen-sent",
        current_body_to_send: "Sent body",
        status: "sent",
        send_slot: "morning",
        sent_at: "2026-07-03T12:00:00.000Z",
        final_body_sent: "Sent body",
      },
    ];
    db.generations = [
      {
        id: "gen-sent",
        generation_number: 1,
        clerk_user_id: "user_sent",
        draft_for_day_key: "2026-07-03",
        writer_openai_messages: WRITER_MESSAGES,
        machine_draft_body: "Sent body",
        machine_should_send: true,
      },
    ];
    const { rows } = await listSendableTylerTextOverviewRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].rowState).toBe("draft_sent");
    expect(rows[0].draftStatus).toBe("sent");
  });

  it("excludes no-phone, stopped, sms disabled, not subscribed, paused, and not V2 users", async () => {
    seedSendableUser({ clerkUserId: "user_ok", preferredName: "Brandon" });
    seedSendableUser({ clerkUserId: "user_no_phone", noPhone: true });
    seedSendableUser({ clerkUserId: "user_stopped", stopped: true });
    seedSendableUser({ clerkUserId: "user_sms_off", smsDisabled: true });
    seedSendableUser({ clerkUserId: "user_unsub", notSubscribed: true });
    seedSendableUser({ clerkUserId: "user_paused", paused: true });
    seedSendableUser({ clerkUserId: "user_not_v2", notV2: true });

    const members = await loadSendableTylerTextOverviewAudienceMembers();
    expect(members.map((m) => m.clerkUserId)).toEqual(["user_ok"]);
  });

  it("counts and search work", async () => {
    seedSendableUser({ clerkUserId: "user_a", preferredName: "Jordan", phone: "+15551110001" });
    seedSendableUser({ clerkUserId: "user_b", preferredName: "Aron", phone: "+15551110002" });
    seedCurrentDraft({ clerk_user_id: "user_a" });

    const all = await listSendableTylerTextOverviewRows();
    expect(all.counts.sendableUsers).toBe(2);
    expect(all.counts.noDraftYet).toBe(1);
    expect(all.counts.draftCurrent).toBe(1);

    const byName = await listSendableTylerTextOverviewRows({ searchQuery: "jordan" });
    expect(byName.rows).toHaveLength(1);
    expect(byName.rows[0].clerkUserId).toBe("user_a");

    const byPhone = await listSendableTylerTextOverviewRows({ searchQuery: "1110002" });
    expect(byPhone.rows).toHaveLength(1);
    expect(byPhone.rows[0].clerkUserId).toBe("user_b");

    const byClerk = await listSendableTylerTextOverviewRows({ searchQuery: "user_b" });
    expect(byClerk.rows).toHaveLength(1);
  });

  it("day filter keeps sendable user with no_draft_yet for that day", async () => {
    seedSendableUser({ clerkUserId: "user_day", preferredName: "Day User" });
    db.drafts = [
      {
        id: "draft-other-day",
        clerk_user_id: "user_day",
        draft_for_day_key: "2026-07-01",
        current_generation_id: "gen-1",
        current_body_to_send: MACHINE_BODY,
        status: "current",
      },
    ];
    db.generations = [
      {
        id: "gen-1",
        generation_number: 1,
        clerk_user_id: "user_day",
        draft_for_day_key: "2026-07-01",
        writer_openai_messages: WRITER_MESSAGES,
        machine_draft_body: MACHINE_BODY,
        machine_should_send: true,
      },
    ];

    const { rows } = await listSendableTylerTextOverviewRows({
      draftForDayKey: "2026-07-03",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].rowState).toBe("no_draft_yet");
    expect(rows[0].draftForDayKey).toBe("2026-07-03");
  });

  it("resolveTylerTextOverviewRowState and pickTylerTextOverviewDraftOverlay behave", () => {
    expect(resolveTylerTextOverviewRowState(null)).toBe("no_draft_yet");
    expect(resolveTylerTextOverviewRowState("sent")).toBe("draft_sent");
    const overlay = pickTylerTextOverviewDraftOverlay(
      [
        {
          id: "d1",
          clerk_user_id: "u1",
          draft_for_day_key: "2026-07-01",
          current_generation_id: "g1",
          current_body_to_send: "a",
          status: "sent",
        },
        {
          id: "d2",
          clerk_user_id: "u1",
          draft_for_day_key: "2026-07-03",
          current_generation_id: "g2",
          current_body_to_send: "b",
          status: "current",
        },
      ],
      null
    );
    expect(overlay?.id).toBe("d2");
    expect(
      matchesTylerTextOverviewSearchQuery(
        {
          draftId: null,
          clerkUserId: "user_a",
          preferredName: "Jordan",
          phoneNumber: "+1555",
          timezone: null,
          rowState: "no_draft_yet",
          draftForDayKey: "",
          sendSlot: "morning",
          draftStatus: "current",
          sentAt: null,
          finalBodySent: null,
          twilioMessageSid: null,
          sourceSmsSendEventId: null,
          currentBodyToSend: null,
          writerOpenAiMessages: [],
          currentGenerationId: null,
          currentGenerationNumber: null,
          latestGenerationId: null,
          latestGenerationNumber: null,
          isLatestGeneration: null,
          writerPromptPath: null,
          notebookHash: null,
          notebookMessageCount: 0,
          notebookFamily: "writer_skipped",
          notebookDisplayMode: "writer_skipped_unknown",
          machineShouldSend: null,
          machineNoSendReason: null,
          capturePresent: null,
          silenceCadenceRoute: null,
          silenceDay: null,
          intentionalSpace: null,
          laneStage: null,
          slotCoachingContext: null,
        },
        "jordan"
      )
    ).toBe(true);
    expect(
      computeTylerTextOverviewAdminCounts([
        {
          rowState: "no_draft_yet",
          machineShouldSend: null,
        } as never,
        {
          rowState: "draft_current",
          machineShouldSend: true,
        } as never,
        {
          rowState: "draft_sent",
          machineShouldSend: false,
        } as never,
      ])
    ).toEqual({
      sendableUsers: 3,
      noDraftYet: 1,
      draftCurrent: 1,
      draftSent: 1,
      draftSkipped: 0,
      machineShouldSendTrue: 1,
      machineShouldSendFalse: 1,
    });
  });
});

describe("tyler-text-overview Phase 4 scope guards", () => {
  it("no sms_send_events writes from admin lib", async () => {
    seedCurrentDraft();
    await listCurrentTylerTextOverviewDrafts();
    await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body: "Edited",
      now: new Date("2026-07-02T17:00:00.000Z"),
    });
    expect(db.smsSendEventsWrites).toBe(0);
  });

  it("no daily/weekly/inbound/Twilio files touched in Phase 4 files", () => {
    const phase4Files = [
      "src/lib/tyler-text-overview-admin.ts",
      "src/app/api/admin/tyler-text-overview/route.ts",
      "src/app/api/admin/tyler-text-overview/[draftId]/route.ts",
      "src/app/admin/tyler-text-overview/morning/page.tsx",
      "src/app/admin/tyler-text-overview/evening/page.tsx",
      "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx",
    ];
    const forbiddenImports = [
      "daily-sms/route",
      "weekly-sms/route",
      "twilio/inbound",
      "sms-inbound-coach",
      "tyler-text-overview-generate",
      "@/lib/twilio",
      "sms_send_events",
    ];
    for (const rel of phase4Files) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      for (const needle of forbiddenImports) {
        expect(src).not.toContain(needle);
      }
    }
  });

  it("no notebook rebuild imports in Phase 4 files", () => {
    const paths = [
      "src/lib/tyler-text-overview-admin.ts",
      "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx",
    ];
    const forbidden = [
      "buildDailySmsContent",
      "produceDailyV3RelationshipSms",
      "buildRecentExactThreadForBrief",
      'from "openai"',
      "@/lib/openai",
    ];
    for (const rel of paths) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      for (const needle of forbidden) {
        expect(src).not.toContain(needle);
      }
    }
  });

  it("no new env vars in Phase 4 files", () => {
    const paths = [
      "src/lib/tyler-text-overview-admin.ts",
      "src/app/api/admin/tyler-text-overview/route.ts",
      "src/app/api/admin/tyler-text-overview/[draftId]/route.ts",
      "src/app/admin/tyler-text-overview/morning/page.tsx",
      "src/app/admin/tyler-text-overview/evening/page.tsx",
      "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx",
      "src/lib/tyler-text-overview-types.ts",
    ];
    for (const rel of paths) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      const envReads = src.match(/process\.env\.[A-Z0-9_]+/g) ?? [];
      expect(envReads).toEqual([]);
    }
  });

  it("admin page and API routes use requireTylerAdmin", () => {
    for (const rel of [
      "src/app/admin/tyler-text-overview/morning/page.tsx",
      "src/app/admin/tyler-text-overview/evening/page.tsx",
      "src/app/api/admin/tyler-text-overview/route.ts",
      "src/app/api/admin/tyler-text-overview/[draftId]/route.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src).toContain("requireTylerAdmin");
    }
  });

  it("dashboard only fetches admin tyler-text-overview API", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx"),
      "utf8"
    );
    expect(src).toContain("/api/admin/tyler-text-overview");
    expect(src).not.toContain("buildDailySmsContent");
  });

  it("dashboard has sendable audience counts and search", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx"),
      "utf8"
    );
    expect(src).toContain("Sendable audience");
    expect(src).toContain('placeholder="Name, phone, or clerk_user_id"');
    expect(src).toContain("rowStateLabel");
    expect(src).toContain("adminCountLabel");
  });

  it("two-page TTO split: morning and evening pages with fixed sendSlot", () => {
    const morningPage = readFileSync(
      join(process.cwd(), "src/app/admin/tyler-text-overview/morning/page.tsx"),
      "utf8"
    );
    const eveningPage = readFileSync(
      join(process.cwd(), "src/app/admin/tyler-text-overview/evening/page.tsx"),
      "utf8"
    );
    const rootPage = readFileSync(
      join(process.cwd(), "src/app/admin/tyler-text-overview/page.tsx"),
      "utf8"
    );
    const dashboard = readFileSync(
      join(process.cwd(), "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx"),
      "utf8"
    );

    expect(rootPage).toContain("redirect(");
    expect(morningPage).toContain('sendSlot={SMS_DAILY_PRODUCTION_SEND_SLOT}');
    expect(eveningPage).toContain('sendSlot={SMS_DAILY_EVENING_PREVIEW_SEND_SLOT}');
    expect(dashboard).not.toContain('searchParams.get("send_slot")');
    expect(dashboard).not.toContain("role=\"tablist\"");
    expect(dashboard).toContain("/api/admin/tyler-text-overview/evening-preview");
    expect(dashboard).toContain("/api/admin/tyler-text-overview/evening-send");
    expect(dashboard).toContain("eveningSendButtonLabel");
    expect(dashboard).toContain("isEveningSendBusy");
    expect(dashboard).toContain("Save Evening Text");
    expect(dashboard).toContain("canEditEveningDraft");
    expect(dashboard).toContain("MORNING_TTO_AUTHORITY_BANNER");
    expect(dashboard).not.toMatch(/Generate all|Bulk generate/i);
  });
});
