import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { from, rpc, sendMail, calls, db } = vi.hoisted(() => {
  const sendMail = vi.fn(async (payload?: { to?: string }) => {
    void payload;
    return { data: { id: "email-1" }, error: null };
  });
  const calls: Array<{ method: string; url: string }> = [];
  const db = {
    mode: "incomplete" as "incomplete" | "complete",
    messageOrder: "forward" as "forward" | "reverse",
    automation: "active" as "active" | "off",
    interpretation: "pilot" as "pilot" | "off",
    sending: "on" as "on" | "off",
    settings: {} as Record<string, unknown>,
    people: [] as Record<string, unknown>[],
    journeys: [] as Record<string, unknown>[],
    actions: [] as Record<string, unknown>[],
    messages: [] as Record<string, unknown>[],
    suppressions: [] as Record<string, unknown>[],
    domains: [] as Record<string, unknown>[],
    events: [] as Record<string, unknown>[],
    blockReads: 0,
  };
  const from = vi.fn();
  const rpc = vi.fn(async (_name?: string, _args?: Record<string, unknown>) => ({ data: null, error: null }));
  return { from, rpc, sendMail, calls, db };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => from(table),
    rpc: (name: string, args?: Record<string, unknown>) => rpc(name, args),
  },
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMail };
  },
}));

import { runAcquisitionCron } from "@/lib/acquisition/store";

const NOW = new Date("2026-11-17T15:00:00.000Z");
const PROSPECT = "coach@school.edu";
const ACTIVATED = "2019-01-01T00:00:00.000Z";
const PREVIOUS_WALK = "2026-10-01T00:00:00.000Z";

function resetDb() {
  db.mode = "incomplete";
  db.messageOrder = "forward";
  db.automation = "active";
  db.interpretation = "pilot";
  db.sending = "on";
  db.blockReads = 0;
  db.settings = {
    id: "default",
    automation_status: "active",
    video_delay_hours: 24,
    trial_followup_delay_hours: 72,
    daily_send_cap: 25,
    evergreen_personal_video_id: null,
    campaign_assets: {},
    offers: {},
    conversation_interpretation: "pilot",
    conversation_sending: "on",
    instantly_blocklist: "off",
    video_reminder_hours: 48,
    video_final_reminder_hours: 96,
    instantly_block_import_cursor: null,
    instantly_block_import_cycle: 4,
    instantly_block_import_completed_cycle: 3,
    instantly_block_import_completed_at: PREVIOUS_WALK,
    instantly_block_import_error: null,
    instantly_block_import_pages: 80,
    instantly_block_import_claim_until: null,
    instantly_block_import_generation: 7,
  };
  db.people = [{
    id: "person-1",
    email_normalized: PROSPECT,
    first_name: "Casey",
    last_name: "Coach",
    lifecycle_state: "asset_requested",
    requested_asset: null,
    offer_key: null,
    clerk_user_id: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    source_campaign: null,
    source_sender: null,
    sport: null,
    role: null,
    geography: null,
    close_reason: null,
  }];
  db.journeys = [{
    id: "journey-1",
    person_id: "person-1",
    campaign_id: "camp-1",
    lifecycle_state: "asset_requested",
    closed_at: null,
  }];
  db.actions = [{
    id: "action-1",
    person_id: "person-1",
    action_type: "send_asset",
    attempt_count: 0,
    idempotency_key: "asset:person-1:journey-1",
    journey_id: "journey-1",
    promised_assets: ["definite_dozen"],
    promised_label: "Pat Summitt Definite Dozen team discussion guide",
    scheduled_at: "2020-01-01T00:00:00.000Z",
    status: "scheduled",
    claim_until: null,
    updated_at: "2020-01-01T00:00:00.000Z",
  }];
  db.messages = [
    inbound("inbound-a", "interpreted"),
    inbound("inbound-b", "interpreted"),
    inbound("inbound-new", "pending"),
  ];
  db.suppressions = [];
  db.domains = [];
  db.events = [];
  calls.length = 0;
  sendMail.mockClear();
  rpc.mockClear();
}

function inbound(id: string, status: "pending" | "interpreted"): Record<string, unknown> {
  return {
    id,
    person_id: "person-1",
    journey_id: "journey-1",
    campaign_id: "camp-1",
    direction: "inbound",
    provider: "instantly",
    subject: "Practice plan",
    body_text: "Can you send the practice plan?",
    occurred_at: "2026-11-01T15:00:00.000Z",
    created_at: "2026-11-01T15:00:00.000Z",
    processing_status: status,
    claim_until: null,
    attempt_count: 0,
    ai_outcome: "ask_question",
    ai_reason: "The coach asked for the practice plan.",
    draft_subject: "Practice plan",
    draft_body: "The practice plan is the one we already discussed.",
    effect_applied_at: status === "interpreted" ? "2026-11-01T16:00:00.000Z" : null,
    reply_to_provider_message_id: "01234567-89ab-cdef-0123-456789abcdef",
    sender_account: "outreach@summittmindset.com",
    lead_email: PROSPECT,
    provider_message_id: `provider:${id}`,
  };
}

