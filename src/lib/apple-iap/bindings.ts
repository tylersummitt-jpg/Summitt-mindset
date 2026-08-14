import "server-only";

import { randomUUID } from "node:crypto";
import { supabaseServer } from "@/lib/supabase-server";

const LIVE_TOKEN_SELECT = "app_account_token";
const MAX_INSERT_ATTEMPTS = 4;

export type LiveAppleAccountBinding = {
  appAccountToken: string;
};

export type AppleAccountBindingResult =
  | { ok: true; appAccountToken: string }
  | { ok: false; reason: "read_failed" | "insert_failed" };

export type AppleAccountBindingInsertOutcome =
  | { status: "inserted"; appAccountToken: string }
  | {
      status: "unique_violation";
      error?: { code?: string; message?: string; details?: string };
    }
  | { status: "failed" };

export type AppleAccountBindingStore = {
  findLiveBinding: (
    clerkUserId: string
  ) => Promise<LiveAppleAccountBinding | null | "read_failed">;
  insertLiveBinding: (
    clerkUserId: string,
    appAccountToken: string
  ) => Promise<AppleAccountBindingInsertOutcome>;
};

export function isPostgresUniqueViolation(error: {
  code?: string;
  message?: string;
} | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("duplicate key") || message.includes("unique constraint")
  );
}

export function createSupabaseAppleAccountBindingStore(): AppleAccountBindingStore {
  return {
    async findLiveBinding(clerkUserId) {
      const { data, error } = await supabaseServer
        .from("apple_account_bindings")
        .select(LIVE_TOKEN_SELECT)
        .eq("clerk_user_id", clerkUserId)
        .is("unbound_at", null)
        .maybeSingle();

      if (error) return "read_failed";
      const token = data?.app_account_token;
      if (typeof token !== "string" || token.length === 0) return null;
      return { appAccountToken: token };
    },

    async insertLiveBinding(clerkUserId, appAccountToken) {
      const { data, error } = await supabaseServer
        .from("apple_account_bindings")
        .insert({
          clerk_user_id: clerkUserId,
          app_account_token: appAccountToken,
          unbound_at: null,
        })
        .select(LIVE_TOKEN_SELECT)
        .maybeSingle();

      if (!error) {
        const persisted = data?.app_account_token;
        if (typeof persisted !== "string" || persisted.length === 0) {
          return { status: "failed" };
        }
        return { status: "inserted", appAccountToken: persisted };
      }

      if (isPostgresUniqueViolation(error)) {
        return { status: "unique_violation", error };
      }

      return { status: "failed" };
    },
  };
}

/**
 * Return the live appAccountToken for this Clerk user, creating one if needed.
 *
 * Never reuses tombstones (live query requires unbound_at IS NULL and
 * clerk_user_id = this user). Unique races re-read the persisted live row.
 * app_account_token collisions generate a new UUID and retry narrowly.
 * A generated UUID is returned only after a successful insert (or a live
 * re-read of the winner).
 */
export async function getOrCreateLiveAppleAccountToken(
  clerkUserId: string,
  deps: {
    store?: AppleAccountBindingStore;
    randomUUID?: () => string;
  } = {}
): Promise<AppleAccountBindingResult> {
  const store = deps.store ?? createSupabaseAppleAccountBindingStore();
  const nextUuid = deps.randomUUID ?? randomUUID;

  const existing = await store.findLiveBinding(clerkUserId);
  if (existing === "read_failed") return { ok: false, reason: "read_failed" };
  if (existing) return { ok: true, appAccountToken: existing.appAccountToken };

  let candidate = nextUuid();

  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt += 1) {
    const inserted = await store.insertLiveBinding(clerkUserId, candidate);
    if (inserted.status === "inserted") {
      return { ok: true, appAccountToken: inserted.appAccountToken };
    }
    if (inserted.status === "failed") {
      return { ok: false, reason: "insert_failed" };
    }

    const racedLive = await store.findLiveBinding(clerkUserId);
    if (racedLive === "read_failed") return { ok: false, reason: "read_failed" };
    if (racedLive) {
      return { ok: true, appAccountToken: racedLive.appAccountToken };
    }

    // Unique violation but no live row for this user → token collision
    // (another live user or a tombstone). Do not return the unpersisted UUID.
    candidate = nextUuid();
  }

  return { ok: false, reason: "insert_failed" };
}
