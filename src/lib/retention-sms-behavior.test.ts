import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  ANY_INBOUND_LABEL,
  COACHING_REPLY_LABEL,
  SMS_COACHING_GAP,
  SMS_COACHING_REPLY_GAP,
  SMS_INBOUND_GAP,
  smsBehaviorFromRows,
} from "@/lib/retention-sms-behavior";

const SENT_AT = "2026-10-01T13:05:00.000Z";
const REPLY_AT = "2026-10-01T15:00:00.000Z";
const STOP_AT = "2026-10-01T16:00:00.000Z";

describe("sms behavior facts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the send timestamp and keeps STOP out of coaching replies", () => {
    const result = smsBehaviorFromRows({
      weekly: [],
      sends: [
        {
          id: "send-1",
          clerk_user_id: "user_a",
          day_key: "2026-10-01",
          send_slot: "morning",
          message_sid: "SM1",
          status: "sent",
          created_at: "2026-10-01T14:00:00.000Z",
          metadata: { sent_at: SENT_AT },
        },
        {
          id: "send-failed",
          clerk_user_id: "user_a",
          day_key: "2026-10-01",
          send_slot: "morning",
          message_sid: "SM_FAIL",
          status: "failed",
          created_at: "2026-10-01T13:00:00.000Z",
          metadata: { sent_at: "2026-10-01T13:00:00.000Z" },
        },
      ],
      inbound: [
        { clerk_user_id: "user_a", received_at: REPLY_AT, raw_body: "yes" },
        { clerk_user_id: "user_a", received_at: STOP_AT, raw_body: "STOP" },
        { clerk_user_id: "user_b", received_at: "2026-10-01T12:00:00.000Z", raw_body: "hello" },
      ],
    });

    expect(result.gaps).toEqual([]);
    expect(result.signals.map((signal) => signal.label)).toContain(COACHING_REPLY_LABEL);
    expect(result.signals.map((signal) => signal.label)).toContain(ANY_INBOUND_LABEL);
    const coaching = result.hits.filter((hit) => hit.signal === "coaching");
    expect(coaching).toEqual([{ clerkUserId: "user_a", atMs: Date.parse(SENT_AT), signal: "coaching" }]);
    expect(coaching[0]?.atMs).not.toBe(Date.parse("2026-10-01T12:00:00.000Z"));
    const replies = result.hits.filter((hit) => hit.signal === "coaching_reply");
    expect(replies).toEqual([
      { clerkUserId: "user_a", atMs: Date.parse(REPLY_AT), signal: "coaching_reply" },
    ]);
    const inbound = result.hits.filter((hit) => hit.signal === "reply").map((hit) => hit.clerkUserId);
    expect(inbound).toEqual(["user_a", "user_a", "user_b"]);
    expect(JSON.stringify(result.hits)).not.toContain("yes");
    expect(JSON.stringify(result.hits)).not.toContain("STOP");
    expect(JSON.stringify(result.hits)).not.toContain("hello");
  });

  it("names a failed read instead of turning it into zero replies", () => {
    const result = smsBehaviorFromRows({
      sends: null,
      inbound: [
        { clerk_user_id: "user_a", received_at: REPLY_AT, raw_body: "yes" },
      ],
      weekly: [],
    });
    expect(result.gaps).toEqual([SMS_COACHING_GAP, SMS_COACHING_REPLY_GAP]);
    expect(result.signals.map((signal) => signal.id)).not.toContain("coaching");
    expect(result.signals.map((signal) => signal.id)).not.toContain("coaching_reply");
    expect(result.hits.filter((hit) => hit.signal === "coaching_reply")).toEqual([]);
    expect(result.hits.filter((hit) => hit.signal === "reply")).toHaveLength(1);
  });

  it("does not attribute replies when the weekly boundary read fails", () => {
    const result = smsBehaviorFromRows({
      sends: [
        {
          id: "send-1",
          clerk_user_id: "user_a",
          send_slot: "morning",
          message_sid: "SM1",
          status: "sent",
          created_at: SENT_AT,
          metadata: { sent_at: SENT_AT },
        },
      ],
      inbound: null,
      weekly: null,
    });
    expect(result.gaps).toContain(SMS_INBOUND_GAP);
    expect(result.gaps).toContain(SMS_COACHING_REPLY_GAP);
    expect(result.hits.filter((hit) => hit.signal === "coaching_reply")).toEqual([]);
    expect(result.hits.filter((hit) => hit.signal === "reply")).toEqual([]);
    expect(result.hits.filter((hit) => hit.signal === "coaching")).toHaveLength(1);
  });
});
