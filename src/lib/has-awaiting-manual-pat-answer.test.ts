import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  jobs: [] as Array<{
    message_sid: string;
    clerk_user_id: string;
    status: string;
  }>,
  lookupError: null as { message: string } | null,
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return builder;
        },
        limit: () => builder,
        maybeSingle: async () => {
          if (db.lookupError) {
            return { data: null, error: db.lookupError };
          }
          if (table !== "sms_inbound_coach_jobs") {
            return { data: null, error: null };
          }
          const rows = db.jobs.filter((j) => {
            if (
              typeof filters.clerk_user_id === "string" &&
              j.clerk_user_id !== filters.clerk_user_id
            ) {
              return false;
            }
            if (typeof filters.status === "string" && j.status !== filters.status) {
              return false;
            }
            return true;
          });
          return { data: rows[0] ?? null, error: null };
        },
      };
      return builder;
    },
  },
}));

import {
  AWAITING_MANUAL_PAT_ANSWER_SKIP_REASON,
  AWAITING_MANUAL_PAT_ANSWER_STATUS,
  hasAwaitingManualPatAnswer,
} from "@/lib/has-awaiting-manual-pat-answer";

describe("hasAwaitingManualPatAnswer", () => {
  beforeEach(() => {
    db.jobs = [];
    db.lookupError = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when none pending", async () => {
    expect(await hasAwaitingManualPatAnswer("user_brooke")).toBe(false);
  });

  it("returns true when a job is awaiting_manual_pat_answer", async () => {
    db.jobs.push({
      message_sid: "SMpark1",
      clerk_user_id: "user_brooke",
      status: "awaiting_manual_pat_answer",
    });
    expect(await hasAwaitingManualPatAnswer("user_brooke")).toBe(true);
  });

  it("ignores sent and cancelled jobs", async () => {
    db.jobs.push(
      {
        message_sid: "SMsent",
        clerk_user_id: "user_brooke",
        status: "sent",
      },
      {
        message_sid: "SMcancel",
        clerk_user_id: "user_brooke",
        status: "cancelled",
      }
    );
    expect(await hasAwaitingManualPatAnswer("user_brooke")).toBe(false);
  });

  it("stays true while a second pending job remains after one is answered", async () => {
    db.jobs.push(
      {
        message_sid: "SMdone",
        clerk_user_id: "user_brooke",
        status: "sent",
      },
      {
        message_sid: "SMstill",
        clerk_user_id: "user_brooke",
        status: "awaiting_manual_pat_answer",
      }
    );
    expect(await hasAwaitingManualPatAnswer("user_brooke")).toBe(true);
  });

  it("returns false only after zero awaiting jobs remain", async () => {
    db.jobs.push(
      {
        message_sid: "SMa",
        clerk_user_id: "user_brooke",
        status: "sent",
      },
      {
        message_sid: "SMb",
        clerk_user_id: "user_brooke",
        status: "cancelled",
      }
    );
    expect(await hasAwaitingManualPatAnswer("user_brooke")).toBe(false);
  });

  it("does not treat another user's pending job as this user's", async () => {
    db.jobs.push({
      message_sid: "SMother",
      clerk_user_id: "user_other",
      status: "awaiting_manual_pat_answer",
    });
    expect(await hasAwaitingManualPatAnswer("user_brooke")).toBe(false);
  });

  it("fail-closes on lookup error", async () => {
    db.lookupError = { message: "db_down" };
    expect(await hasAwaitingManualPatAnswer("user_brooke")).toBe(true);
  });

  it("empty clerk id is false", async () => {
    expect(await hasAwaitingManualPatAnswer("  ")).toBe(false);
  });

  it("exports the skip reason used by M/E/W logs", () => {
    expect(AWAITING_MANUAL_PAT_ANSWER_STATUS).toBe("awaiting_manual_pat_answer");
    expect(AWAITING_MANUAL_PAT_ANSWER_SKIP_REASON).toBe("awaiting_manual_pat_answer");
  });
});
