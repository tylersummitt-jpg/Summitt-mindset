import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

const { fromMock, state } = vi.hoisted(() => {
  const state = {
    pageResult: { data: [] as unknown[], error: null as { message: string } | null },
    lastEqCalls: [] as Array<[string, string]>,
    lastOrders: [] as Array<{ col: string; ascending: boolean }>,
    lastLimit: null as number | null,
    lastSelect: null as string | null,
    lastTable: null as string | null,
  };
  const fromMock = vi.fn();
  return { fromMock, state };
});

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: fromMock,
  },
}));

import {
  loadActiveWinsForSeasonCommitment,
  SEASON_WINS_DISPLAY_LIMIT,
} from "@/lib/v2-victory-season-wins";
import { PUBLIC_WIN_SELECT_COLUMNS } from "@/lib/v2-win-public-read";

function winRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    occurred_at: "2026-08-08T12:00:00.000Z",
    display_title: "Done",
    display_body: "Done",
    supporting_quote: null,
    sensitivity_caution: false,
    celebration_appropriate: false,
    commitment_id: "c-season-2",
    status: "active",
    updated_at: "2026-08-08T12:05:00.000Z",
    ...overrides,
  };
}

function installFromMock() {
  fromMock.mockImplementation((table: string) => {
    state.lastTable = table;
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn((cols: string) => {
      state.lastSelect = cols;
      return chain;
    });
    chain.eq = vi.fn((col: string, val: string) => {
      state.lastEqCalls.push([col, val]);
      return chain;
    });
    chain.order = vi.fn((col: string, opts?: { ascending?: boolean }) => {
      state.lastOrders.push({ col, ascending: opts?.ascending !== false });
      return chain;
    });
    chain.limit = vi.fn((n: number) => {
      state.lastLimit = n;
      return Promise.resolve(state.pageResult);
    });
    return chain;
  });
}

describe("loadActiveWinsForSeasonCommitment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.pageResult = { data: [], error: null };
    state.lastEqCalls = [];
    state.lastOrders = [];
    state.lastLimit = null;
    state.lastSelect = null;
    state.lastTable = null;
    installFromMock();
  });

  it("loads active manual and sms_inbound Wins for matching commitment", async () => {
    state.pageResult = {
      data: [
        winRow({
          id: "manual-1",
          display_title: "Done",
          display_body: "Done",
          celebration_appropriate: false,
          supporting_quote: null,
        }),
        winRow({
          id: "sms-1",
          occurred_at: "2026-08-07T12:00:00.000Z",
          display_title: "Showed up",
          display_body: "You kept the goal.",
          celebration_appropriate: true,
          supporting_quote: "got it done",
        }),
      ],
      error: null,
    };

    const wins = await loadActiveWinsForSeasonCommitment({
      clerkUserId: "user_1",
      commitmentId: "c-season-2",
    });

    expect(state.lastTable).toBe("v2_win");
    expect(state.lastSelect).toBe(PUBLIC_WIN_SELECT_COLUMNS);
    expect(state.lastEqCalls).toEqual([
      ["clerk_user_id", "user_1"],
      ["commitment_id", "c-season-2"],
      ["status", "active"],
    ]);
    expect(state.lastOrders).toEqual([
      { col: "occurred_at", ascending: false },
      { col: "id", ascending: false },
    ]);
    expect(state.lastLimit).toBe(SEASON_WINS_DISPLAY_LIMIT);
    expect(wins).toHaveLength(2);
    expect(wins[0]?.id).toBe("manual-1");
    expect(wins[0]?.displayTitle).toBe("Done");
    expect(wins[1]?.id).toBe("sms-1");
  });

  it("scopes by clerk + commitment + active only; no provenance filters", async () => {
    await loadActiveWinsForSeasonCommitment({
      clerkUserId: "user_1",
      commitmentId: "c-season-2",
    });
    const eqCols = state.lastEqCalls.map(([c]) => c);
    expect(eqCols).toEqual(["clerk_user_id", "commitment_id", "status"]);
    expect(eqCols).not.toContain("source_type");
    expect(eqCols).not.toContain("recognition_mode");
    expect(eqCols).not.toContain("relationship_type");
    expect(eqCols).not.toContain("source_message_sid");
    expect(eqCols).not.toContain("source_event_id");
    expect(eqCols).not.toContain("candidate_ordinal");
  });

  it("returns empty for blank clerk or commitment", async () => {
    expect(
      await loadActiveWinsForSeasonCommitment({ clerkUserId: "", commitmentId: "c1" })
    ).toEqual([]);
    expect(
      await loadActiveWinsForSeasonCommitment({ clerkUserId: "u1", commitmentId: "  " })
    ).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("does not date-window filter (no started_at/ended_at/gte/lte)", async () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-victory-season-wins.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/started_at|ended_at|\.gte\(|\.lte\(|\.gt\(|\.lt\(/);
    await loadActiveWinsForSeasonCommitment({
      clerkUserId: "user_1",
      commitmentId: "c-season-2",
    });
    expect(state.lastEqCalls.map(([c]) => c)).not.toContain("occurred_at");
  });

  it("maps rows through public Win mapper (quote rules preserved)", async () => {
    state.pageResult = {
      data: [
        winRow({
          celebration_appropriate: false,
          supporting_quote: "should not show",
        }),
      ],
      error: null,
    };
    const wins = await loadActiveWinsForSeasonCommitment({
      clerkUserId: "user_1",
      commitmentId: "c-season-2",
    });
    expect(wins[0]?.supportingQuote).toBeNull();
    expect(wins[0]?.celebrationAppropriate).toBe(false);
  });

  it("caps limit at SEASON_WINS_DISPLAY_LIMIT", async () => {
    await loadActiveWinsForSeasonCommitment({
      clerkUserId: "user_1",
      commitmentId: "c-season-2",
      limit: 999,
    });
    expect(state.lastLimit).toBe(SEASON_WINS_DISPLAY_LIMIT);
  });

  it("source file has no OpenAI and no date membership law", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-victory-season-wins.ts"),
      "utf8"
    );
    expect(src).toContain('eq("clerk_user_id"');
    expect(src).toContain('eq("commitment_id"');
    expect(src).toContain('eq("status", "active")');
    expect(src).not.toContain("openai");
    expect(src).not.toContain("source_type");
    expect(src).not.toContain("recognition_mode");
  });
});
