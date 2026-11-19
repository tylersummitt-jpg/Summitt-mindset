import { continueAfterInstantlyPage, parseInstantlyListPayload } from "@/lib/acquisition/backfill";
import {
  normalizeAcquisitionEmail,
  reduceLiveSignal,
  type AcquisitionLifecycle,
} from "@/lib/acquisition/model";

/**
 * One-way import of Instantly's workspace block list.
 * Docs checked 2026-11-17: GET /api/v2/block-lists-entries.
 * BlockListEntry fields are id, timestamp_created, organization_id, bl_value, is_domain.
 * There is no suppression reason and no updated_since filter.
 * This module does not delete entries, send email, or change campaigns.
 */

export const BLOCK_IMPORT_PAGE_BUDGET = 20;
export const BLOCK_IMPORT_PAGE_LIMIT = 100;
export const BLOCK_IMPORT_CLAIM_MS = 4 * 60 * 1000;
const ENTRY_ID = /^[A-Za-z0-9-]{1,80}$/;
const SAFE_ERROR_ID = /^[A-Za-z0-9-]{1,64}$/;
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const CURSOR_MAX = 200;

export const BLOCK_IMPORT_REASONS = ["unsubscribe", "complaint", "bounce", "provider"] as const;
export type BlockImportReason = (typeof BLOCK_IMPORT_REASONS)[number];

export type BlockImportEntry = {
  id: string;
  value: string;
  isDomain: boolean;
};

export type BlockImportPerson = {
  id: string;
  email: string;
  lifecycle: AcquisitionLifecycle;
};

export type BlockImportPlan = {
  insertSuppression: boolean;
  nextLifecycle: AcquisitionLifecycle | null;
  cancelOutbound: boolean;
  providerEventId: string;
  personId: string | null;
};

export type BlockImportClaim =
  | {
      ok: true;
      generation: number;
      cursor: string | null;
      cycle: number;
      pages: number;
    }
  | { ok: false; reason: "contended" | "unreadable" };

export type BlockImportCommit =
  | { kind: "progress"; generation: number; cursor: string; pages: number }
  | {
      kind: "complete";
      generation: number;
      cycle: number;
      completedCycle: number;
      completedAt: string;
      pages: number;
    }
  | { kind: "error"; generation: number; error: string };

export type BlockImportRun = {
  readable: boolean;
  cycleCompletedThisRun: boolean;
  pagesRead: number;
  error: string | null;
};

export type ImportLease = {
  cursor: string | null;
  cycle: number;
  pages: number;
  generation: number;
  claimUntil: string | null;
  completedCycle: number | null;
  completedAt: string | null;
  error: string | null;
};

export type BlockImportStore = {
  suppressionReason(email: string): Promise<BlockImportReason | null | "unreadable">;
  insertSuppression(email: string): Promise<"inserted" | "duplicate" | "failed">;
  personByEmail(email: string): Promise<BlockImportPerson | null | "unreadable">;
  advanceLifecycle(personId: string, from: AcquisitionLifecycle, to: AcquisitionLifecycle): Promise<"advanced" | "lost" | "failed">;
  cancelScheduled(personId: string): Promise<boolean>;
  cancelExpiredClaims(personId: string): Promise<boolean>;
  clearNextAction(personId: string): Promise<boolean>;
  insertEvent(args: { personId: string | null; providerEventId: string }): Promise<"stored" | "duplicate" | "failed">;
  upsertDomain(args: { domain: string; providerEntryId: string }): Promise<boolean>;
  cancelDomainOutbound(domain: string): Promise<boolean>;
};

export function blockDomain(value: string): string | null {
  const domain = value.trim().toLowerCase();
  if (domain.length < 4 || domain.length > 253 || !DOMAIN.test(domain)) return null;
  return domain;
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  return blockDomain(email.slice(at + 1));
}

export function blockImportPlan(args: {
  entryId: string;
  person: { id: string; lifecycle: AcquisitionLifecycle } | null;
  existingReason: BlockImportReason | null;
  eventPersonId: string | null;
}): BlockImportPlan {
  const reduced = args.person ? reduceLiveSignal(args.person.lifecycle, "bounced") : null;
  const suffix = args.eventPersonId ? `:${args.eventPersonId}` : "";
  return {
    insertSuppression: args.existingReason == null,
    nextLifecycle: reduced?.outcome === "advance" ? reduced.state : null,
    cancelOutbound: args.person != null,
    providerEventId: `instantly-block:${args.entryId}${suffix}`,
    personId: args.person?.id ?? null,
  };
}

