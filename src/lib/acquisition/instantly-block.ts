import { createHash } from "node:crypto";

import { normalizeAcquisitionEmail } from "@/lib/acquisition/model";

/**
 * Instantly workspace blocklist decisions.
 * Docs checked 2026-10-24:
 * POST https://api.instantly.ai/api/v2/block-lists-entries
 * body { bl_value } only. 200 returns id, timestamp_created, organization_id, bl_value, is_domain.
 * Scopes: block_list_entries:create, block_list_entries:all, all:create, all:all.
 * GET same path with search, limit 1-100. Read scopes include block_list_entries:read.
 * Documented errors include 400, 401, 402, 404, 429, and 504 on search.
 * 403 is not listed. A 403 is treated as missing permission, never as success.
 * This module does not delete entries, pause campaigns, or change sender accounts.
 */

export const INSTANTLY_BLOCK_LIST_URL = "https://api.instantly.ai/api/v2/block-lists-entries";

export const INSTANTLY_BLOCK_REASONS = [
  "trial_started",
  "paid_member",
  "unsubscribe",
  "complaint",
  "bounce",
] as const;

export type InstantlyBlockReason = (typeof INSTANTLY_BLOCK_REASONS)[number];

export type InstantlyBlockStatus = "pending" | "confirmed" | "failed" | "uncertain";

export type InstantlyBlockEvidence = {
  reason: InstantlyBlockReason;
  sourceEventId: string;
};

const SAFE_ENTRY_ID = /^[A-Za-z0-9-]{1,80}$/;
const TRANSIENT_BASE_MS = 15 * 60 * 1000;
const PERMISSION_BASE_MS = 6 * 60 * 60 * 1000;
const TRANSIENT_CAP_MS = 24 * 60 * 60 * 1000;
const PERMISSION_CAP_MS = 7 * 24 * 60 * 60 * 1000;

export type InstantlyBlockIntentResult =
  | { ok: true; outcome: "inserted" | "present" }
  | { ok: false; outcome: "not_stored" | "invalid_email" };

/** A held claim is in the future. A null or expired claim can be taken again. */
export function blockClaimHeld(claimUntil: string | null, now: Date): boolean {
  if (claimUntil == null) return false;
  const ms = Date.parse(claimUntil);
  return Number.isFinite(ms) && ms > now.getTime();
}

/**
 * Backoff grows with the attempt and then stops growing.
 * The row stays due again. Nothing here marks it successful or drops it.
 */
export function blockBackoffMs(attemptCount: number, kind: "transient" | "permission"): number {
  const base = kind === "permission" ? PERMISSION_BASE_MS : TRANSIENT_BASE_MS;
  const cap = kind === "permission" ? PERMISSION_CAP_MS : TRANSIENT_CAP_MS;
  const steps = Math.min(Math.max(Math.floor(attemptCount) - 1, 0), 12);
  return Math.min(base * 2 ** steps, cap);
}

export function instantlyBlocklistEnabled(value: unknown): boolean {
  return value === "on";
}

