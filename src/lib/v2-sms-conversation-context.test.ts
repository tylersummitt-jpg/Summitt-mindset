import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";

const supabaseFrom = vi.hoisted(() => vi.fn());
const getRecentV2EventsForAi = vi.hoisted(() => vi.fn());
const loadV2CoachingMemoryForPrompt = vi.hoisted(() => vi.fn());
const fetchPendingEvolutionRecommendation = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: supabaseFrom },
}));

vi.mock("@/lib/v2-commitment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-commitment")>();
  return {
    ...actual,
    getRecentV2EventsForAi,
  };
});

vi.mock("@/lib/v2-coaching-memory", () => ({
  loadV2CoachingMemoryForPrompt,
}));

vi.mock("@/lib/v2-commitment-evolution-recommendation", () => ({
  fetchPendingEvolutionRecommendation,
}));

import { buildV2SmsConversationContextPack } from "@/lib/v2-sms-conversation-context";

const REPO = path.join(__dirname, "..", "..");
const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
const THREE_DAYS_AGO = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const FOUR_DAYS_AGO = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();

type InboundQueryCapture = {
  select?: string;
  orderColumn?: string;
  orderAscending?: boolean;
};

function minimalCommitment(): ActiveV2CommitmentRow {
  return {
    id: "commit_1",
    clerk_user_id: "user_conv",
    status: "active",
    behavior_statement: "Two hours of distribution work daily",
    title: "Distribution",
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
    updated_at: null,
    started_at: null,
  };
}

function arrayThenable<T>(data: T) {
  const result = { data, error: null as null };
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    not: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (resolve: (v: typeof result) => void) => {
      resolve(result);
      return Promise.resolve(result);
    },
  };
  return builder;
}

