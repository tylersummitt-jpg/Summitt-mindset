import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  chunkIdsForTtoManifestQuery,
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
  parseMorningWriterRetryCapture,
  mapMorningBriefInterpreterPanel,
  mapMorningCoachingBriefFromMetadata,
  mapMorningWriterCapturePanel,
  mapMessageForFromMetadata,
  mapMorningRelationshipPacketFromMetadata,
  mapCoachingStackFromMetadata,
  deriveAuthoritativeMachineDraftStatus,
  pickTylerTextOverviewDraftOverlay,
  resolveAdminListSendSlot,
  resolveTylerTextOverviewRowState,
  updateTylerTextOverviewDraftBody,
  bulkSaveMorningTtoDraftBodies,
  bulkSaveEveningTtoDraftBodies,
  isTylerTextOverviewSaveApproval,
  TTO_DRAFT_BODY_EXCEEDS_TWILIO_TRANSPORT_MAX,
} from "@/lib/tyler-text-overview-admin";
import { hashSmsSnippet } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";
import { SMS_DAILY_EVENING_PREVIEW_SEND_SLOT } from "@/lib/tyler-text-overview-types";

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
  sent_at?: string | null;
  final_body_sent?: string | null;
  twilio_message_sid?: string | null;
  source_sms_send_event_id?: string | null;
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
  generated_at?: string | null;
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
  smsSendEvents: [] as Array<{
    id: string;
    send_slot: string;
    day_key: string;
    message_sid: string | null;
  }>,
  smsSendEventsWrites: 0,
  generationUpdateCalls: 0,
  /** When set, first drafts select reports this exact count (truncation simulation). */
  draftsExactCountOverride: null as number | null,
  audienceExactCountOverride: null as number | null,
  countForceNull: false,
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
    const userCmp = a.clerk_user_id.localeCompare(b.clerk_user_id);
    if (userCmp !== 0) return userCmp;
    return a.id.localeCompare(b.id);
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
      if (action === "select") {
        let rows = [...db.smsSendEvents];
        if (typeof payload.send_slot === "string") {
          rows = rows.filter((r) => r.send_slot === payload.send_slot);
        }
        if (typeof payload.day_key === "string") {
          rows = rows.filter((r) => r.day_key === payload.day_key);
        }
        if (payload.not_message_sid_is_null === true) {
          rows = rows.filter((r) => r.message_sid != null && r.message_sid !== "");
        }
        const count = db.countForceNull ? null : rows.length;
        if (payload.head) {
          return { data: null, error: null, count };
        }
        return { data: rows, error: null, count };
      }
      db.smsSendEventsWrites += 1;
      return { data: null, error: null };
    }

    if (table === "sms_daily_drafts" && action === "select") {
      let rows = filterDrafts(payload);
      const exactCount =
        db.countForceNull
          ? null
          : typeof db.draftsExactCountOverride === "number"
            ? db.draftsExactCountOverride
            : rows.length;
      if (typeof payload.rangeFrom === "number" && typeof payload.rangeTo === "number") {
        rows = rows.slice(payload.rangeFrom, payload.rangeTo + 1);
      }
      if (payload.maybeSingle) {
        return { data: rows[0] ?? null, error: null, count: exactCount };
      }
      if (payload.head) {
        return { data: null, error: null, count: exactCount };
      }
      return { data: rows, error: null, count: exactCount };
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
      rows.sort((a, b) => a.clerk_user_id.localeCompare(b.clerk_user_id));
      const exactCount =
        db.countForceNull
          ? null
          : typeof db.audienceExactCountOverride === "number"
            ? db.audienceExactCountOverride
            : rows.length;
      if (typeof payload.rangeFrom === "number" && typeof payload.rangeTo === "number") {
        rows = rows.slice(payload.rangeFrom, payload.rangeTo + 1);
      }
      if (payload.maybeSingle) {
        return { data: rows[0] ?? null, error: null, count: exactCount };
      }
      return { data: rows, error: null, count: exactCount };
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
      rows.sort((a, b) => a.clerk_user_id.localeCompare(b.clerk_user_id));
      const exactCount = rows.length;
      if (typeof payload.rangeFrom === "number" && typeof payload.rangeTo === "number") {
        rows = rows.slice(payload.rangeFrom, payload.rangeTo + 1);
      }
      return { data: rows, error: null, count: exactCount };
    }

    if (table === "v2_user_sms_comms_preferences" && action === "select") {
      let rows = [...db.v2CommsPrefs];
      if (Array.isArray(payload.in_clerk_user_id)) {
        const allowed = payload.in_clerk_user_id as string[];
        rows = rows.filter((r) => allowed.includes(r.clerk_user_id));
      }
      rows.sort((a, b) => a.clerk_user_id.localeCompare(b.clerk_user_id));
      const exactCount = rows.length;
      if (typeof payload.rangeFrom === "number" && typeof payload.rangeTo === "number") {
        rows = rows.slice(payload.rangeFrom, payload.rangeTo + 1);
      }
      if (payload.maybeSingle) {
        return { data: rows[0] ?? null, error: null, count: exactCount };
      }
      return { data: rows, error: null, count: exactCount };
    }

    if (table === "user_profiles" && action === "select") {
      let rows = [...db.userProfiles];
      if (Array.isArray(payload.in_clerk_user_id)) {
        const allowed = payload.in_clerk_user_id as string[];
        rows = rows.filter((r) => allowed.includes(r.clerk_user_id));
      }
      rows.sort((a, b) => a.clerk_user_id.localeCompare(b.clerk_user_id));
      const exactCount = rows.length;
      if (typeof payload.rangeFrom === "number" && typeof payload.rangeTo === "number") {
        rows = rows.slice(payload.rangeFrom, payload.rangeTo + 1);
      }
      return { data: rows, error: null, count: exactCount };
    }

    if (table === "sms_daily_draft_generations" && action === "select") {
      const ids = (payload.in_id as string[] | undefined) ?? [];
      if (typeof payload.id === "string") {
        const row = db.generations.find((g) => g.id === payload.id) ?? null;
        return { data: row, error: null, count: row ? 1 : 0 };
      }
      if (ids.length > 0) {
        let rows = db.generations.filter((g) => ids.includes(g.id));
        rows.sort((a, b) => a.id.localeCompare(b.id));
        const exactCount = db.countForceNull ? null : rows.length;
        return { data: rows, error: null, count: exactCount };
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
        return { data: rows, error: null, count: rows.length };
      }
      return { data: [], error: null, count: 0 };
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
  self.select = vi.fn((cols?: string, opts?: { count?: string; head?: boolean }) => {
    if (cols) state.payload.select = cols;
    if (opts?.count) state.payload.countMode = opts.count;
    if (opts?.head) state.payload.head = true;
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
  self.not = vi.fn((col: string, op: string, val: unknown) => {
    if (col === "message_sid" && op === "is" && val === null) {
      state.payload.not_message_sid_is_null = true;
    }
    return self;
  });
  self.neq = vi.fn((col: string, val: unknown) => {
    state.payload[`neq_${col}`] = val;
    return self;
  });
  self.order = vi.fn(() => self);
  self.range = vi.fn((from: number, to: number) => {
    state.payload.rangeFrom = from;
    state.payload.rangeTo = to;
    return self;
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
    db.smsSendEvents = [];
    db.smsSendEventsWrites = 0;
    db.draftsExactCountOverride = null;
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
    expect(dto.authoritativeMachineDraftBody).toBe(MACHINE_BODY);
    expect(dto.authoritativeRetryMessages).toEqual([]);
    expect(dto.authoritativeRetryOccurred).toBeNull();
    expect(dto.writerPromptPath).toBe("daily_writing_brief_v1");
    expect(dto.notebookMessageCount).toBe(3);
    expect(dto.machineShouldSend).toBe(true);
    expect(dto.capturePresent).toBe(true);
    expect(dto.isLatestGeneration).toBe(true);
  });

  it("Morning DTO exposes authoritative machine draft + retry from current_generation_id only", () => {
    const morningPrimary = [
      { role: "system" as const, content: "MORNING_SYSTEM_EXACT" },
      {
        role: "user" as const,
        content:
          'MORNING_RELATIONSHIP_PACKET_V1\n{"version":"morning_relationship_v1","exact_thread":[{"role":"user","body":"hi"}]}\nWrite JSON only.',
      },
    ];
    const retryMessages = [
      { role: "assistant" as const, content: "{bad" },
      { role: "user" as const, content: "Return strict JSON only: {\"body\":\"...\"}" },
    ];
    const orphanPrimary = [
      { role: "system" as const, content: "ORPHAN_SYSTEM" },
      { role: "user" as const, content: "ORPHAN_USER" },
    ];

    seedCurrentDraft({
      current_body_to_send: "Tyler edited send body",
      current_body_source: "tyler_edit",
      edited_by_tyler: true,
      generation: {
        writer_openai_messages: morningPrimary,
        writer_prompt_path: "morning_relationship_v1",
        machine_draft_body: "Original machine draft body",
        generated_at: "2026-07-03T12:00:00.000Z",
        generation_metadata: {
          capture_present: true,
          writer_model: "gpt-4o-mini",
          morning_writer_capture_v1: {
            model: "gpt-4o-mini",
            retry_occurred: true,
            retry_succeeded: true,
            retry_messages: retryMessages,
          },
        },
      },
    });
    db.generations.push({
      id: "gen-orphan-newer",
      generation_number: 99,
      clerk_user_id: "user_admin_test",
      draft_for_day_key: "2026-07-03",
      send_slot: "morning",
      writer_openai_messages: orphanPrimary,
      writer_prompt_path: "morning_relationship_v1",
      machine_draft_body: "Orphan machine body must not display",
      machine_should_send: true,
      generation_metadata: {
        capture_present: true,
        morning_writer_capture_v1: {
          model: "other-model",
          retry_occurred: false,
          retry_messages: [],
        },
      },
    });

    const dto = mapDraftRowsToAdminDto({
      drafts: db.drafts,
      generationsById: new Map(db.generations.map((g) => [g.id, g])),
      latestGenerationsByKey: new Map([
        [
          "user_admin_test:2026-07-03:morning",
          { id: "gen-orphan-newer", generation_number: 99 },
        ],
      ]),
    })[0];

    expect(dto.currentGenerationId).toBe("gen-1");
    expect(dto.currentBodyToSend).toBe("Tyler edited send body");
    expect(dto.authoritativeMachineDraftBody).toBe("Original machine draft body");
    expect(dto.authoritativeMachineDraftStatus).toBe("available");
    expect(dto.writerOpenAiMessages).toEqual(morningPrimary);
    expect(dto.writerOpenAiMessages).not.toEqual(orphanPrimary);
    expect(dto.authoritativeRetryMessages).toEqual(retryMessages);
    expect(dto.authoritativeRetryOccurred).toBe(true);
    expect(dto.authoritativeWriterModel).toBe("gpt-4o-mini");
    expect(dto.authoritativeGeneratedAt).toBe("2026-07-03T12:00:00.000Z");
    expect(dto.writerPromptPath).toBe("morning_relationship_v1");
    expect(dto.isLatestGeneration).toBe(false);
    expect(dto.latestGenerationId).toBe("gen-orphan-newer");
  });

  it("DTO keeps machine draft and current body separate when texts are identical", () => {
    seedCurrentDraft({
      current_body_to_send: MACHINE_BODY,
      current_body_source: "machine",
      edited_by_tyler: false,
      generation: {
        machine_draft_body: MACHINE_BODY,
        writer_prompt_path: "morning_relationship_v1",
      },
    });
    const dto = mapDraftRowsToAdminDto({
      drafts: db.drafts,
      generationsById: new Map(db.generations.map((g) => [g.id, g])),
      latestGenerationsByKey: new Map([
        ["user_admin_test:2026-07-03:morning", { id: "gen-1", generation_number: 1 }],
      ]),
    })[0];
    expect(dto.currentBodyToSend).toBe(MACHINE_BODY);
    expect(dto.authoritativeMachineDraftBody).toBe(MACHINE_BODY);
    expect(dto.authoritativeMachineDraftBody).toBe(dto.currentBodyToSend);
    expect(dto.authoritativeMachineDraftStatus).toBe("available");
    expect(dto.currentBodySource).toBe("machine");
  });

  it("DTO never aliases machine body from current body when generation failed", () => {
    seedCurrentDraft({
      current_body_to_send: null,
      generation: {
        machine_draft_body: null,
        machine_should_send: false,
        machine_no_send_reason: "invalid_json",
        writer_prompt_path: "morning_relationship_v1",
        writer_openai_messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "MORNING_RELATIONSHIP_PACKET_V1\n{}" },
        ],
      },
    });
    const dto = mapDraftRowsToAdminDto({
      drafts: db.drafts,
      generationsById: new Map(db.generations.map((g) => [g.id, g])),
    })[0];
    expect(dto.currentBodyToSend).toBeNull();
    expect(dto.authoritativeMachineDraftBody).toBeNull();
    expect(dto.authoritativeMachineDraftStatus).toBe("generation_failed");
    expect(dto.machineNoSendReason).toBe("invalid_json");
  });

  it("DTO reports generation_missing without falling back to newest generation", () => {
    seedCurrentDraft({ current_generation_id: "gen-missing-link" });
    db.generations = [
      {
        id: "gen-orphan-newest",
        generation_number: 9,
        clerk_user_id: "user_admin_test",
        draft_for_day_key: "2026-07-03",
        send_slot: "morning",
        writer_openai_messages: WRITER_MESSAGES,
        machine_draft_body: "Must not be used",
        machine_should_send: true,
      },
    ];
    const dto = mapDraftRowsToAdminDto({
      drafts: db.drafts,
      generationsById: new Map(db.generations.map((g) => [g.id, g])),
      latestGenerationsByKey: new Map([
        [
          "user_admin_test:2026-07-03:morning",
          { id: "gen-orphan-newest", generation_number: 9 },
        ],
      ]),
    })[0];
    expect(dto.currentGenerationId).toBe("gen-missing-link");
    expect(dto.authoritativeMachineDraftBody).toBeNull();
    expect(dto.authoritativeMachineDraftStatus).toBe("generation_missing");
    expect(dto.writerOpenAiMessages).toEqual([]);
    expect(dto.latestGenerationId).toBe("gen-orphan-newest");
    expect(dto.isLatestGeneration).toBe(false);
  });

  it("deriveAuthoritativeMachineDraftStatus covers available/failed/missing/historical", () => {
    expect(
      deriveAuthoritativeMachineDraftStatus({
        draftCurrentGenerationId: "g1",
        generation: { id: "g1", writer_openai_messages: [], machine_draft_body: "hi" },
      })
    ).toBe("available");
    expect(
      deriveAuthoritativeMachineDraftStatus({
        draftCurrentGenerationId: "g1",
        generation: {
          id: "g1",
          writer_openai_messages: [],
          machine_draft_body: null,
          machine_should_send: false,
          machine_no_send_reason: "intentional_space",
        },
      })
    ).toBe("intentional_space");
    expect(
      deriveAuthoritativeMachineDraftStatus({
        draftCurrentGenerationId: "g1",
        generation: undefined,
      })
    ).toBe("generation_missing");
    expect(
      deriveAuthoritativeMachineDraftStatus({
        draftCurrentGenerationId: "g1",
        generation: { id: "g1", writer_openai_messages: [], machine_draft_body: null },
      })
    ).toBe("historical_unavailable");
  });

  it("parseMorningWriterRetryCapture preserves exact retry strings", () => {
    const retryMessages = [
      { role: "assistant" as const, content: "raw assistant failure\nwith\nnewlines" },
      { role: "user" as const, content: "exact reminder" },
    ];
    const parsed = parseMorningWriterRetryCapture({
      writer_model: "gpt-4o-mini",
      morning_writer_capture_v1: {
        model: "gpt-4o-mini",
        retry_occurred: true,
        retry_messages: retryMessages,
      },
    });
    expect(parsed.retryOccurred).toBe(true);
    expect(parsed.retryMessages).toEqual(retryMessages);
    expect(parsed.model).toBe("gpt-4o-mini");

    expect(
      parseMorningWriterRetryCapture({
        morning_writer_capture_v1: {
          model: "gpt-4o-mini",
          retry_occurred: false,
          retry_messages: retryMessages,
        },
      }).retryMessages
    ).toEqual([]);
  });

  it("Phase 2D maps stored Sol writer capture without reconstruction", () => {
    const panel = mapMorningWriterCapturePanel({
      morning_writer_capture_v1: {
        model: "gpt-5.6-sol",
        temperature: null,
        reasoning_effort: "low",
        max_completion_tokens: 1200,
        latency_ms: 900,
        error: null,
        raw_response: '{"body":"Hi"}',
        raw_retry_response: null,
        retry_occurred: false,
        retry_succeeded: null,
      },
    });
    expect(panel?.model).toBe("gpt-5.6-sol");
    expect(panel?.reasoningEffort).toBe("low");
    expect(panel?.maxCompletionTokens).toBe(1200);
    expect(panel?.temperature).toBeNull();
    expect(panel?.rawResponse).toBe('{"body":"Hi"}');
    expect(panel?.openaiError).toBeNull();
    expect(mapMorningWriterCapturePanel({})).toBeNull();
  });

  it("maps scrubbed writer openai_error forensics without leaking extra fields", () => {
    const panel = mapMorningWriterCapturePanel({
      morning_writer_capture_v1: {
        model: "gpt-5.6-sol",
        temperature: null,
        reasoning_effort: "low",
        max_completion_tokens: 1200,
        error: "openai_request_failed",
        openai_error: {
          name: "APIError",
          message: "429",
          status: 429,
          code: "rate_limit_exceeded",
          type: "insufficient_quota",
          request_id: "req_1",
          headers: { authorization: "Bearer sk" },
        },
      },
    });
    expect(panel?.error).toBe("openai_request_failed");
    expect(panel?.openaiError).toEqual({
      name: "APIError",
      message: "429",
      status: 429,
      code: "rate_limit_exceeded",
      type: "insufficient_quota",
      requestId: "req_1",
    });
    expect(JSON.stringify(panel?.openaiError)).not.toContain("Bearer");
  });

  it("maps empty openai_error object to null (no junk placeholders)", () => {
    expect(
      mapMorningWriterCapturePanel({
        morning_writer_capture_v1: {
          model: "gpt-5.6-sol",
          temperature: null,
          openai_error: {
            name: null,
            message: null,
            status: null,
            code: null,
            type: null,
            request_id: null,
          },
        },
      })?.openaiError
    ).toBeNull();
  });

  it("Phase 2C maps stored interpreter metadata without reconstruction", () => {
    const brief = {
      version: "morning_coaching_brief_v1",
      confidence: "medium",
      human_situation: { most_alive: "alive", person_use: "do_not_force" },
    };
    const panel = mapMorningBriefInterpreterPanel({
      morning_brief_interpreter_v1: {
        model: "gpt-5.6-sol",
        temperature: null,
        reasoning_effort: "low",
        max_completion_tokens: 2500,
        latency_ms: 1200,
        error: null,
        exact_system_message: "sys",
        exact_user_message: "user",
        exact_input_object: {
          available_identity: { text: "I am a father" },
          available_important_people: [{ name: "Brooke", relationship: "spouse/partner" }],
        },
        raw_response: "{}",
        parsed_brief: brief,
        retry: null,
      },
      morning_coaching_brief_v1: brief,
    });
    expect(panel?.model).toBe("gpt-5.6-sol");
    expect(panel?.reasoningEffort).toBe("low");
    expect(panel?.temperature).toBeNull();
    expect(panel?.openaiError).toBeNull();
    expect(panel?.exactInputObject?.available_important_people).toEqual([
      { name: "Brooke", relationship: "spouse/partner" },
    ]);
    expect(panel?.parsedBrief).toEqual(brief);
    expect(mapMorningCoachingBriefFromMetadata({ morning_coaching_brief_v1: brief })).toEqual(
      brief
    );
    expect(mapMorningBriefInterpreterPanel({})).toBeNull();
  });

  it("maps scrubbed interpreter openai_error forensics", () => {
    const panel = mapMorningBriefInterpreterPanel({
      morning_brief_interpreter_v1: {
        model: "gpt-5.6-sol",
        error: "openai_request_failed",
        openai_error: {
          name: "Error",
          message: "Bad schema",
          status: 400,
          code: "invalid_request_error",
          type: "invalid_request_error",
          request_id: "req_i",
        },
      },
    });
    expect(panel?.error).toBe("openai_request_failed");
    expect(panel?.openaiError).toEqual({
      name: "Error",
      message: "Bad schema",
      status: 400,
      code: "invalid_request_error",
      type: "invalid_request_error",
      requestId: "req_i",
    });
  });

  it("E4 maps persisted message_for, packet, and coaching_stack without reconstruction", () => {
    const messageFor = {
      timezone: "America/Chicago",
      local_date: "2026-08-07",
      local_weekday: "Friday",
      daypart: "evening",
    };
    const packet = {
      version: "morning_relationship_packet_v1",
      message_for: messageFor,
      exact_thread: {
        messages: [
          { sender: "coach", body: "Actually sent" },
          { sender: "user", body: "Actually received" },
        ],
      },
    };
    expect(mapMessageForFromMetadata({ message_for: messageFor })).toEqual(messageFor);
    expect(mapMessageForFromMetadata({})).toBeNull();
    expect(
      mapMessageForFromMetadata({
        message_for: { ...messageFor, daypart: "afternoon" },
      })
    ).toBeNull();
    expect(
      mapMessageForFromMetadata({
        message_for: { ...messageFor, daypart: "weekly" },
      })
    ).toEqual({ ...messageFor, daypart: "weekly" });
    expect(
      mapMorningRelationshipPacketFromMetadata({
        weekly_relationship_packet_v1: { version: "weekly_relationship_v1" },
      })
    ).toEqual({ version: "weekly_relationship_v1" });
    expect(mapMorningRelationshipPacketFromMetadata({ morning_relationship_packet_v1: packet })).toEqual(
      packet
    );
    expect(mapMorningRelationshipPacketFromMetadata({})).toBeNull();
    expect(mapCoachingStackFromMetadata({ coaching_stack: "shared_sol_v1" })).toBe(
      "shared_sol_v1"
    );
    expect(mapCoachingStackFromMetadata({})).toBeNull();

    const dto = mapDraftRowsToAdminDto({
      drafts: [
        {
          id: "draft-e4",
          clerk_user_id: "user_e4",
          draft_for_day_key: "2026-08-07",
          send_slot: "evening_checkin",
          current_generation_id: "gen-e4",
          current_body_to_send: "Have a good evening.",
          current_body_source: "tyler_edit",
          edited_by_tyler: true,
          status: "current",
        },
      ],
      generationsById: new Map([
        [
          "gen-e4",
          {
            id: "gen-e4",
            clerk_user_id: "user_e4",
            draft_for_day_key: "2026-08-07",
            send_slot: "evening_checkin",
            generation_number: 1,
            machine_draft_body: "Machine A",
            machine_should_send: false,
            machine_no_send_reason: "writer_error",
            writer_prompt_path: "morning_brief_writer_v1",
            writer_openai_messages: [
              { role: "system", content: "sys" },
              { role: "user", content: "MORNING_RELATIONSHIP_PACKET_V1\n{}" },
            ],
            generation_metadata: {
              coaching_stack: "shared_sol_v1",
              message_for: messageFor,
              morning_relationship_packet_v1: packet,
              morning_coaching_brief_v1: { version: "morning_coaching_brief_v1", confidence: "low" },
              morning_brief_interpreter_v1: {
                model: "gpt-5.6-sol",
                reasoning_effort: "low",
                error: "fail_soft",
                raw_response: "{}",
              },
              morning_writer_capture_v1: {
                model: "gpt-5.6-sol",
                reasoning_effort: "low",
                error: "writer_failed",
                raw_response: null,
              },
            },
          },
        ],
      ]),
    })[0];

    expect(dto.messageFor).toEqual(messageFor);
    expect(dto.morningRelationshipPacketV1).toEqual(packet);
    expect(dto.coachingStack).toBe("shared_sol_v1");
    expect(dto.morningCoachingBriefV1).toEqual({
      version: "morning_coaching_brief_v1",
      confidence: "low",
    });
    expect(dto.morningBriefInterpreterV1?.error).toBe("fail_soft");
    expect(dto.morningWriterCaptureV1?.error).toBe("writer_failed");
    expect(dto.authoritativeMachineDraftBody).toBe("Machine A");
    expect(dto.currentBodyToSend).toBe("Have a good evening.");
    expect(dto.machineShouldSend).toBe(false);
    expect(JSON.stringify(dto)).not.toContain("unsent Morning draft");
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

  it("maps quiet relationship clock observability from generation metadata", () => {
    const dto = mapDraftRowsToAdminDto({
      drafts: [
        {
          id: "draft-clock",
          clerk_user_id: "user_admin_test",
          draft_for_day_key: "2026-08-25",
          send_slot: "evening_checkin",
          status: "current",
          current_generation_id: "gen-clock",
          current_body_to_send: "Would-send body",
          current_body_source: "machine_draft",
          edited_by_tyler: false,
          edited_at: null,
          sent_at: null,
          final_body_sent: null,
          twilio_message_sid: null,
          source_sms_send_event_id: null,
        },
      ],
      generationsById: new Map([
        [
          "gen-clock",
          {
            id: "gen-clock",
            generation_number: 1,
            writer_openai_messages: [
              { role: "system", content: "s" },
              { role: "user", content: "u" },
              { role: "assistant", content: "a" },
            ],
            machine_draft_body: "Would-send body",
            machine_should_send: true,
            machine_no_send_reason: null,
            generation_metadata: {
              quiet_relationship_eligible: true,
              message_required_today: false,
              clock_lookup_failed: true,
              clock_lookup_error: "sms_send_events:column does not exist",
              days_since_last_successful_proactive_send: null,
              proactive_decision: "send",
              intentional_space: false,
              morning_brief_interpreter_v1: {
                parsed_brief: {
                  coaching_direction: { proactive_decision: "intentional_space" },
                },
              },
            },
          },
        ],
      ]),
    })[0];
    expect(dto.quietRelationshipEligible).toBe(true);
    expect(dto.messageRequiredToday).toBe(false);
    expect(dto.clockLookupFailed).toBe(true);
    expect(dto.clockLookupError).toBe("sms_send_events:column does not exist");
    expect(dto.daysSinceLastSuccessfulProactiveSend).toBeNull();
    expect(dto.interpreterProactiveDecision).toBe("intentional_space");
    expect(dto.clampedProactiveDecision).toBe("send");
    expect(dto.intentionalSpace).toBe(false);
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

  it("save exact machine body still marks Tyler approval (Save = approve)", async () => {
    db.drafts[0].current_body_source = "machine";
    db.drafts[0].edited_by_tyler = false;
    db.drafts[0].edited_at = null;

    await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body: MACHINE_BODY,
      now,
    });

    expect(db.drafts[0].current_body_source).toBe("tyler_edit");
    expect(db.drafts[0].edited_by_tyler).toBe(true);
    expect(db.drafts[0].edited_at).toBe(now.toISOString());
    expect(db.drafts[0].edit_distance_chars).toBe(0);
    // Telemetry helper still reports equality separately from save approval.
    expect(
      computeTylerTextOverviewEdited({
        normalizedBody: normalizeTylerTextOverviewDraftBodyInput(MACHINE_BODY),
        machineDraftBody: MACHINE_BODY,
      })
    ).toBe(false);
  });

  it("save non-empty body when machine_draft_body is null marks Tyler approval", async () => {
    db.generations[0].machine_draft_body = null;
    db.generations[0].machine_should_send = false;
    db.generations[0].machine_no_send_reason = "daily_lane_stale_ask_blocked";
    await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body: "Tyler wrote after machine blocked",
      now,
    });
    expect(db.drafts[0].current_body_source).toBe("tyler_edit");
    expect(db.drafts[0].edited_by_tyler).toBe(true);
    expect(db.drafts[0].current_body_to_send).toBe("Tyler wrote after machine blocked");
  });

  it("save blank body marks Tyler save metadata but stores null body", async () => {
    const result = await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body: "   ",
      now,
    });
    expect(result.ok).toBe(true);
    expect(db.drafts[0].current_body_to_send).toBeNull();
    expect(db.drafts[0].current_body_hash).toBeNull();
    expect(db.drafts[0].edited_by_tyler).toBe(true);
    expect(db.drafts[0].current_body_source).toBe("tyler_edit");
  });

  it("Morning 1600-character save succeeds", async () => {
    const body = "x".repeat(1600);
    const result = await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body,
      now,
    });
    expect(result.ok).toBe(true);
    expect(db.drafts[0].current_body_to_send).toBe(body);
  });

  it("Morning 1601-character save fails and does not mutate draft", async () => {
    const original = db.drafts[0].current_body_to_send;
    const body = "x".repeat(1601);
    const result = await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body,
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe(TTO_DRAFT_BODY_EXCEEDS_TWILIO_TRANSPORT_MAX);
    }
    expect(db.drafts[0].current_body_to_send).toBe(original);
  });

  it("Evening 1600-character save succeeds", async () => {
    db.drafts[0].send_slot = "evening_checkin";
    const body = "x".repeat(1600);
    const result = await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body,
      now,
    });
    expect(result.ok).toBe(true);
    expect(db.drafts[0].current_body_to_send).toBe(body);
  });

  it("Evening 1601-character save fails and does not mutate draft", async () => {
    db.drafts[0].send_slot = "evening_checkin";
    const original = db.drafts[0].current_body_to_send;
    const body = "x".repeat(1601);
    const result = await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body,
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe(TTO_DRAFT_BODY_EXCEEDS_TWILIO_TRANSPORT_MAX);
    }
    expect(db.drafts[0].current_body_to_send).toBe(original);
  });

  it("save non-empty body after intentional blank replaces blank and keeps Tyler provenance", async () => {
    await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body: "   ",
      now,
    });
    expect(db.drafts[0].current_body_to_send).toBeNull();
    expect(db.drafts[0].current_body_source).toBe("tyler_edit");

    const later = new Date("2026-07-02T18:30:00.000Z");
    const result = await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body: "Have a great Saturday!",
      now: later,
    });
    expect(result.ok).toBe(true);
    expect(db.drafts[0].current_body_to_send).toBe("Have a great Saturday!");
    expect(db.drafts[0].current_body_source).toBe("tyler_edit");
    expect(db.drafts[0].edited_by_tyler).toBe(true);
    expect(db.drafts[0].edited_at).toBe(later.toISOString());
  });

  it("isTylerTextOverviewSaveApproval is always true", () => {
    expect(isTylerTextOverviewSaveApproval()).toBe(true);
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

  it("Weekly save rejects bodies over the footer-aware 1555 editable max", async () => {
    db.drafts[0].send_slot = "weekly_review";
    db.generations[0].send_slot = "weekly_review";
    const body = "x".repeat(1556);
    const result = await updateTylerTextOverviewDraftBody({
      draftId: "draft-1",
      body,
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/1555/);
    }
    expect(db.drafts[0].current_body_to_send).not.toBe(body);
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

describe("tyler-text-overview-admin morning bulk save", () => {
  const now = new Date("2026-07-02T17:00:00.000Z");
  const DAY = "2026-07-03";
  const OTHER_DAY = "2026-07-04";

  function seedBulkFixture() {
    db.drafts = [];
    db.generations = [];
    db.smsAudience = [];
    db.v2Commitments = [];
    db.v2CommsPrefs = [];
    db.userProfiles = [];
    db.smsSendEventsWrites = 0;
    db.generationUpdateCalls = 0;

    const users = [
      { id: "user_a", name: "Alpha", draftId: "draft-a", genId: "gen-a", body: "Machine A" },
      { id: "user_b", name: "Beta", draftId: "draft-b", genId: "gen-b", body: "Machine B" },
      { id: "user_c", name: "Charlie", draftId: "draft-c", genId: "gen-c", body: "Prior Tyler C" },
      { id: "user_sent", name: "Sent", draftId: "draft-sent", genId: "gen-sent", body: "Already sent" },
      { id: "user_missing", name: "Missing", draftId: null, genId: null, body: null },
    ] as const;

    for (const u of users) {
      seedSendableUser({ clerkUserId: u.id, preferredName: u.name, phone: `+1555000${u.id.slice(-1)}` });
      if (!u.draftId || !u.genId) continue;
      db.generations.push({
        id: u.genId,
        generation_number: 1,
        clerk_user_id: u.id,
        draft_for_day_key: DAY,
        send_slot: "morning",
        writer_openai_messages: WRITER_MESSAGES,
        writer_prompt_path: "daily_writing_brief_v1",
        machine_draft_body: u.body === "Prior Tyler C" ? "Machine C original" : u.body,
        machine_should_send: true,
        machine_no_send_reason: null,
        notebook_hash: `hash-${u.id}`,
        notebook_verdict: "verified",
        generation_metadata: { capture_present: true, who: u.id },
      });
      db.drafts.push({
        id: u.draftId,
        clerk_user_id: u.id,
        draft_for_day_key: DAY,
        current_generation_id: u.genId,
        current_body_to_send: u.body,
        status: u.id === "user_sent" ? "sent" : "current",
        send_slot: "morning",
        current_body_source: u.id === "user_c" ? "tyler_edit" : "machine",
        edited_by_tyler: u.id === "user_c",
        edited_at: u.id === "user_c" ? "2026-07-02T12:00:00.000Z" : null,
        sent_at: u.id === "user_sent" ? "2026-07-03T11:00:00.000Z" : null,
      });
    }

    // Wrong-day current morning draft must never be touched.
    seedSendableUser({ clerkUserId: "user_other_day", preferredName: "OtherDay", phone: "+15550999" });
    db.generations.push({
      id: "gen-other-day",
      generation_number: 1,
      clerk_user_id: "user_other_day",
      draft_for_day_key: OTHER_DAY,
      send_slot: "morning",
      writer_openai_messages: WRITER_MESSAGES,
      machine_draft_body: "Other day machine",
      machine_should_send: true,
    });
    db.drafts.push({
      id: "draft-other-day",
      clerk_user_id: "user_other_day",
      draft_for_day_key: OTHER_DAY,
      current_generation_id: "gen-other-day",
      current_body_to_send: "Other day body",
      status: "current",
      send_slot: "morning",
      current_body_source: "machine",
      edited_by_tyler: false,
    });

    // Evening draft same day must never be touched.
    seedSendableUser({ clerkUserId: "user_evening", preferredName: "Evening", phone: "+15550888" });
    db.generations.push({
      id: "gen-evening",
      generation_number: 1,
      clerk_user_id: "user_evening",
      draft_for_day_key: DAY,
      send_slot: "evening_checkin",
      writer_openai_messages: WRITER_MESSAGES,
      machine_draft_body: "Evening machine",
      machine_should_send: true,
    });
    db.drafts.push({
      id: "draft-evening",
      clerk_user_id: "user_evening",
      draft_for_day_key: DAY,
      current_generation_id: "gen-evening",
      current_body_to_send: "Evening body",
      status: "current",
      send_slot: "evening_checkin",
      current_body_source: "machine",
      edited_by_tyler: false,
    });
  }

  beforeEach(() => {
    seedBulkFixture();
    vi.clearAllMocks();
  });

  it("blank_all blanks current morning drafts only with tyler_edit provenance", async () => {
    const result = await bulkSaveMorningTtoDraftBodies({
      draftForDayKey: DAY,
      operation: "blank_all",
      now,
    });
    expect("targeted" in result).toBe(true);
    if (!("targeted" in result)) return;
    expect(result.ok).toBe(true);
    expect(result.targeted).toBe(3);
    expect(result.updated).toBe(3);
    expect(result.skippedNonCurrent).toBe(1);
    expect(result.skippedMissing).toBe(3);
    expect(result.failed).toEqual([]);
    expect(result.textsSentByThisAction).toBe(0);
    expect(result.appliedBody).toBeNull();

    for (const id of ["draft-a", "draft-b", "draft-c"]) {
      const d = db.drafts.find((row) => row.id === id)!;
      expect(d.current_body_to_send).toBeNull();
      expect(d.current_body_source).toBe("tyler_edit");
      expect(d.edited_by_tyler).toBe(true);
      expect(d.edited_at).toBe(now.toISOString());
    }

    expect(db.drafts.find((d) => d.id === "draft-sent")!.current_body_to_send).toBe("Already sent");
    expect(db.drafts.find((d) => d.id === "draft-other-day")!.current_body_to_send).toBe(
      "Other day body"
    );
    expect(db.drafts.find((d) => d.id === "draft-evening")!.current_body_to_send).toBe(
      "Evening body"
    );
    expect(db.generations.find((g) => g.id === "gen-a")!.machine_draft_body).toBe("Machine A");
    expect(db.generations.find((g) => g.id === "gen-c")!.machine_draft_body).toBe(
      "Machine C original"
    );
    expect(db.generations.find((g) => g.id === "gen-a")!.machine_should_send).toBe(true);
    expect(db.generations.find((g) => g.id === "gen-a")!.generation_metadata).toEqual({
      capture_present: true,
      who: "user_a",
    });
    expect(db.smsSendEventsWrites).toBe(0);
    expect(db.generationUpdateCalls).toBe(0);
  });

  it("blank_all is idempotent when repeated", async () => {
    await bulkSaveMorningTtoDraftBodies({
      draftForDayKey: DAY,
      operation: "blank_all",
      now,
    });
    const again = await bulkSaveMorningTtoDraftBodies({
      draftForDayKey: DAY,
      operation: "blank_all",
      now: new Date("2026-07-02T18:00:00.000Z"),
    });
    expect("updated" in again && again.updated).toBe(3);
    expect(db.drafts.find((d) => d.id === "draft-a")!.current_body_to_send).toBeNull();
    expect(db.drafts.find((d) => d.id === "draft-a")!.current_body_source).toBe("tyler_edit");
  });

  it("apply_all writes exact normalized body and overwrites prior Tyler edits", async () => {
    const body = "  Happy Fourth of July! 🇺🇸\nSee you Monday. https://example.com  ";
    const result = await bulkSaveMorningTtoDraftBodies({
      draftForDayKey: DAY,
      operation: "apply_all",
      body,
      now,
    });
    expect("targeted" in result).toBe(true);
    if (!("targeted" in result)) return;
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(3);
    expect(result.appliedBody).toBe(
      "Happy Fourth of July! 🇺🇸\nSee you Monday. https://example.com"
    );
    expect(result.textsSentByThisAction).toBe(0);

    const expected = normalizeTylerTextOverviewDraftBodyInput(body);
    for (const id of ["draft-a", "draft-b", "draft-c"]) {
      const d = db.drafts.find((row) => row.id === id)!;
      expect(d.current_body_to_send).toBe(expected);
      expect(d.current_body_source).toBe("tyler_edit");
      expect(d.edited_by_tyler).toBe(true);
    }
    expect(db.drafts.find((d) => d.id === "draft-c")!.current_body_to_send).not.toBe("Prior Tyler C");
    expect(db.generations.find((g) => g.id === "gen-c")!.machine_draft_body).toBe(
      "Machine C original"
    );
    expect(db.drafts.find((d) => d.id === "draft-sent")!.current_body_to_send).toBe("Already sent");
    expect(db.drafts.find((d) => d.id === "draft-evening")!.current_body_to_send).toBe(
      "Evening body"
    );
  });

  it("apply_all rejects whitespace-only body", async () => {
    const result = await bulkSaveMorningTtoDraftBodies({
      draftForDayKey: DAY,
      operation: "apply_all",
      body: "   ",
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && "status" in result) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/blank_all/i);
    }
    expect(db.drafts.find((d) => d.id === "draft-a")!.current_body_to_send).toBe("Machine A");
  });

  it("apply_all over 1600 does not persist invalid body", async () => {
    const originalA = db.drafts.find((d) => d.id === "draft-a")!.current_body_to_send;
    const originalB = db.drafts.find((d) => d.id === "draft-b")!.current_body_to_send;
    const body = "x".repeat(1601);
    const result = await bulkSaveMorningTtoDraftBodies({
      draftForDayKey: DAY,
      operation: "apply_all",
      body,
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && "status" in result) {
      expect(result.status).toBe(400);
      expect(result.error).toBe(TTO_DRAFT_BODY_EXCEEDS_TWILIO_TRANSPORT_MAX);
    }
    expect(db.drafts.find((d) => d.id === "draft-a")!.current_body_to_send).toBe(originalA);
    expect(db.drafts.find((d) => d.id === "draft-b")!.current_body_to_send).toBe(originalB);
  });

  it("rejects invalid day key", async () => {
    const result = await bulkSaveMorningTtoDraftBodies({
      draftForDayKey: "not-a-day",
      operation: "blank_all",
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && "status" in result) {
      expect(result.status).toBe(400);
    }
  });

  it("does not create drafts for missing audience members", async () => {
    const before = db.drafts.length;
    await bulkSaveMorningTtoDraftBodies({
      draftForDayKey: DAY,
      operation: "apply_all",
      body: "Shared text",
      now,
    });
    expect(db.drafts.length).toBe(before);
    expect(db.drafts.some((d) => d.clerk_user_id === "user_missing")).toBe(false);
  });
});

describe("tyler-text-overview-admin evening bulk save", () => {
  const now = new Date("2026-07-02T17:00:00.000Z");
  const DAY = "2026-07-03";
  const OTHER_DAY = "2026-07-04";

  function seedEveningBulkFixture() {
    db.drafts = [];
    db.generations = [];
    db.smsAudience = [];
    db.v2Commitments = [];
    db.v2CommsPrefs = [];
    db.userProfiles = [];
    db.smsSendEventsWrites = 0;
    db.generationUpdateCalls = 0;

    const users = [
      { id: "user_a", name: "Alpha", draftId: "draft-ea", genId: "gen-ea", body: "Machine A" },
      { id: "user_b", name: "Beta", draftId: "draft-eb", genId: "gen-eb", body: "Machine B" },
      { id: "user_c", name: "Charlie", draftId: "draft-ec", genId: "gen-ec", body: "Prior Tyler C" },
      { id: "user_sent", name: "Sent", draftId: "draft-esent", genId: "gen-esent", body: "Already sent" },
      { id: "user_missing", name: "Missing", draftId: null, genId: null, body: null },
    ] as const;

    for (const u of users) {
      seedSendableUser({ clerkUserId: u.id, preferredName: u.name, phone: `+1555000${u.id.slice(-1)}` });
      if (!u.draftId || !u.genId) continue;
      db.generations.push({
        id: u.genId,
        generation_number: 1,
        clerk_user_id: u.id,
        draft_for_day_key: DAY,
        send_slot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
        writer_openai_messages: WRITER_MESSAGES,
        writer_prompt_path: "shared_sol_v1",
        machine_draft_body: u.body === "Prior Tyler C" ? "Machine C original" : u.body,
        machine_should_send: true,
        machine_no_send_reason: null,
        notebook_hash: `hash-${u.id}`,
        notebook_verdict: "verified",
        generation_metadata: { capture_present: true, who: u.id, preview_only: true },
      });
      db.drafts.push({
        id: u.draftId,
        clerk_user_id: u.id,
        draft_for_day_key: DAY,
        current_generation_id: u.genId,
        current_body_to_send: u.body,
        status: u.id === "user_sent" ? "sent" : "current",
        send_slot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
        current_body_source: u.id === "user_c" ? "tyler_edit" : "machine",
        edited_by_tyler: u.id === "user_c",
        edited_at: u.id === "user_c" ? "2026-07-02T12:00:00.000Z" : null,
        sent_at: u.id === "user_sent" ? "2026-07-03T23:00:00.000Z" : null,
      });
    }

    seedSendableUser({ clerkUserId: "user_other_day", preferredName: "OtherDay", phone: "+15550999" });
    db.generations.push({
      id: "gen-e-other-day",
      generation_number: 1,
      clerk_user_id: "user_other_day",
      draft_for_day_key: OTHER_DAY,
      send_slot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      writer_openai_messages: WRITER_MESSAGES,
      machine_draft_body: "Other day machine",
      machine_should_send: true,
    });
    db.drafts.push({
      id: "draft-e-other-day",
      clerk_user_id: "user_other_day",
      draft_for_day_key: OTHER_DAY,
      current_generation_id: "gen-e-other-day",
      current_body_to_send: "Other day evening body",
      status: "current",
      send_slot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      current_body_source: "machine",
      edited_by_tyler: false,
    });

    seedSendableUser({ clerkUserId: "user_morning", preferredName: "Morning", phone: "+15550888" });
    db.generations.push({
      id: "gen-morning-same-day",
      generation_number: 1,
      clerk_user_id: "user_morning",
      draft_for_day_key: DAY,
      send_slot: "morning",
      writer_openai_messages: WRITER_MESSAGES,
      machine_draft_body: "Morning machine",
      machine_should_send: true,
    });
    db.drafts.push({
      id: "draft-morning-same-day",
      clerk_user_id: "user_morning",
      draft_for_day_key: DAY,
      current_generation_id: "gen-morning-same-day",
      current_body_to_send: "Morning body",
      status: "current",
      send_slot: "morning",
      current_body_source: "machine",
      edited_by_tyler: false,
    });
  }

  beforeEach(() => {
    seedEveningBulkFixture();
    vi.clearAllMocks();
  });

  it("blank_all blanks current evening drafts only with tyler_edit provenance", async () => {
    const result = await bulkSaveEveningTtoDraftBodies({
      draftForDayKey: DAY,
      operation: "blank_all",
      now,
    });
    expect("targeted" in result).toBe(true);
    if (!("targeted" in result)) return;
    expect(result.ok).toBe(true);
    expect(result.sendSlot).toBe(SMS_DAILY_EVENING_PREVIEW_SEND_SLOT);
    expect(result.targeted).toBe(3);
    expect(result.updated).toBe(3);
    expect(result.skippedNonCurrent).toBe(1);
    expect(result.skippedMissing).toBe(3);
    expect(result.failed).toEqual([]);
    expect(result.textsSentByThisAction).toBe(0);
    expect(result.appliedBody).toBeNull();

    for (const id of ["draft-ea", "draft-eb", "draft-ec"]) {
      const d = db.drafts.find((row) => row.id === id)!;
      expect(d.current_body_to_send).toBeNull();
      expect(d.current_body_source).toBe("tyler_edit");
      expect(d.edited_by_tyler).toBe(true);
      expect(d.edited_at).toBe(now.toISOString());
      expect(d.current_generation_id).toMatch(/^gen-e/);
    }

    expect(db.drafts.find((d) => d.id === "draft-esent")!.current_body_to_send).toBe("Already sent");
    expect(db.drafts.find((d) => d.id === "draft-e-other-day")!.current_body_to_send).toBe(
      "Other day evening body"
    );
    expect(db.drafts.find((d) => d.id === "draft-morning-same-day")!.current_body_to_send).toBe(
      "Morning body"
    );
    expect(db.generations.find((g) => g.id === "gen-ea")!.machine_draft_body).toBe("Machine A");
    expect(db.generations.find((g) => g.id === "gen-ec")!.machine_draft_body).toBe(
      "Machine C original"
    );
    expect(db.generations.find((g) => g.id === "gen-ea")!.machine_should_send).toBe(true);
    expect(db.generations.find((g) => g.id === "gen-ea")!.generation_metadata).toEqual({
      capture_present: true,
      who: "user_a",
      preview_only: true,
    });
    expect(db.smsSendEventsWrites).toBe(0);
    expect(db.generationUpdateCalls).toBe(0);
  });

  it("apply_all writes exact normalized body and overwrites prior Tyler edits", async () => {
    const body = "  Good evening! 🌙\nSee you tomorrow. https://example.com  ";
    const result = await bulkSaveEveningTtoDraftBodies({
      draftForDayKey: DAY,
      operation: "apply_all",
      body,
      now,
    });
    expect("targeted" in result).toBe(true);
    if (!("targeted" in result)) return;
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(3);
    expect(result.appliedBody).toBe(
      "Good evening! 🌙\nSee you tomorrow. https://example.com"
    );
    expect(result.textsSentByThisAction).toBe(0);

    const expected = normalizeTylerTextOverviewDraftBodyInput(body);
    for (const id of ["draft-ea", "draft-eb", "draft-ec"]) {
      const d = db.drafts.find((row) => row.id === id)!;
      expect(d.current_body_to_send).toBe(expected);
      expect(d.current_body_source).toBe("tyler_edit");
      expect(d.edited_by_tyler).toBe(true);
    }
    expect(db.drafts.find((d) => d.id === "draft-ec")!.current_body_to_send).not.toBe("Prior Tyler C");
    expect(db.generations.find((g) => g.id === "gen-ec")!.machine_draft_body).toBe(
      "Machine C original"
    );
    expect(db.drafts.find((d) => d.id === "draft-esent")!.current_body_to_send).toBe("Already sent");
    expect(db.drafts.find((d) => d.id === "draft-morning-same-day")!.current_body_to_send).toBe(
      "Morning body"
    );
    expect(db.generations.find((g) => g.id === "gen-ea")!.machine_should_send).toBe(true);
  });

  it("apply_all rejects whitespace-only body", async () => {
    const result = await bulkSaveEveningTtoDraftBodies({
      draftForDayKey: DAY,
      operation: "apply_all",
      body: "   ",
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && "status" in result) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/blank_all/i);
    }
    expect(db.drafts.find((d) => d.id === "draft-ea")!.current_body_to_send).toBe("Machine A");
  });

  it("apply_all over 1600 does not persist invalid evening body", async () => {
    const originalA = db.drafts.find((d) => d.id === "draft-ea")!.current_body_to_send;
    const originalB = db.drafts.find((d) => d.id === "draft-eb")!.current_body_to_send;
    const body = "x".repeat(1601);
    const result = await bulkSaveEveningTtoDraftBodies({
      draftForDayKey: DAY,
      operation: "apply_all",
      body,
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && "status" in result) {
      expect(result.status).toBe(400);
      expect(result.error).toBe(TTO_DRAFT_BODY_EXCEEDS_TWILIO_TRANSPORT_MAX);
    }
    expect(db.drafts.find((d) => d.id === "draft-ea")!.current_body_to_send).toBe(originalA);
    expect(db.drafts.find((d) => d.id === "draft-eb")!.current_body_to_send).toBe(originalB);
  });

  it("does not create drafts for missing audience members", async () => {
    const before = db.drafts.length;
    await bulkSaveEveningTtoDraftBodies({
      draftForDayKey: DAY,
      operation: "apply_all",
      body: "Shared evening text",
      now,
    });
    expect(db.drafts.length).toBe(before);
    expect(db.drafts.some((d) => d.clerk_user_id === "user_missing")).toBe(false);
  });

  it("bulk blank leaves current null for pre-Twilio revalidation to refuse", async () => {
    await bulkSaveEveningTtoDraftBodies({
      draftForDayKey: DAY,
      operation: "blank_all",
      now,
    });
    expect(db.drafts.find((d) => d.id === "draft-ea")!.current_body_to_send).toBeNull();
    expect(db.drafts.find((d) => d.id === "draft-ea")!.current_body_source).toBe("tyler_edit");
  });

  it("bulk apply leaves latest body B for pre-Twilio revalidation to prefer over stale A", async () => {
    await bulkSaveEveningTtoDraftBodies({
      draftForDayKey: DAY,
      operation: "apply_all",
      body: "Evening B",
      now,
    });
    expect(db.drafts.find((d) => d.id === "draft-ea")!.current_body_to_send).toBe("Evening B");
  });

  it("shared helper wire: evening route uses evening wrapper / no Twilio", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/admin/tyler-text-overview/evening-bulk-save/route.ts"),
      "utf8"
    );
    expect(route).toContain("requireTylerAdmin");
    expect(route).toContain("bulkSaveEveningTtoDraftBodies");
    expect(route).not.toMatch(/sendSMS/);
    expect(route).not.toMatch(/openai/i);
    expect(route).not.toContain("sendEveningTtoAuthoritativeCronSend");
    const admin = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-admin.ts"),
      "utf8"
    );
    expect(admin).toContain("export async function bulkSaveTtoDraftBodies");
    expect(admin).toContain("bulkSaveEveningTtoDraftBodies");
    expect(admin).toContain("SMS_DAILY_EVENING_PREVIEW_SEND_SLOT");
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

  it("unauthorized morning-bulk-save rejected", async () => {
    const err = Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
    requireTylerAdminMock.mockRejectedValueOnce(err);
    const { POST } = await import(
      "@/app/api/admin/tyler-text-overview/morning-bulk-save/route"
    );
    const res = await POST(
      new Request("http://localhost/api/admin/tyler-text-overview/morning-bulk-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft_for_day_key: "2026-07-03",
          operation: "blank_all",
        }),
      })
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it("unauthorized evening-bulk-save rejected", async () => {
    const err = Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
    requireTylerAdminMock.mockRejectedValueOnce(err);
    const { POST } = await import(
      "@/app/api/admin/tyler-text-overview/evening-bulk-save/route"
    );
    const res = await POST(
      new Request("http://localhost/api/admin/tyler-text-overview/evening-bulk-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft_for_day_key: "2026-07-03",
          operation: "blank_all",
        }),
      })
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it("unauthorized morning-generate-all rejected", async () => {
    const err = Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
    requireTylerAdminMock.mockRejectedValueOnce(err);
    const { POST } = await import(
      "@/app/api/admin/tyler-text-overview/morning-generate-all/route"
    );
    const res = await POST(
      new Request("http://localhost/api/admin/tyler-text-overview/morning-generate-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft_for_day_key: "2026-08-07" }),
      })
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it("unauthorized evening-generate-all rejected", async () => {
    const err = Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
    requireTylerAdminMock.mockRejectedValueOnce(err);
    const { POST } = await import(
      "@/app/api/admin/tyler-text-overview/evening-generate-all/route"
    );
    const res = await POST(
      new Request("http://localhost/api/admin/tyler-text-overview/evening-generate-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft_for_day_key: "2026-08-07" }),
      })
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it("morning-bulk-save apply_all requires admin and returns aggregate", async () => {
    requireTylerAdminMock.mockResolvedValue(undefined);
    seedCurrentDraft();
    const { POST } = await import(
      "@/app/api/admin/tyler-text-overview/morning-bulk-save/route"
    );
    const res = await POST(
      new Request("http://localhost/api/admin/tyler-text-overview/morning-bulk-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft_for_day_key: "2026-07-03",
          operation: "apply_all",
          body: "Shared holiday text",
        }),
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.result.updated).toBe(1);
    expect(json.result.appliedBody).toBe("Shared holiday text");
    expect(json.result.textsSentByThisAction).toBe(0);
    expect(db.drafts[0].current_body_to_send).toBe("Shared holiday text");
    expect(db.drafts[0].current_body_source).toBe("tyler_edit");
    expect(db.smsSendEventsWrites).toBe(0);
  });

  it("evening-bulk-save apply_all requires admin and returns aggregate", async () => {
    requireTylerAdminMock.mockResolvedValue(undefined);
    db.smsAudience = [];
    db.v2Commitments = [];
    db.v2CommsPrefs = [];
    db.userProfiles = [];
    db.smsSendEventsWrites = 0;
    db.generationUpdateCalls = 0;
    seedSendableUser({ clerkUserId: "user_evening_bulk", preferredName: "Eve" });
    db.generations = [
      {
        id: "gen-eve-bulk",
        generation_number: 1,
        clerk_user_id: "user_evening_bulk",
        draft_for_day_key: "2026-07-03",
        send_slot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
        writer_openai_messages: WRITER_MESSAGES,
        machine_draft_body: "Eve machine",
        machine_should_send: true,
      },
    ];
    db.drafts = [
      {
        id: "draft-eve-bulk",
        clerk_user_id: "user_evening_bulk",
        draft_for_day_key: "2026-07-03",
        current_generation_id: "gen-eve-bulk",
        current_body_to_send: "Eve machine",
        status: "current",
        send_slot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
        current_body_source: "machine",
        edited_by_tyler: false,
      },
    ];
    const { POST } = await import(
      "@/app/api/admin/tyler-text-overview/evening-bulk-save/route"
    );
    const res = await POST(
      new Request("http://localhost/api/admin/tyler-text-overview/evening-bulk-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft_for_day_key: "2026-07-03",
          operation: "apply_all",
          body: "Shared evening text",
        }),
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.result.updated).toBe(1);
    expect(json.result.sendSlot).toBe(SMS_DAILY_EVENING_PREVIEW_SEND_SLOT);
    expect(json.result.appliedBody).toBe("Shared evening text");
    expect(json.result.textsSentByThisAction).toBe(0);
    expect(db.drafts[0].current_body_to_send).toBe("Shared evening text");
    expect(db.drafts[0].current_body_source).toBe("tyler_edit");
    expect(db.smsSendEventsWrites).toBe(0);
    expect(db.generationUpdateCalls).toBe(0);
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
    db.smsSendEvents = [];
    db.draftsExactCountOverride = null;
    db.smsSendEventsWrites = 0;
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
    // Search filters display rows only — global counts stay complete.
    expect(byClerk.counts.sendableUsers).toBe(2);
    expect(byClerk.counts.noDraftYet).toBe(1);
    expect(byClerk.counts.draftCurrent).toBe(1);
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
          clerkUserId: "user_a",
          preferredName: "Jordan",
          phoneNumber: "+1555",
          draftForDayKey: "",
        },
        "jordan"
      )
    ).toBe(true);
    expect(
      computeTylerTextOverviewAdminCounts([
        {
          rowState: "no_draft_yet",
          machineShouldSend: null,
          editedByTyler: false,
          currentBodySource: null,
          currentBodyToSend: null,
        } as never,
        {
          rowState: "draft_current",
          machineShouldSend: true,
          editedByTyler: false,
          currentBodySource: "machine",
          currentBodyToSend: "hello",
        } as never,
        {
          rowState: "draft_sent",
          machineShouldSend: false,
          editedByTyler: false,
          currentBodySource: "machine",
          currentBodyToSend: "sent",
        } as never,
      ])
    ).toEqual({
      sendableUsers: 3,
      noDraftYet: 1,
      draftCurrent: 1,
      draftCurrentReady: 1,
      draftCurrentTylerBlanked: 0,
      draftSent: 1,
      draftSkipped: 0,
      machineShouldSendTrue: 1,
      machineShouldSendFalse: 1,
      generationLinkageErrors: 0,
      draftsMarkedSentDayTotal: 1,
      twilioAcceptedDayTotal: null,
    });
  });
});

describe("tyler-text-overview morning manifest completeness", () => {
  beforeEach(() => {
    db.drafts = [];
    db.generations = [];
    db.smsAudience = [];
    db.v2Commitments = [];
    db.v2CommsPrefs = [];
    db.userProfiles = [];
    db.smsSendEvents = [];
    db.draftsExactCountOverride = null;
    db.audienceExactCountOverride = null;
    db.countForceNull = false;
    db.smsSendEventsWrites = 0;
    vi.clearAllMocks();
  });

  it("38 audience + 37 selected-day drafts → 37 overlays and 1 genuine no-draft", async () => {
    const day = "2026-08-05";
    for (let i = 1; i <= 38; i += 1) {
      seedSendableUser({
        clerkUserId: `user_${String(i).padStart(2, "0")}`,
        preferredName: `User ${i}`,
        phone: `+1555000${String(i).padStart(4, "0")}`,
      });
    }
    for (let i = 1; i <= 37; i += 1) {
      const clerkUserId = `user_${String(i).padStart(2, "0")}`;
      const genId = `gen_${i}`;
      db.generations.push({
        id: genId,
        generation_number: 1,
        clerk_user_id: clerkUserId,
        draft_for_day_key: day,
        writer_openai_messages: WRITER_MESSAGES,
        machine_draft_body: MACHINE_BODY,
        machine_should_send: true,
      });
      db.drafts.push({
        id: `draft_${i}`,
        clerk_user_id: clerkUserId,
        draft_for_day_key: day,
        current_generation_id: genId,
        current_body_to_send: MACHINE_BODY,
        status: "current",
        send_slot: "morning",
      });
    }

    const { rows, counts, manifest } = await listSendableTylerTextOverviewRows({
      draftForDayKey: day,
    });
    expect(rows).toHaveLength(38);
    expect(rows.filter((r) => r.draftId != null)).toHaveLength(37);
    expect(rows.filter((r) => r.rowState === "no_draft_yet")).toHaveLength(1);
    expect(counts.noDraftYet).toBe(1);
    expect(counts.draftCurrent).toBe(37);
    expect(manifest.manifestComplete).toBe(true);
    expect(manifest.returnedDraftCount).toBe(37);
    expect(manifest.queriedDraftExactCount).toBe(37);
    expect(manifest.genuineMissingDraftCount).toBe(1);
  });

  it("historical volume cannot truncate selected-day manifest", async () => {
    const day = "2026-08-05";
    seedSendableUser({ clerkUserId: "user_live", preferredName: "Live" });
    for (let i = 0; i < 1100; i += 1) {
      db.drafts.push({
        id: `hist_${i}`,
        clerk_user_id: "user_live",
        draft_for_day_key: `2020-01-${String((i % 28) + 1).padStart(2, "0")}`,
        current_generation_id: "gen_hist",
        current_body_to_send: "old",
        status: "current",
        send_slot: "morning",
      });
    }
    db.generations.push({
      id: "gen_live",
      generation_number: 1,
      clerk_user_id: "user_live",
      draft_for_day_key: day,
      writer_openai_messages: WRITER_MESSAGES,
      machine_draft_body: MACHINE_BODY,
      machine_should_send: true,
    });
    db.drafts.push({
      id: "draft_live",
      clerk_user_id: "user_live",
      draft_for_day_key: day,
      current_generation_id: "gen_live",
      current_body_to_send: MACHINE_BODY,
      status: "current",
      send_slot: "morning",
    });

    const { rows, manifest } = await listSendableTylerTextOverviewRows({
      draftForDayKey: day,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].draftId).toBe("draft_live");
    expect(rows[0].rowState).toBe("draft_current");
    expect(manifest.returnedDraftCount).toBe(1);
    expect(manifest.queriedDraftExactCount).toBe(1);
  });

  it("truncated incomplete draft result fails loudly", async () => {
    seedSendableUser({ clerkUserId: "user_a", preferredName: "A" });
    db.drafts.push({
      id: "draft_a",
      clerk_user_id: "user_a",
      draft_for_day_key: "2026-08-05",
      current_generation_id: "gen_a",
      current_body_to_send: MACHINE_BODY,
      status: "current",
      send_slot: "morning",
    });
    db.generations.push({
      id: "gen_a",
      generation_number: 1,
      clerk_user_id: "user_a",
      draft_for_day_key: "2026-08-05",
      writer_openai_messages: WRITER_MESSAGES,
      machine_draft_body: MACHINE_BODY,
      machine_should_send: true,
    });
    db.draftsExactCountOverride = 9;

    await expect(
      listSendableTylerTextOverviewRows({ draftForDayKey: "2026-08-05" })
    ).rejects.toThrow(/tto_manifest_incomplete:drafts/);
  });

  it("9 sent drafts produce draftsMarkedSentDayTotal 9 including historical non-audience", async () => {
    const day = "2026-08-05";
    for (let i = 1; i <= 5; i += 1) {
      seedSendableUser({ clerkUserId: `aud_${i}`, preferredName: `Aud ${i}` });
      db.generations.push({
        id: `gen_sent_${i}`,
        generation_number: 1,
        clerk_user_id: `aud_${i}`,
        draft_for_day_key: day,
        writer_openai_messages: WRITER_MESSAGES,
        machine_draft_body: MACHINE_BODY,
        machine_should_send: true,
      });
      db.drafts.push({
        id: `draft_sent_${i}`,
        clerk_user_id: `aud_${i}`,
        draft_for_day_key: day,
        current_generation_id: `gen_sent_${i}`,
        current_body_to_send: MACHINE_BODY,
        status: "sent",
        send_slot: "morning",
        sent_at: `${day}T12:0${i}:00.000Z`,
        final_body_sent: MACHINE_BODY,
      });
    }
    for (let i = 6; i <= 9; i += 1) {
      db.generations.push({
        id: `gen_hist_sent_${i}`,
        generation_number: 1,
        clerk_user_id: `gone_${i}`,
        draft_for_day_key: day,
        writer_openai_messages: WRITER_MESSAGES,
        machine_draft_body: MACHINE_BODY,
        machine_should_send: true,
      });
      db.drafts.push({
        id: `draft_hist_sent_${i}`,
        clerk_user_id: `gone_${i}`,
        draft_for_day_key: day,
        current_generation_id: `gen_hist_sent_${i}`,
        current_body_to_send: MACHINE_BODY,
        status: "sent",
        send_slot: "morning",
        sent_at: `${day}T13:0${i}:00.000Z`,
        final_body_sent: MACHINE_BODY,
      });
    }
    for (let i = 1; i <= 9; i += 1) {
      db.smsSendEvents.push({
        id: `evt_${i}`,
        send_slot: "morning",
        day_key: day,
        message_sid: `SM${i}`,
      });
    }

    const { counts, rows, manifest } = await listSendableTylerTextOverviewRows({
      draftForDayKey: day,
    });
    expect(rows.filter((r) => r.rowState === "draft_sent")).toHaveLength(5);
    expect(counts.draftSent).toBe(5);
    expect(counts.draftsMarkedSentDayTotal).toBe(9);
    expect(counts.twilioAcceptedDayTotal).toBe(9);
    expect(manifest.draftsMarkedSentDayTotal).toBe(9);
    expect(manifest.twilioAcceptedDayTotal).toBe(9);
  });

  it("missing generation becomes linkage error, not no-draft", async () => {
    seedSendableUser({ clerkUserId: "user_link", preferredName: "Link" });
    db.drafts.push({
      id: "draft_link",
      clerk_user_id: "user_link",
      draft_for_day_key: "2026-08-05",
      current_generation_id: "gen_missing",
      current_body_to_send: MACHINE_BODY,
      status: "current",
      send_slot: "morning",
    });

    const { rows, counts, manifest } = await listSendableTylerTextOverviewRows({
      draftForDayKey: "2026-08-05",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].rowState).toBe("draft_current");
    expect(rows[0].draftId).toBe("draft_link");
    expect(rows[0].generationLinkageError).toBe(true);
    expect(counts.generationLinkageErrors).toBe(1);
    expect(counts.noDraftYet).toBe(0);
    expect(manifest.manifestComplete).toBe(false);
    expect(manifest.generationLinkageErrorCount).toBe(1);
  });

  it("null draft exact count fails loudly", async () => {
    seedSendableUser({ clerkUserId: "user_a", preferredName: "A" });
    db.drafts.push({
      id: "draft_a",
      clerk_user_id: "user_a",
      draft_for_day_key: "2026-08-05",
      current_generation_id: "gen_a",
      current_body_to_send: MACHINE_BODY,
      status: "current",
      send_slot: "morning",
    });
    db.generations.push({
      id: "gen_a",
      generation_number: 1,
      clerk_user_id: "user_a",
      draft_for_day_key: "2026-08-05",
      writer_openai_messages: WRITER_MESSAGES,
      machine_draft_body: MACHINE_BODY,
      machine_should_send: true,
    });
    db.countForceNull = true;
    await expect(
      listSendableTylerTextOverviewRows({ draftForDayKey: "2026-08-05" })
    ).rejects.toThrow(/tto_manifest_incomplete:.*count_unavailable/);
  });

  it("null audience exact count fails loudly", async () => {
    seedSendableUser({ clerkUserId: "user_a", preferredName: "A" });
    db.audienceExactCountOverride = null as unknown as number;
    db.countForceNull = true;
    await expect(loadSendableTylerTextOverviewAudienceMembers()).rejects.toThrow(
      /tto_manifest_incomplete:audience_count_unavailable/
    );
  });

  it("chunkIdsForTtoManifestQuery chunks safely", () => {
    const ids = Array.from({ length: 520 }, (_, i) => `u${i}`);
    const chunks = chunkIdsForTtoManifestQuery(ids, 250);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(250);
    expect(chunks[1]).toHaveLength(250);
    expect(chunks[2]).toHaveLength(20);
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
    expect(src).toContain("Refresh");
    expect(src).toContain("lastRefreshedAt");
    expect(src).toContain("TTO_MANIFEST_INCOMPLETE_BANNER");
    expect(src).toContain("MORNING_UNSAVED_COPY");
    expect(src).toContain("handleManualRefresh");
    expect(src).toContain("preserveUnsaved");
    expect(src).toContain("AbortController");
    expect(src).toContain("loadGenerationRef");
    expect(src).toContain("MORNING_SAVE_RELOAD_FAILED_COPY");
    expect(src).toContain("matchesTylerTextOverviewSearchQuery");
    expect(src).toContain("TTO_FILTERED_ROWS_LABEL");
    expect(src).toContain("showFullPageLoader");
    expect(src).toContain("backgroundRefreshing");
    expect(src).toContain("shouldSkipMorningTtoFocusRefresh");
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
    expect(dashboard).toContain("runGenerateAll");
    expect(dashboard).toContain("ttoGenerateAllEndpoint");
    expect(dashboard).not.toMatch(/Bulk generate/i);
  });
});
