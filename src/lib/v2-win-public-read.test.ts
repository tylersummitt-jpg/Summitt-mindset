import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    lastGte: null as { col: string; val: string } | null,
    lastLt: null as { col: string; val: string } | null,
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

const enrichMock = vi.hoisted(() =>
  vi.fn(async ({ wins }: { wins: unknown[] }) => wins)
);

vi.mock("@/lib/victory-media/enrich-public-wins-with-media", () => ({
  enrichPublicWinsWithMedia: enrichMock,
}));

import {
  PUBLIC_WIN_MONTH_MARKER_SELECT_COLUMNS,
  PUBLIC_WIN_SELECT_COLUMNS,
  PUBLIC_WINS_PAGE_LIMIT,
  PUBLIC_WINS_RECENT_LIMIT,
  buildPublicWinsOlderThanOrFilter,
  decodePublicWinsCursor,
  encodePublicWinsCursor,
  loadPublicAllWinsForUser,
  loadPublicVictoryWinsForUser,
  loadPublicVictoryWinsForUserLocalDay,
  loadVictoryWinMonthMarkersForUser,
  mapV2WinRowToPublicDto,
  quotePostgrestFilterValue,
  sanitizePublicWinSupportingQuote,
  isMemberOwnedWinPresentation,
  publicWinCardDisplayBody,
} from "@/lib/v2-win-public-read";
import { localDayUtcRange, localMonthUtcRange } from "@/lib/timezone";

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
    source_type: "sms_inbound",
    user_edited_at: null,
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
    chain.gte = vi.fn((col: string, val: string) => {
      state.lastGte = { col, val };
      return chain;
    });
    chain.lt = vi.fn((col: string, val: string) => {
      state.lastLt = { col, val };
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
  it("maps approved fields, hides unedited system body, and omits sensitive quote", () => {
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
      displayBody: "",
      supportingQuote: null,
      celebrationAppropriate: true,
      commitmentId: null,
      updatedAt: "2026-08-01T12:05:00.000Z",
      sourceType: "sms_inbound",
      userEditedAt: null,
    });
    expect(dto).not.toHaveProperty("model_confidence");
    expect(dto).not.toHaveProperty("idempotency_key");
    expect(dto).not.toHaveProperty("source_message_sid");
    expect(dto).not.toHaveProperty("hidden_reason");
    expect(dto).not.toHaveProperty("action_fact");
    expect(PUBLIC_WIN_SELECT_COLUMNS).toContain("updated_at");
    expect(PUBLIC_WIN_SELECT_COLUMNS).toContain("source_type");
    expect(PUBLIC_WIN_SELECT_COLUMNS).toContain("user_edited_at");
    expect(PUBLIC_WIN_SELECT_COLUMNS).not.toContain("source_message");
    expect(PUBLIC_WIN_SELECT_COLUMNS).not.toContain("hidden_reason");
    expect(PUBLIC_WIN_SELECT_COLUMNS).not.toContain("action_fact");
  });

  it("includes whole-life and commitment-linked rows", () => {
    expect(mapV2WinRowToPublicDto(winRow({ commitment_id: null }) as never).commitmentId).toBeNull();
    expect(
      mapV2WinRowToPublicDto(winRow({ commitment_id: "c1" }) as never).commitmentId
    ).toBe("c1");
  });

  it("A. hides recognition-style system body and keeps sanitized quote", () => {
    const dto = mapV2WinRowToPublicDto(
      winRow({
        display_title: "Consistent Weight Lifting",
        display_body: "Tyler, you lifted weights again today, showing your commitment.",
        supporting_quote: "I lifted weights again today!",
        source_type: "sms_inbound",
        user_edited_at: null,
      }) as never
    );
    expect(dto.displayTitle).toBe("Consistent Weight Lifting");
    expect(dto.displayBody).toBe("");
    expect(dto.supportingQuote).toBe("I lifted weights again today!");
  });

  it("B. hides Sol life Win duplicate body and keeps rich inbound quote", () => {
    const quote =
      "Swimming with them. I put my phone away and was completely in the moment with them.";
    const title = "Put his phone away while swimming and gave his kids his full attention.";
    const dto = mapV2WinRowToPublicDto(
      winRow({
        display_title: title,
        display_body: title,
        supporting_quote: quote,
        source_type: "sms_inbound",
        user_edited_at: null,
      }) as never
    );
    expect(dto.displayTitle).toBe(title);
    expect(dto.displayBody).toBe("");
    expect(dto.supportingQuote).toBe(quote);
  });

  it("C. hides structural accountability duplicate body when quote is null", () => {
    const dto = mapV2WinRowToPublicDto(
      winRow({
        display_title: "Lift weights for 30 minutes a day.",
        display_body: "Lift weights for 30 minutes a day.",
        supporting_quote: null,
        source_type: "sms_inbound",
        user_edited_at: null,
      }) as never
    );
    expect(dto.displayTitle).toBe("Lift weights for 30 minutes a day.");
    expect(dto.displayBody).toBe("");
    expect(dto.supportingQuote).toBeNull();
  });

  it("preserves manual member-authored body even when it equals title", () => {
    const dto = mapV2WinRowToPublicDto(
      winRow({
        display_title: "Family Vacation",
        display_body: "Took the kids to the beach.",
        supporting_quote: null,
        celebration_appropriate: false,
        source_type: "manual",
        user_edited_at: null,
      }) as never
    );
    expect(dto.displayTitle).toBe("Family Vacation");
    expect(dto.displayBody).toBe("Took the kids to the beach.");
    expect(dto.supportingQuote).toBeNull();
  });

  it("preserves manual body when body equals title and celebration is quiet", () => {
    const dto = mapV2WinRowToPublicDto(
      winRow({
        display_title: "Done",
        display_body: "Done",
        supporting_quote: null,
        celebration_appropriate: false,
        source_type: "manual",
        user_edited_at: null,
      }) as never
    );
    expect(dto.displayBody).toBe("Done");
  });

  it("preserves edited system Win body via user_edited_at, not body/title difference", () => {
    const dto = mapV2WinRowToPublicDto(
      winRow({
        display_title: "Lifted weights with Brooke",
        display_body: "We actually made it to the gym together.",
        supporting_quote: null,
        source_type: "sms_inbound",
        user_edited_at: "2026-08-20T15:00:00.000Z",
      }) as never
    );
    expect(dto.displayTitle).toBe("Lifted weights with Brooke");
    expect(dto.displayBody).toBe("We actually made it to the gym together.");
    expect(dto.userEditedAt).toBe("2026-08-20T15:00:00.000Z");
  });

  it("does not infer edit ownership from celebration_appropriate or body/title mismatch", () => {
    const dto = mapV2WinRowToPublicDto(
      winRow({
        display_title: "Consistent Weight Lifting",
        display_body: "Tyler, you lifted weights again today.",
        celebration_appropriate: false,
        source_type: "sms_inbound",
        user_edited_at: null,
      }) as never
    );
    expect(dto.displayBody).toBe("");
    expect(isMemberOwnedWinPresentation({ sourceType: "sms_inbound", userEditedAt: null })).toBe(
      false
    );
  });
});