type Filter = { kind: string; column: string; value: unknown; operator?: string };

function match(row: Record<string, unknown>, filters: Filter[]): boolean {
  return filters.every((filter) => {
    const left = row[filter.column];
    if (filter.kind === "eq") return left === filter.value;
    if (filter.kind === "neq") return left !== filter.value;
    if (filter.kind === "in") return Array.isArray(filter.value) && filter.value.includes(left);
    if (filter.kind === "is") return filter.value == null ? left == null : left === filter.value;
    if (filter.kind === "not" && filter.operator === "is") return filter.value == null ? left != null : left !== filter.value;
    if (typeof left === "string" && typeof filter.value === "string") {
      if (filter.kind === "lt") return left < filter.value;
      if (filter.kind === "lte") return left <= filter.value;
      if (filter.kind === "gt") return left > filter.value;
      if (filter.kind === "gte") return left >= filter.value;
    }
    if (filter.kind === "or" || filter.kind === "like") return true;
    return true;
  });
}

function tableFor(name: string): Record<string, unknown>[] | null {
  if (name === "acquisition_people") return db.people;
  if (name === "acquisition_journeys") return db.journeys;
  if (name === "acquisition_actions") return db.actions;
  if (name === "acquisition_messages") return db.messages;
  if (name === "recovery_suppressions") return db.suppressions;
  if (name === "acquisition_blocked_domains") return db.domains;
  if (name === "acquisition_events") return db.events;
  return null;
}

