import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const supabaseFrom = vi.hoisted(() => vi.fn());
const getRecentV2EventsForAi = vi.hoisted(() => vi.fn());
const getActiveCommitment = vi.hoisted(() => vi.fn());
const fetchLastAnyUserReplyAt = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: supabaseFrom },
}));

vi.mock("@/lib/v2-commitment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-commitment")>();
  return {
    ...actual,
    getActiveCommitment,
    getRecentV2EventsForAi,
  };
});

vi.mock("@/lib/sms-last-any-user-reply", () => ({
  fetchLastAnyUserReplyAt,
}));

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  assembleMorningBriefInterpreterInputFromPacket,
} from "@/lib/morning-tto-brief-canonical-load-v1";
import { ANSWERED_USER_MESSAGE_LINKS_INTERPRETER_LAW } from "@/lib/morning-tto-brief-interpreter-v1";
import { loadMorningRelationshipPacket } from "@/lib/morning-tto-relationship-packet";
import {
  answeredUserMessageLinkFromCoachJobRow,
  answeredUserMessageLinksFromCoachJobRows,
  buildMorningExactThreadForPacket,
  buildRecentExactThread72h,
} from "@/lib/sms-recent-exact-thread-72h";

const TZ = "America/Chicago";
const NOW = new Date("2026-06-22T15:30:00.000Z");
const REPO = process.cwd();

const BROOKE_QUESTION = "Did you set alarms at night?";
const BROOKE_ANSWER = "Absolutely!";

function chain(rows: unknown[] | unknown | null, error: { message: string } | null = null) {
  const result = { data: error ? null : rows, error };
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    is: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () =>
      Promise.resolve(
        Array.isArray(rows) ? { data: rows[0] ?? null, error } : { data: rows, error }
      ),
    then: (resolve: (v: typeof result) => void) => resolve(result),
  };
  return builder;
}

function sentJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    message_sid: "SM_Q2",
    raw_body: BROOKE_QUESTION,
    reply_body: BROOKE_ANSWER,
    outbound_message_sid: "SM_A2",
    sent_at: "2026-06-21T16:00:00.000Z",
    status: "sent",
    created_at: "2026-06-20T12:00:00.000Z",
    ...overrides,
  };
}

function setupThreadTables(args: {
  jobRows?: unknown[];
  sendRows?: unknown[];
  inboundMsgRows?: unknown[];
  weeklyRows?: unknown[];
}) {
  supabaseFrom.mockImplementation((table: string) => {
    switch (table) {
      case "sms_send_events":
        return chain(args.sendRows ?? []);
      case "sms_weekly_send_events":
        return chain(args.weeklyRows ?? []);
      case "sms_inbound_coach_jobs":
        return chain(args.jobRows ?? []);
      case "sms_inbound_messages":
        return chain(args.inboundMsgRows ?? []);
      case "sms_last_outbound_context":
        return chain(null);
      default:
        return chain([]);
    }
  });
}

function activeCommitment(): ActiveV2CommitmentRow {
  return {
    id: "cmt_morning",
    clerk_user_id: "user_morning",
    behavior_statement: "One hour of focused writing each morning",
    title: "Writing",
    accountability_phase: "active_accountability",
    started_at: "2026-01-01T12:00:00.000Z",
    refresh_session: null,
  } as ActiveV2CommitmentRow;
}

function setupPacketTables(args: { jobRows?: unknown[]; sendRows?: unknown[] }) {
  supabaseFrom.mockImplementation((table: string) => {
    switch (table) {
      case "user_profiles":
        return chain({ preferred_name: "Brooke" });
      case "important_people":
        return chain([]);
      case "v2_commitment": {
        const priorResult = { data: [], error: null };
        const builder = {
          select: () => builder,
          eq: () => builder,
          in: () => builder,
          is: () => builder,
          order: () => builder,
          limit: () => builder,
          maybeSingle: () => Promise.resolve({ data: activeCommitment(), error: null }),
          then: (resolve: (v: typeof priorResult) => void) => resolve(priorResult),
        };
        return builder;
      }
      case "sms_send_events":
        return chain(args.sendRows ?? []);
      case "sms_weekly_send_events":
        return chain([]);
      case "sms_inbound_coach_jobs":
        return chain(args.jobRows ?? []);
      case "sms_inbound_messages":
        return chain([]);
      case "sms_last_outbound_context":
        return chain(null);
      case "v2_durable_user_evidence":
        return chain([]);
      case "v2_win":
        return chain([]);
      default:
        return chain([]);
    }
  });
}

function extras() {
  return {
    importantPeople: [],
    outcomeSpine: {
      latestOutcome: null as const,
      latestOutcomeAt: null,
      latestOutcomeMessage: null,
      matchingOutcomeCount: 0,
      hasVerifiedProofMetadata: false as const,
    },
    threadMemoryHint: null,
  };
}

