import "server-only";

import {
  advanceInstantlyBlock,
  instantlyBlocklistEnabled,
  mergeBlockIntent,
  planInstantlyBlockCoverage,
  type BlockCoverageInputPerson,
  type BlockCoverageInputSuppression,
  type BlockCoveragePlan,
  type BlockCoverageProposal,
  type InstantlyBlockEvidence,
  type InstantlyBlockIntentResult,
  type InstantlyBlockReason,
  type InstantlyBlockStatus,
} from "@/lib/acquisition/instantly-block";
import {
  unavailableInstantlyBlockVisibility,
  type InstantlyBlockVisibility,
} from "@/lib/acquisition/instantly-block-visibility";
import { normalizeAcquisitionEmail } from "@/lib/acquisition/model";
import { supabaseServer } from "@/lib/supabase-server";

const CLAIM_MS = 2 * 60 * 1000;
const PAGE_SIZE = 1000;
const PAGE_CAP = 50;
export const RECONCILE_PAGE_SIZE = 100;
export const RECONCILE_MAX_PAGES = 2;
export const RECONCILE_RECENT = 25;
export const RECONCILE_WRITE_CAP = 5;

const COVERAGE_LIFECYCLES = [
  "trial_started",
  "paid_member",
  "trial_expired",
  "not_interested",
  "unsubscribed",
  "suppressed",
] as const;

type BlockRow = {
  id: string;
  personId: string | null;
  email: string;
  reason: InstantlyBlockReason;
  status: InstantlyBlockStatus;
  sourceEventId: string;
  providerEntryId: string | null;
  providerConfirmedAt: string | null;
  evidence: InstantlyBlockEvidence[];
  attemptCount: number;
};

function evidenceFrom(value: unknown): InstantlyBlockEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { reason?: unknown; sourceEventId?: unknown };
    if (
      row.reason !== "trial_started" &&
      row.reason !== "paid_member" &&
      row.reason !== "unsubscribe" &&
      row.reason !== "complaint" &&
      row.reason !== "bounce"
    ) return [];
    if (typeof row.sourceEventId !== "string" || row.sourceEventId.length < 1) return [];
    return [{ reason: row.reason, sourceEventId: row.sourceEventId }];
  });
}

function asRow(value: Record<string, unknown> | null): BlockRow | null {
  if (!value || typeof value.id !== "string" || typeof value.email_normalized !== "string") return null;
  if (
    value.reason !== "trial_started" &&
    value.reason !== "paid_member" &&
    value.reason !== "unsubscribe" &&
    value.reason !== "complaint" &&
    value.reason !== "bounce"
  ) return null;
  if (value.status !== "pending" && value.status !== "confirmed" && value.status !== "failed" && value.status !== "uncertain") {
    return null;
  }
  return {
    id: value.id,
    personId: typeof value.person_id === "string" ? value.person_id : null,
    email: value.email_normalized,
    reason: value.reason,
    status: value.status,
    sourceEventId: typeof value.source_event_id === "string" ? value.source_event_id : "",
    providerEntryId: typeof value.provider_entry_id === "string" ? value.provider_entry_id : null,
    providerConfirmedAt: typeof value.provider_confirmed_at === "string" ? value.provider_confirmed_at : null,
    evidence: evidenceFrom(value.evidence),
    attemptCount: typeof value.attempt_count === "number" ? value.attempt_count : 0,
  };
}

