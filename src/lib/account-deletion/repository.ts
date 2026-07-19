/**
 * APP-041B1 account-deletion request repository (state foundation only).
 *
 * No HTTP routes in this slice. Future routes MUST pass clerkUserId from
 * auth().userId — never from a client-supplied target user id field.
 *
 * External orchestration (SMS / Stripe / purge / Clerk) is intentionally absent.
 *
 * Idempotency: unique (clerk_user_id, idempotency_key) is permanent.
 * Same key after completion returns that historical completed request.
 * A genuinely new deletion attempt requires a new idempotency key.
 *
 * Lease: production acquire/CAS use Postgres RPCs with server now().
 * Create does not require a lease. Transition / failure / complete do.
 */

import "server-only";

import { randomUUID } from "node:crypto";

import { supabaseServer } from "@/lib/supabase-server";

import { sanitizeAccountDeletionErrorDetail } from "./sanitize";
import {
  isLegalAccountDeletionTransition,
  isProcessingAccountDeletionStatus,
  nextForwardAccountDeletionStatus,
} from "./transitions";
import {
  ACCOUNT_DELETION_ORCHESTRATION_VERSION,
  ACCOUNT_DELETION_SUPPORTED_ORCHESTRATION_VERSIONS,
  type AccountDeletionErrorCode,
  type AccountDeletionRequestRow,
  type AccountDeletionStatus,
  type AccountDeletionStepsJson,
  isAccountDeletionStatus,
} from "./types";

export const DEFAULT_ACCOUNT_DELETION_LEASE_MS = 2 * 60 * 1000;

export const ACQUIRE_ACCOUNT_DELETION_LEASE_RPC =
  "acquire_account_deletion_lease" as const;
export const CAS_ACCOUNT_DELETION_REQUEST_RPC =
  "cas_account_deletion_request" as const;
export const SUPPRESS_SMS_FOR_ACCOUNT_DELETION_RPC =
  "suppress_sms_for_account_deletion" as const;
export const PURGE_APP_DATA_FOR_ACCOUNT_DELETION_RPC =
  "purge_app_data_for_account_deletion" as const;

export type AccountDeletionRepoResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: AccountDeletionErrorCode; message: string };

export type CreateAccountDeletionRequestInput = {
  /** Server-trusted Clerk user id (from auth().userId in future routes). */
  clerkUserId: string;
  idempotencyKey: string;
  orchestrationVersion?: number;
  now?: Date;
};

export type AcquireAccountDeletionLeaseInput = {
  requestId: string;
  lockOwner: string;
  leaseMs?: number;
  /** Test-only clock for in-memory store; ignored by Postgres RPC (uses now()). */
  now?: Date;
};

export type TransitionAccountDeletionInput = {
  requestId: string;
  fromStatus: AccountDeletionStatus;
  /**
   * Target status. For resume from failed_retryable, this MUST equal the
   * persisted row.current_step; the repository derives and enforces that.
   */
  toStatus: AccountDeletionStatus;
  /** Required: nonempty worker id that currently holds an active lease. */
  lockOwner: string;
  leaseMs?: number;
  expectedOrchestrationVersion?: number;
  /** Test-only clock for in-memory store; Postgres CAS uses server now(). */
  now?: Date;
  stepNote?: { code?: string; ok?: boolean; detail?: string };
  /** When set, persists sms_result via CAS (B2a). */
  smsResult?: AccountDeletionRequestRow["sms_result"];
  /** When set, persists stripe_result via CAS (B3a). */
  stripeResult?: AccountDeletionRequestRow["stripe_result"];
  /** When set, persists purge_result via CAS (C2). */
  purgeResult?: AccountDeletionRequestRow["purge_result"];
};

export type RecordAccountDeletionFailureInput = {
  requestId: string;
  fromStatus: AccountDeletionStatus;
  terminal: boolean;
  errorCode: string;
  errorDetail?: string | null;
  /** Required: nonempty worker id that currently holds an active lease. */
  lockOwner: string;
  leaseMs?: number;
  expectedOrchestrationVersion?: number;
  now?: Date;
  /** When set, persists stripe_result via CAS (B3a). */
  stripeResult?: AccountDeletionRequestRow["stripe_result"];
  /** When set, persists purge_result via CAS (C2). */
  purgeResult?: AccountDeletionRequestRow["purge_result"];
  /** Optional sanitized progress note merged into the failure step. */
  stepDetail?: string | null;
};

type CasPatch = {
  status: AccountDeletionStatus;
  current_step: AccountDeletionStatus;
  steps: AccountDeletionStepsJson;
  last_error_code?: string | null;
  last_error_detail?: string | null;
  last_retry_at?: string | null;
  completed_at?: string | null;
  clear_errors?: boolean;
  release_lock?: boolean;
  sms_result?: AccountDeletionRequestRow["sms_result"];
  set_sms_result?: boolean;
  stripe_result?: AccountDeletionRequestRow["stripe_result"];
  set_stripe_result?: boolean;
  purge_result?: AccountDeletionRequestRow["purge_result"];
  set_purge_result?: boolean;
};