function maybeSingleThenable<T>(data: T) {
  const result = { data, error: null as null };
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

function inboundMessagesChain(rows: unknown[], capture: InboundQueryCapture) {
  const result = { data: rows, error: null as null };
  const builder = {
    select: vi.fn((cols: string) => {
      capture.select = cols;
      return builder;
    }),
    eq: vi.fn(() => builder),
    order: vi.fn((col: string, opts: { ascending: boolean }) => {
      capture.orderColumn = col;
      capture.orderAscending = opts.ascending;
      return builder;
    }),
    limit: vi.fn(() => builder),
    then: (resolve: (v: typeof result) => void) => {
      resolve(result);
      return Promise.resolve(result);
    },
  };
  return builder;
}

function setupSupabaseForPack(args: {
  inboundRows?: unknown[];
  inboundCapture?: InboundQueryCapture;
  sendRows?: unknown[];
  coachJobRows?: unknown[];
}) {
  const inboundCapture = args.inboundCapture ?? {};
  supabaseFrom.mockImplementation((table: string) => {
    switch (table) {
      case "user_profiles":
        return maybeSingleThenable(null);
      case "sms_last_outbound_context":
        return maybeSingleThenable(null);
      case "sms_inbound_messages":
        return inboundMessagesChain(args.inboundRows ?? [], inboundCapture);
      case "sms_send_events":
        return arrayThenable(args.sendRows ?? []);
      case "sms_inbound_coach_jobs":
        return arrayThenable(args.coachJobRows ?? []);
      default:
        throw new Error(`unexpected table ${table}`);
    }
  });
  return inboundCapture;
}

describe("v2-sms-conversation-context inbound schema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecentV2EventsForAi.mockResolvedValue([]);
    loadV2CoachingMemoryForPrompt.mockResolvedValue(null);
    fetchPendingEvolutionRecommendation.mockResolvedValue(null);
  });

  it("source selects raw_body, received_at and orders by received_at descending", () => {
    const src = fs.readFileSync(
      path.join(REPO, "src/lib/v2-sms-conversation-context.ts"),
      "utf8"
    );
    const inboundBlock = src.match(
      /from\("sms_inbound_messages"\)[\s\S]*?\.limit\(8\)/
    )?.[0];
    expect(inboundBlock).toBeDefined();
    expect(inboundBlock).toMatch(/select\("raw_body, received_at"\)/);
    expect(inboundBlock).toMatch(/order\("received_at", \{ ascending: false \}\)/);
    expect(inboundBlock).not.toMatch(/created_at/);
  });

  it("sms_inbound_messages query selects raw_body, received_at", async () => {
    const capture: InboundQueryCapture = {};
    setupSupabaseForPack({
      inboundCapture: capture,
      inboundRows: [],
    });

    await buildV2SmsConversationContextPack({
      clerkUserId: "user_conv",
      commitmentId: "commit_1",
      commitment: minimalCommitment(),
      preloadedEventsNewestFirst: [],
      preloadedCoachingMemory: null,
    });

    expect(capture.select).toBe("raw_body, received_at");
  });

  it("sms_inbound_messages query orders by received_at descending", async () => {
    const capture: InboundQueryCapture = {};
    setupSupabaseForPack({
      inboundCapture: capture,
      inboundRows: [],
    });

    await buildV2SmsConversationContextPack({
      clerkUserId: "user_conv",
      commitmentId: "commit_1",
      commitment: minimalCommitment(),
      preloadedEventsNewestFirst: [],
      preloadedCoachingMemory: null,
    });

    expect(capture.orderColumn).toBe("received_at");
    expect(capture.orderAscending).toBe(false);
  });

  it("includes inbound raw_body lines in recentTranscriptLines as User lines", async () => {
    setupSupabaseForPack({
      inboundRows: [
        {
          raw_body: "Got the hour in last night after church.",
          received_at: TWO_DAYS_AGO,
        },
      ],
      sendRows: [],
      coachJobRows: [],
    });

    const pack = await buildV2SmsConversationContextPack({
      clerkUserId: "user_conv",
      commitmentId: "commit_1",
      commitment: minimalCommitment(),
      preloadedEventsNewestFirst: [],
      preloadedCoachingMemory: null,
    });

    expect(pack.recentTranscriptLines.some((line) => /^User:/i.test(line))).toBe(true);
    expect(
      pack.recentTranscriptLines.some((line) => /Got the hour in last night/i.test(line))
    ).toBe(true);
    expect(pack.lastInboundPreview).toMatch(/Got the hour in last night/i);
  });

  it("works when inbound rows have received_at only (no created_at)", async () => {
    setupSupabaseForPack({
      inboundRows: [
        {
          raw_body: "User reply without created_at column present.",
          received_at: TWO_DAYS_AGO,
        },
      ],
    });

    const pack = await buildV2SmsConversationContextPack({
      clerkUserId: "user_conv",
      commitmentId: "commit_1",
      commitment: minimalCommitment(),
      preloadedEventsNewestFirst: [],
      preloadedCoachingMemory: null,
    });

    expect(pack.recentTranscriptLines.some((line) => /without created_at column/i.test(line))).toBe(
      true
    );
  });

  it("preserves sms_send_events coach transcript lines", async () => {
    setupSupabaseForPack({
      inboundRows: [],
      sendRows: [
        {
          sms_body: "Daily coach line from send events table with enough text.",
          created_at: THREE_DAYS_AGO,
          metadata: {},
        },
      ],
      coachJobRows: [],
    });

    const pack = await buildV2SmsConversationContextPack({
      clerkUserId: "user_conv",
      commitmentId: "commit_1",
      commitment: minimalCommitment(),
      preloadedEventsNewestFirst: [],
      preloadedCoachingMemory: null,
    });

    expect(pack.recentTranscriptLines.some((line) => /^Coach:/i.test(line))).toBe(true);
    expect(
      pack.recentTranscriptLines.some((line) => /Daily coach line from send events/i.test(line))
    ).toBe(true);
  });

  it("preserves sms_inbound_coach_jobs reply transcript lines", async () => {
    setupSupabaseForPack({
      inboundRows: [],
      sendRows: [],
      coachJobRows: [
        {
          reply_body: "Coach reply from inbound coach job with enough body text.",
          sent_at: FOUR_DAYS_AGO,
          updated_at: FOUR_DAYS_AGO,
          created_at: FOUR_DAYS_AGO,
          status: "sent",
          outbound_message_sid: "SM_COACH_REPLY",
        },
      ],
    });

    const pack = await buildV2SmsConversationContextPack({
      clerkUserId: "user_conv",
      commitmentId: "commit_1",
      commitment: minimalCommitment(),
      preloadedEventsNewestFirst: [],
      preloadedCoachingMemory: null,
    });

    expect(pack.recentTranscriptLines.some((line) => /^Coach:/i.test(line))).toBe(true);
    expect(
      pack.recentTranscriptLines.some((line) => /Coach reply from inbound coach job/i.test(line))
    ).toBe(true);
  });

  it("does not import sms-recent-exact-thread-72h", () => {
    const src = fs.readFileSync(
      path.join(REPO, "src/lib/v2-sms-conversation-context.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/sms-recent-exact-thread-72h/);
  });
});