export async function ensureInstantlyBlock(args: {
  email: string;
  personId: string | null;
  reason: InstantlyBlockReason;
  sourceEventId: string;
}): Promise<InstantlyBlockIntentResult> {
  const email = normalizeAcquisitionEmail(args.email);
  if (!email) return { ok: false, outcome: "invalid_email" };
  try {
    const evidence = [{ reason: args.reason, sourceEventId: args.sourceEventId }];
    const { error } = await supabaseServer.from("acquisition_instantly_blocks").insert({
      person_id: args.personId,
      email_normalized: email,
      reason: args.reason,
      status: "pending",
      source_event_id: args.sourceEventId,
      evidence,
      attempt_count: 0,
    });
    if (!error) return { ok: true, outcome: "inserted" };
    if ((error as { code?: string }).code !== "23505") {
      console.warn("[acquisition] instantly block intent was not stored");
      return { ok: false, outcome: "not_stored" };
    }
    const { data, error: readError } = await supabaseServer
      .from("acquisition_instantly_blocks")
      .select("id, person_id, email_normalized, reason, status, source_event_id, provider_entry_id, evidence, attempt_count")
      .eq("email_normalized", email)
      .maybeSingle();
    const existing = asRow(data as Record<string, unknown> | null);
    if (readError || !existing) {
      console.warn("[acquisition] instantly block intent was not stored");
      return { ok: false, outcome: "not_stored" };
    }
    const merged = mergeBlockIntent(existing, args);
    const { error: updateError } = await supabaseServer
      .from("acquisition_instantly_blocks")
      .update({
        person_id: merged.personId,
        evidence: merged.evidence,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (updateError) {
      console.warn("[acquisition] instantly block intent was not stored");
      return { ok: false, outcome: "not_stored" };
    }
    return { ok: true, outcome: "present" };
  } catch {
    console.warn("[acquisition] instantly block intent was not stored");
    return { ok: false, outcome: "not_stored" };
  }
}

function pageContinues(pageNumber: number, rowCount: number): { continue: boolean; complete: boolean } {
  if (rowCount < PAGE_SIZE) return { continue: false, complete: true };
  if (pageNumber >= PAGE_CAP) return { continue: false, complete: false };
  return { continue: true, complete: false };
}

async function readPeopleForCoverage(): Promise<{ ok: boolean; complete: boolean; rows: BlockCoverageInputPerson[] }> {
  const rows: BlockCoverageInputPerson[] = [];
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabaseServer
      .from("acquisition_people")
      .select("id, email_normalized, lifecycle_state")
      .in("lifecycle_state", [...COVERAGE_LIFECYCLES])
      .order("email_normalized", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { ok: false, complete: false, rows };
    const batch = data ?? [];
    for (const row of batch) {
      if (typeof row.id === "string" && typeof row.email_normalized === "string" && typeof row.lifecycle_state === "string") {
        rows.push({ id: row.id, email: row.email_normalized, lifecycle: row.lifecycle_state });
      }
    }
    const decision = pageContinues(page + 1, batch.length);
    if (!decision.continue) return { ok: true, complete: decision.complete, rows };
  }
  return { ok: true, complete: false, rows };
}

async function readSuppressionsForCoverage(): Promise<{ ok: boolean; complete: boolean; rows: BlockCoverageInputSuppression[] }> {
  const rows: BlockCoverageInputSuppression[] = [];
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabaseServer
      .from("recovery_suppressions")
      .select("email_normalized, reason")
      .in("reason", ["unsubscribe", "complaint", "bounce", "provider"])
      .order("email_normalized", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { ok: false, complete: false, rows };
    const batch = data ?? [];
    for (const row of batch) {
      if (typeof row.email_normalized === "string" && typeof row.reason === "string") {
        rows.push({ email: row.email_normalized, reason: row.reason });
      }
    }
    const decision = pageContinues(page + 1, batch.length);
    if (!decision.continue) return { ok: true, complete: decision.complete, rows };
  }
  return { ok: true, complete: false, rows };
}

async function readBlockedEmails(): Promise<{ ok: boolean; complete: boolean; emails: string[] }> {
  const emails: string[] = [];
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabaseServer
      .from("acquisition_instantly_blocks")
      .select("email_normalized")
      .order("email_normalized", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { ok: false, complete: false, emails };
    const batch = data ?? [];
    for (const row of batch) {
      if (typeof row.email_normalized === "string") emails.push(row.email_normalized);
    }
    const decision = pageContinues(page + 1, batch.length);
    if (!decision.continue) return { ok: true, complete: decision.complete, emails };
  }
  return { ok: true, complete: false, emails };
}

export type InstantlyBlockCoverageReport = BlockCoveragePlan & {
  readable: boolean;
  complete: boolean;
};

const EMPTY_COVERAGE: InstantlyBlockCoverageReport = {
  proposals: [],
  alreadyCovered: 0,
  excluded: { declined: 0, provider: 0, unspecifiedSuppressed: 0, other: 0 },
  readable: false,
  complete: false,
};

type ReconcileCursor = {
  email: string | null;
  generation: number;
};

function asReconcileCursor(email: unknown, generation: unknown): ReconcileCursor | null {
  if (typeof generation !== "number" || !Number.isInteger(generation) || generation < 0) return null;
  if (email == null) return { email: null, generation };
  if (typeof email !== "string" || email.length < 6 || email.length > 254 || email.indexOf("@") < 2) return null;
  return { email, generation };
}

/** The saved cursor is the last email this pass has fully resolved. A miss does not move it. */
async function readReconcileCursors(): Promise<
  | { ok: true; people: ReconcileCursor; suppressions: ReconcileCursor }
  | { ok: false }
> {
  const { data, error } = await supabaseServer
    .from("acquisition_settings")
    .select("instantly_reconcile_people_email, instantly_reconcile_people_gen, instantly_reconcile_suppression_email, instantly_reconcile_suppression_gen")
    .eq("id", "default")
    .maybeSingle();
  if (error || !data) return { ok: false };
  const row = data as Record<string, unknown>;
  const people = asReconcileCursor(row.instantly_reconcile_people_email, row.instantly_reconcile_people_gen);
  const suppressions = asReconcileCursor(row.instantly_reconcile_suppression_email, row.instantly_reconcile_suppression_gen);
  if (!people || !suppressions) return { ok: false };
  return { ok: true, people, suppressions };
}

async function saveReconcileCursor(
  kind: "people" | "suppression",
  previous: ReconcileCursor,
  next: ReconcileCursor,
): Promise<"saved" | "contended" | "failed"> {
  const emailColumn = kind === "people"
    ? "instantly_reconcile_people_email"
    : "instantly_reconcile_suppression_email";
  const generationColumn = kind === "people"
    ? "instantly_reconcile_people_gen"
    : "instantly_reconcile_suppression_gen";
  const patch = kind === "people"
    ? { instantly_reconcile_people_email: next.email, instantly_reconcile_people_gen: next.generation }
    : { instantly_reconcile_suppression_email: next.email, instantly_reconcile_suppression_gen: next.generation };
  const filtered = supabaseServer
    .from("acquisition_settings")
    .update(patch)
    .eq("id", "default")
    .eq(generationColumn, previous.generation);
  const scoped = previous.email === null
    ? filtered.is(emailColumn, null)
    : filtered.eq(emailColumn, previous.email);
  const { data, error } = await scoped.select("id");
  if (error) return "failed";
  return Array.isArray(data) && data.length === 1 ? "saved" : "contended";
}

/** Read-only. This does not insert intents and does not call Instantly. */
export async function previewInstantlyBlockCoverage(): Promise<InstantlyBlockCoverageReport> {
  try {
    const people = await readPeopleForCoverage();
    const suppressions = await readSuppressionsForCoverage();
    const blocked = await readBlockedEmails();
    if (!people.ok || !suppressions.ok || !blocked.ok) return EMPTY_COVERAGE;
    const plan = planInstantlyBlockCoverage({
      people: people.rows,
      suppressions: suppressions.rows,
      blockedEmails: blocked.emails,
    });
    return {
      ...plan,
      readable: true,
      complete: people.complete && suppressions.complete && blocked.complete,
    };
  } catch {
    return EMPTY_COVERAGE;
  }
}

type CoverageRead = {
  ok: boolean;
  complete: boolean;
  rows: Record<string, unknown>[];
  emails: string[];
};

function rowsOf(data: unknown): { ok: true; rows: Record<string, unknown>[] } | { ok: false; rows: [] } {
  return { ok: true, rows: (data ?? []) as unknown as Record<string, unknown>[] };
}

async function readRecentPeople(): Promise<{ ok: boolean; rows: Record<string, unknown>[] }> {
  const { data, error } = await supabaseServer
    .from("acquisition_people")
    .select("id, email_normalized, lifecycle_state")
    .in("lifecycle_state", [...COVERAGE_LIFECYCLES])
    .order("updated_at", { ascending: false })
    .limit(RECONCILE_RECENT);
  if (error) return { ok: false, rows: [] };
  return rowsOf(data);
}

async function readRecentSuppressions(): Promise<{ ok: boolean; rows: Record<string, unknown>[] }> {
  const { data, error } = await supabaseServer
    .from("recovery_suppressions")
    .select("email_normalized, reason")
    .in("reason", ["unsubscribe", "complaint", "bounce", "provider"])
    .order("created_at", { ascending: false })
    .limit(RECONCILE_RECENT);
  if (error) return { ok: false, rows: [] };
  return rowsOf(data);
}

async function readPeopleAfter(afterEmail: string | null): Promise<{ ok: boolean; rows: Record<string, unknown>[] }> {
  const { data, error } = afterEmail
    ? await supabaseServer
      .from("acquisition_people")
      .select("id, email_normalized, lifecycle_state")
      .in("lifecycle_state", [...COVERAGE_LIFECYCLES])
      .gt("email_normalized", afterEmail)
      .order("email_normalized", { ascending: true })
      .limit(RECONCILE_PAGE_SIZE)
    : await supabaseServer
      .from("acquisition_people")
      .select("id, email_normalized, lifecycle_state")
      .in("lifecycle_state", [...COVERAGE_LIFECYCLES])
      .order("email_normalized", { ascending: true })
      .limit(RECONCILE_PAGE_SIZE);
  if (error) return { ok: false, rows: [] };
  return rowsOf(data);
}

async function readSuppressionsAfter(afterEmail: string | null): Promise<{ ok: boolean; rows: Record<string, unknown>[] }> {
  const { data, error } = afterEmail
    ? await supabaseServer
      .from("recovery_suppressions")
      .select("email_normalized, reason")
      .in("reason", ["unsubscribe", "complaint", "bounce", "provider"])
      .gt("email_normalized", afterEmail)
      .order("email_normalized", { ascending: true })
      .limit(RECONCILE_PAGE_SIZE)
    : await supabaseServer
      .from("recovery_suppressions")
      .select("email_normalized, reason")
      .in("reason", ["unsubscribe", "complaint", "bounce", "provider"])
      .order("email_normalized", { ascending: true })
      .limit(RECONCILE_PAGE_SIZE);
  if (error) return { ok: false, rows: [] };
  return rowsOf(data);
}

async function readReconcileWalk(
  readPage: (afterEmail: string | null) => Promise<{ ok: boolean; rows: Record<string, unknown>[] }>,
  afterEmail: string | null,
): Promise<CoverageRead> {
  const rows: Record<string, unknown>[] = [];
  let cursor = afterEmail;
  for (let page = 0; page < RECONCILE_MAX_PAGES; page += 1) {
    const batch = await readPage(cursor);
    if (!batch.ok) return { ok: false, complete: false, rows, emails: [] };
    const emails: string[] = [];
    for (const row of batch.rows) {
      if (typeof row.email_normalized !== "string" || row.email_normalized.length < 1) {
        return { ok: false, complete: false, rows, emails: [] };
      }
      emails.push(row.email_normalized);
    }
    rows.push(...batch.rows);
    if (batch.rows.length < RECONCILE_PAGE_SIZE) {
      return { ok: true, complete: true, rows, emails: [...emailsOf(rows)] };
    }
    cursor = emails[emails.length - 1] ?? cursor;
  }
  return { ok: true, complete: false, rows, emails: [...emailsOf(rows)] };
}

function emailsOf(rows: readonly Record<string, unknown>[]): string[] {
  const emails: string[] = [];
  for (const row of rows) {
    if (typeof row.email_normalized === "string") emails.push(row.email_normalized);
  }
  return emails;
}

/**
 * Moves through emails in scan order.
 * Stops before the first email that still needs an intent, so a later write cannot skip it.
 * A finished short page wraps to the beginning and bumps the generation.
 */
function cursorAfter(
  previous: ReconcileCursor,
  orderedEmails: readonly string[],
  openEmails: ReadonlySet<string>,
  reachedEnd: boolean,
): ReconcileCursor | null {
  let resolved: string | null = null;
  let finished = true;
  for (const email of orderedEmails) {
    const key = normalizeAcquisitionEmail(email) ?? email;
    if (openEmails.has(key)) {
      finished = false;
      break;
    }
    resolved = email;
  }
  if (!finished) {
    if (resolved == null || resolved === previous.email) return null;
    return { email: resolved, generation: previous.generation };
  }
  if (reachedEnd) {
    if (previous.email === null && orderedEmails.length === 0) return null;
    return { email: null, generation: previous.generation + 1 };
  }
  if (resolved == null || resolved === previous.email) return null;
  return { email: resolved, generation: previous.generation };
}

function asPeople(rows: readonly Record<string, unknown>[]): BlockCoverageInputPerson[] {
  return rows.flatMap((row) => {
    if (typeof row.id !== "string" || typeof row.email_normalized !== "string" || typeof row.lifecycle_state !== "string") return [];
    return [{ id: row.id, email: row.email_normalized, lifecycle: row.lifecycle_state }];
  });
}

function asSuppressions(rows: readonly Record<string, unknown>[]): BlockCoverageInputSuppression[] {
  return rows.flatMap((row) => {
    if (typeof row.email_normalized !== "string" || typeof row.reason !== "string") return [];
    return [{ email: row.email_normalized, reason: row.reason }];
  });
}

async function readBlockedEmailsFor(emails: readonly string[]): Promise<{ ok: boolean; emails: string[] }> {
  const found: string[] = [];
  for (let index = 0; index < emails.length; index += RECONCILE_PAGE_SIZE) {
    const chunk = emails.slice(index, index + RECONCILE_PAGE_SIZE);
    if (chunk.length === 0) continue;
    const { data, error } = await supabaseServer
      .from("acquisition_instantly_blocks")
      .select("email_normalized")
      .in("email_normalized", [...chunk]);
    if (error) return { ok: false, emails: found };
    for (const row of data ?? []) {
      if (typeof row.email_normalized === "string") found.push(row.email_normalized);
    }
  }
  return { ok: true, emails: found };
}

export type InstantlyBlockReconciliation = {
  readable: boolean;
  complete: boolean;
  stored: number;
  failed: number;
  deferred: number;
};

/**
 * Inserts a bounded batch of missing local intents.
 * This does not call Instantly and does not change people, events, or journeys.
 */
export async function reconcileMissingInstantlyBlocks(_args: {
  now?: Date;
} = {}): Promise<InstantlyBlockReconciliation> {
  const none = { readable: false, complete: false, stored: 0, failed: 0, deferred: 0 };
  try {
    const cursors = await readReconcileCursors();
    if (!cursors.ok) return none;
    const [recentPeople, walkedPeople, recentSuppressions, walkedSuppressions] = await Promise.all([
      readRecentPeople(),
      readReconcileWalk(readPeopleAfter, cursors.people.email),
      readRecentSuppressions(),
      readReconcileWalk(readSuppressionsAfter, cursors.suppressions.email),
    ]);
    if (!recentPeople.ok || !walkedPeople.ok || !recentSuppressions.ok || !walkedSuppressions.ok) return none;
    const people = asPeople([...recentPeople.rows, ...walkedPeople.rows]);
    const suppressions = asSuppressions([...recentSuppressions.rows, ...walkedSuppressions.rows]);
    const emails = [...new Set([
      ...people.map((person) => person.email),
      ...suppressions.map((row) => row.email),
    ])];
    const blocked = await readBlockedEmailsFor(emails);
    if (!blocked.ok) return none;
    const plan = planInstantlyBlockCoverage({
      people,
      suppressions,
      blockedEmails: blocked.emails,
    });
    const recent = new Set(asPeople(recentPeople.rows).map((person) => person.email));
    for (const row of asSuppressions(recentSuppressions.rows)) recent.add(row.email);
    const ranked = [...plan.proposals].sort((left, right) => {
      const leftRank = recent.has(left.email) ? 0 : 1;
      const rightRank = recent.has(right.email) ? 0 : 1;
      return leftRank - rightRank;
    });
    const chosen: BlockCoverageProposal[] = [];
    let writes = 0;
    for (const proposal of ranked) {
      if (proposal.evidence.length < 1 || writes + proposal.evidence.length > RECONCILE_WRITE_CAP) break;
      chosen.push(proposal);
      writes += proposal.evidence.length;
    }
    const applied = await applyInstantlyBlockCoverage(chosen);
    const storedEmails = new Set(applied.storedEmails);
    const open = new Set(plan.proposals.flatMap((proposal) => storedEmails.has(proposal.email) ? [] : [proposal.email]));
    const peopleNext = cursorAfter(cursors.people, walkedPeople.emails, open, walkedPeople.complete);
    const suppressionNext = cursorAfter(cursors.suppressions, walkedSuppressions.emails, open, walkedSuppressions.complete);
    const peopleSaved = peopleNext
      ? await saveReconcileCursor("people", cursors.people, peopleNext)
      : "saved";
    const suppressionSaved = suppressionNext
      ? await saveReconcileCursor("suppression", cursors.suppressions, suppressionNext)
      : "saved";
    return {
      readable: true,
      complete: peopleSaved === "saved"
        && suppressionSaved === "saved"
        && walkedPeople.complete
        && walkedSuppressions.complete,
      stored: applied.stored,
      failed: applied.failed,
      deferred: plan.proposals.length - chosen.length,
    };
  } catch {
    return none;
  }
}

/** Inserts missing intents only. This does not call Instantly. */
export async function applyInstantlyBlockCoverage(
  proposals: readonly BlockCoverageProposal[],
): Promise<{ stored: number; failed: number; storedEmails: string[] }> {
  let stored = 0;
  let failed = 0;
  const storedEmails: string[] = [];
  for (const proposal of proposals) {
    let proposalOk = true;
    for (const item of proposal.evidence) {
      const result = await ensureInstantlyBlock({
        email: proposal.email,
        personId: proposal.personId,
        reason: item.reason,
        sourceEventId: item.sourceEventId,
      });
      if (result.outcome === "not_stored") {
        proposalOk = false;
        failed += 1;
        break;
      }
    }
    if (proposalOk) {
      stored += 1;
      storedEmails.push(proposal.email);
    }
  }
  return { stored, failed, storedEmails };
}

export async function deliverPendingInstantlyBlocks(args: {
  enabled: boolean;
  apiKey: string | null;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<{ attempted: number; skipped: "inactive" | "missing_credentials" | "unreadable" | null }> {
  if (!args.enabled) return { attempted: 0, skipped: "inactive" };
  const now = args.now ?? new Date();
  const { data, error } = await supabaseServer
    .from("acquisition_instantly_blocks")
    .select("id, person_id, email_normalized, reason, status, source_event_id, provider_entry_id, provider_confirmed_at, evidence, attempt_count, claim_until, next_attempt_at")
    .in("status", ["pending", "failed", "uncertain"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte."${now.toISOString()}"`)
    .order("created_at", { ascending: true })
    .limit(5);
  if (error) return { attempted: 0, skipped: "unreadable" };
  if (!args.apiKey) {
    // Rows stay visible. advanceInstantlyBlock performs no fetch without a key.
  }
  let attempted = 0;
  for (const raw of data ?? []) {
    const row = asRow(raw as Record<string, unknown>);
    if (!row || row.status === "confirmed") continue;
    const claimUntil = new Date(now.getTime() + CLAIM_MS).toISOString();
    const { data: claimed } = await supabaseServer
      .from("acquisition_instantly_blocks")
      .update({
        claim_until: claimUntil,
        attempt_count: row.attemptCount + 1,
        updated_at: now.toISOString(),
      })
      .eq("id", row.id)
      .eq("status", row.status)
      .or(`claim_until.is.null,claim_until.lte."${now.toISOString()}"`)
      .select("id");
    if (!Array.isArray(claimed) || claimed.length !== 1) continue;
    attempted += 1;
    const advanced = await advanceInstantlyBlock({
      enabled: true,
      apiKey: args.apiKey,
      email: row.email,
      status: row.status,
      attemptCount: row.attemptCount + 1,
      fetchImpl: args.fetchImpl,
      now,
    });
    await supabaseServer
      .from("acquisition_instantly_blocks")
      .update({
        status: advanced.status,
        provider_entry_id: advanced.providerEntryId ?? row.providerEntryId,
        provider_confirmed_at: advanced.confirmedAt ?? row.providerConfirmedAt,
        last_error: advanced.lastError,
        next_attempt_at: advanced.nextAttemptAt,
        claim_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  }
  return { attempted, skipped: args.apiKey ? null : "missing_credentials" };
}

/** Exact current totals. This does not insert, update, or call Instantly. */
export async function loadInstantlyBlockVisibility(): Promise<InstantlyBlockVisibility> {
  const unavailable = unavailableInstantlyBlockVisibility();
  try {
    const [pending, confirmed, failed, uncertain, oldest, settings] = await Promise.all([
      countBlockStatus("pending"),
      countBlockStatus("confirmed"),
      countBlockStatus("failed"),
      countBlockStatus("uncertain"),
      supabaseServer
        .from("acquisition_instantly_blocks")
        .select("created_at")
        .in("status", ["pending", "failed", "uncertain"])
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabaseServer
        .from("acquisition_settings")
        .select("instantly_blocklist")
        .eq("id", "default")
        .maybeSingle(),
    ]);
    const countsReadable = pending != null && confirmed != null && failed != null && uncertain != null;
    const oldestPayload = oldest.data as { created_at?: unknown } | Array<{ created_at?: unknown }> | null;
    const oldestRow = Array.isArray(oldestPayload) ? oldestPayload[0] ?? null : oldestPayload;
    const oldestAt = typeof oldestRow?.created_at === "string" ? oldestRow.created_at : null;
    const settingsPayload = settings.data as { instantly_blocklist?: unknown } | Array<{ instantly_blocklist?: unknown }> | null;
    const switchValue = Array.isArray(settingsPayload) ? settingsPayload[0] ?? null : settingsPayload;
    return {
      countsReadable,
      switchReadable: !settings.error && switchValue != null,
      ageReadable: !oldest.error,
      blocking: !settings.error && switchValue != null
        ? instantlyBlocklistEnabled(switchValue.instantly_blocklist) ? "on" : "off"
        : null,
      pending: countsReadable ? pending : null,
      confirmed: countsReadable ? confirmed : null,
      failed: countsReadable ? failed : null,
      uncertain: countsReadable ? uncertain : null,
      oldestOutstandingAt: oldest.error ? null : oldestAt,
    };
  } catch {
    return unavailable;
  }
}

async function countBlockStatus(status: InstantlyBlockStatus): Promise<number | null> {
  const { count, error } = await supabaseServer
    .from("acquisition_instantly_blocks")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (error || typeof count !== "number") return null;
  return count;
}