describe("answeredUserMessageLinkFromCoachJobRow", () => {
  it("maps a sent inbound job to exact SID/body/time fields", () => {
    const job = sentJob();
    const link = answeredUserMessageLinkFromCoachJobRow(job);
    expect(link).toEqual({
      inbound_message_sid: "SM_Q2",
      outbound_message_sid: "SM_A2",
      user_body: BROOKE_QUESTION,
      coach_body: BROOKE_ANSWER,
      answered_at: "2026-06-21T16:00:00.000Z",
    });
    expect(link?.user_body).toBe(job.raw_body);
    expect(link?.coach_body).toBe(job.reply_body);
  });

  it("preserves exact stored bodies including punctuation and does not rewrite", () => {
    const job = sentJob({
      raw_body: "Did you set alarms at night?",
      reply_body: "Absolutely!",
    });
    const link = answeredUserMessageLinkFromCoachJobRow(job);
    expect(link?.user_body).toBe("Did you set alarms at night?");
    expect(link?.coach_body).toBe("Absolutely!");
  });

  it("returns null for unsent draft awaiting_manual_pat_answer", () => {
    expect(
      answeredUserMessageLinkFromCoachJobRow(
        sentJob({
          status: "awaiting_manual_pat_answer",
          outbound_message_sid: null,
          sent_at: null,
          reply_body: BROOKE_ANSWER,
        })
      )
    ).toBeNull();
  });

  it("returns null for sending with no durable delivery evidence", () => {
    expect(
      answeredUserMessageLinkFromCoachJobRow(
        sentJob({
          status: "sending",
          outbound_message_sid: null,
          sent_at: null,
        })
      )
    ).toBeNull();
  });

  it("returns null for failed/reverted awaiting job", () => {
    expect(
      answeredUserMessageLinkFromCoachJobRow(
        sentJob({
          status: "awaiting_manual_pat_answer",
          outbound_message_sid: null,
          sent_at: null,
          last_error: "Send failed.",
          reply_body: BROOKE_ANSWER,
        })
      )
    ).toBeNull();
  });

  it("returns null for cancelled/STOP before send", () => {
    expect(
      answeredUserMessageLinkFromCoachJobRow(
        sentJob({
          status: "cancelled",
          outbound_message_sid: null,
          sent_at: null,
          last_error: "STOP",
          reply_body: null,
        })
      )
    ).toBeNull();
  });

  it("does not link by body equality — duplicate text stays SID-distinct", () => {
    const links = answeredUserMessageLinksFromCoachJobRows([
      sentJob({
        message_sid: "SM_1",
        raw_body: BROOKE_QUESTION,
        reply_body: BROOKE_ANSWER,
        outbound_message_sid: null,
        sent_at: null,
        status: "awaiting_manual_pat_answer",
      }),
      sentJob({
        message_sid: "SM_2",
        raw_body: BROOKE_QUESTION,
        reply_body: BROOKE_ANSWER,
        outbound_message_sid: "SM_A2",
        sent_at: "2026-06-21T16:00:00.000Z",
        status: "sent",
      }),
    ]);
    expect(links).toHaveLength(1);
    expect(links[0]?.inbound_message_sid).toBe("SM_2");
    expect(links.some((l) => l.inbound_message_sid === "SM_1")).toBe(false);
  });

  it("keeps two answered inbound jobs as two independent links", () => {
    const links = answeredUserMessageLinksFromCoachJobRows([
      sentJob({
        message_sid: "SM_Q1",
        raw_body: "Did you drink a lot of water every day?",
        reply_body: "Yes — constantly.",
        outbound_message_sid: "SM_A1",
        sent_at: "2026-06-20T16:00:00.000Z",
      }),
      sentJob({
        message_sid: "SM_Q2",
        sent_at: "2026-06-21T16:00:00.000Z",
      }),
    ]);
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.inbound_message_sid)).toEqual(["SM_Q1", "SM_Q2"]);
    expect(links[0]?.coach_body).toBe("Yes — constantly.");
    expect(links[1]?.coach_body).toBe(BROOKE_ANSWER);
  });

  it("links Q1 by SID after intervening conversation — no adjacency", () => {
    const links = answeredUserMessageLinksFromCoachJobRows([
      sentJob({
        message_sid: "SM_Q1",
        raw_body: "Q1 original",
        reply_body: "A1 later",
        outbound_message_sid: "SM_A1",
        sent_at: "2026-06-21T20:00:00.000Z",
        created_at: "2026-06-18T12:00:00.000Z",
      }),
    ]);
    expect(links).toEqual([
      {
        inbound_message_sid: "SM_Q1",
        outbound_message_sid: "SM_A1",
        user_body: "Q1 original",
        coach_body: "A1 later",
        answered_at: "2026-06-21T20:00:00.000Z",
      },
    ]);
  });

  it("works retroactively for already-sent historical rows with no feature marker", () => {
    const historical = {
      message_sid: "SM_Q2",
      raw_body: BROOKE_QUESTION,
      reply_body: BROOKE_ANSWER,
      outbound_message_sid: "SM_A2",
      sent_at: "2026-06-15T11:00:00.000Z",
      status: "sent",
    };
    expect(historical).not.toHaveProperty("created_after_linkage_feature");
    expect(answeredUserMessageLinkFromCoachJobRow(historical)?.inbound_message_sid).toBe("SM_Q2");
  });
});