/** Test-injectable store surface (in-memory or Supabase/RPC mock). */
export type AccountDeletionStore = {
  insert(row: AccountDeletionRequestRow): Promise<AccountDeletionRequestRow>;
  findById(id: string): Promise<AccountDeletionRequestRow | null>;
  findByUserAndIdempotency(
    clerkUserId: string,
    idempotencyKey: string
  ): Promise<AccountDeletionRequestRow | null>;
  findUnresolvedByUser(
    clerkUserId: string
  ): Promise<AccountDeletionRequestRow | null>;
  /**
   * Any deletion row for the user (unresolved preferred; else most recent
   * including completed). Used by entitlement anti-resurrection (B3b).
   */
  findAnyByUser(
    clerkUserId: string
  ): Promise<AccountDeletionRequestRow | null>;
  acquireLease(input: {
    requestId: string;
    lockOwner: string;
    leaseMs: number;
    now: Date;
  }): Promise<AccountDeletionRequestRow | null>;
  casWithActiveLease(input: {
    requestId: string;
    expectedStatus: AccountDeletionStatus;
    expectedOrchestrationVersion: number;
    lockOwner: string;
    leaseMs: number;
    now: Date;
    patch: CasPatch;
  }): Promise<AccountDeletionRequestRow | null>;
  releaseLease(input: {
    requestId: string;
    lockOwner: string;
    expectedStatus: AccountDeletionStatus;
    expectedOrchestrationVersion: number;
    now: Date;
  }): Promise<AccountDeletionRequestRow | null>;
};

type Store = AccountDeletionStore;

function nowIso(d?: Date): string {
  return (d ?? new Date()).toISOString();
}

function assertSupportedVersion(
  version: number
): AccountDeletionRepoResult<true> {
  if (
    !(
      ACCOUNT_DELETION_SUPPORTED_ORCHESTRATION_VERSIONS as readonly number[]
    ).includes(version)
  ) {
    return {
      ok: false,
      code: "unsupported_orchestration_version",
      message: `Unsupported orchestration_version ${version}`,
    };
  }
  return { ok: true, value: true };
}

function requireLockOwner(
  lockOwner: string | undefined
): AccountDeletionRepoResult<string> {
  const trimmed = (lockOwner ?? "").trim();
  if (!trimmed) {
    return {
      ok: false,
      code: "invalid_argument",
      message: "lockOwner is required",
    };
  }
  return { ok: true, value: trimmed };
}

function mapRow(raw: Record<string, unknown>): AccountDeletionRequestRow {
  const status = raw.status;
  const currentStep = raw.current_step;
  if (!isAccountDeletionStatus(status) || !isAccountDeletionStatus(currentStep)) {
    throw new Error("invalid_account_deletion_row_status");
  }
  return {
    id: String(raw.id),
    clerk_user_id: String(raw.clerk_user_id),
    orchestration_version: Number(raw.orchestration_version),
    status,
    current_step: currentStep,
    steps: (raw.steps as AccountDeletionStepsJson) ?? {},
    attempt_count: Number(raw.attempt_count ?? 0),
    locked_at: (raw.locked_at as string | null) ?? null,
    lock_owner: (raw.lock_owner as string | null) ?? null,
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
    completed_at: (raw.completed_at as string | null) ?? null,
    last_retry_at: (raw.last_retry_at as string | null) ?? null,
    last_error_code: (raw.last_error_code as string | null) ?? null,
    last_error_detail: (raw.last_error_detail as string | null) ?? null,
    sms_result: (raw.sms_result as AccountDeletionRequestRow["sms_result"]) ?? null,
    stripe_result:
      (raw.stripe_result as AccountDeletionRequestRow["stripe_result"]) ?? null,
    purge_result:
      (raw.purge_result as AccountDeletionRequestRow["purge_result"]) ?? null,
    clerk_result:
      (raw.clerk_result as AccountDeletionRequestRow["clerk_result"]) ?? null,
    idempotency_key: String(raw.idempotency_key),
  };
}

function leaseExpiredInMemory(
  row: AccountDeletionRequestRow,
  now: Date,
  leaseMs: number
): boolean {
  if (!row.locked_at || !row.lock_owner) return true;
  const lockedMs = Date.parse(row.locked_at);
  if (Number.isNaN(lockedMs)) return true;
  return now.getTime() - lockedMs >= leaseMs;
}