describe("publicWinCardDisplayBody owner-mode", () => {
  it("treats sms_inbound + null user_edited_at as unedited system", () => {
    expect(
      publicWinCardDisplayBody({
        displayBody: "Tyler, you lifted weights again today.",
        sourceType: "sms_inbound",
        userEditedAt: null,
      })
    ).toBe("");
    expect(
      isMemberOwnedWinPresentation({ sourceType: "sms_inbound", userEditedAt: null })
    ).toBe(false);
  });

  it("treats source_type manual as member-authored even without user_edited_at", () => {
    expect(
      publicWinCardDisplayBody({
        displayBody: "Took the kids to the beach.",
        sourceType: "manual",
        userEditedAt: null,
      })
    ).toBe("Took the kids to the beach.");
    expect(isMemberOwnedWinPresentation({ sourceType: "manual", userEditedAt: null })).toBe(true);
  });

  it("treats sms_inbound + user_edited_at as member-authored", () => {
    expect(
      publicWinCardDisplayBody({
        displayBody: "We actually made it to the gym together.",
        sourceType: "sms_inbound",
        userEditedAt: "2026-08-20T15:00:00.000Z",
      })
    ).toBe("We actually made it to the gym together.");
    expect(
      isMemberOwnedWinPresentation({
        sourceType: "sms_inbound",
        userEditedAt: "2026-08-20T15:00:00.000Z",
      })
    ).toBe(true);
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
    enrichMock.mockImplementation(async ({ wins }: { wins: unknown[] }) => wins);
    state.lastEqCalls = [];
    state.lastOrders = [];
    state.lastLimit = null;
    state.lastOr = null;
    state.lastSelects = [];
    state.lastGte = null;
    state.lastLt = null;
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
    expect(result.recentWins[0]?.displayBody).toBe("");
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

  it("enriches after canonical wins; media failure does not change win list", async () => {
    enrichMock.mockImplementation(async ({ wins }: { wins: Array<{ id: string }> }) =>
      wins.map((w, i) =>
        i === 0
          ? {
              ...w,
              media: {
                id: "m1",
                cardUrl: "https://signed.example/card.jpg",
                width: 100,
                height: 80,
              },
            }
          : w
      )
    );

    const result = await loadPublicVictoryWinsForUser({ clerkUserId: "user_1" });
    expect(enrichMock).toHaveBeenCalledWith({
      clerkUserId: "user_1",
      wins: expect.arrayContaining([
        expect.objectContaining({ id: "cccccccc-cccc-cccc-cccc-cccccccccccc" }),
        expect.objectContaining({ id: "dddddddd-dddd-dddd-dddd-dddddddddddd" }),
      ]),
    });
    expect(result.recentWins[0]?.media?.cardUrl).toBe("https://signed.example/card.jpg");
    expect(result.recentWins[0]?.displayBody).toBe("");
    expect(result.recentWins[0]?.id).toBe("cccccccc-cccc-cccc-cccc-cccccccccccc");
    expect(result.recentWins).toHaveLength(2);
    expect(result.totalActiveWins).toBe(2);
  });
});

describe("loadPublicAllWinsForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enrichMock.mockImplementation(async ({ wins }: { wins: unknown[] }) => wins);
    state.lastEqCalls = [];
    state.lastOrders = [];
    state.lastLimit = null;
    state.lastOr = null;
    state.lastSelects = [];
    state.lastGte = null;
    state.lastLt = null;
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

  it("enriches page wins only; preserves pagination when enrichment adds media", async () => {
    enrichMock.mockImplementation(async ({ wins }: { wins: unknown[] }) =>
      (wins as Array<Record<string, unknown>>).map((w) => ({
        ...w,
        media: { id: "m", cardUrl: "https://signed/x", width: 1, height: 1 },
      }))
    );
    const result = await loadPublicAllWinsForUser({ clerkUserId: "user_1" });
    expect(result.wins).toHaveLength(PUBLIC_WINS_PAGE_LIMIT);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeTruthy();
    expect(result.wins[0]?.media?.cardUrl).toBe("https://signed/x");
    expect(enrichMock).toHaveBeenCalledWith({
      clerkUserId: "user_1",
      wins: expect.any(Array),
    });
    expect(enrichMock.mock.calls[0]?.[0]?.wins).toHaveLength(PUBLIC_WINS_PAGE_LIMIT);
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

const PUBLIC_READ_SRC = readFileSync(join(process.cwd(), "src/lib/v2-win-public-read.ts"), "utf8");

function resetPublicReadQueryCapture() {
  vi.clearAllMocks();
  enrichMock.mockImplementation(async ({ wins }: { wins: unknown[] }) => wins);
  state.lastEqCalls = [];
  state.lastOrders = [];
  state.lastLimit = null;
  state.lastOr = null;
  state.lastSelects = [];
  state.lastGte = null;
  state.lastLt = null;
  state.pageResult = { data: [], error: null };
}

describe("loadVictoryWinMonthMarkersForUser", () => {
  beforeEach(() => {
    resetPublicReadQueryCapture();
    installFromMock();
  });

  it("queries clerk_user_id + active + local month range, selects only id and occurred_at, no media, no row cap", async () => {
    const range = localMonthUtcRange("2026-09", "America/New_York")!;
    state.pageResult = {
      data: [
        { id: "a", occurred_at: "2026-09-14T16:00:00.000Z" },
        { id: "b", occurred_at: "2026-09-15T02:00:00.000Z" },
        { id: "c", occurred_at: "2026-09-14T20:00:00.000Z" },
      ],
      error: null,
    };

    const result = await loadVictoryWinMonthMarkersForUser({
      clerkUserId: "user_1",
      timeZone: "America/New_York",
      monthKey: "2026-09",
    });

    expect(fromMock).toHaveBeenCalledWith("v2_win");
    expect(state.lastSelects).toEqual([PUBLIC_WIN_MONTH_MARKER_SELECT_COLUMNS]);
    expect(PUBLIC_WIN_MONTH_MARKER_SELECT_COLUMNS).toBe("id, occurred_at");
    expect(state.lastEqCalls).toEqual([
      ["clerk_user_id", "user_1"],
      ["status", "active"],
    ]);
    expect(state.lastGte).toEqual({ col: "occurred_at", val: range.startUtcIso });
    expect(state.lastLt).toEqual({ col: "occurred_at", val: range.endUtcIso });
    expect(state.lastLimit).toBeNull();
    expect(enrichMock).not.toHaveBeenCalled();
    expect(result.counts["2026-09-14"]).toBe(3);
    expect(Object.keys(result.counts)).toEqual(["2026-09-14"]);
  });

  it("groups two UTC calendar dates onto one member-local day", async () => {
    state.pageResult = {
      data: [
        { id: "utc-sep-14", occurred_at: "2026-09-14T16:00:00.000Z" },
        { id: "utc-sep-15-still-local-14", occurred_at: "2026-09-15T02:00:00.000Z" },
      ],
      error: null,
    };
    const result = await loadVictoryWinMonthMarkersForUser({
      clerkUserId: "user_1",
      timeZone: "America/New_York",
      monthKey: "2026-09",
    });
    expect(result.counts).toEqual({ "2026-09-14": 2 });
  });

  it("does not count hidden rows because the query is status=active only", async () => {
    state.pageResult = {
      data: [{ id: "only-active-returned", occurred_at: "2026-09-14T16:00:00.000Z" }],
      error: null,
    };
    const result = await loadVictoryWinMonthMarkersForUser({
      clerkUserId: "user_1",
      timeZone: "America/New_York",
      monthKey: "2026-09",
    });
    expect(state.lastEqCalls).toContainEqual(["status", "active"]);
    expect(result.counts["2026-09-14"]).toBe(1);
  });

  it("fail-closed: invalid month does not query the database", async () => {
    const result = await loadVictoryWinMonthMarkersForUser({
      clerkUserId: "user_1",
      timeZone: "America/New_York",
      monthKey: "2026-13",
    });
    expect(result).toEqual({ counts: {} });
    expect(fromMock).not.toHaveBeenCalled();
    expect(enrichMock).not.toHaveBeenCalled();
  });

  it("requires clerk user id like the home loader", async () => {
    await expect(
      loadVictoryWinMonthMarkersForUser({
        clerkUserId: "  ",
        timeZone: "America/New_York",
        monthKey: "2026-09",
      })
    ).rejects.toThrow(/v2_win_public_read_requires_clerk_user_id/);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("loadPublicVictoryWinsForUserLocalDay", () => {
  beforeEach(() => {
    resetPublicReadQueryCapture();
    installFromMock();
  });

  it("scopes owner + active + local day range, maps DTO, hides unedited system body, enriches media, orders desc", async () => {
    const range = localDayUtcRange("2026-09-14", "America/New_York")!;
    state.pageResult = {
      data: [
        winRow({
          id: "newer",
          occurred_at: "2026-09-14T20:00:00.000Z",
          display_title: "Later win",
          display_body: "Tyler, you did the thing.",
          source_type: "sms_inbound",
          user_edited_at: null,
        }),
        winRow({
          id: "older",
          occurred_at: "2026-09-14T16:00:00.000Z",
          display_title: "Earlier win",
          display_body: "Member wrote this.",
          source_type: "manual",
          user_edited_at: null,
          supporting_quote: null,
          celebration_appropriate: false,
        }),
      ],
      error: null,
    };
    enrichMock.mockImplementation(async ({ wins }: { wins: unknown[] }) =>
      (wins as Array<{ id: string }>).map((w) =>
        w.id === "newer"
          ? {
              ...w,
              media: { id: "m1", cardUrl: "https://signed.example/card.jpg", width: 10, height: 8 },
            }
          : w
      )
    );

    const wins = await loadPublicVictoryWinsForUserLocalDay({
      clerkUserId: "user_1",
      timeZone: "America/New_York",
      dayKey: "2026-09-14",
    });

    expect(state.lastSelects).toEqual([PUBLIC_WIN_SELECT_COLUMNS]);
    expect(state.lastEqCalls).toEqual([
      ["clerk_user_id", "user_1"],
      ["status", "active"],
    ]);
    expect(state.lastGte).toEqual({ col: "occurred_at", val: range.startUtcIso });
    expect(state.lastLt).toEqual({ col: "occurred_at", val: range.endUtcIso });
    expect(state.lastOrders).toEqual([
      { col: "occurred_at", ascending: false },
      { col: "id", ascending: false },
    ]);
    expect(state.lastLimit).toBe(PUBLIC_WINS_PAGE_LIMIT);
    expect(enrichMock).toHaveBeenCalledTimes(1);
    expect(enrichMock).toHaveBeenCalledWith({
      clerkUserId: "user_1",
      wins: expect.any(Array),
    });
    expect(wins).toHaveLength(2);
    expect(wins[0]?.id).toBe("newer");
    expect(wins[0]?.displayBody).toBe("");
    expect(wins[0]?.media?.cardUrl).toBe("https://signed.example/card.jpg");
    expect(wins[1]?.id).toBe("older");
    expect(wins[1]?.displayBody).toBe("Member wrote this.");
    expect(wins[0]).not.toHaveProperty("action_fact");
    expect(wins[0]).not.toHaveProperty("source_message");
    expect(PUBLIC_WIN_SELECT_COLUMNS).not.toContain("action_fact");
    expect(PUBLIC_WIN_SELECT_COLUMNS).not.toContain("source_message");
  });

  it("fail-closed: invalid day does not query or enrich", async () => {
    const wins = await loadPublicVictoryWinsForUserLocalDay({
      clerkUserId: "user_1",
      timeZone: "America/New_York",
      dayKey: "2026-02-30",
    });
    expect(wins).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
    expect(enrichMock).not.toHaveBeenCalled();
  });

  it("requires clerk user id", async () => {
    await expect(
      loadPublicVictoryWinsForUserLocalDay({
        clerkUserId: "",
        timeZone: "UTC",
        dayKey: "2026-09-14",
      })
    ).rejects.toThrow(/v2_win_public_read_requires_clerk_user_id/);
  });
});

describe("Victory Calendar public-read source policy", () => {
  it("does not import Sol, D2, weekly TTO, SMS persist, or media write pipelines", () => {
    expect(PUBLIC_READ_SRC).not.toContain("weekly-tto-accountability-events");
    expect(PUBLIC_READ_SRC).not.toContain("inbound-win-recognition");
    expect(PUBLIC_READ_SRC).not.toContain("inbound-sol-relationship");
    expect(PUBLIC_READ_SRC).not.toContain("inbound-mms-d2a");
    expect(PUBLIC_READ_SRC).not.toContain("inbound-mms-d2b");
    expect(PUBLIC_READ_SRC).not.toContain("inbound-mms-d2c");
    expect(PUBLIC_READ_SRC).not.toContain("historical-win-evidence-load");
    expect(PUBLIC_READ_SRC).not.toContain("v2-win-persist");
    expect(PUBLIC_READ_SRC).not.toContain("victory-media/upload");
    expect(PUBLIC_READ_SRC).toContain("loadVictoryWinMonthMarkersForUser");
    expect(PUBLIC_READ_SRC).toContain("loadPublicVictoryWinsForUserLocalDay");
    expect(PUBLIC_READ_SRC).toContain("PUBLIC_WINS_RECENT_LIMIT = 7");
    expect(PUBLIC_READ_SRC).toContain('eq("clerk_user_id"');
    expect(PUBLIC_READ_SRC).toContain('eq("status", "active")');
  });
});
