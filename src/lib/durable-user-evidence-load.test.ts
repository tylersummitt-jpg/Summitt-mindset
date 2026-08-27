import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from },
}));

import {
  applyDurableUserEvidenceSafetyCeiling,
  fetchActiveDurableUserEvidenceRows,
  projectDurableUserEvidenceItems,
  type DurableUserEvidenceRow,
} from "@/lib/durable-user-evidence-load";

function row(
  overrides: Partial<DurableUserEvidenceRow> & Pick<DurableUserEvidenceRow, "id">
): DurableUserEvidenceRow {
  const n = Number.parseInt(overrides.id.replace(/\D/g, "") || "0", 10);
  return {
    occurred_at: `2026-01-${String((n % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
    source_message_sid: `SM${overrides.id}`,
    exact_user_evidence: `quote ${overrides.id}`,
    created_at: `2026-01-${String((n % 28) + 1).padStart(2, "0")}T12:00:01.000Z`,
    ...overrides,
  };
}

describe("durable user evidence load policy", () => {
  it("<=40 rows all load", () => {
    const rows = Array.from({ length: 40 }, (_, i) => row({ id: String(i) }));
    expect(applyDurableUserEvidenceSafetyCeiling(rows)).toHaveLength(40);
  });

  it(">40 keeps oldest 8 + newest 32 in chronological order", () => {
    const rows = Array.from({ length: 50 }, (_, i) => row({ id: String(i) }));
    const selected = applyDurableUserEvidenceSafetyCeiling(rows);
    expect(selected).toHaveLength(40);
    expect(selected.slice(0, 8).map((r) => r.id)).toEqual(
      ["0", "1", "2", "3", "4", "5", "6", "7"]
    );
    expect(selected.slice(-32).map((r) => r.id)).toEqual(
      Array.from({ length: 32 }, (_, i) => String(i + 18))
    );
  });

  it("omits evidence already in actual surviving exact-thread SIDs", () => {
    const items = projectDurableUserEvidenceItems({
      rows: [
        row({
          id: "in",
          source_message_sid: "SMinthread",
          exact_user_evidence: "already in thread",
          occurred_at: "2026-08-01T12:00:00.000Z",
        }),
        row({
          id: "out",
          source_message_sid: "SMfallen",
          exact_user_evidence: "I like when you challenge me directly.",
          occurred_at: "2026-08-10T12:00:00.000Z",
        }),
      ],
      timezone: "America/Chicago",
      survivingExactThreadMessageSids: ["SMinthread"],
    });
    expect(items).toEqual([
      {
        source: "user_message",
        occurred_at: "2026-08-10",
        evidence: "I like when you challenge me directly.",
        user_quote: "I like when you challenge me directly.",
      },
    ]);
  });

  it("loads evidence younger than 21 days when it is not in the surviving SID set", () => {
    const items = projectDurableUserEvidenceItems({
      rows: [
        row({
          id: "recent",
          source_message_sid: "SMrecent",
          exact_user_evidence: "Don't sugarcoat it.",
          occurred_at: "2026-08-20T15:00:00.000Z",
        }),
      ],
      timezone: "America/Chicago",
      survivingExactThreadMessageSids: [],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.evidence).toBe("Don't sugarcoat it.");
  });

  it("uses user timezone for YYYY-MM-DD, not UTC calendar date", () => {
    const items = projectDurableUserEvidenceItems({
      rows: [
        row({
          id: "late",
          source_message_sid: "SMlate",
          exact_user_evidence: "Being present with my kids matters more.",
          occurred_at: "2026-08-19T04:30:00.000Z",
        }),
      ],
      timezone: "America/Chicago",
      survivingExactThreadMessageSids: [],
    });
    expect(items[0]?.occurred_at).toBe("2026-08-18");
  });

  it("duplicates evidence and user_quote for user_message items", () => {
    const items = projectDurableUserEvidenceItems({
      rows: [
        row({
          id: "q",
          source_message_sid: "SMq",
          exact_user_evidence: "Don't sugarcoat it.",
          occurred_at: "2026-08-18T16:00:00.000Z",
        }),
      ],
      timezone: "America/Chicago",
      survivingExactThreadMessageSids: [],
    });
    expect(items[0]?.source).toBe("user_message");
    expect(items[0]?.evidence).toBe(items[0]?.user_quote);
  });
});

describe("fetchActiveDurableUserEvidenceRows", () => {
  beforeEach(() => {
    from.mockReset();
  });

  it("queries active rows only and fail-softs on error", async () => {
    const eq = vi.fn(() => builder);
    const order = vi.fn(() => builder);
    const builder = {
      select: () => builder,
      eq,
      order,
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: [], error: null }),
    };
    from.mockReturnValue(builder);
    await fetchActiveDurableUserEvidenceRows("user_1");
    expect(from).toHaveBeenCalledWith("v2_durable_user_evidence");
    expect(eq).toHaveBeenCalledWith("clerk_user_id", "user_1");
    expect(eq).toHaveBeenCalledWith("status", "active");
    expect(eq).not.toHaveBeenCalledWith("status", "hidden");
  });
});