function createInMemoryStore(): Store {
  const rows = new Map<string, AccountDeletionRequestRow>();

  return {
    async insert(row) {
      for (const existing of rows.values()) {
        if (
          existing.clerk_user_id === row.clerk_user_id &&
          existing.idempotency_key === row.idempotency_key
        ) {
          throw Object.assign(new Error("unique_violation"), {
            code: "23505",
            constraint: "account_deletion_requests_user_idempotency",
          });
        }
        if (
          existing.clerk_user_id === row.clerk_user_id &&
          existing.status !== "completed"
        ) {
          throw Object.assign(new Error("unique_violation"), {
            code: "23505",
            constraint: "account_deletion_requests_one_unresolved_per_user",
          });
        }
      }
      rows.set(row.id, { ...row, steps: { ...row.steps } });
      return rows.get(row.id)!;
    },
    async findById(id) {
      const row = rows.get(id);
      return row ? { ...row, steps: { ...row.steps } } : null;
    },
    async findByUserAndIdempotency(clerkUserId, idempotencyKey) {
      for (const row of rows.values()) {
        if (
          row.clerk_user_id === clerkUserId &&
          row.idempotency_key === idempotencyKey
        ) {
          return { ...row, steps: { ...row.steps } };
        }
      }
      return null;
    },
    async findUnresolvedByUser(clerkUserId) {
      for (const row of rows.values()) {
        if (row.clerk_user_id === clerkUserId && row.status !== "completed") {
          return { ...row, steps: { ...row.steps } };
        }
      }
      return null;
    },
    async findAnyByUser(clerkUserId) {
      let best: AccountDeletionRequestRow | null = null;
      for (const row of rows.values()) {
        if (row.clerk_user_id !== clerkUserId) continue;
        if (row.status !== "completed") {
          return { ...row, steps: { ...row.steps } };
        }
        if (
          !best ||
          Date.parse(row.updated_at) > Date.parse(best.updated_at)
        ) {
          best = row;
        }
      }
      return best ? { ...best, steps: { ...best.steps } } : null;
    },
    async acquireLease({ requestId, lockOwner, leaseMs, now }) {
      const current = rows.get(requestId);
      if (!current) return null;
      if (current.orchestration_version !== 1) return null;
      if (
        current.status === "completed" ||
        current.status === "failed_terminal"
      ) {
        return null;
      }
      const free =
        !current.lock_owner ||
        !current.locked_at ||
        current.lock_owner === lockOwner ||
        leaseExpiredInMemory(current, now, leaseMs);
      if (!free) return null;
      const ts = nowIso(now);
      const next: AccountDeletionRequestRow = {
        ...current,
        lock_owner: lockOwner,
        locked_at: ts,
        attempt_count: current.attempt_count + 1,
        updated_at: ts,
        steps: { ...current.steps },
      };
      rows.set(requestId, next);
      return { ...next, steps: { ...next.steps } };
    },
    async casWithActiveLease({
      requestId,
      expectedStatus,
      expectedOrchestrationVersion,
      lockOwner,
      leaseMs,
      now,
      patch,
    }) {
      const current = rows.get(requestId);
      if (!current) return null;
      if (current.status !== expectedStatus) return null;
      if (current.orchestration_version !== expectedOrchestrationVersion) {
        return null;
      }
      if (current.lock_owner !== lockOwner) return null;
      if (leaseExpiredInMemory(current, now, leaseMs)) return null;
      if (patch.set_sms_result && patch.sms_result == null) return null;
      if (patch.set_stripe_result && patch.stripe_result == null) return null;
      if (patch.set_purge_result && patch.purge_result == null) return null;
      const ts = nowIso(now);
      const next: AccountDeletionRequestRow = {
        ...current,
        status: patch.status,
        current_step: patch.current_step,
        steps: { ...patch.steps },
        updated_at: ts,
        last_error_code: patch.clear_errors
          ? null
          : (patch.last_error_code ?? current.last_error_code),
        last_error_detail: patch.clear_errors
          ? null
          : (patch.last_error_detail ?? current.last_error_detail),
        last_retry_at: patch.last_retry_at ?? current.last_retry_at,
        completed_at: patch.completed_at ?? current.completed_at,
        lock_owner: patch.release_lock ? null : current.lock_owner,
        locked_at: patch.release_lock ? null : current.locked_at,
        sms_result: patch.set_sms_result
          ? (patch.sms_result ?? null)
          : current.sms_result,
        stripe_result: patch.set_stripe_result
          ? (patch.stripe_result ?? null)
          : current.stripe_result,
        purge_result: patch.set_purge_result
          ? (patch.purge_result ?? null)
          : current.purge_result,
        id: current.id,
        clerk_user_id: current.clerk_user_id,
        idempotency_key: current.idempotency_key,
      };
      rows.set(requestId, next);
      return { ...next, steps: { ...next.steps } };
    },
    async releaseLease({
      requestId,
      lockOwner,
      expectedStatus,
      expectedOrchestrationVersion,
      now,
    }) {
      const current = rows.get(requestId);
      if (!current) return null;
      if (current.status !== expectedStatus) return null;
      if (current.orchestration_version !== expectedOrchestrationVersion) {
        return null;
      }
      if (current.lock_owner !== lockOwner) return null;
      const ts = nowIso(now);
      const next: AccountDeletionRequestRow = {
        ...current,
        lock_owner: null,
        locked_at: null,
        updated_at: ts,
        steps: { ...current.steps },
      };
      rows.set(requestId, next);
      return { ...next, steps: { ...next.steps } };
    },
  };
}

function firstRpcRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const first = data[0];
    return first && typeof first === "object"
      ? (first as Record<string, unknown>)
      : null;
  }
  if (data && typeof data === "object") {
    return data as Record<string, unknown>;
  }
  return null;
}

function createSupabaseStore(): Store {
  return {
    async insert(row) {
      const { data, error } = await supabaseServer
        .from("account_deletion_requests")
        .insert({
          id: row.id,
          clerk_user_id: row.clerk_user_id,
          orchestration_version: row.orchestration_version,
          status: row.status,
          current_step: row.current_step,
          steps: row.steps,
          attempt_count: row.attempt_count,
          locked_at: row.locked_at,
          lock_owner: row.lock_owner,
          created_at: row.created_at,
          updated_at: row.updated_at,
          completed_at: row.completed_at,
          last_retry_at: row.last_retry_at,
          last_error_code: row.last_error_code,
          last_error_detail: row.last_error_detail,
          sms_result: row.sms_result,
          stripe_result: row.stripe_result,
          purge_result: row.purge_result,
          clerk_result: row.clerk_result,
          idempotency_key: row.idempotency_key,
        })
        .select("*")
        .single();
      if (error) {
        throw Object.assign(new Error(error.message), {
          code: (error as { code?: string }).code,
        });
      }
      return mapRow(data as Record<string, unknown>);
    },
    async findById(id) {
      const { data, error } = await supabaseServer
        .from("account_deletion_requests")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? mapRow(data as Record<string, unknown>) : null;
    },
    async findByUserAndIdempotency(clerkUserId, idempotencyKey) {
      const { data, error } = await supabaseServer
        .from("account_deletion_requests")
        .select("*")
        .eq("clerk_user_id", clerkUserId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (error) throw error;
      return data ? mapRow(data as Record<string, unknown>) : null;
    },
    async findUnresolvedByUser(clerkUserId) {
      const { data, error } = await supabaseServer
        .from("account_deletion_requests")
        .select("*")
        .eq("clerk_user_id", clerkUserId)
        .neq("status", "completed")
        .maybeSingle();
      if (error) throw error;
      return data ? mapRow(data as Record<string, unknown>) : null;
    },
    async findAnyByUser(clerkUserId) {
      const unresolved = await this.findUnresolvedByUser(clerkUserId);
      if (unresolved) return unresolved;
      const { data, error } = await supabaseServer
        .from("account_deletion_requests")
        .select("*")
        .eq("clerk_user_id", clerkUserId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? mapRow(data as Record<string, unknown>) : null;
    },
    async acquireLease({ requestId, lockOwner, leaseMs }) {
      const { data, error } = await supabaseServer.rpc(
        ACQUIRE_ACCOUNT_DELETION_LEASE_RPC,
        {
          p_request_id: requestId,
          p_lock_owner: lockOwner,
          p_lease_ms: leaseMs,
        }
      );
      if (error) throw error;
      const raw = firstRpcRow(data);
      return raw ? mapRow(raw) : null;
    },
    async casWithActiveLease({
      requestId,
      expectedStatus,
      expectedOrchestrationVersion,
      lockOwner,
      leaseMs,
      patch,
    }) {
      const { data, error } = await supabaseServer.rpc(
        CAS_ACCOUNT_DELETION_REQUEST_RPC,
        {
          p_request_id: requestId,
          p_expected_status: expectedStatus,
          p_expected_orchestration_version: expectedOrchestrationVersion,
          p_lock_owner: lockOwner,
          p_lease_ms: leaseMs,
          p_new_status: patch.status,
          p_new_current_step: patch.current_step,
          p_steps: patch.steps,
          p_last_error_code: patch.last_error_code ?? null,
          p_last_error_detail: patch.last_error_detail ?? null,
          p_last_retry_at: patch.last_retry_at ?? null,
          p_completed_at: patch.completed_at ?? null,
          p_clear_errors: patch.clear_errors ?? false,
          p_release_lock: patch.release_lock ?? false,
          p_sms_result: patch.set_sms_result ? (patch.sms_result ?? null) : null,
          p_set_sms_result: patch.set_sms_result ?? false,
          p_stripe_result: patch.set_stripe_result
            ? (patch.stripe_result ?? null)
            : null,
          p_set_stripe_result: patch.set_stripe_result ?? false,
          p_purge_result: patch.set_purge_result
            ? (patch.purge_result ?? null)
            : null,
          p_set_purge_result: patch.set_purge_result ?? false,
        }
      );
      if (error) throw error;
      const raw = firstRpcRow(data);
      return raw ? mapRow(raw) : null;
    },
    async releaseLease({
      requestId,
      lockOwner,
      expectedStatus,
      expectedOrchestrationVersion,
      now,
    }) {
      const ts = nowIso(now);
      const { data, error } = await supabaseServer
        .from("account_deletion_requests")
        .update({
          locked_at: null,
          lock_owner: null,
          updated_at: ts,
        })
        .eq("id", requestId)
        .eq("status", expectedStatus)
        .eq("orchestration_version", expectedOrchestrationVersion)
        .eq("lock_owner", lockOwner)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data ? mapRow(data as Record<string, unknown>) : null;
    },
  };
}

let activeStore: Store | null = null;

function getStore(): Store {
  if (!activeStore) {
    activeStore = createSupabaseStore();
  }
  return activeStore;
}

/** Test-only: swap in an isolated in-memory store. */
export function useInMemoryAccountDeletionStoreForTests(): void {
  activeStore = createInMemoryStore();
}

/** Test-only: restore Supabase-backed store. */
export function useSupabaseAccountDeletionStoreForTests(): void {
  activeStore = createSupabaseStore();
}

/** Test-only: inject a custom store (e.g. race / RPC mock wrapper). */
export function useAccountDeletionStoreForTests(
  store: AccountDeletionStore
): void {
  activeStore = store;
}

export async function getAccountDeletionRequestById(
  id: string
): Promise<AccountDeletionRequestRow | null> {
  return getStore().findById(id);
}

export async function getUnresolvedAccountDeletionRequestForUser(
  clerkUserId: string
): Promise<AccountDeletionRequestRow | null> {
  const trimmed = clerkUserId.trim();
  if (!trimmed) return null;
  return getStore().findUnresolvedByUser(trimmed);
}

/**
 * Any account_deletion_requests row for the user (unresolved preferred,
 * otherwise latest including completed). Used by B3b entitlement guards.
 */
export async function getAnyAccountDeletionRequestForUser(
  clerkUserId: string
): Promise<AccountDeletionRequestRow | null> {
  const trimmed = clerkUserId.trim();
  if (!trimmed) return null;
  return getStore().findAnyByUser(trimmed);
}

/**
 * Create an initial `requested` row, or return the existing same-user
 * idempotent row. Blocks a second unresolved request (including failed_*).
 * Does not require a lease.
 *
 * Same key after completion returns the historical completed request
 * (created: false). A new deletion needs a new idempotency key.
 */
export async function createAccountDeletionRequest(
  input: CreateAccountDeletionRequestInput
): Promise<
  AccountDeletionRepoResult<{
    row: AccountDeletionRequestRow;
    created: boolean;
  }>
> {
  const clerkUserId = input.clerkUserId.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!clerkUserId || !idempotencyKey) {
    return {
      ok: false,
      code: "invalid_argument",
      message: "clerkUserId and idempotencyKey are required",
    };
  }

  const version =
    input.orchestrationVersion ?? ACCOUNT_DELETION_ORCHESTRATION_VERSION;
  const versionCheck = assertSupportedVersion(version);
  if (!versionCheck.ok) return versionCheck;

  const store = getStore();
  const existingSameKey = await store.findByUserAndIdempotency(
    clerkUserId,
    idempotencyKey
  );
  if (existingSameKey) {
    return { ok: true, value: { row: existingSameKey, created: false } };
  }

  const unresolved = await store.findUnresolvedByUser(clerkUserId);
  if (unresolved) {
    return {
      ok: false,
      code: "conflict_unresolved_exists",
      message: "An unresolved account deletion request already exists",
    };
  }

  const ts = nowIso(input.now);
  const row: AccountDeletionRequestRow = {
    id: randomUUID(),
    clerk_user_id: clerkUserId,
    orchestration_version: version,
    status: "requested",
    current_step: "requested",
    steps: {
      requested: { at: ts, ok: true, code: "created" },
    },
    attempt_count: 0,
    locked_at: null,
    lock_owner: null,
    created_at: ts,
    updated_at: ts,
    completed_at: null,
    last_retry_at: null,
    last_error_code: null,
    last_error_detail: null,
    sms_result: null,
    stripe_result: null,
    purge_result: null,
    clerk_result: null,
    idempotency_key: idempotencyKey,
  };

  try {
    const inserted = await store.insert(row);
    return { ok: true, value: { row: inserted, created: true } };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "23505") {
      const again = await store.findByUserAndIdempotency(
        clerkUserId,
        idempotencyKey
      );
      if (again) {
        return { ok: true, value: { row: again, created: false } };
      }
      return {
        ok: false,
        code: "conflict_unresolved_exists",
        message: "An unresolved account deletion request already exists",
      };
    }
    return {
      ok: false,
      code: "internal_error",
      message: "Failed to create account deletion request",
    };
  }
}