export function parseBlockListPage(body: unknown):
  | { ok: true; entries: BlockImportEntry[]; itemCount: number; nextCursor: string | null }
  | { ok: false; reason: "unreadable" | "invalid_entry"; entryId: string | null } {
  const parsed = parseInstantlyListPayload(body);
  if (!parsed.ok) return { ok: false, reason: "unreadable", entryId: null };
  if (parsed.nextCursor && !safeCursor(parsed.nextCursor)) {
    return { ok: false, reason: "unreadable", entryId: null };
  }
  const entries: BlockImportEntry[] = [];
  for (const item of parsed.items) {
    const entry = parseBlockListEntry(item);
    if (!entry) return { ok: false, reason: "invalid_entry", entryId: safeEntryId(item) };
    entries.push(entry);
  }
  return { ok: true, entries, itemCount: parsed.items.length, nextCursor: parsed.nextCursor };
}

/** A provider id we can store without treating the raw value as a recipient. */
export function invalidEntryError(entryId: string | null): string {
  if (entryId && SAFE_ERROR_ID.test(entryId)) return `invalid_entry:${entryId}`;
  return "invalid_entry";
}

/**
 * Automatic prospect mail is allowed only after this invocation finishes the
 * whole block-list walk. A previous completed_at, a search miss, and a sampled
 * recipient list are not inputs.
 */
export function automaticSendsAllowed(args: {
  readable: boolean;
  cycleCompletedThisRun: boolean;
}): boolean {
  return args.readable && args.cycleCompletedThisRun;
}

export function leaseIsHeld(lease: ImportLease, now: Date): boolean {
  if (!lease.claimUntil) return false;
  const until = Date.parse(lease.claimUntil);
  return Number.isFinite(until) && until > now.getTime();
}

export function claimImportLease(
  lease: ImportLease,
  now: Date,
  claimMs = BLOCK_IMPORT_CLAIM_MS,
):
  | { ok: true; lease: ImportLease; claim: Extract<BlockImportClaim, { ok: true }> }
  | { ok: false; reason: "contended" } {
  if (leaseIsHeld(lease, now)) return { ok: false, reason: "contended" };
  const next: ImportLease = {
    ...lease,
    generation: lease.generation + 1,
    claimUntil: new Date(now.getTime() + claimMs).toISOString(),
  };
  return {
    ok: true,
    lease: next,
    claim: {
      ok: true,
      generation: next.generation,
      cursor: lease.cursor,
      cycle: lease.cycle,
      pages: lease.pages,
    },
  };
}

export function commitImportLease(
  lease: ImportLease,
  patch: BlockImportCommit,
  now: Date,
  claimMs = BLOCK_IMPORT_CLAIM_MS,
): { ok: true; lease: ImportLease } | { ok: false } {
  if (lease.generation !== patch.generation) return { ok: false };
  if (!leaseIsHeld(lease, now)) return { ok: false };
  if (patch.kind === "progress") {
    return {
      ok: true,
      lease: {
        ...lease,
        cursor: patch.cursor,
        pages: patch.pages,
        error: null,
        claimUntil: new Date(now.getTime() + claimMs).toISOString(),
      },
    };
  }
  if (patch.kind === "complete") {
    return {
      ok: true,
      lease: {
        ...lease,
        cursor: null,
        cycle: patch.cycle,
        completedCycle: patch.completedCycle,
        completedAt: patch.completedAt,
        pages: patch.pages,
        error: null,
        claimUntil: null,
      },
    };
  }
  return {
    ok: true,
    lease: {
      ...lease,
      error: patch.error.slice(0, 80),
      claimUntil: null,
    },
  };
}

export async function applyBlockPage(
  store: BlockImportStore,
  entries: readonly BlockImportEntry[],
): Promise<boolean> {
  for (const entry of entries) {
    if (entry.isDomain) {
      const domain = blockDomain(entry.value);
      if (!domain) return false;
      if (!(await store.upsertDomain({ domain, providerEntryId: entry.id }))) return false;
      const recorded = await store.insertEvent({
        personId: null,
        providerEventId: `instantly-block:${entry.id}`,
      });
      if (recorded === "failed") return false;
      if (!(await store.cancelDomainOutbound(domain))) return false;
      continue;
    }
    const person = await store.personByEmail(entry.value);
    if (person === "unreadable") return false;
    const applied = await applyEmailStop(store, {
      entryId: entry.id,
      email: entry.value,
      person,
      eventPersonId: null,
    });
    if (!applied) return false;
  }
  return true;
}

