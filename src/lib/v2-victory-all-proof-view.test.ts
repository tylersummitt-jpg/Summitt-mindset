import { describe, expect, it, vi, beforeEach } from "vitest";

const { fromMock, state } = vi.hoisted(() => {
  const state = {
    pageResult: { data: [] as unknown[], error: null as null | { message: string } },
    lastEq: [] as Array<[string, string]>,
    lastLimit: null as number | null,
  };
  return { fromMock: vi.fn(), state };
});

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: fromMock,
  },
}));

import { PUBLIC_WINS_PAGE_LIMIT } from "@/lib/v2-win-public-read";
import { loadVictoryAllProofView } from "@/lib/v2-victory-all-proof-view";

describe("loadVictoryAllProofView (v2_win)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.lastEq = [];
    state.lastLimit = null;
    state.pageResult = {
      data: [
        {
          id: "e1",
          occurred_at: "2026-06-10T12:00:00Z",
          display_title: "Win A",
          display_body: "Body A",
          supporting_quote: null,
          sensitivity_caution: false,
          celebration_appropriate: true,
          commitment_id: null,
          status: "active",
        },
        {
          id: "e2",
          occurred_at: "2026-05-01T12:00:00Z",
          display_title: "Win B",
          display_body: "Body B",
          supporting_quote: "quote",
          sensitivity_caution: false,
          celebration_appropriate: true,
          commitment_id: "c1",
          status: "active",
        },
      ],
      error: null,
    };

    fromMock.mockImplementation((table: string) => {
      expect(table).toBe("v2_win");
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (col: string, val: string) => {
        state.lastEq.push([col, val]);
        return chain;
      };
      chain.order = () => chain;
      chain.limit = (n: number) => {
        state.lastLimit = n;
        return chain;
      };
      chain.or = () => chain;
      chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(state.pageResult).then(resolve, reject);
      return chain;
    });
  });

  it("loads account-scoped active Wins from v2_win, not commitment events", async () => {
    const view = await loadVictoryAllProofView("user_1");
    expect(view.wins.map((w) => w.id)).toEqual(["e1", "e2"]);
    expect(view.wins[0]?.commitmentId).toBeNull();
    expect(view.wins[1]?.commitmentId).toBe("c1");
    expect(view.hasMore).toBe(false);
    expect(state.lastEq).toEqual(
      expect.arrayContaining([
        ["clerk_user_id", "user_1"],
        ["status", "active"],
      ])
    );
    expect(state.lastLimit).toBe(PUBLIC_WINS_PAGE_LIMIT + 1);
    expect(fromMock).not.toHaveBeenCalledWith("v2_commitment_event");
    expect(fromMock).not.toHaveBeenCalledWith("v2_commitment");
  });
});