export async function acquireAccountDeletionLease(
  input: AcquireAccountDeletionLeaseInput
): Promise<AccountDeletionRepoResult<AccountDeletionRequestRow>> {
  const lockOwnerCheck = requireLockOwner(input.lockOwner);
  if (!lockOwnerCheck.ok) return lockOwnerCheck;

  const leaseMs = input.leaseMs ?? DEFAULT_ACCOUNT_DELETION_LEASE_MS;
  const now = input.now ?? new Date();
  const store = getStore();

  // Pre-read for clearer error codes only; acquisition itself is atomic in store.
  const row = await store.findById(input.requestId);
  if (!row) {
    return { ok: false, code: "not_found", message: "Request not found" };
  }

  const versionCheck = assertSupportedVersion(row.orchestration_version);
  if (!versionCheck.ok) return versionCheck;

  if (row.status === "completed" || row.status === "failed_terminal") {
    return {
      ok: false,
      code: "illegal_transition",
      message: `Cannot lease request in status ${row.status}`,
    };
  }

  const updated = await store.acquireLease({
    requestId: row.id,
    lockOwner: lockOwnerCheck.value,
    leaseMs,
    now,
  });

  if (!updated) {
    // Distinguish held vs race: re-read for message quality only.
    const again = await store.findById(input.requestId);
    if (
      again &&
      again.lock_owner &&
      again.lock_owner !== lockOwnerCheck.value &&
      !leaseExpiredInMemory(again, now, leaseMs)
    ) {
      return {
        ok: false,
        code: "lease_held",
        message: "Active lease held by another worker",
      };
    }
    return {
      ok: false,
      code: "cas_conflict",
      message: "Lease acquisition lost a race",
    };
  }

  return { ok: true, value: updated };
}

