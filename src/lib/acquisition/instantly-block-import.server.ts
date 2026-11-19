import "server-only";

import { INSTANTLY_BLOCK_LIST_URL } from "@/lib/acquisition/instantly-block";
import {
  BLOCK_IMPORT_PAGE_BUDGET,
  BLOCK_IMPORT_PAGE_LIMIT,
  applyBlockPage,
  claimImportLease,
  commitImportLease,
  emailDomain,
  runBlockImport,
  type BlockImportClaim,
  type BlockImportCommit,
  type BlockImportPerson,
  type BlockImportReason,
  type BlockImportRun,
  type BlockImportStore,
  type ImportLease,
} from "@/lib/acquisition/instantly-block-import";
import { isAcquisitionLifecycle, normalizeAcquisitionEmail } from "@/lib/acquisition/model";
import { supabaseServer } from "@/lib/supabase-server";

const IMPORT_COLUMNS = [
  "instantly_block_import_cursor",
  "instantly_block_import_cycle",
  "instantly_block_import_completed_at",
  "instantly_block_import_error",
  "instantly_block_import_pages",
  "instantly_block_import_claim_until",
  "instantly_block_import_generation",
].join(", ");

type ImportRow = {
  instantly_block_import_cursor?: unknown;
  instantly_block_import_cycle?: unknown;
  instantly_block_import_completed_at?: unknown;
  instantly_block_import_error?: unknown;
  instantly_block_import_pages?: unknown;
  instantly_block_import_claim_until?: unknown;
  instantly_block_import_generation?: unknown;
};

export async function importInstantlyBlockList(args: {
  now: Date;
  /** Sole time source for claim, renewal, commit, expiry, and completion. */
  clock?: () => Date;
  apiKey: string | null;
  fetchImpl?: typeof fetch;
}): Promise<BlockImportRun> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const clock = args.clock ?? (() => args.now);
  return runBlockImport({
    now: args.now,
    clock,
    budget: BLOCK_IMPORT_PAGE_BUDGET,
    claim: () => claimImport(clock()),
    readPage: (cursor) => readBlockPage(cursor, args.apiKey, fetchImpl),
    applyPage: (entries) => applyBlockPage(supabaseImportStore(args.now), entries),
    commit: (patch) => commitImport(patch, clock()),
  });
}

/** Known suppression or domain block. Null means the read failed and the caller must not send. */
export async function durableAcquisitionStop(email: string): Promise<boolean | null> {
  const normalized = normalizeAcquisitionEmail(email);
  if (!normalized) return true;
  const domain = emailDomain(normalized);
  const [suppression, blocked] = await Promise.all([
    supabaseServer.from("recovery_suppressions").select("id").eq("email_normalized", normalized).maybeSingle(),
    domain
      ? supabaseServer.from("acquisition_blocked_domains").select("domain").eq("domain", domain).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (suppression.error || blocked.error) return null;
  return Boolean(suppression.data?.id) || Boolean(blocked.data && "domain" in blocked.data && blocked.data.domain);
}

async function claimImport(now: Date): Promise<BlockImportClaim> {
  const state = await readImportState();
  if (!state.ok) return { ok: false, reason: "unreadable" };
  const decision = claimImportLease(state.lease, now);
  if (!decision.ok) return { ok: false, reason: "contended" };
  const { data, error } = await supabaseServer
    .from("acquisition_settings")
    .update({
      instantly_block_import_claim_until: decision.lease.claimUntil,
      instantly_block_import_generation: decision.lease.generation,
      updated_at: now.toISOString(),
    })
    .eq("id", "default")
    .eq("instantly_block_import_generation", state.lease.generation)
    .or(`instantly_block_import_claim_until.is.null,instantly_block_import_claim_until.lte."${now.toISOString()}"`)
    .select("id");
  if (error) return { ok: false, reason: "unreadable" };
  if (!Array.isArray(data) || data.length !== 1) return { ok: false, reason: "contended" };
  return decision.claim;
}

async function commitImport(patch: BlockImportCommit, now: Date): Promise<boolean> {
  const state = await readImportState();
  if (!state.ok) return false;
  const decision = commitImportLease(state.lease, patch, now);
  if (!decision.ok) return false;
  const update = patch.kind === "progress"
    ? {
        instantly_block_import_cursor: decision.lease.cursor,
        instantly_block_import_pages: decision.lease.pages,
        instantly_block_import_error: null,
        instantly_block_import_claim_until: decision.lease.claimUntil,
        updated_at: now.toISOString(),
      }
    : patch.kind === "complete"
      ? {
          instantly_block_import_cursor: null,
          instantly_block_import_cycle: decision.lease.cycle,
          instantly_block_import_completed_cycle: decision.lease.completedCycle,
          instantly_block_import_completed_at: decision.lease.completedAt,
          instantly_block_import_pages: decision.lease.pages,
          instantly_block_import_error: null,
          instantly_block_import_claim_until: null,
          updated_at: now.toISOString(),
        }
      : {
          instantly_block_import_error: decision.lease.error,
          instantly_block_import_claim_until: null,
          updated_at: now.toISOString(),
        };
  const { data, error } = await supabaseServer
    .from("acquisition_settings")
    .update(update)
    .eq("id", "default")
    .eq("instantly_block_import_generation", patch.generation)
    .gt("instantly_block_import_claim_until", now.toISOString())
    .select("id");
  return !error && Array.isArray(data) && data.length === 1;
}

async function readBlockPage(
  cursor: string | null,
  apiKey: string | null,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  if (!apiKey) return { ok: false, error: "permission" };
  const url = new URL(INSTANTLY_BLOCK_LIST_URL);
  url.searchParams.set("limit", String(BLOCK_IMPORT_PAGE_LIMIT));
  if (cursor) url.searchParams.set("starting_after", cursor);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 429) return { ok: false, error: "rate_limited" };
    if (response.status === 401 || response.status === 403 || response.status === 402) {
      return { ok: false, error: "permission" };
    }
    if (response.status === 504 || response.status >= 500) return { ok: false, error: "timeout_or_network" };
    if (!response.ok) return { ok: false, error: "unreadable" };
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, error: "timeout_or_network" };
  }
}

