import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fromMock = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

import {
  createSupabaseAppleAccountBindingStore,
  getOrCreateLiveAppleAccountToken,
  isPostgresUniqueViolation,
  type AppleAccountBindingStore,
} from "./bindings";

const USER = "user_1";
const TOKEN_A = "11111111-1111-4111-8111-111111111111";
const TOKEN_B = "22222222-2222-4222-8222-222222222222";
const TOKEN_C = "33333333-3333-4333-8333-333333333333";

function memoryStore(opts: {
  live?: string | null;
  insert?: AppleAccountBindingStore["insertLiveBinding"];
  findSequence?: Array<string | null | "read_failed">;
}): AppleAccountBindingStore {
  let live = opts.live ?? null;
  const finds = [...(opts.findSequence ?? [])];
  return {
    async findLiveBinding() {
      if (finds.length > 0) {
        const next = finds.shift();
        if (next === "read_failed") return "read_failed";
        if (next == null) return null;
        return { appAccountToken: next };
      }
      if (live == null) return null;
      return { appAccountToken: live };
    },
    async insertLiveBinding(_clerkUserId, appAccountToken) {
      if (opts.insert) return opts.insert(_clerkUserId, appAccountToken);
      live = appAccountToken;
      return { status: "inserted", appAccountToken };
    },
  };
}

describe("isPostgresUniqueViolation", () => {
  it("detects 23505 and duplicate-key messages", () => {
    expect(isPostgresUniqueViolation({ code: "23505" })).toBe(true);
    expect(
      isPostgresUniqueViolation({
        message: "duplicate key value violates unique constraint",
      })
    ).toBe(true);
    expect(isPostgresUniqueViolation({ code: "42501" })).toBe(false);
  });
});

describe("getOrCreateLiveAppleAccountToken", () => {
  it("returns the existing live binding UUID", async () => {
    const result = await getOrCreateLiveAppleAccountToken(USER, {
      store: memoryStore({ live: TOKEN_A }),
      randomUUID: () => TOKEN_B,
    });
    expect(result).toEqual({ ok: true, appAccountToken: TOKEN_A });
  });

  it("inserts a random UUID on first request and returns the persisted value", async () => {
    const insert = vi.fn(async (_id: string, token: string) => ({
      status: "inserted" as const,
      appAccountToken: token,
    }));
    const result = await getOrCreateLiveAppleAccountToken(USER, {
      store: memoryStore({ live: null, insert }),
      randomUUID: () => TOKEN_A,
    });
    expect(insert).toHaveBeenCalledWith(USER, TOKEN_A);
    expect(result).toEqual({ ok: true, appAccountToken: TOKEN_A });
  });

  it("repeat request returns the stored UUID without inserting", async () => {
    const insert = vi.fn(async (_id: string, token: string) => ({
      status: "inserted" as const,
      appAccountToken: token,
    }));
    const store = memoryStore({ live: TOKEN_A, insert });
    const first = await getOrCreateLiveAppleAccountToken(USER, {
      store,
      randomUUID: () => TOKEN_B,
    });
    const second = await getOrCreateLiveAppleAccountToken(USER, {
      store,
      randomUUID: () => TOKEN_C,
    });
    expect(first).toEqual({ ok: true, appAccountToken: TOKEN_A });
    expect(second).toEqual({ ok: true, appAccountToken: TOKEN_A });
    expect(insert).not.toHaveBeenCalled();
  });

  it("live clerk unique race re-reads the canonical persisted token", async () => {
    const insert = vi.fn(async () => ({
      status: "unique_violation" as const,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "apple_account_bindings_live_clerk_user_id_uq"',
      },
    }));
    const result = await getOrCreateLiveAppleAccountToken(USER, {
      store: memoryStore({
        insert,
        findSequence: [null, TOKEN_B],
      }),
      randomUUID: () => TOKEN_A,
    });
    expect(result).toEqual({ ok: true, appAccountToken: TOKEN_B });
    expect(result.ok && result.appAccountToken).not.toBe(TOKEN_A);
  });

  it("app_account_token collision regenerates and retries", async () => {
    const insert = vi
      .fn()
      .mockResolvedValueOnce({
        status: "unique_violation",
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "apple_account_bindings_app_account_token_uq"',
        },
      })
      .mockResolvedValueOnce({
        status: "inserted",
        appAccountToken: TOKEN_B,
      });
    const uuids = [TOKEN_A, TOKEN_B];
    const result = await getOrCreateLiveAppleAccountToken(USER, {
      store: memoryStore({
        insert,
        findSequence: [null, null],
      }),
      randomUUID: () => uuids.shift() ?? TOKEN_C,
    });
    expect(insert).toHaveBeenNthCalledWith(1, USER, TOKEN_A);
    expect(insert).toHaveBeenNthCalledWith(2, USER, TOKEN_B);
    expect(result).toEqual({ ok: true, appAccountToken: TOKEN_B });
  });

  it("does not reuse a tombstoned historical binding", async () => {
    const insert = vi.fn(async (_id: string, token: string) => ({
      status: "inserted" as const,
      appAccountToken: token,
    }));
    const result = await getOrCreateLiveAppleAccountToken(USER, {
      store: memoryStore({
        insert,
        findSequence: [null],
      }),
      randomUUID: () => TOKEN_B,
    });
    expect(result).toEqual({ ok: true, appAccountToken: TOKEN_B });
    expect(insert).toHaveBeenCalledWith(USER, TOKEN_B);
  });

  it("DB read error does not manufacture a token", async () => {
    const insert = vi.fn();
    const result = await getOrCreateLiveAppleAccountToken(USER, {
      store: memoryStore({
        insert: insert as never,
        findSequence: ["read_failed"],
      }),
      randomUUID: () => TOKEN_A,
    });
    expect(result).toEqual({ ok: false, reason: "read_failed" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("non-unique insert error returns insert_failed", async () => {
    const result = await getOrCreateLiveAppleAccountToken(USER, {
      store: memoryStore({
        insert: async () => ({ status: "failed" }),
      }),
      randomUUID: () => TOKEN_A,
    });
    expect(result).toEqual({ ok: false, reason: "insert_failed" });
  });
});

describe("createSupabaseAppleAccountBindingStore live query", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("queries only live rows (clerk_user_id + unbound_at IS NULL)", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { app_account_token: TOKEN_A },
      error: null,
    }));
    const is = vi.fn(() => ({ maybeSingle }));
    const eq = vi.fn(() => ({ is }));
    const select = vi.fn(() => ({ eq }));
    fromMock.mockReturnValue({ select, insert: vi.fn() });

    const store = createSupabaseAppleAccountBindingStore();
    const found = await store.findLiveBinding(USER);
    expect(fromMock).toHaveBeenCalledWith("apple_account_bindings");
    expect(select).toHaveBeenCalledWith("app_account_token");
    expect(eq).toHaveBeenCalledWith("clerk_user_id", USER);
    expect(is).toHaveBeenCalledWith("unbound_at", null);
    expect(found).toEqual({ appAccountToken: TOKEN_A });
  });
});