function query(table: string) {
  const state: {
    op: "select" | "insert" | "update";
    select: string;
    head: boolean;
    payload: Record<string, unknown> | null;
    filters: Filter[];
    limit: number | null;
  } = { op: "select", select: "", head: false, payload: null, filters: [], limit: null };
  const resolve = () => {
    if (table === "acquisition_settings" && state.op === "select") {
      if (state.select.includes("instantly_reconcile")) {
        return { data: null, error: { message: "reconcile is outside this test" }, count: null };
      }
      return { data: { ...db.settings }, error: null, count: null };
    }
    if (table === "acquisition_campaign_activations") {
      return {
        data: [{
          campaign_id: "camp-1",
          state: "active",
          activated_at: ACTIVATED,
          last_activated_at: ACTIVATED,
        }],
        error: null,
        count: null,
      };
    }
    if (table === "acquisition_settings" && state.op === "update" && state.payload) {
      const generation = state.filters.find((filter) => filter.column === "instantly_block_import_generation");
      if (generation && db.settings.instantly_block_import_generation !== generation.value) {
        return { data: [], error: null, count: null };
      }
      const newer = state.filters.find((filter) => filter.kind === "gt" && filter.column === "instantly_block_import_claim_until");
      const claimUntil = db.settings.instantly_block_import_claim_until;
      if (newer && (typeof claimUntil !== "string" || Date.parse(claimUntil) <= Date.parse(String(newer.value)))) {
        return { data: [], error: null, count: null };
      }
      const claimOr = state.filters.find((filter) => filter.kind === "or" && String(filter.value).includes("instantly_block_import_claim_until"));
      if (claimOr) {
        const stamp = String(claimOr.value).match(/lte\."([^"]+)"/);
        const now = stamp ? Date.parse(stamp[1]) : Number.NaN;
        if (typeof claimUntil === "string" && Number.isFinite(now) && Date.parse(claimUntil) > now) {
          return { data: [], error: null, count: null };
        }
      }
      Object.assign(db.settings, state.payload);
      return { data: [{ id: "default" }], error: null, count: null };
    }
    const rows = tableFor(table);
    if (!rows) return { data: [], error: null, count: 0 };
    if (state.op === "insert" && state.payload) {
      rows.push({ ...state.payload });
      return { data: null, error: null, count: null };
    }
    let matched = rows.filter((row) => match(row, state.filters));
    if (table === "acquisition_messages" && state.select === "id, campaign_id, created_at") {
      matched = [...matched].sort((left, right) => {
        const order = String(left.id).localeCompare(String(right.id));
        return db.messageOrder === "reverse" ? -order : order;
      });
    }
    if (state.op === "update" && state.payload) {
      for (const row of matched) Object.assign(row, state.payload);
    }
    if (state.limit != null) matched = matched.slice(0, state.limit);
    if (state.head) return { data: null, error: null, count: matched.length };
    return { data: matched.map((row) => ({ ...row })), error: null, count: matched.length };
  };
  const one = () => {
    const result = resolve();
    const row = Array.isArray(result.data) ? result.data[0] ?? null : result.data;
    return { data: row, error: result.error };
  };
  const builder = {
    select(columns?: string, options?: { head?: boolean }) {
      state.select = columns ?? "";
      state.head = Boolean(options?.head);
      return builder;
    },
    insert(payload: Record<string, unknown>) {
      state.op = "insert";
      state.payload = payload;
      return builder;
    },
    update(payload: Record<string, unknown>) {
      state.op = "update";
      state.payload = payload;
      return builder;
    },
    eq(column: string, value: unknown) {
      state.filters.push({ kind: "eq", column, value });
      return builder;
    },
    neq(column: string, value: unknown) {
      state.filters.push({ kind: "neq", column, value });
      return builder;
    },
    in(column: string, value: unknown) {
      state.filters.push({ kind: "in", column, value });
      return builder;
    },
    is(column: string, value: unknown) {
      state.filters.push({ kind: "is", column, value });
      return builder;
    },
    not(column: string, operator: string, value: unknown) {
      state.filters.push({ kind: "not", column, value, operator });
      return builder;
    },
    or(value: string) {
      state.filters.push({ kind: "or", column: "", value });
      return builder;
    },
    lt(column: string, value: unknown) {
      state.filters.push({ kind: "lt", column, value });
      return builder;
    },
    lte(column: string, value: unknown) {
      state.filters.push({ kind: "lte", column, value });
      return builder;
    },
    gt(column: string, value: unknown) {
      state.filters.push({ kind: "gt", column, value });
      return builder;
    },
    gte(column: string, value: unknown) {
      state.filters.push({ kind: "gte", column, value });
      return builder;
    },
    like(column: string, value: unknown) {
      state.filters.push({ kind: "like", column, value });
      return builder;
    },
    order() { return builder; },
    limit(value: number) {
      state.limit = value;
      return builder;
    },
    range() { return builder; },
    maybeSingle: () => Promise.resolve(one()),
    single: () => Promise.resolve(one()),
    then(onFulfilled: (value: ReturnType<typeof resolve>) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(resolve()).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

function blockPage() {
  if (db.mode === "complete") {
    return { items: [], next_starting_after: null };
  }
  return {
    items: [{
      id: "entry-other",
      timestamp_created: NOW.toISOString(),
      organization_id: "org-1",
      bl_value: "other@example.com",
      is_domain: false,
    }],
    next_starting_after: "cursor-2",
  };
}

function runCron(clock: () => Date = () => NOW) {
  return runAcquisitionCron(NOW, clock);
}

function stubFetch(onBlock: () => Response) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (method === "GET" && url.includes("block-lists-entries")) {
      db.blockReads += 1;
      return onBlock();
    }
    if (method === "POST") return new Response(JSON.stringify({ id: "reply-1" }), { status: 200 });
    return new Response("missing", { status: 500 });
  }));
}

