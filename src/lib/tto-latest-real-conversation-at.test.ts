import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFrom = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: supabaseFrom },
}));

import {
  isExactComplianceCommandBody,
  readLatestRealConversationAt,
  realConversationIsNewerThanAuthority,
} from "@/lib/tto-latest-real-conversation-at";

const tables: Record<string, { data: unknown[]; error: { message: string } | null }> = {};

function install() {
  supabaseFrom.mockImplementation((table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => Promise.resolve(tables[table] ?? { data: [], error: null }),
    };
    return chain;
  });
}

describe("latest real conversation clock", () => {
  beforeEach(() => {
    tables.sms_inbound_messages = { data: [], error: null };
    tables.sms_inbound_coach_jobs = { data: [], error: null };
    tables.sms_send_events = { data: [], error: null };
    tables.sms_weekly_send_events = { data: [], error: null };
    install();
  });

  it("uses member text and ignores exact command rows and empty media rows", async () => {
    tables.sms_inbound_messages = {
      data: [
        { received_at: "2026-09-08T18:00:00.000Z", raw_body: "STOP" },
        { received_at: "2026-09-08T17:00:00.000Z", raw_body: "START" },
        { received_at: "2026-09-08T16:00:00.000Z", raw_body: "HELP" },
        { received_at: "2026-09-08T15:00:00.000Z", raw_body: "INFO" },
        { received_at: "2026-09-08T14:00:00.000Z", raw_body: "  " },
        { received_at: "2026-09-08T12:00:00.000Z", raw_body: "Thanks" },
      ],
      error: null,
    };
    const result = await readLatestRealConversationAt("user_1");
    expect(result).toEqual({ ok: true, at: "2026-09-08T12:00:00.000Z" });
  });

  it("counts a sent Coach reply and ignores an unsent reply draft", async () => {
    tables.sms_inbound_coach_jobs = {
      data: [
        {
          reply_body: "Draft only",
          status: "pending",
          updated_at: "2026-09-08T18:00:00.000Z",
          created_at: "2026-09-08T11:00:00.000Z",
        },
        {
          reply_body: "Sent answer",
          status: "sent",
          outbound_message_sid: "SM_coach",
          sent_at: "2026-09-08T13:00:00.000Z",
          created_at: "2026-09-08T12:00:00.000Z",
          updated_at: "2026-09-08T19:00:00.000Z",
        },
      ],
      error: null,
    };
    const result = await readLatestRealConversationAt("user_1");
    expect(result).toEqual({ ok: true, at: "2026-09-08T13:00:00.000Z" });
  });

  it("counts a proven Morning send and ignores a reservation", async () => {
    tables.sms_send_events = {
      data: [
        {
          status: "reserved",
          created_at: "2026-09-08T18:00:00.000Z",
          updated_at: "2026-09-08T18:30:00.000Z",
          sms_body: "Not sent yet",
        },
        {
          status: "sent",
          message_sid: "SM_morning",
          created_at: "2026-09-08T10:00:00.000Z",
          updated_at: "2026-09-08T20:00:00.000Z",
          metadata: { sent_at: "2026-09-08T10:05:00.000Z" },
          sms_body: "Good morning",
        },
      ],
      error: null,
    };
    const result = await readLatestRealConversationAt("user_1");
    expect(result).toEqual({ ok: true, at: "2026-09-08T10:05:00.000Z" });
  });

  it("fails closed when a read errors", async () => {
    tables.sms_weekly_send_events = { data: [], error: { message: "weekly_down" } };
    const result = await readLatestRealConversationAt("user_1");
    expect(result.ok).toBe(false);
  });

  it("treats a missing authority as not fresh when a conversation exists", () => {
    expect(
      realConversationIsNewerThanAuthority("2026-09-08T12:00:00.000Z", null)
    ).toBe(true);
    expect(realConversationIsNewerThanAuthority(null, "2026-09-08T12:00:00.000Z")).toBe(false);
    expect(
      realConversationIsNewerThanAuthority(
        "2026-09-08T12:00:00.000Z",
        "2026-09-08T12:00:00.000Z"
      )
    ).toBe(false);
  });

  it("recognizes the exact compliance commands", () => {
    for (const word of ["stop", "START", "unstop", "Help", "info", "CANCEL", "end"]) {
      expect(isExactComplianceCommandBody(word)).toBe(true);
    }
    expect(isExactComplianceCommandBody("stop please")).toBe(false);
    expect(isExactComplianceCommandBody("Thanks")).toBe(false);
  });
});
