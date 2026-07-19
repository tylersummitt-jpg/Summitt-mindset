/**
 * APP-041E3a — Clerk REST deletion adapter (server-only, unreachable).
 *
 * Implements ClerkDeletionAdapter via explicit DELETE to Clerk Backend API.
 * No route, cron, scheduler, or default invocation. Callers must inject
 * secretKey, fetch, and timeoutMs — no ambient env lookup.
 *
 * Never returns or logs PII, raw bodies, stacks, tokens, or headers.
 */

import "server-only";

import type {
  ClerkDeletionAdapter,
  ClerkDeletionResult,
} from "./clerk-deletion-adapter";

export const CLERK_REST_DELETE_CODES = {
  deleted: "clerk_deleted",
  already_absent: "clerk_already_absent",
  http_retryable: "clerk_http_retryable",
  network: "clerk_network_error",
  timeout: "clerk_timeout",
  auth_or_config: "clerk_auth_or_config",
  client_error: "clerk_client_error",
  invalid_user_id: "clerk_invalid_user_id",
  invalid_adapter_config: "clerk_invalid_adapter_config",
} as const;

export type CreateClerkRestDeletionAdapterInput = {
  /** Explicit Clerk secret; never read from process.env here. */
  secretKey: string;
  /** Explicit fetch implementation (inject mock in tests). */
  fetch: typeof globalThis.fetch;
  /** Positive finite timeout in milliseconds. */
  timeoutMs: number;
};

const CLERK_USERS_BASE = "https://api.clerk.com/v1/users";

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * Build a ClerkDeletionAdapter that DELETEs a user by durable Clerk user id.
 * Captures secret/fetch/timeout at construction; later mutation of the input
 * object does not affect the adapter.
 */
export function createClerkRestDeletionAdapter(
  input: CreateClerkRestDeletionAdapterInput
): ClerkDeletionAdapter {
  if (!input || typeof input !== "object") {
    throw new Error(CLERK_REST_DELETE_CODES.invalid_adapter_config);
  }

  const secretKey =
    typeof input.secretKey === "string" ? input.secretKey.trim() : "";
  if (!secretKey) {
    throw new Error(CLERK_REST_DELETE_CODES.invalid_adapter_config);
  }

  const fetchImpl = input.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error(CLERK_REST_DELETE_CODES.invalid_adapter_config);
  }

  const timeoutMs = input.timeoutMs;
  if (
    !Number.isFinite(timeoutMs) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120_000
  ) {
    throw new Error(CLERK_REST_DELETE_CODES.invalid_adapter_config);
  }

  // Capture primitives/function refs at construction time.
  const capturedSecret = secretKey;
  const capturedFetch = fetchImpl;
  const capturedTimeoutMs = timeoutMs;

  return Object.freeze({
    async deleteUser(args: {
      clerkUserId: string;
    }): Promise<ClerkDeletionResult> {
      const clerkUserId =
        typeof args?.clerkUserId === "string" ? args.clerkUserId.trim() : "";
      if (!clerkUserId) {
        return {
          outcome: "terminal_error",
          code: CLERK_REST_DELETE_CODES.invalid_user_id,
        };
      }

      const url = `${CLERK_USERS_BASE}/${encodeURIComponent(clerkUserId)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), capturedTimeoutMs);

      try {
        const res = await capturedFetch(url, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${capturedSecret}` },
          cache: "no-store",
          signal: controller.signal,
        });

        // Status-only mapping — never read or retain response body.
        const status = res.status;
        if (status === 200 || status === 204) {
          return {
            outcome: "deleted",
            code: CLERK_REST_DELETE_CODES.deleted,
          };
        }
        if (status === 404) {
          return {
            outcome: "already_absent",
            code: CLERK_REST_DELETE_CODES.already_absent,
          };
        }
        if (status === 429 || status >= 500) {
          return {
            outcome: "retryable_error",
            code: CLERK_REST_DELETE_CODES.http_retryable,
          };
        }
        if (status === 401 || status === 403) {
          return {
            outcome: "terminal_error",
            code: CLERK_REST_DELETE_CODES.auth_or_config,
          };
        }
        if (status >= 400 && status < 500) {
          return {
            outcome: "terminal_error",
            code: CLERK_REST_DELETE_CODES.client_error,
          };
        }
        return {
          outcome: "retryable_error",
          code: CLERK_REST_DELETE_CODES.http_retryable,
        };
      } catch (err) {
        if (isAbortError(err)) {
          return {
            outcome: "retryable_error",
            code: CLERK_REST_DELETE_CODES.timeout,
          };
        }
        return {
          outcome: "retryable_error",
          code: CLERK_REST_DELETE_CODES.network,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