describe("exact-thread + packet answered_user_message_links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecentV2EventsForAi.mockResolvedValue([]);
    getActiveCommitment.mockResolvedValue(activeCommitment());
    fetchLastAnyUserReplyAt.mockResolvedValue(null);
  });

  it("Brooke canary: sent job produces one SID-exact link in thread, packet, and interpreter input", async () => {
    const job = sentJob();
    setupThreadTables({ jobRows: [job] });

    const thread = await buildRecentExactThread72h({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      windowHours: 21 * 24,
      preserveUserBodyFormatting: true,
    });
    expect(thread.answered_user_message_links).toEqual([
      {
        inbound_message_sid: "SM_Q2",
        outbound_message_sid: "SM_A2",
        user_body: BROOKE_QUESTION,
        coach_body: BROOKE_ANSWER,
        answered_at: "2026-06-21T16:00:00.000Z",
      },
    ]);
    expect(thread.messages.some((m) => m.role === "user" && m.body === BROOKE_QUESTION)).toBe(
      true
    );
    expect(thread.messages.some((m) => m.role === "coach" && m.body === BROOKE_ANSWER)).toBe(
      true
    );
    const userIdx = thread.messages.findIndex(
      (m) => m.role === "user" && m.body === BROOKE_QUESTION
    );
    const coachIdx = thread.messages.findIndex(
      (m) => m.role === "coach" && m.body === BROOKE_ANSWER
    );
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(coachIdx).toBeGreaterThan(userIdx);

    setupPacketTables({ jobRows: [job] });
    const morning = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });
    expect(morning.ok).toBe(true);
    if (!morning.ok) return;
    expect(morning.packet.answered_user_message_links).toEqual([
      {
        inbound_message_sid: "SM_Q2",
        outbound_message_sid: "SM_A2",
        user_body: BROOKE_QUESTION,
        coach_body: BROOKE_ANSWER,
        answered_at: "2026-06-21T16:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(morning.packet.exact_thread.messages)).not.toContain("message_sid");
    expect(morning.packet.exact_thread.messages[0]).not.toHaveProperty("message_sid");
    expect(morning.packet.exact_thread.messages[0]).not.toHaveProperty(
      "reply_to_inbound_message_sid"
    );

    const input = assembleMorningBriefInterpreterInputFromPacket({
      packet: morning.packet,
      extras: extras(),
    });
    expect(input).not.toHaveProperty("ok");
    if ("ok" in input) throw new Error(input.error);
    expect(input.answered_user_message_links).toEqual(morning.packet.answered_user_message_links);
    expect(input.answered_user_message_links[0]?.inbound_message_sid).toBe("SM_Q2");
  });

  it("Evening uses the same Morning packet loader field", async () => {
    setupPacketTables({ jobRows: [sentJob()] });
    const evening = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
      daypart: "evening",
    });
    expect(evening.ok).toBe(true);
    if (!evening.ok) return;
    expect(evening.packet.message_for.daypart).toBe("evening");
    expect(evening.packet.answered_user_message_links).toEqual([
      {
        inbound_message_sid: "SM_Q2",
        outbound_message_sid: "SM_A2",
        user_body: BROOKE_QUESTION,
        coach_body: BROOKE_ANSWER,
        answered_at: "2026-06-21T16:00:00.000Z",
      },
    ]);
  });

  it("unsent draft produces no link and does not change exact-thread ordering of visible rows", async () => {
    setupThreadTables({
      jobRows: [
        sentJob({
          status: "awaiting_manual_pat_answer",
          outbound_message_sid: null,
          sent_at: null,
          reply_body: "Saved draft only",
        }),
      ],
      sendRows: [
        {
          sms_body: "How did writing go?",
          created_at: "2026-06-21T14:00:00.000Z",
          status: "sent",
          message_sid: "SM_DAILY",
          sent_at: "2026-06-21T14:00:00.000Z",
        },
      ],
    });
    const thread = await buildRecentExactThread72h({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      windowHours: 21 * 24,
    });
    expect(thread.answered_user_message_links).toEqual([]);
    expect(thread.messages.some((m) => /Saved draft only/.test(m.body))).toBe(false);
    const coachBodies = thread.messages.filter((m) => m.role === "coach").map((m) => m.body);
    expect(coachBodies).toEqual(["How did writing go?"]);
  });

  it("proactive sms_send_events never become answered-user links", async () => {
    setupThreadTables({
      sendRows: [
        {
          sms_body: BROOKE_ANSWER,
          created_at: "2026-06-21T16:00:00.000Z",
          status: "sent",
          message_sid: "SM_PROACTIVE",
          sent_at: "2026-06-21T16:00:00.000Z",
        },
      ],
      inboundMsgRows: [
        {
          raw_body: BROOKE_QUESTION,
          received_at: "2026-06-20T12:00:00.000Z",
          message_sid: "SM_Q2",
        },
      ],
    });
    const thread = await buildRecentExactThread72h({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      windowHours: 21 * 24,
    });
    expect(thread.answered_user_message_links).toEqual([]);
    expect(thread.messages.some((m) => m.message_sid === "SM_PROACTIVE")).toBe(true);
  });

  it("weekly send events never become answered-user links", async () => {
    setupThreadTables({
      weeklyRows: [
        {
          body: BROOKE_ANSWER,
          created_at: "2026-06-21T16:00:00.000Z",
          status: "sent",
          message_sid: "SM_WEEKLY",
          sent_at: "2026-06-21T16:00:00.000Z",
        },
      ],
    });
    const thread = await buildRecentExactThread72h({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      windowHours: 21 * 24,
    });
    expect(thread.answered_user_message_links).toEqual([]);
  });

  it("Morning packet projection still strips IDs from model-facing messages", async () => {
    setupThreadTables({ jobRows: [sentJob()] });
    const morning = await buildMorningExactThreadForPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      messageForLocalDate: "2026-06-22",
    });
    expect(morning.answered_user_message_links[0]?.inbound_message_sid).toBe("SM_Q2");
    for (const m of morning.messages) {
      expect(m).not.toHaveProperty("message_sid");
      expect(m).not.toHaveProperty("reply_to_inbound_message_sid");
      expect(Object.keys(m).sort()).toEqual(
        [
          "body",
          "day_relation_to_message",
          "local_day_key",
          "local_weekday",
          "sender",
          "sent_at_local",
          "sent_at_utc",
        ].sort()
      );
    }
  });
});

