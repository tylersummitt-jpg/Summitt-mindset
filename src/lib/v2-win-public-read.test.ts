import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, state } = vi.hoisted(() => {
  const state = {
    countResult: { count: 0, error: null as { message: string } | null },
    pageResult: { data: [] as unknown[], error: null as { message: string } | null },
    lastEqCalls: [] as Array<[string, string]>,
    lastSelects: [] as string[],
    lastOrders: [] as Array<{ col: string; ascending: boolean }>,
    lastLimit: null as number | null,
    lastOr: null as string | null,
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
  PUBLIC_WIN_SELECT_COLUMNS,
  PUBLIC_WINS_PAGE_LIMIT,
  PUBLIC_WINS_RECENT_LIMIT,
  buildPublicWinsOlderThanOrFilter,
  decodePublicWinsCursor,
  encodePublicWinsCursor,
  loadPublicAllWinsForUser,
  loadPublicVictoryWinsForUser,
  mapV2WinRowToPublicDto,
  quotePostgrestFilterValue,
  sanitizePublicWinSupportingQuote,
} from "@/lib/v2-win-public-read";

function winRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    occurred_at: "2026-08-01T12:00:00.000Z",
    display_title: "Showed up",
    display_body: "You did the hard thing.",
    supporting_quote: "I got it done",
    sensitivity_caution: false,
    celebration_appropriate: true,
    commitment_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    status: "active",
    updated_at: "2026-08-01T12:05:00.000Z",
    ...overrides,
  };
}

function installFromMock() {
  fromMock.mockImplementation((table: string) => {
    expect(table).toBe("v2_win");
    const chain: Record<string, unknown> & { __isCount?: boolean } = {};

    chain.select = vi.fn((cols: string, opts?: { count?: string; head?: boolean }) => {
      state.lastSelects.push(cols);
      chain.__isCount = Boolean(opts?.head);
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
      return chain;
    });
    chain.or = vi.fn((filter: string) => {
      state.lastOr = filter;
      return chain;
    });
    // thenable for await query — per-chain head flag avoids Promise.all races
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      const result = chain.__isCount ? state.countResult : state.pageResult;
      return Promise.resolve(result).then(resolve, reject);
    };

    return chain;
  });
}

describe("sanitizePublicWinSupportingQuote", () => {
  it("omits blank, sensitive, and non-celebratory quotes", () => {
    expect(
      sanitizePublicWinSupportingQuote({
        supportingQuote: "  ",
        sensitivityCaution: false,
        celebrationAppropriate: true,
      })
    ).toBeNull();
    expect(
      sanitizePublicWinSupportingQuote({
        supportingQuote: "ok",
        sensitivityCaution: true,
        celebrationAppropriate: true,
      })
    ).toBeNull();
    expect(
      sanitizePublicWinSupportingQuote({
        supportingQuote: "ok",
        sensitivityCaution: false,
        celebrationAppropriate: false,
      })
    ).toBeNull();
    expect(
      sanitizePublicWinSupportingQuote({
        supportingQuote: "  I did it  ",
        sensitivityCaution: false,
        celebrationAppropriate: true,
      })
    ).toBe("I did it");
  });
});

describe("mapV2WinRowToPublicDto", () => {
  it("maps approved fields and omits sensitive quote", () => {
    const dto = mapV2WinRowToPublicDto(
      winRow({
        sensitivity_caution: true,
        supporting_quote: "private",
        commitment_id: null,
      }) as never
    );
    expect(dto).toEqual({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      occurredAt: "2026-08-01T12:00:00.000Z",
      displayTitle: "Showed up",
      displayBody: "You did the hard thing.",
      supportingQuote: null,
      celebrationAppropriate: true,
      commitmentId: null,
      updatedAt: "2026-08-01T12:05:00.000Z",
    });
    expect(dto).not.toHaveProperty("model_confidence");
    expect(dto).not.toHaveProperty("idempotency_key");
    expect(dto).not.toHaveProperty("source_message_sid");
    expect(dto).not.toHaveProperty("hidden_reason");
    expect(PUBLIC_WIN_SELECT_COLUMNS).toContain("updated_at");
    expect(PUBLIC_WIN_SELECT_COLUMNS).not.toContain("source_message");
    expect(PUBLIC_WIN_SELECT_COLUMNS).not.toContain("hidden_reason");
  });

  it("includes whole-life and commitment-linked rows", () => {
    expect(mapV2WinRowToPublicDto(winRow({ commitment_id: null }) as never).commitmentId).toBeNull();
    expect(
      mapV2WinRowToPublicDto(winRow({ commitment_id: "c1" }) as never).commitmentId
    ).toBe("c1");
  });
});