function supabaseImportStore(now: Date): BlockImportStore {
  const nowIso = now.toISOString();
  return {
    suppressionReason: suppressionReason,
    insertSuppression: insertProviderSuppression,
    personByEmail: personByEmail,
    advanceLifecycle: (personId, from, to) => advanceLifecycle(personId, from, to, nowIso),
    cancelScheduled: (personId) => cancelScheduled(personId, nowIso),
    cancelExpiredClaims: (personId) => cancelExpiredClaims(personId, nowIso),
    clearNextAction: (personId) => clearNextAction(personId, nowIso),
    insertEvent: (args) => insertImportEvent(args, nowIso),
    upsertDomain: (args) => upsertDomain(args, nowIso),
    cancelDomainOutbound: (domain) => cancelDomainOutbound(domain, nowIso),
  };
}

async function suppressionReason(email: string): Promise<BlockImportReason | null | "unreadable"> {
  const { data, error } = await supabaseServer
    .from("recovery_suppressions")
    .select("reason")
    .eq("email_normalized", email)
    .maybeSingle();
  if (error) return "unreadable";
  if (!data) return null;
  const reason = data.reason;
  if (reason === "unsubscribe" || reason === "complaint" || reason === "bounce" || reason === "provider") {
    return reason;
  }
  return "provider";
}

async function insertProviderSuppression(email: string): Promise<"inserted" | "duplicate" | "failed"> {
  const { error } = await supabaseServer.from("recovery_suppressions").insert({
    email_normalized: email,
    reason: "provider",
  });
  if (!error) return "inserted";
  if ((error as { code?: string }).code === "23505") return "duplicate";
  return "failed";
}

async function personByEmail(email: string): Promise<BlockImportPerson | null | "unreadable"> {
  const { data, error } = await supabaseServer
    .from("acquisition_people")
    .select("id, email_normalized, lifecycle_state")
    .eq("email_normalized", email)
    .maybeSingle();
  if (error) return "unreadable";
  if (!data) return null;
  return personFromRow(data);
}

async function cancelDomainOutbound(domain: string, nowIso: string): Promise<boolean> {
  const { error } = await supabaseServer.rpc("acquisition_cancel_domain_outbound", {
    p_domain: domain,
    p_now: nowIso,
  });
  return !error;
}

async function advanceLifecycle(
  personId: string,
  from: BlockImportPerson["lifecycle"],
  to: BlockImportPerson["lifecycle"],
  nowIso: string,
): Promise<"advanced" | "lost" | "failed"> {
  const { data, error } = await supabaseServer
    .from("acquisition_people")
    .update({ lifecycle_state: to, updated_at: nowIso })
    .eq("id", personId)
    .eq("lifecycle_state", from)
    .select("id");
  if (error) return "failed";
  return Array.isArray(data) && data.length === 1 ? "advanced" : "lost";
}

async function cancelScheduled(personId: string, nowIso: string): Promise<boolean> {
  const { error } = await supabaseServer
    .from("acquisition_actions")
    .update({ status: "canceled", claim_until: null, updated_at: nowIso })
    .eq("person_id", personId)
    .eq("status", "scheduled");
  return !error;
}