describe("protected surfaces and derivation constraints", () => {
  it("interpreter law is a short deterministic contract", () => {
    expect(ANSWERED_USER_MESSAGE_LINKS_INTERPRETER_LAW).toContain(
      "answered_user_message_links is deterministic relationship truth"
    );
    expect(ANSWERED_USER_MESSAGE_LINKS_INTERPRETER_LAW).toContain(
      "Do not treat a linked user message as an unanswered direct question"
    );
    expect(ANSWERED_USER_MESSAGE_LINKS_INTERPRETER_LAW).toContain("direct_question_or_need");
    expect(ANSWERED_USER_MESSAGE_LINKS_INTERPRETER_LAW).toContain("open_loop");
  });

  it("does not add OpenAI, body matching, or a new table", () => {
    const helper = readFileSync(join(REPO, "src/lib/sms-recent-exact-thread-72h.ts"), "utf8");
    const deriveStart = helper.indexOf("export function answeredUserMessageLinkFromCoachJobRow");
    const deriveEnd = helper.indexOf("export function coachJobReplyStrongDeliveryEvidence");
    const derive = helper.slice(deriveStart, deriveEnd);
    expect(derive).not.toContain("openai");
    expect(derive).not.toContain("toLowerCase");
    expect(derive).not.toContain("includes(");
    expect(derive).not.toContain("proximity");
    expect(derive).not.toContain("from(\"sms_answered");
    expect(derive).toContain("coachJobReplyStrongDeliveryEvidence");
  });

  it("does not change writer prompts, inbound interpreter/writer, or manual send", () => {
    const files = [
      "src/lib/morning-tto-writer.ts",
      "src/lib/weekly-tto-writer.ts",
      "src/lib/inbound-sol-writer.ts",
      "src/lib/inbound-sol-brief-interpreter.ts",
      "src/lib/admin-manual-pat-answers.ts",
      "src/lib/v2-commitment-sms-thread-memory.ts",
      "src/lib/has-awaiting-manual-pat-answer.ts",
    ];
    for (const rel of files) {
      const src = readFileSync(join(REPO, rel), "utf8");
      expect(src).not.toContain("answered_user_message_links");
      expect(src).not.toContain("ANSWERED USER MESSAGE LINKS");
    }
  });
});
