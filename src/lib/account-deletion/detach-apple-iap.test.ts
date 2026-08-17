import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn(), rpc: vi.fn() },
}));

import {
  detachAppleIapForDeletion,
  type AppleIapDetachStore,
} from "./detach-apple-iap";

const TOKEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORIGINAL_TX = "1001";
const LAST_SIGNED = "2026-06-15T00:00:00.000Z";

type BindingRow = {
  clerk_user_id: string | null;
  app_account_token: string;
  unbound_at: string | null;
};

type SubRow = {
  clerk_user_id: string | null;
  original_transaction_id: string;
  latest_transaction_id: string;
  app_account_token: string;
  last_signed_at: string | null;
  status: string;
  product_id: string;
  environment: string;
};

function memoryStore(input: {
  bindings?: BindingRow[];
  subscriptions?: SubRow[];
  failTombstone?: boolean;
  failDetach?: boolean;
}): AppleIapDetachStore & {
  bindings: BindingRow[];
  subscriptions: SubRow[];
} {
  const bindings = input.bindings ?? [];
  const subscriptions = input.subscriptions ?? [];
  return {
    bindings,
    subscriptions,
    async tombstoneLiveBinding(clerkUserId) {
      if (input.failTombstone) return "failed";
      const live = bindings.filter(
        (row) => row.clerk_user_id === clerkUserId && row.unbound_at === null
      );
      if (live.length === 0) return "already_unbound";
      const now = "2026-08-17T19:00:00.000Z";
      for (const row of live) {
        row.clerk_user_id = null;
        row.unbound_at = now;
      }
      return "tombstoned";
    },
    async detachSubscriptions(clerkUserId) {
      if (input.failDetach) return "failed";
      const owned = subscriptions.filter(
        (row) => row.clerk_user_id === clerkUserId
      );
      if (owned.length === 0) return "none";
      for (const row of owned) {
        row.clerk_user_id = null;
      }
      return "detached";
    },
  };
}

function liveBinding(clerkUserId = "user_1"): BindingRow {
  return {
    clerk_user_id: clerkUserId,
    app_account_token: TOKEN,
    unbound_at: null,
  };
}

function ownedSub(clerkUserId: string | null = "user_1"): SubRow {
  return {
    clerk_user_id: clerkUserId,
    original_transaction_id: ORIGINAL_TX,
    latest_transaction_id: "2001",
    app_account_token: TOKEN,
    last_signed_at: LAST_SIGNED,
    status: "active",
    product_id: "com.summittmindset.ios.membership.monthly",
    environment: "sandbox",
  };
}