describe("acquisition cron send gate", () => {
  beforeEach(() => {
    resetDb();
    from.mockImplementation((table: string) => query(table));
    vi.stubEnv("INSTANTLY_API_KEY", "test-key");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url });
      if (method === "GET" && url.includes("block-lists-entries")) {
        db.blockReads += 1;
        const cursor = new URL(url).searchParams.get("starting_after");
        if (db.mode === "incomplete" && cursor) return new Response("busy", { status: 429 });
        return new Response(JSON.stringify(blockPage()), { status: 200 });
      }
      if (method === "POST") {
        return new Response(JSON.stringify({ id: "reply-1" }), { status: 200 });
      }
      return new Response("missing", { status: 500 });
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends nothing while this invocation has not finished the walk, in either reply order", async () => {
    for (const messageOrder of ["forward", "reverse"] as const) {
      resetDb();
      db.messageOrder = messageOrder;
      const result = await runCron();
      expect(result).toMatchObject({ skipped: "block_import_held", accepted: 0 });
      expect(posts()).toEqual([]);
      expect(sendMail).not.toHaveBeenCalled();
      expect(calls.some((call) => call.url.includes("search="))).toBe(false);
      expect(db.settings.instantly_block_import_completed_at).toBe(PREVIOUS_WALK);
      expect(db.messages.find((row) => row.id === "inbound-new")?.processing_status).toBe("interpreted");
    }
  });

  it("sends the due resource and every ready reply only after this invocation finishes the walk", async () => {
    db.mode = "complete";
    const result = await runCron();
    expect(result.skipped).not.toBe("block_import_held");
    expect(db.settings.instantly_block_import_completed_at).toBe(NOW.toISOString());
    expect(db.settings.instantly_block_import_claim_until).toBeNull();
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(posts()).toHaveLength(3);
    expect(calls.some((call) => call.url.includes("search="))).toBe(false);
    expect(String(sendMail.mock.calls[0]?.[0]?.to)).toBe(PROSPECT);
  });

  it("still refuses a finished walk when the recipient is suppressed", async () => {
    db.mode = "complete";
    db.suppressions.push({ id: "stop-1", email_normalized: PROSPECT, reason: "unsubscribe" });
    const result = await runCron();
    expect(result.accepted).toBe(0);
    expect(sendMail).not.toHaveBeenCalled();
    expect(posts()).toEqual([]);
  });

  it("does not send a resource when automation is off", async () => {
    db.mode = "complete";
    db.automation = "off";
    db.interpretation = "off";
    db.sending = "off";
    db.settings.automation_status = "off";
    db.settings.conversation_interpretation = "off";
    db.settings.conversation_sending = "off";
    const result = await runCron();
    expect(result).toMatchObject({ skipped: "automation_off", accepted: 0 });
    expect(sendMail).not.toHaveBeenCalled();
    expect(posts()).toEqual([]);
    expect(db.actions.find((row) => row.id === "action-1")?.status).toBe("scheduled");
  });

  it("does not post an automatic reply when conversation sending is off", async () => {
    db.mode = "complete";
    db.automation = "off";
    db.sending = "off";
    db.settings.automation_status = "off";
    db.settings.conversation_sending = "off";
    const result = await runCron();
    expect(result.skipped).toBe("automation_off");
    expect(posts()).toEqual([]);
    expect(sendMail).not.toHaveBeenCalled();
    expect(db.messages.find((row) => row.id === "inbound-new")?.processing_status).toBe("interpreted");
  });

  it("renews a continuing owner from the same clock and sends nothing while the walk is unfinished", async () => {
    let at = NOW.getTime();
    const observed: string[] = [];
    stubFetch(() => {
      if (db.blockReads === 1) {
        observed.push(String(db.settings.instantly_block_import_claim_until));
        at = NOW.getTime() + 60_000;
        return new Response(JSON.stringify(blockPage()), { status: 200 });
      }
      observed.push(String(db.settings.instantly_block_import_claim_until));
      return new Response("busy", { status: 429 });
    });
    const result = await runCron(() => new Date(at));
    expect(result).toMatchObject({ skipped: "block_import_held", accepted: 0 });
    expect(observed).toEqual([
      new Date(NOW.getTime() + 4 * 60 * 1000).toISOString(),
      new Date(NOW.getTime() + 60_000 + 4 * 60 * 1000).toISOString(),
    ]);
    expect(sendMail).not.toHaveBeenCalled();
    expect(posts()).toEqual([]);
  });

  it("does not commit or send when the lease expires before completion", async () => {
    db.mode = "complete";
    let at = NOW.getTime();
    stubFetch(() => {
      at = NOW.getTime() + 4 * 60 * 1000;
      return new Response(JSON.stringify(blockPage()), { status: 200 });
    });
    const result = await runCron(() => new Date(at));
    expect(result).toMatchObject({ skipped: "block_import_held", accepted: 0 });
    expect(db.settings.instantly_block_import_completed_at).toBe(PREVIOUS_WALK);
    expect(db.settings.instantly_block_import_generation).toBe(8);
    expect(sendMail).not.toHaveBeenCalled();
    expect(posts()).toEqual([]);
  });

  it("does not commit or send after a newer generation takes the lease", async () => {
    db.mode = "complete";
    stubFetch(() => {
      db.settings.instantly_block_import_generation = 99;
      return new Response(JSON.stringify(blockPage()), { status: 200 });
    });
    const result = await runCron();
    expect(result).toMatchObject({ skipped: "block_import_held", accepted: 0 });
    expect(db.settings.instantly_block_import_generation).toBe(99);
    expect(db.settings.instantly_block_import_completed_at).toBe(PREVIOUS_WALK);
    expect(db.settings.instantly_block_import_cursor).toBeNull();
    expect(sendMail).not.toHaveBeenCalled();
    expect(posts()).toEqual([]);
  });

  it("does not let the import request itself send email", async () => {
    await runCron();
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(sendMail).not.toHaveBeenCalled();
    expect(db.blockReads).toBeGreaterThan(0);
  });
});

function posts() {
  return calls.filter((call) => call.method === "POST");
}