export async function releaseAccountDeletionLease(input: {
  requestId: string;
  lockOwner: string;
  now?: Date;
}): Promise<AccountDeletionRepoResult<AccountDeletionRequestRow>> {
  const lockOwnerCheck = requireLockOwner(input.lockOwner);
  if (!lockOwnerCheck.ok) return lockOwnerCheck;

  const store = getStore();
  const row = await store.findById(input.requestId);
  if (!row) {
    return { ok: false, code: "not_found", message: "Request not found" };
  }
  if (row.lock_owner !== lockOwnerCheck.value) {
    return {
      ok: false,
      code: "lease_not_held",
      message: "Caller does not hold the lease",
    };
  }

  const updated = await store.releaseLease({
    requestId: row.id,
    lockOwner: lockOwnerCheck.value,
    expectedStatus: row.status,
    expectedOrchestrationVersion: row.orchestration_version,
    now: input.now ?? new Date(),
  });

  if (!updated) {
    return {
      ok: false,
      code: "cas_conflict",
      message: "Lease release lost a race",
    };
  }
  return { ok: true, value: updated };
}

export async function transitionAccountDeletionRequest(
  input: TransitionAccountDeletionInput
): Promise<AccountDeletionRepoResult<AccountDeletionRequestRow>> {
  const lockOwnerCheck = requireLockOwner(input.lockOwner);
  if (!lockOwnerCheck.ok) return lockOwnerCheck;

  const leaseMs = input.leaseMs ?? DEFAULT_ACCOUNT_DELETION_LEASE_MS;
  const now = input.now ?? new Date();
  const store = getStore();
  const row = await store.findById(input.requestId);
  if (!row) {
    return { ok: false, code: "not_found", message: "Request not found" };
  }

  const expectedVersion =
    input.expectedOrchestrationVersion ?? row.orchestration_version;
  if (row.orchestration_version !== expectedVersion) {
    return {
      ok: false,
      code: "unsupported_orchestration_version",
      message: "Orchestration version mismatch",
    };
  }
  const versionCheck = assertSupportedVersion(row.orchestration_version);
  if (!versionCheck.ok) return versionCheck;

  if (row.status !== input.fromStatus) {
    return {
      ok: false,
      code: "cas_conflict",
      message: `Expected status ${input.fromStatus}, found ${row.status}`,
    };
  }

  // Resume target is derived from persisted current_step — never caller invention.
  if (input.fromStatus === "failed_retryable") {
    if (
      !isProcessingAccountDeletionStatus(row.current_step) ||
      input.toStatus !== row.current_step
    ) {
      return {
        ok: false,
        code: "illegal_transition",
        message: `Resume must target persisted current_step ${row.current_step}`,
      };
    }
  }

  if (
    !isLegalAccountDeletionTransition(input.fromStatus, input.toStatus, {
      persistedCurrentStep: row.current_step,
    })
  ) {
    return {
      ok: false,
      code: "illegal_transition",
      message: `Illegal transition ${input.fromStatus} → ${input.toStatus}`,
    };
  }

  if (row.lock_owner !== lockOwnerCheck.value) {
    return {
      ok: false,
      code: "lease_not_held",
      message: "Caller does not hold the lease",
    };
  }

  const ts = nowIso(now);
  const steps: AccountDeletionStepsJson = {
    ...row.steps,
    [input.toStatus]: {
      at: ts,
      ok: input.stepNote?.ok ?? true,
      code: input.stepNote?.code,
      from: input.fromStatus,
      to: input.toStatus,
      ...(input.stepNote?.detail
        ? {
            detail:
              sanitizeAccountDeletionErrorDetail(input.stepNote.detail) ??
              undefined,
          }
        : {}),
    },
  };

  const patch: CasPatch = {
    status: input.toStatus,
    current_step: input.toStatus,
    steps,
    clear_errors: true,
    last_error_code: null,
    last_error_detail: null,
  };

  if (input.smsResult !== undefined) {
    if (input.smsResult == null) {
      return {
        ok: false,
        code: "invalid_argument",
        message: "smsResult must be a non-null allowed value when set",
      };
    }
    patch.set_sms_result = true;
    patch.sms_result = input.smsResult;
  }

  if (input.stripeResult !== undefined) {
    if (input.stripeResult == null) {
      return {
        ok: false,
        code: "invalid_argument",
        message: "stripeResult must be a non-null allowed value when set",
      };
    }
    patch.set_stripe_result = true;
    patch.stripe_result = input.stripeResult;
  }

  if (input.purgeResult !== undefined) {
    if (input.purgeResult == null) {
      return {
        ok: false,
        code: "invalid_argument",
        message: "purgeResult must be a non-null allowed value when set",
      };
    }
    patch.set_purge_result = true;
    patch.purge_result = input.purgeResult;
  }

  if (input.fromStatus === "failed_retryable") {
    patch.last_retry_at = ts;
  }
  if (input.toStatus === "completed") {
    patch.completed_at = ts;
    patch.release_lock = true;
  }

  const updated = await store.casWithActiveLease({
    requestId: row.id,
    expectedStatus: input.fromStatus,
    expectedOrchestrationVersion: expectedVersion,
    lockOwner: lockOwnerCheck.value,
    leaseMs,
    now,
    patch,
  });

  if (!updated) {
    return {
      ok: false,
      code: "cas_conflict",
      message: "Transition lost a race or lease is not active",
    };
  }
  return { ok: true, value: updated };
}