describe("detachAppleIapForDeletion", () => {
  it("tombstones a live binding and preserves the token forever", async () => {
    const store = memoryStore({ bindings: [liveBinding()] });
    const result = await detachAppleIapForDeletion("user_1", { store });
    expect(result).toEqual({
      ok: true,
      binding: "tombstoned",
      subscriptions: "none",
    });
    expect(store.bindings[0]?.clerk_user_id).toBeNull();
    expect(store.bindings[0]?.unbound_at).toBe("2026-08-17T19:00:00.000Z");
    expect(store.bindings[0]?.app_account_token).toBe(TOKEN);
  });

  it("does not reactivate a tombstoned token", async () => {
    const store = memoryStore({
      bindings: [
        {
          clerk_user_id: null,
          app_account_token: TOKEN,
          unbound_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const result = await detachAppleIapForDeletion("user_1", { store });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.binding).toBe("already_unbound");
    expect(store.bindings[0]?.unbound_at).toBe("2026-01-01T00:00:00.000Z");
    expect(store.bindings[0]?.clerk_user_id).toBeNull();
    expect(store.bindings[0]?.app_account_token).toBe(TOKEN);
  });

  it("detaches apple_subscriptions while preserving billing evidence", async () => {
    const store = memoryStore({ subscriptions: [ownedSub()] });
    const result = await detachAppleIapForDeletion("user_1", { store });
    expect(result).toEqual({
      ok: true,
      binding: "already_unbound",
      subscriptions: "detached",
    });
    const row = store.subscriptions[0];
    expect(row?.clerk_user_id).toBeNull();
    expect(row?.original_transaction_id).toBe(ORIGINAL_TX);
    expect(row?.latest_transaction_id).toBe("2001");
    expect(row?.app_account_token).toBe(TOKEN);
    expect(row?.last_signed_at).toBe(LAST_SIGNED);
    expect(row?.status).toBe("active");
    expect(row?.product_id).toBe(
      "com.summittmindset.ios.membership.monthly"
    );
    expect(row?.environment).toBe("sandbox");
  });

  it("no live binding is a safe idempotent success", async () => {
    const store = memoryStore({ bindings: [], subscriptions: [] });
    const result = await detachAppleIapForDeletion("user_1", { store });
    expect(result).toEqual({
      ok: true,
      binding: "already_unbound",
      subscriptions: "none",
    });
  });

  it("no Apple subscriptions is a safe idempotent success", async () => {
    const store = memoryStore({ bindings: [liveBinding()] });
    const result = await detachAppleIapForDeletion("user_1", { store });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subscriptions).toBe("none");
  });

  it("tombstone success + detach failure remains retryable and does not roll back", async () => {
    const store = memoryStore({
      bindings: [liveBinding()],
      subscriptions: [ownedSub()],
      failDetach: true,
    });
    const first = await detachAppleIapForDeletion("user_1", { store });
    expect(first).toMatchObject({
      ok: false,
      reason: "subscription_detach_failed",
      binding: "tombstoned",
      subscriptions: "failed",
    });
    expect(store.bindings[0]?.clerk_user_id).toBeNull();
    expect(store.bindings[0]?.app_account_token).toBe(TOKEN);
    expect(store.subscriptions[0]?.clerk_user_id).toBe("user_1");

    const retryStore = memoryStore({
      bindings: store.bindings,
      subscriptions: store.subscriptions,
    });
    const second = await detachAppleIapForDeletion("user_1", {
      store: retryStore,
    });
    expect(second).toEqual({
      ok: true,
      binding: "already_unbound",
      subscriptions: "detached",
    });
    expect(retryStore.subscriptions[0]?.clerk_user_id).toBeNull();
    expect(retryStore.subscriptions[0]?.original_transaction_id).toBe(
      ORIGINAL_TX
    );
    expect(retryStore.subscriptions[0]?.last_signed_at).toBe(LAST_SIGNED);
  });

  it("detach success + tombstone failure remains retryable and completes on retry", async () => {
    const store = memoryStore({
      bindings: [liveBinding()],
      subscriptions: [ownedSub()],
      failTombstone: true,
    });
    const first = await detachAppleIapForDeletion("user_1", { store });
    expect(first).toMatchObject({
      ok: false,
      reason: "binding_tombstone_failed",
      binding: "failed",
      subscriptions: "detached",
    });
    expect(store.bindings[0]?.clerk_user_id).toBe("user_1");
    expect(store.subscriptions[0]?.clerk_user_id).toBeNull();

    const retryStore = memoryStore({
      bindings: store.bindings,
      subscriptions: store.subscriptions,
    });
    const second = await detachAppleIapForDeletion("user_1", {
      store: retryStore,
    });
    expect(second).toEqual({
      ok: true,
      binding: "tombstoned",
      subscriptions: "none",
    });
    expect(retryStore.bindings[0]?.clerk_user_id).toBeNull();
    expect(retryStore.bindings[0]?.app_account_token).toBe(TOKEN);
    expect(retryStore.subscriptions[0]?.clerk_user_id).toBeNull();
  });

  it("does not call App Store APIs or require credential env vars", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/account-deletion/detach-apple-iap.ts"),
      "utf8"
    );
    expect(src).not.toContain("AppStoreServerAPIClient");
    expect(src).not.toContain("createAppStoreServerApiClient");
    expect(src).not.toContain("APPLE_IAP_ISSUER_ID");
    expect(src).not.toContain("APPLE_IAP_KEY_ID");
    expect(src).not.toContain("APPLE_IAP_PRIVATE_KEY");
    expect(src).not.toMatch(/DELETE FROM|from\(".*"\)\.delete/);
    expect(src).not.toContain("unbound_at: null");
    expect(src).toContain("clerk_user_id: null");
  });
});