export function instantlyBlockSourceId(kind: string, id: string): string {
  const raw = `${kind}:${id}`;
  if (raw.length <= 180) return raw;
  return `${kind}:${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}

export function instantlyBlockReasonForSuppression(
  reason: "unsubscribe" | "complaint" | "bounce" | "provider",
): InstantlyBlockReason | null {
  if (reason === "unsubscribe" || reason === "complaint" || reason === "bounce") return reason;
  return null;
}

/** Offer decline and subscription close do not create or remove a block. */
export function instantlyBlockReasonForLifecycle(signal: string): InstantlyBlockReason | null {
  if (signal === "trial_started" || signal === "paid_member") return signal;
  return null;
}

export function mergeBlockIntent<T extends {
  personId: string | null;
  reason: InstantlyBlockReason;
  status: InstantlyBlockStatus;
  providerEntryId: string | null;
  evidence: InstantlyBlockEvidence[];
}>(existing: T, incoming: {
  personId: string | null;
  reason: InstantlyBlockReason;
  sourceEventId: string;
}): T {
  const already = existing.evidence.some((item) => item.sourceEventId === incoming.sourceEventId);
  const evidence = already
    ? existing.evidence
    : [...existing.evidence, { reason: incoming.reason, sourceEventId: incoming.sourceEventId }].slice(-8);
  return {
    ...existing,
    personId: existing.personId ?? incoming.personId,
    evidence,
  };
}

type FetchResult = {
  status: number;
  body: unknown;
} | { thrown: true };

async function requestBlock(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<FetchResult> {
  try {
    const response = await fetchImpl(url, init);
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch {
    return { thrown: true };
  }
}

function matchingEntry(value: unknown, email: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.is_domain !== false) return null;
  if (typeof row.bl_value !== "string" || row.bl_value.trim().toLowerCase() !== email) return null;
  if (typeof row.id !== "string" || !SAFE_ENTRY_ID.test(row.id)) return null;
  return row.id;
}

export function matchBlockListEntry(payload: unknown, email: string): {
  id: string | null;
  truncated: boolean;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { id: null, truncated: false };
  }
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return { id: null, truncated: false };
  for (const item of items) {
    const id = matchingEntry(item, email);
    if (id) return { id, truncated: false };
  }
  return { id: null, truncated: items.length >= 100 };
}

export type InstantlyBlockAdvance = {
  status: InstantlyBlockStatus;
  providerEntryId: string | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  confirmedAt: string | null;
};

function confirmed(id: string, now: Date): InstantlyBlockAdvance {
  return {
    status: "confirmed",
    providerEntryId: id,
    lastError: null,
    nextAttemptAt: null,
    confirmedAt: now.toISOString(),
  };
}

function retryAt(now: Date, attemptCount: number, kind: "transient" | "permission"): string {
  return new Date(now.getTime() + blockBackoffMs(attemptCount, kind)).toISOString();
}

function classifyHttp(
  result: Exclude<FetchResult, { thrown: true }>,
  email: string,
  now: Date,
  attemptCount: number,
): InstantlyBlockAdvance | "absent" {
  if (result.status === 401 || result.status === 403) {
    return {
      status: "failed",
      providerEntryId: null,
      lastError: "permission_denied",
      nextAttemptAt: retryAt(now, attemptCount, "permission"),
      confirmedAt: null,
    };
  }
  if (result.status === 429) {
    return {
      status: "pending",
      providerEntryId: null,
      lastError: "rate_limited",
      nextAttemptAt: retryAt(now, attemptCount, "transient"),
      confirmedAt: null,
    };
  }
  if (result.status === 200) {
    const id = matchingEntry(result.body, email);
    if (id) return confirmed(id, now);
    const items = result.body && typeof result.body === "object" && !Array.isArray(result.body)
      ? (result.body as { items?: unknown }).items
      : undefined;
    if (Array.isArray(items)) {
      const listed = matchBlockListEntry(result.body, email);
      if (listed.id) return confirmed(listed.id, now);
      if (listed.truncated) {
        return {
          status: "uncertain",
          providerEntryId: null,
          lastError: "read_truncated",
          nextAttemptAt: retryAt(now, attemptCount, "transient"),
          confirmedAt: null,
        };
      }
      return "absent";
    }
    return {
      status: "uncertain",
      providerEntryId: null,
      lastError: "unreadable_response",
      nextAttemptAt: retryAt(now, attemptCount, "transient"),
      confirmedAt: null,
    };
  }
  if (result.status === 504 || result.status >= 500) {
    return {
      status: "uncertain",
      providerEntryId: null,
      lastError: "timeout_or_network",
      nextAttemptAt: retryAt(now, attemptCount, "transient"),
      confirmedAt: null,
    };
  }
  if (result.status === 400 || result.status === 402 || result.status === 404) {
    return {
      status: "failed",
      providerEntryId: null,
      lastError: "provider_rejected",
      nextAttemptAt: retryAt(now, attemptCount, "permission"),
      confirmedAt: null,
    };
  }
  return {
    status: "uncertain",
    providerEntryId: null,
    lastError: "unreadable_response",
    nextAttemptAt: retryAt(now, attemptCount, "transient"),
    confirmedAt: null,
  };
}

export async function advanceInstantlyBlock(args: {
  enabled: boolean;
  apiKey: string | null;
  email: string;
  status: InstantlyBlockStatus;
  attemptCount?: number;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<InstantlyBlockAdvance & { requested: boolean }> {
  const now = args.now ?? new Date();
  const attemptCount = args.attemptCount ?? 1;
  const unchanged = {
    status: args.status,
    providerEntryId: null,
    lastError: null,
    nextAttemptAt: null,
    confirmedAt: null,
    requested: false,
  };
  if (!args.enabled) return unchanged;
  if (args.status === "confirmed") return unchanged;
  if (!args.apiKey) {
    return {
      ...unchanged,
      lastError: "missing_credentials",
      nextAttemptAt: retryAt(now, attemptCount, "permission"),
    };
  }
  const fetchImpl = args.fetchImpl ?? fetch;
  const headers = {
    Authorization: `Bearer ${args.apiKey}`,
    Accept: "application/json",
  };
  const searchUrl = `${INSTANTLY_BLOCK_LIST_URL}?limit=100&search=${encodeURIComponent(args.email)}`;

  const readBack = async (): Promise<InstantlyBlockAdvance | "absent"> => {
    const listed = await requestBlock(searchUrl, { method: "GET", headers }, fetchImpl);
    if ("thrown" in listed) {
      return {
        status: "uncertain",
        providerEntryId: null,
        lastError: "timeout_or_network",
        nextAttemptAt: retryAt(now, attemptCount, "transient"),
        confirmedAt: null,
      };
    }
    return classifyHttp(listed, args.email, now, attemptCount);
  };

  if (args.status === "uncertain") {
    const read = await readBack();
    if (read !== "absent") return { ...read, requested: true };
  }

  const created = await requestBlock(INSTANTLY_BLOCK_LIST_URL, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ bl_value: args.email }),
  }, fetchImpl);
  if ("thrown" in created) {
    return {
      status: "uncertain",
      providerEntryId: null,
      lastError: "timeout_or_network",
      nextAttemptAt: retryAt(now, attemptCount, "transient"),
      confirmedAt: null,
      requested: true,
    };
  }
  if (created.status === 400) {
    const read = await readBack();
    if (read !== "absent") return { ...read, requested: true };
    return {
      status: "failed",
      providerEntryId: null,
      lastError: "provider_rejected",
      nextAttemptAt: retryAt(now, attemptCount, "permission"),
      confirmedAt: null,
      requested: true,
    };
  }
  const classified = classifyHttp(created, args.email, now, attemptCount);
  if (classified !== "absent") return { ...classified, requested: true };
  return {
    status: "failed",
    providerEntryId: null,
    lastError: "provider_rejected",
    nextAttemptAt: retryAt(now, attemptCount, "permission"),
    confirmedAt: null,
    requested: true,
  };
}

export type BlockCoverageInputPerson = {
  id: string;
  email: string;
  lifecycle: string;
};

export type BlockCoverageInputSuppression = {
  email: string;
  reason: string;
};

export type BlockCoverageProposal = {
  email: string;
  personId: string | null;
  reason: InstantlyBlockReason;
  sourceEventId: string;
  evidence: InstantlyBlockEvidence[];
};

export type BlockCoveragePlan = {
  proposals: BlockCoverageProposal[];
  alreadyCovered: number;
  excluded: {
    declined: number;
    provider: number;
    unspecifiedSuppressed: number;
    other: number;
  };
};

const COVERAGE_RANK: Record<InstantlyBlockReason, number> = {
  complaint: 5,
  bounce: 4,
  unsubscribe: 3,
  paid_member: 2,
  trial_started: 1,
};

/**
 * Missing stop intents from authoritative rows.
 * A trial stays a trial, including a person who has since expired.
 * Unsubscribe comes from an unsubscribe row. Declined rows are not proposed.
 */
export function planInstantlyBlockCoverage(args: {
  people: readonly BlockCoverageInputPerson[];
  suppressions: readonly BlockCoverageInputSuppression[];
  blockedEmails: readonly string[];
}): BlockCoveragePlan {
  const blocked = new Set(
    args.blockedEmails.flatMap((email) => {
      const normalized = normalizeAcquisitionEmail(email);
      return normalized ? [normalized] : [];
    }),
  );
  const byEmail = new Map<string, BlockCoverageProposal>();
  const covered = new Set<string>();
  const excluded = { declined: 0, provider: 0, unspecifiedSuppressed: 0, other: 0 };

  const consider = (
    emailRaw: string,
    personId: string | null,
    reason: InstantlyBlockReason,
    sourceKind: string,
    sourceId: string,
  ) => {
    const email = normalizeAcquisitionEmail(emailRaw);
    if (!email) return;
    if (blocked.has(email)) {
      covered.add(email);
      return;
    }
    const sourceEventId = instantlyBlockSourceId(
      sourceKind,
      sourceKind.startsWith("suppression:") ? email : sourceId,
    );
    const item = { reason, sourceEventId };
    const existing = byEmail.get(email);
    if (!existing) {
      byEmail.set(email, {
        email,
        personId,
        reason,
        sourceEventId,
        evidence: [item],
      });
      return;
    }
    if (personId && !existing.personId) existing.personId = personId;
    if (!existing.evidence.some((entry) => entry.sourceEventId === sourceEventId)) {
      existing.evidence.push(item);
    }
    if (COVERAGE_RANK[reason] > COVERAGE_RANK[existing.reason]) {
      existing.reason = reason;
      existing.sourceEventId = sourceEventId;
    }
  };

  for (const row of args.suppressions) {
    if (row.reason === "provider") {
      excluded.provider += 1;
      continue;
    }
    const reason = instantlyBlockReasonForSuppression(
      row.reason === "unsubscribe" || row.reason === "complaint" || row.reason === "bounce"
        ? row.reason
        : "provider",
    );
    if (!reason) {
      excluded.other += 1;
      continue;
    }
    consider(row.email, null, reason, `suppression:${reason}`, row.email);
  }

  for (const person of args.people) {
    if (person.lifecycle === "trial_expired") {
      consider(person.email, person.id, "trial_started", "person:trial_expired", person.id);
      continue;
    }
    if (person.lifecycle === "not_interested") {
      excluded.declined += 1;
      continue;
    }
    if (person.lifecycle === "suppressed") {
      const email = normalizeAcquisitionEmail(person.email);
      if (email && !blocked.has(email) && !byEmail.has(email)) excluded.unspecifiedSuppressed += 1;
      continue;
    }
    if (person.lifecycle === "trial_started" || person.lifecycle === "paid_member") {
      consider(person.email, person.id, person.lifecycle, `person:${person.lifecycle}`, person.id);
      continue;
    }
    if (person.lifecycle === "unsubscribed") {
      consider(person.email, person.id, "unsubscribe", "person:unsubscribed", person.id);
      continue;
    }
    excluded.other += 1;
  }

  const proposals = [...byEmail.values()];
  for (const proposal of proposals) {
    proposal.evidence.sort((a, b) => COVERAGE_RANK[b.reason] - COVERAGE_RANK[a.reason]);
    const primary = proposal.evidence[0];
    if (!primary) continue;
    proposal.reason = primary.reason;
    proposal.sourceEventId = primary.sourceEventId;
  }
  return { proposals, alreadyCovered: covered.size, excluded };
}