export async function runBlockImport(args: {
  budget: number;
  claim: () => Promise<BlockImportClaim>;
  readPage: (cursor: string | null) => Promise<{ ok: true; body: unknown } | { ok: false; error: string }>;
  applyPage: (entries: readonly BlockImportEntry[]) => Promise<boolean>;
  commit: (patch: BlockImportCommit) => Promise<boolean>;
  now: Date;
  /** Same clock the caller uses for claim and commit. Defaults to the supplied instant. */
  clock?: () => Date;
}): Promise<BlockImportRun> {
  const clock = args.clock ?? (() => args.now);
  const claim = await args.claim();
  if (!claim.ok) {
    return {
      readable: claim.reason !== "unreadable",
      cycleCompletedThisRun: false,
      pagesRead: 0,
      error: claim.reason === "unreadable" ? "unreadable" : null,
    };
  }
  let cursor = claim.cursor;
  let pagesRead = 0;
  const seen = new Set<string>();
  if (cursor) seen.add(cursor);
  for (let index = 0; index < args.budget; index += 1) {
    const page = await args.readPage(cursor);
    if (!page.ok) {
      await args.commit({ kind: "error", generation: claim.generation, error: page.error });
      return { readable: true, cycleCompletedThisRun: false, pagesRead, error: page.error };
    }
    const parsed = parseBlockListPage(page.body);
    if (!parsed.ok) {
      const error = parsed.reason === "invalid_entry" ? invalidEntryError(parsed.entryId) : "unreadable";
      await args.commit({ kind: "error", generation: claim.generation, error });
      return { readable: true, cycleCompletedThisRun: false, pagesRead, error };
    }
    const decision = continueAfterInstantlyPage({
      pageNumber: index + 1,
      pageCap: args.budget + 1,
      itemCount: parsed.itemCount,
      nextCursor: parsed.nextCursor,
      requestCursor: cursor,
    });
    if (!(await args.applyPage(parsed.entries))) {
      await args.commit({ kind: "error", generation: claim.generation, error: "database" });
      return { readable: true, cycleCompletedThisRun: false, pagesRead, error: "database" };
    }
    pagesRead += 1;
    if (!decision.continue) {
      if (!decision.complete) {
        await args.commit({
          kind: "error",
          generation: claim.generation,
          error: decision.error ?? "unreadable",
        });
        return {
          readable: true,
          cycleCompletedThisRun: false,
          pagesRead,
          error: decision.error ?? "unreadable",
        };
      }
      const saved = await args.commit({
        kind: "complete",
        generation: claim.generation,
        cycle: claim.cycle + 1,
        completedCycle: claim.cycle,
        completedAt: clock().toISOString(),
        pages: claim.pages + pagesRead,
      });
      return {
        readable: true,
        cycleCompletedThisRun: saved,
        pagesRead,
        error: saved ? null : "database",
      };
    }
    const next = parsed.nextCursor;
    if (!next || seen.has(next)) {
      await args.commit({ kind: "error", generation: claim.generation, error: "cursor_repeated" });
      return { readable: true, cycleCompletedThisRun: false, pagesRead, error: "cursor_repeated" };
    }
    seen.add(next);
    const saved = await args.commit({
      kind: "progress",
      generation: claim.generation,
      cursor: next,
      pages: claim.pages + pagesRead,
    });
    if (!saved) {
      return { readable: true, cycleCompletedThisRun: false, pagesRead, error: "database" };
    }
    cursor = next;
  }
  return { readable: true, cycleCompletedThisRun: false, pagesRead, error: null };
}

async function applyEmailStop(
  store: BlockImportStore,
  args: {
    entryId: string;
    email: string;
    person: BlockImportPerson | null;
    eventPersonId: string | null;
  },
): Promise<boolean> {
  const reason = await store.suppressionReason(args.email);
  if (reason === "unreadable") return false;
  const person = args.person;
  const plan = blockImportPlan({
    entryId: args.entryId,
    person,
    existingReason: reason,
    eventPersonId: args.eventPersonId,
  });
  if (plan.insertSuppression) {
    const inserted = await store.insertSuppression(args.email);
    if (inserted === "failed") return false;
  }
  if (plan.nextLifecycle && person) {
    const advanced = await store.advanceLifecycle(person.id, person.lifecycle, plan.nextLifecycle);
    if (advanced === "failed") return false;
    if (advanced === "lost") {
      const current = await store.personByEmail(args.email);
      if (current === "unreadable") return false;
      const retry = blockImportPlan({
        entryId: args.entryId,
        person: current,
        existingReason: "provider",
        eventPersonId: args.eventPersonId,
      });
      if (retry.nextLifecycle && current) {
        const second = await store.advanceLifecycle(current.id, current.lifecycle, retry.nextLifecycle);
        if (second !== "advanced") return false;
      }
    }
  }
  if (plan.cancelOutbound && person) {
    if (!(await store.cancelScheduled(person.id))) return false;
    if (!(await store.cancelExpiredClaims(person.id))) return false;
    if (!(await store.clearNextAction(person.id))) return false;
  }
  const event = await store.insertEvent({
    personId: plan.personId,
    providerEventId: plan.providerEventId,
  });
  return event !== "failed";
}

function safeEntryId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

function parseBlockListEntry(value: unknown): BlockImportEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !ENTRY_ID.test(row.id)) return null;
  if (typeof row.bl_value !== "string" || typeof row.is_domain !== "boolean") return null;
  if (row.is_domain) {
    const domain = blockDomain(row.bl_value);
    if (!domain) return null;
    return { id: row.id, value: domain, isDomain: true };
  }
  const email = normalizeAcquisitionEmail(row.bl_value);
  if (!email) return null;
  return { id: row.id, value: email, isDomain: false };
}

function safeCursor(value: string): boolean {
  return value.length >= 1 && value.length <= CURSOR_MAX && !/\s/.test(value);
}