/**
 * Same-status leased patch (steps / optional sms_result) for durable markers
 * before slow external work (e.g. Clerk). Does not advance the state machine.
 */
export async function patchAccountDeletionRequestWhileLeased(input: {
  requestId: string;
  expectedStatus: AccountDeletionStatus;
  lockOwner: string;
  steps: AccountDeletionStepsJson;
  smsResult?: AccountDeletionRequestRow["sms_result"];
  stripeResult?: AccountDeletionRequestRow["stripe_result"];
  purgeResult?: AccountDeletionRequestRow["purge_result"];
  leaseMs?: number;
  expectedOrchestrationVersion?: number;
  now?: Date;
}): Promise<AccountDeletionRepoResult<AccountDeletionRequestRow>> {
  const lockOwnerCheck = requireLockOwner(input.lockOwner);
  if (!lockOwnerCheck.ok) return lockOwnerCheck;

  if (input.smsResult !== undefined && input.smsResult == null) {
    return {
      ok: false,
      code: "invalid_argument",
      message: "smsResult must be a non-null allowed value when set",
    };
  }
  if (input.stripeResult !== undefined && input.stripeResult == null) {
    return {
      ok: false,
      code: "invalid_argument",
      message: "stripeResult must be a non-null allowed value when set",
    };
  }
  if (input.purgeResult !== undefined && input.purgeResult == null) {
    return {
      ok: false,
      code: "invalid_argument",
      message: "purgeResult must be a non-null allowed value when set",
    };
  }

  const leaseMs = input.leaseMs ?? DEFAULT_ACCOUNT_DELETION_LEASE_MS;
  const now = input.now ?? new Date();
  const store = getStore();
  const row = await store.findById(input.requestId);
  if (!row) {
    return { ok: false, code: "not_found", message: "Request not found" };
  }
  if (row.status !== input.expectedStatus) {
    return {
      ok: false,
      code: "cas_conflict",
      message: `Expected status ${input.expectedStatus}, found ${row.status}`,
    };
  }
  if (row.lock_owner !== lockOwnerCheck.value) {
    return {
      ok: false,
      code: "lease_not_held",
      message: "Caller does not hold the lease",
    };
  }

  const expectedVersion =
    input.expectedOrchestrationVersion ?? row.orchestration_version;
  if (row.orchestration_version !== expectedVersion) {
    return {
      ok: false,
      code: "unsupported_orchestration_version",
      message: "Orchestration version mismatch",
    };
  }

  const patch: CasPatch = {
    status: row.status,
    current_step: row.current_step,
    steps: input.steps,
  };
  if (input.smsResult !== undefined) {
    patch.set_sms_result = true;
    patch.sms_result = input.smsResult;
  }
  if (input.stripeResult !== undefined) {
    patch.set_stripe_result = true;
    patch.stripe_result = input.stripeResult;
  }
  if (input.purgeResult !== undefined) {
    patch.set_purge_result = true;
    patch.purge_result = input.purgeResult;
  }

  const updated = await store.casWithActiveLease({
    requestId: row.id,
    expectedStatus: input.expectedStatus,
    expectedOrchestrationVersion: expectedVersion,
    lockOwner: lockOwnerCheck.value,
    leaseMs,
    now,
    patch,
  });

  if (!updated) {
    return {
      ok: false,
      code: "cas_conflict",
      message: "Leased patch lost a race or lease is not active",
    };
  }
  return { ok: true, value: updated };
}

