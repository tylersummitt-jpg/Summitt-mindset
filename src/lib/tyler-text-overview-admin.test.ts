import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  computeTylerTextOverviewEdited,
  levenshteinCharDistance,
  listCurrentTylerTextOverviewDrafts,
  mapDraftRowsToAdminDto,
  normalizeTylerTextOverviewDraftBodyInput,
  parseWriterOpenAiMessages,
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

const db = vi.hoisted(() => ({
  drafts: [] as DraftRow[],
  generations: [] as GenerationRow[],
  smsSendEventsWrites: 0,
  generationUpdateCalls: 0,
}));

function filterDrafts(payload: Record<string, unknown>): DraftRow[] {
  let rows = db.drafts.filter((d) => d.status === (payload.status ?? d.status));
  if (typeof payload.send_slot === "string") {
    rows = rows.filter((d) => ((d as { send_slot?: string }).send_slot ?? "morning") === payload.send_slot);
  }
  if (typeof payload.draft_for_day_key === "string") {
    rows = rows.filter((d) => d.draft_for_day_key === payload.draft_for_day_key);
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
        const rows = db.generations.filter(
          (g) =>
            typeof g.clerk_user_id === "string" &&
            typeof g.draft_for_day_key === "string" &&
            clerkIds.includes(g.clerk_user_id) &&
            dayKeys.includes(g.draft_for_day_key)
        );
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

function seedCurrentDraft(overrides?: Partial<DraftRow> & { generation?: Partial<GenerationRow> }) {
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

describe("tyler-text-overview-admin read model", () => {
  beforeEach(() => {
    db.drafts = [];
    db.generations = [];
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

  it("DTO does not expose phone_number", () => {
    seedCurrentDraft();
    const dto = mapDraftRowsToAdminDto({
      drafts: db.drafts,
      generationsById: new Map(db.generations.map((g) => [g.id, g])),
    })[0];
    expect(dto).not.toHaveProperty("phone_number");
    expect(dto).not.toHaveProperty("phoneNumber");
    expect(JSON.stringify(dto)).not.toContain("+15551234567");
  });

  it("DTO does not expose phone_number or raw generation metadata blob", () => {
    seedCurrentDraft();
    const dto = mapDraftRowsToAdminDto({
      drafts: db.drafts,
      generationsById: new Map(db.generations.map((g) => [g.id, g])),
    })[0];
    const json = JSON.stringify(dto);
    expect(dto).not.toHaveProperty("phone_number");
    expect(dto).not.toHaveProperty("phoneNumber");
    expect(dto).not.toHaveProperty("generationMetadata");
    expect(json).not.toContain("+15551234567");
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
    seedCurrentDraft();
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
      "src/app/admin/tyler-text-overview/page.tsx",
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
      "src/app/admin/tyler-text-overview/page.tsx",
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
      "src/app/admin/tyler-text-overview/page.tsx",
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
});