describe("quotePostgrestFilterValue", () => {
  it("double-quotes values and escapes quotes and backslashes", () => {
    expect(quotePostgrestFilterValue("plain")).toBe('"plain"');
    expect(quotePostgrestFilterValue('say "hi"')).toBe('"say \\"hi\\""');
    expect(quotePostgrestFilterValue("a\\b")).toBe('"a\\\\b"');
  });
});

describe("public wins cursor helpers", () => {
  it("round-trips cursor encoding", () => {
    const raw = encodePublicWinsCursor({
      occurredAt: "2026-08-01T12:00:00.000Z",
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });
    expect(decodePublicWinsCursor(raw)).toEqual({
      occurredAt: "2026-08-01T12:00:00.000Z",
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });
    expect(decodePublicWinsCursor("not-valid")).toBeNull();
    expect(decodePublicWinsCursor("")).toBeNull();
    expect(decodePublicWinsCursor(undefined)).toBeNull();
  });

  it("builds older-than or filter with double-quoted ISO timestamp and UUID", () => {
    const occurredAt = "2026-08-01T12:00:00.000Z";
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const filter = buildPublicWinsOlderThanOrFilter({ occurredAt, id });

    expect(filter).toBe(
      `occurred_at.lt."${occurredAt}",and(occurred_at.eq."${occurredAt}",id.lt."${id}")`
    );
    expect(filter).toContain(`occurred_at.lt."${occurredAt}"`);
    expect(filter).toContain(`occurred_at.eq."${occurredAt}"`);
    expect(filter).toContain(`id.lt."${id}"`);
    // Unquoted embedding must not appear (reserved . / : in ISO).
    expect(filter).not.toContain(`occurred_at.lt.${occurredAt},`);
  });

  it("preserves milliseconds and +00:00 offset without stripping reserved characters", () => {
    const occurredAt = "2026-08-01T12:00:00.123+00:00";
    const id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const filter = buildPublicWinsOlderThanOrFilter({ occurredAt, id });
    expect(filter).toContain(`"${occurredAt}"`);
    expect(filter).toContain(".123+00:00");
    expect(filter).not.toMatch(/occurred_at\.lt\.[^"]/);
  });

  it("uses id.lt as secondary boundary for equal timestamps (tuple logic)", () => {
    const occurredAt = "2026-08-01T12:00:00.000Z";
    const id = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const filter = buildPublicWinsOlderThanOrFilter({ occurredAt, id });
    expect(filter).toMatch(
      /^occurred_at\.lt\."[^"]+",and\(occurred_at\.eq\."[^"]+",id\.lt\."[^"]+"\)$/
    );
    expect(filter).toContain(`and(occurred_at.eq."${occurredAt}",id.lt."${id}")`);
  });

  it("escapes quote and backslash characters in filter values", () => {
    const occurredAt = '2026-08-01T12:00:00.000Z"evil';
    const id = 'id-with\\"slash'; // characters: id-with \ " slash
    const filter = buildPublicWinsOlderThanOrFilter({ occurredAt, id });
    expect(filter).toContain(`occurred_at.lt.${quotePostgrestFilterValue(occurredAt)}`);
    expect(filter).toContain(`id.lt.${quotePostgrestFilterValue(id)}`);
    expect(quotePostgrestFilterValue(occurredAt)).toBe('"2026-08-01T12:00:00.000Z\\"evil"');
    expect(quotePostgrestFilterValue(id)).toBe('"id-with\\\\\\"slash"');
  });
});

describe("loadPublicVictoryWinsForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.lastEqCalls = [];
    state.lastOrders = [];
    state.lastLimit = null;
    state.lastOr = null;
    state.lastSelects = [];
    state.countResult = { count: 2, error: null };
    state.pageResult = {
      data: [
        winRow({
          id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
          occurred_at: "2026-08-02T12:00:00.000Z",
          commitment_id: null,
          display_title: "Whole life",
        }),
        winRow({
          id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
          occurred_at: "2026-08-01T12:00:00.000Z",
          display_title: "Goal linked",
        }),
      ],
      error: null,
    };
    installFromMock();
  });

  it("requires clerk user id", async () => {
    await expect(loadPublicVictoryWinsForUser({ clerkUserId: "  " })).rejects.toThrow(
      /v2_win_public_read_requires_clerk_user_id/
    );
  });

  it("filters by clerk_user_id and active status, bounds recent to 7, parallel count", async () => {
    const result = await loadPublicVictoryWinsForUser({
      clerkUserId: "user_1",
      recentLimit: PUBLIC_WINS_RECENT_LIMIT,
    });

    expect(result.totalActiveWins).toBe(2);
    expect(result.recentWins).toHaveLength(2);
    expect(result.recentWins[0]?.displayTitle).toBe("Whole life");
    expect(result.recentWins[0]?.commitmentId).toBeNull();
    expect(result.recentWins[1]?.commitmentId).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    expect(state.lastSelects).toContain(PUBLIC_WIN_SELECT_COLUMNS);
    expect(state.lastSelects.join("|")).not.toMatch(
      /model_confidence|idempotency|source_message|schema_version|action_fact|why_meaningful/
    );
    expect(state.lastEqCalls).toEqual(
      expect.arrayContaining([
        ["clerk_user_id", "user_1"],
        ["status", "active"],
      ])
    );
    expect(state.lastOrders).toEqual([
      { col: "occurred_at", ascending: false },
      { col: "id", ascending: false },
    ]);
    expect(state.lastLimit).toBe(PUBLIC_WINS_RECENT_LIMIT);
    expect(fromMock).toHaveBeenCalledWith("v2_win");
  });
});