async function cancelExpiredClaims(personId: string, nowIso: string): Promise<boolean> {
  const { error } = await supabaseServer
    .from("acquisition_actions")
    .update({ status: "canceled", claim_until: null, updated_at: nowIso })
    .eq("person_id", personId)
    .eq("status", "claimed")
    .or(`claim_until.is.null,claim_until.lte."${nowIso}"`);
  return !error;
}

async function clearNextAction(personId: string, nowIso: string): Promise<boolean> {
  const { error } = await supabaseServer
    .from("acquisition_people")
    .update({ next_action_type: null, next_action_at: null, updated_at: nowIso })
    .eq("id", personId);
  return !error;
}

async function insertImportEvent(
  args: { personId: string | null; providerEventId: string },
  nowIso: string,
): Promise<"stored" | "duplicate" | "failed"> {
  const { error } = await supabaseServer.from("acquisition_events").insert({
    person_id: args.personId,
    provider: "system",
    provider_event_id: args.providerEventId,
    event_type: "instantly_block_imported",
    occurred_at: nowIso,
    metadata: {},
  });
  if (!error) return "stored";
  if ((error as { code?: string }).code === "23505") return "duplicate";
  return "failed";
}

async function upsertDomain(
  args: { domain: string; providerEntryId: string },
  nowIso: string,
): Promise<boolean> {
  const inserted = await supabaseServer.from("acquisition_blocked_domains").insert({
    domain: args.domain,
    provider_entry_id: args.providerEntryId,
    first_seen_at: nowIso,
    last_seen_at: nowIso,
  });
  if (!inserted.error) return true;
  if ((inserted.error as { code?: string }).code !== "23505") return false;
  const updated = await supabaseServer
    .from("acquisition_blocked_domains")
    .update({ provider_entry_id: args.providerEntryId, last_seen_at: nowIso })
    .eq("domain", args.domain);
  return !updated.error;
}

async function readImportState(): Promise<{ ok: true; lease: ImportLease } | { ok: false }> {
  const { data, error } = await supabaseServer
    .from("acquisition_settings")
    .select(IMPORT_COLUMNS)
    .eq("id", "default")
    .maybeSingle();
  if (error || !data) return { ok: false };
  const row = data as ImportRow;
  const cursor = typeof row.instantly_block_import_cursor === "string" ? row.instantly_block_import_cursor : null;
  const cycle = row.instantly_block_import_cycle;
  const pages = row.instantly_block_import_pages;
  const generation = row.instantly_block_import_generation;
  const claimUntil = typeof row.instantly_block_import_claim_until === "string"
    ? row.instantly_block_import_claim_until
    : null;
  if (typeof cycle !== "number" || typeof pages !== "number" || typeof generation !== "number") return { ok: false };
  return {
    ok: true,
    lease: {
      cursor,
      cycle,
      pages,
      generation,
      claimUntil,
      completedCycle: null,
      completedAt: typeof row.instantly_block_import_completed_at === "string"
        ? row.instantly_block_import_completed_at
        : null,
      error: typeof row.instantly_block_import_error === "string" ? row.instantly_block_import_error : null,
    },
  };
}

function personFromRow(row: { id?: unknown; email_normalized?: unknown; lifecycle_state?: unknown }): BlockImportPerson | null | "unreadable" {
  if (!row) return null;
  if (typeof row.id !== "string" || typeof row.email_normalized !== "string") return "unreadable";
  const lifecycle = typeof row.lifecycle_state === "string" ? row.lifecycle_state : "";
  if (!isAcquisitionLifecycle(lifecycle)) return "unreadable";
  const email = normalizeAcquisitionEmail(row.email_normalized);
  if (!email) return "unreadable";
  return { id: row.id, email, lifecycle };
}

export function importVisibilityFields(row: ImportRow | null, readable: boolean): {
  importReadable: boolean;
  importCompletedAt: string | null;
  importError: string | null;
  importInProgress: boolean;
} {
  if (!readable || !row) {
    return { importReadable: false, importCompletedAt: null, importError: null, importInProgress: false };
  }
  const completedAt = typeof row.instantly_block_import_completed_at === "string"
    ? row.instantly_block_import_completed_at
    : null;
  const error = typeof row.instantly_block_import_error === "string" ? row.instantly_block_import_error : null;
  const cursor = typeof row.instantly_block_import_cursor === "string" && row.instantly_block_import_cursor.length > 0;
  const claimUntil = typeof row.instantly_block_import_claim_until === "string"
    ? Date.parse(row.instantly_block_import_claim_until)
    : Number.NaN;
  return {
    importReadable: true,
    importCompletedAt: completedAt,
    importError: error,
    importInProgress: cursor || (Number.isFinite(claimUntil) && claimUntil > Date.now()),
  };
}