export async function recordAccountDeletionFailure(
  input: RecordAccountDeletionFailureInput
): Promise<AccountDeletionRepoResult<AccountDeletionRequestRow>> {
  const lockOwnerCheck = requireLockOwner(input.lockOwner);
  if (!lockOwnerCheck.ok) return lockOwnerCheck;

  const toStatus: AccountDeletionStatus = input.terminal
    ? "failed_terminal"
    : "failed_retryable";

  const leaseMs = input.leaseMs ?? DEFAULT_ACCOUNT_DELETION_LEASE_MS;
  const now = input.now ?? new Date();
  const store = getStore();
  const row = await store.findById(input.requestId);
  if (!row) {
    return { ok: false, code: "not_found", message: "Request not found" };
  }

  if (row.status !== input.fromStatus) {
    return {
      ok: false,
      code: "cas_conflict",
      message: `Expected status ${input.fromStatus}, found ${row.status}`,
    };
  }

  if (!isLegalAccountDeletionTransition(input.fromStatus, toStatus)) {
    return {
      ok: false,
      code: "illegal_transition",
      message: `Cannot fail from ${input.fromStatus}`,
    };
  }

  const expectedVersion =
    input.expectedOrchestrationVersion ?? row.orchestration_version;
  if (row.orchestration_version !== expectedVersion) {
    return {
      ok: false,
      code: "unsupported_orchestration_version",
      message: "Orchestration version mismatch",
    };
  }

  if (row.lock_owner !== lockOwnerCheck.value) {
    return {
      ok: false,
      code: "lease_not_held",
      message: "Caller does not hold the lease",
    };
  }

  let retryStep: AccountDeletionStatus = input.fromStatus;
  if (!input.terminal) {
    if (isProcessingAccountDeletionStatus(input.fromStatus)) {
      retryStep = input.fromStatus;
    } else {
      retryStep =
        nextForwardAccountDeletionStatus(input.fromStatus) ?? input.fromStatus;
    }
  }

  const ts = nowIso(now);
  const detail = sanitizeAccountDeletionErrorDetail(input.errorDetail);
  const steps: AccountDeletionStepsJson = {
    ...row.steps,
    [toStatus]: {
      at: ts,
      ok: false,
      code: input.errorCode,
      from: input.fromStatus,
      to: toStatus,
      ...(input.stepDetail
        ? { detail: sanitizeAccountDeletionErrorDetail(input.stepDetail) ?? undefined }
        : {}),
    },
  };

  const patch: CasPatch = {
    status: toStatus,
    current_step: input.terminal ? toStatus : retryStep,
    steps,
    last_error_code: input.errorCode.slice(0, 120),
    last_error_detail: detail,
    release_lock: true,
  };
  if (input.stripeResult !== undefined) {
    if (input.stripeResult == null) {
      return {
        ok: false,
        code: "invalid_argument",
        message: "stripeResult must be a non-null allowed value when set",
      };
    }
    patch.set_stripe_result = true;
    patch.stripe_result = input.stripeResult;
  }
  if (input.purgeResult !== undefined) {
    if (input.purgeResult == null) {
      return {
        ok: false,
        code: "invalid_argument",
        message: "purgeResult must be a non-null allowed value when set",
      };
    }
    patch.set_purge_result = true;
    patch.purge_result = input.purgeResult;
  }

  const updated = await store.casWithActiveLease({
    requestId: row.id,
    expectedStatus: input.fromStatus,
    expectedOrchestrationVersion: expectedVersion,
    lockOwner: lockOwnerCheck.value,
    leaseMs,
    now,
    patch,
  });

  if (!updated) {
    return {
      ok: false,
      code: "cas_conflict",
      message: "Failure recording lost a race or lease is not active",
    };
  }
  return { ok: true, value: updated };
}

export async function markAccountDeletionCompleted(input: {
  requestId: string;
  fromStatus: AccountDeletionStatus;
  lockOwner: string;
  leaseMs?: number;
  expectedOrchestrationVersion?: number;
  now?: Date;
}): Promise<AccountDeletionRepoResult<AccountDeletionRequestRow>> {
  return transitionAccountDeletionRequest({
    requestId: input.requestId,
    fromStatus: input.fromStatus,
    toStatus: "completed",
    lockOwner: input.lockOwner,
    leaseMs: input.leaseMs,
    expectedOrchestrationVersion: input.expectedOrchestrationVersion,
    now: input.now,
    stepNote: { ok: true, code: "completed" },
  });
}