describe("loadPublicAllWinsForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.lastEqCalls = [];
    state.lastOrders = [];
    state.lastLimit = null;
    state.lastOr = null;
    state.lastSelects = [];
    state.pageResult = {
      data: Array.from({ length: PUBLIC_WINS_PAGE_LIMIT + 1 }, (_, i) =>
        winRow({
          id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          occurred_at: `2026-07-${String((i % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
        })
      ),
      error: null,
    };
    installFromMock();
  });

  it("pages with limit+1 and returns nextCursor when more exist", async () => {
    const result = await loadPublicAllWinsForUser({ clerkUserId: "user_1" });
    expect(result.wins).toHaveLength(PUBLIC_WINS_PAGE_LIMIT);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeTruthy();
    expect(state.lastLimit).toBe(PUBLIC_WINS_PAGE_LIMIT + 1);
    expect(state.lastEqCalls).toEqual(
      expect.arrayContaining([
        ["clerk_user_id", "user_1"],
        ["status", "active"],
      ])
    );

    const cursor = decodePublicWinsCursor(result.nextCursor);
    expect(cursor?.id).toBe(result.wins[result.wins.length - 1]?.id);

    state.pageResult = { data: [winRow({ id: "older-1" })], error: null };
    const page2 = await loadPublicAllWinsForUser({
      clerkUserId: "user_1",
      cursorRaw: result.nextCursor,
    });
    expect(cursor).not.toBeNull();
    expect(state.lastOr).toBe(
      `occurred_at.lt."${cursor!.occurredAt}",and(occurred_at.eq."${cursor!.occurredAt}",id.lt."${cursor!.id}")`
    );
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();
  });

  it("malformed cursor is ignored and still clerk/active-scoped", async () => {
    state.pageResult = {
      data: [winRow({ id: "only-1" })],
      error: null,
    };
    const view = await loadPublicAllWinsForUser({
      clerkUserId: "user_1",
      cursorRaw: "not-a-valid-cursor",
    });
    expect(view.wins).toHaveLength(1);
    expect(state.lastOr).toBeNull();
    expect(state.lastEqCalls).toEqual(
      expect.arrayContaining([
        ["clerk_user_id", "user_1"],
        ["status", "active"],
      ])
    );
  });
});
