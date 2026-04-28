/**
 * V2 cutover PR2: inventory + idempotent backfill for supported SMS subscribers.
 * No AI; no Twilio; uses only Supabase + existing user-authored fields.
 */

import { supabaseServer } from "@/lib/supabase-server";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { resolveUserFullyOnV2ForCutoverMessaging } from "@/lib/v2-cutover-gates";

const MIN_BEHAVIOR_CHARS = 10;
const BACKFILL_SOURCE = "cutover_backfill_v1";

export type CutoverReadinessPrimary =
  | "fully_on_v2"
  | "no_active_commitment"
  | "empty_behavior_statement"
  | "sms_audience_missing_phone";

/** Extra detail for operators (boring / operational). */
export type CutoverReadinessDetail =
  | "ok"
  | "proposed_ready_to_activate"
  | "proposed_missing_title_or_behavior"
  | "would_activate_proposed"
  | "would_repair_active_behavior"
  | "would_insert_from_prior_v2_row"
  | "would_insert_from_user_profiles"
  | "manual_no_grounded_text"
  | "error";

export type CutoverAudienceUser = {
  clerk_user_id: string;
  phone_number: string | null;
};

export type CutoverReadinessRow = {
  clerk_user_id: string;
  phone_present: boolean;
  primary: CutoverReadinessPrimary;
  detail: CutoverReadinessDetail;
  /** Fully-on-V2 gate (same as daily-sms fork). */
  fully_on_v2: boolean;
  not_fully_on_v2_reason: string | null;
  proposed_commitment_id: string | null;
  prior_v2_commitment_id: string | null;
  profile_has_anchor: boolean;
  profile_has_life_desires: boolean;
};

export type CutoverBackfillAction =
  | "none"
  | "activated_proposed"
  | "repaired_active_behavior"
  | "inserted_active_from_prior_v2"
  | "inserted_active_from_profile"
  | "skipped_already_fully_on_v2"
  | "manual_no_action";

export type CutoverBackfillResultRow = CutoverReadinessRow & {
  action: CutoverBackfillAction;
  commitment_id_touched: string | null;
  dry_run: boolean;
  error_message: string | null;
};

function cleanText(v: unknown, minLen: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  if (t.length < minLen) return null;
  return t;
}

function safeTitleFromProfile(preferredName: string | null, behavior: string): string {
  const n = preferredName?.trim();
  if (n && n.length > 0) {
    const head = `${n} — current focus`.slice(0, 200);
    return head;
  }
  return "Current focus".slice(0, 200);
}

/** Subscribed + SMS-enabled audience rows (same scope as daily-sms / side-cron cutover). */
export async function loadSmsAudienceSupportedUsers(): Promise<CutoverAudienceUser[]> {
  const { data, error } = await supabaseServer
    .from("sms_audience")
    .select("clerk_user_id, phone_number")
    .eq("summitt_subscribed", true)
    .eq("sms_enabled", true);

  if (error) {
    console.error("[v2-cutover-backfill] sms_audience select failed", { message: error.message });
    return [];
  }

  return (data ?? []).map((r) => ({
    clerk_user_id: String(r.clerk_user_id),
    phone_number: typeof r.phone_number === "string" ? r.phone_number : null,
  }));
}

type ProposedRow = {
  id: string;
  title: string;
  behavior_statement: string;
};

type PriorRow = {
  id: string;
  title: string;
  behavior_statement: string;
  status: string;
};

async function fetchLatestProposed(clerkUserId: string): Promise<ProposedRow | null> {
  const { data, error } = await supabaseServer
    .from("v2_commitment")
    .select("id, title, behavior_statement, status")
    .eq("clerk_user_id", clerkUserId)
    .eq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.id) return null;
  return {
    id: String(data.id),
    title: typeof data.title === "string" ? data.title : "",
    behavior_statement: typeof data.behavior_statement === "string" ? data.behavior_statement : "",
  };
}

async function fetchLatestPriorNonActive(clerkUserId: string): Promise<PriorRow | null> {
  const { data, error } = await supabaseServer
    .from("v2_commitment")
    .select("id, title, behavior_statement, status")
    .eq("clerk_user_id", clerkUserId)
    .in("status", ["paused", "completed", "abandoned", "superseded"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.id) return null;
  return {
    id: String(data.id),
    title: typeof data.title === "string" ? data.title : "",
    behavior_statement: typeof data.behavior_statement === "string" ? data.behavior_statement : "",
    status: typeof data.status === "string" ? data.status : "",
  };
}

async function fetchProfileTexts(clerkUserId: string): Promise<{
  identity_anchor_text: string | null;
  life_desires: string | null;
  preferred_name: string | null;
}> {
  const { data } = await supabaseServer
    .from("user_profiles")
    .select("identity_anchor_text, life_desires, preferred_name")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (!data) {
    return { identity_anchor_text: null, life_desires: null, preferred_name: null };
  }

  const anchor = cleanText(data.identity_anchor_text, 3);
  const life = cleanText(data.life_desires, MIN_BEHAVIOR_CHARS);
  const pref = cleanText(data.preferred_name, 1);
  return {
    identity_anchor_text: anchor,
    life_desires: life,
    preferred_name: pref,
  };
}

function pickGroundedBehavior(profile: Awaited<ReturnType<typeof fetchProfileTexts>>): string | null {
  const a = profile.identity_anchor_text && profile.identity_anchor_text.length >= MIN_BEHAVIOR_CHARS
    ? profile.identity_anchor_text
    : null;
  if (a) return a;
  if (profile.life_desires) return profile.life_desires;
  if (profile.identity_anchor_text) return profile.identity_anchor_text;
  return null;
}

export async function classifyCutoverReadinessForUser(
  clerkUserId: string,
  audiencePhone: string | null
): Promise<CutoverReadinessRow> {
  const gate = await resolveUserFullyOnV2ForCutoverMessaging(clerkUserId);
  const phone_present = Boolean(audiencePhone && audiencePhone.trim().length > 0);

  if (!phone_present) {
    return {
      clerk_user_id: clerkUserId,
      phone_present: false,
      primary: "sms_audience_missing_phone",
      detail: "manual_no_grounded_text",
      fully_on_v2: gate.fullyOnV2,
      not_fully_on_v2_reason: gate.fullyOnV2 ? null : gate.reason,
      proposed_commitment_id: null,
      prior_v2_commitment_id: null,
      profile_has_anchor: false,
      profile_has_life_desires: false,
    };
  }

  if (gate.fullyOnV2) {
    return {
      clerk_user_id: clerkUserId,
      phone_present: true,
      primary: "fully_on_v2",
      detail: "ok",
      fully_on_v2: true,
      not_fully_on_v2_reason: null,
      proposed_commitment_id: null,
      prior_v2_commitment_id: null,
      profile_has_anchor: false,
      profile_has_life_desires: false,
    };
  }

  const active = await getActiveCommitment(clerkUserId);
  const proposed = await fetchLatestProposed(clerkUserId);
  const prior = await fetchLatestPriorNonActive(clerkUserId);
  const profile = await fetchProfileTexts(clerkUserId);
  const profile_has_anchor =
    typeof profile.identity_anchor_text === "string" && profile.identity_anchor_text.length > 0;
  const profile_has_life_desires =
    typeof profile.life_desires === "string" && profile.life_desires.length > 0;

  if (active && !active.behavior_statement?.trim()) {
    const priorBehavior =
      typeof prior?.behavior_statement === "string" && prior.behavior_statement.trim().length >= MIN_BEHAVIOR_CHARS
        ? prior.behavior_statement.trim()
        : null;
    const canRepair = Boolean(pickGroundedBehavior(profile) || priorBehavior);
    return {
      clerk_user_id: clerkUserId,
      phone_present: true,
      primary: "empty_behavior_statement",
      detail: canRepair ? "would_repair_active_behavior" : "manual_no_grounded_text",
      fully_on_v2: false,
      not_fully_on_v2_reason: gate.reason,
      proposed_commitment_id: proposed?.id ?? null,
      prior_v2_commitment_id: prior?.id ?? null,
      profile_has_anchor,
      profile_has_life_desires,
    };
  }

  if (proposed) {
    const ok =
      proposed.title.trim().length > 0 && proposed.behavior_statement.trim().length >= MIN_BEHAVIOR_CHARS;
    return {
      clerk_user_id: clerkUserId,
      phone_present: true,
      primary: "no_active_commitment",
      detail: ok ? "proposed_ready_to_activate" : "proposed_missing_title_or_behavior",
      fully_on_v2: false,
      not_fully_on_v2_reason: gate.reason,
      proposed_commitment_id: proposed.id,
      prior_v2_commitment_id: prior?.id ?? null,
      profile_has_anchor,
      profile_has_life_desires,
    };
  }

  const priorBeh = prior?.behavior_statement?.trim() ?? "";
  const priorTit = prior?.title?.trim() ?? "";
  if (prior && priorBeh.length >= MIN_BEHAVIOR_CHARS && priorTit.length > 0) {
    return {
      clerk_user_id: clerkUserId,
      phone_present: true,
      primary: "no_active_commitment",
      detail: "would_insert_from_prior_v2_row",
      fully_on_v2: false,
      not_fully_on_v2_reason: gate.reason,
      proposed_commitment_id: null,
      prior_v2_commitment_id: prior.id,
      profile_has_anchor,
      profile_has_life_desires,
    };
  }

  const grounded = pickGroundedBehavior(profile);
  if (grounded) {
    return {
      clerk_user_id: clerkUserId,
      phone_present: true,
      primary: "no_active_commitment",
      detail: "would_insert_from_user_profiles",
      fully_on_v2: false,
      not_fully_on_v2_reason: gate.reason,
      proposed_commitment_id: null,
      prior_v2_commitment_id: prior?.id ?? null,
      profile_has_anchor,
      profile_has_life_desires,
    };
  }

  return {
    clerk_user_id: clerkUserId,
    phone_present: true,
    primary: "no_active_commitment",
    detail: "manual_no_grounded_text",
    fully_on_v2: false,
    not_fully_on_v2_reason: gate.reason,
    proposed_commitment_id: null,
    prior_v2_commitment_id: prior?.id ?? null,
    profile_has_anchor,
    profile_has_life_desires,
  };
}

async function activateProposedCommitment(
  clerkUserId: string,
  proposedId: string,
  dryRun: boolean
): Promise<{ ok: boolean; error?: string }> {
  if (dryRun) return { ok: true };

  const already = await getActiveCommitment(clerkUserId);
  if (already?.behavior_statement?.trim()) {
    return { ok: true };
  }

  const nowIso = new Date().toISOString();
  const { data: activatedRow, error: actErr } = await supabaseServer
    .from("v2_commitment")
    .update({
      status: "active",
      started_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", proposedId)
    .eq("status", "proposed")
    .eq("clerk_user_id", clerkUserId)
    .select("id")
    .maybeSingle();

  if (actErr) {
    return { ok: false, error: actErr.message };
  }
  if (!activatedRow?.id) {
    const recovered = await getActiveCommitment(clerkUserId);
    if (recovered?.behavior_statement?.trim()) {
      return { ok: true };
    }
    return { ok: false, error: "activate_no_proposed_row_matched" };
  }

  const { error: evErr } = await supabaseServer.from("v2_commitment_event").insert({
    commitment_id: proposedId,
    clerk_user_id: clerkUserId,
    event_type: "activated",
    source: BACKFILL_SOURCE,
    payload_json: {},
    idempotency_key: `cutover_backfill_activated:${proposedId}`,
  });

  if (evErr && (evErr as { code?: string }).code !== "23505") {
    return { ok: false, error: evErr.message };
  }

  return { ok: true };
}

async function repairActiveBehavior(
  clerkUserId: string,
  commitmentId: string,
  newBehavior: string,
  dryRun: boolean
): Promise<{ ok: boolean; error?: string }> {
  if (dryRun) return { ok: true };

  const { data: row, error: selErr } = await supabaseServer
    .from("v2_commitment")
    .select("id, behavior_statement")
    .eq("id", commitmentId)
    .eq("clerk_user_id", clerkUserId)
    .eq("status", "active")
    .maybeSingle();

  if (selErr || !row?.id) return { ok: false, error: selErr?.message ?? "active_row_missing" };
  const cur = typeof row.behavior_statement === "string" ? row.behavior_statement.trim() : "";
  if (cur.length > 0) return { ok: true };

  const { error: upErr } = await supabaseServer
    .from("v2_commitment")
    .update({
      behavior_statement: newBehavior.trim().slice(0, 4000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", commitmentId)
    .eq("clerk_user_id", clerkUserId)
    .eq("status", "active");

  if (upErr) return { ok: false, error: upErr.message };
  return { ok: true };
}

async function insertActiveFromTexts(args: {
  clerkUserId: string;
  title: string;
  behavior: string;
  success_criteria: string | null;
  supersedes_commitment_id?: string | null;
  evolution_kind?: string | null;
  evolution_reason_code?: string | null;
  evolution_notes?: string | null;
  dryRun: boolean;
}): Promise<{ ok: boolean; commitmentId?: string; error?: string }> {
  if (args.dryRun) {
    return { ok: true, commitmentId: undefined };
  }

  const still = await getActiveCommitment(args.clerkUserId);
  if (still) {
    if (still.behavior_statement?.trim()) {
      return { ok: true, commitmentId: still.id };
    }
    return {
      ok: false,
      error: "active_row_exists_with_empty_behavior_use_repair_path",
    };
  }

  const nowIso = new Date().toISOString();
  const { data: ins, error: insErr } = await supabaseServer
    .from("v2_commitment")
    .insert({
      clerk_user_id: args.clerkUserId,
      status: "active",
      title: args.title.slice(0, 200),
      commitment_type: "accountability",
      behavior_statement: args.behavior.trim().slice(0, 4000),
      success_criteria: args.success_criteria,
      cadence_kind: "daily",
      tone_preference: null,
      reachability_window: {},
      source: BACKFILL_SOURCE,
      supersedes_commitment_id: args.supersedes_commitment_id ?? null,
      evolution_kind: args.evolution_kind ?? null,
      evolution_reason_code: args.evolution_reason_code ?? null,
      evolution_notes: args.evolution_notes ?? null,
      started_at: nowIso,
      updated_at: nowIso,
    })
    .select("id")
    .maybeSingle();

  if (insErr || !ins?.id) {
    return { ok: false, error: insErr?.message ?? "insert_failed" };
  }

  const id = String(ins.id);
  const baseKey = `cutover_backfill:${id}`;

  await supabaseServer.from("v2_commitment_event").insert({
    commitment_id: id,
    clerk_user_id: args.clerkUserId,
    event_type: "created",
    source: BACKFILL_SOURCE,
    payload_json: {},
    idempotency_key: `${baseKey}:created`,
  });

  await supabaseServer.from("v2_commitment_event").insert({
    commitment_id: id,
    clerk_user_id: args.clerkUserId,
    event_type: "activated",
    source: BACKFILL_SOURCE,
    payload_json: {},
    idempotency_key: `${baseKey}:activated`,
  });

  return { ok: true, commitmentId: id };
}

export async function runCutoverBackfillPass(args: {
  dryRun: boolean;
}): Promise<{ rows: CutoverBackfillResultRow[] }> {
  const audience = await loadSmsAudienceSupportedUsers();
  const rows: CutoverBackfillResultRow[] = [];

  for (const u of audience) {
    const readiness = await classifyCutoverReadinessForUser(u.clerk_user_id, u.phone_number);
    let action: CutoverBackfillAction = "manual_no_action";
    let commitment_id_touched: string | null = null;
    let error_message: string | null = null;

    try {
      if (readiness.primary === "fully_on_v2" || readiness.fully_on_v2) {
        action = "skipped_already_fully_on_v2";
      } else if (readiness.primary === "sms_audience_missing_phone") {
        action = "manual_no_action";
      } else if (readiness.primary === "empty_behavior_statement") {
        const active = await getActiveCommitment(u.clerk_user_id);
        const profile = await fetchProfileTexts(u.clerk_user_id);
        const prior = await fetchLatestPriorNonActive(u.clerk_user_id);
        const priorOk =
          prior &&
          typeof prior.behavior_statement === "string" &&
          prior.behavior_statement.trim().length >= MIN_BEHAVIOR_CHARS;
        const text =
          pickGroundedBehavior(profile) ||
          (priorOk ? prior!.behavior_statement.trim() : null);
        if (active?.id && text) {
          const r = await repairActiveBehavior(u.clerk_user_id, active.id, text, args.dryRun);
          if (r.ok) {
            action = "repaired_active_behavior";
            commitment_id_touched = active.id;
          } else {
            error_message = r.error ?? "repair_failed";
          }
        } else {
          action = "manual_no_action";
        }
      } else if (readiness.detail === "proposed_ready_to_activate" && readiness.proposed_commitment_id) {
        const r = await activateProposedCommitment(
          u.clerk_user_id,
          readiness.proposed_commitment_id,
          args.dryRun
        );
        if (r.ok) {
          action = "activated_proposed";
          commitment_id_touched = readiness.proposed_commitment_id;
        } else {
          error_message = r.error ?? "activate_failed";
        }
      } else if (readiness.detail === "would_insert_from_prior_v2_row" && readiness.prior_v2_commitment_id) {
        const prior = await fetchLatestPriorNonActive(u.clerk_user_id);
        if (prior?.behavior_statement?.trim() && prior.title.trim()) {
          const ins = await insertActiveFromTexts({
            clerkUserId: u.clerk_user_id,
            title: prior.title.trim(),
            behavior: prior.behavior_statement.trim(),
            success_criteria: null,
            supersedes_commitment_id: prior.id,
            evolution_kind: "replace",
            evolution_reason_code: "cutover_prior_v2_row",
            dryRun: args.dryRun,
          });
          if (ins.ok) {
            action = "inserted_active_from_prior_v2";
            commitment_id_touched = ins.commitmentId ?? null;
          } else {
            error_message = ins.error ?? "insert_failed";
          }
        } else {
          action = "manual_no_action";
        }
      } else if (readiness.detail === "would_insert_from_user_profiles") {
        const profile = await fetchProfileTexts(u.clerk_user_id);
        const behavior = pickGroundedBehavior(profile);
        if (behavior) {
          const title = safeTitleFromProfile(profile.preferred_name, behavior);
          const ins = await insertActiveFromTexts({
            clerkUserId: u.clerk_user_id,
            title,
            behavior,
            success_criteria: null,
            dryRun: args.dryRun,
          });
          if (ins.ok) {
            action = "inserted_active_from_profile";
            commitment_id_touched = ins.commitmentId ?? null;
          } else {
            error_message = ins.error ?? "insert_failed";
          }
        } else {
          action = "manual_no_action";
        }
      } else {
        action = "manual_no_action";
      }
    } catch (e) {
      error_message = e instanceof Error ? e.message : String(e);
      action = "manual_no_action";
    }

    if (
      args.dryRun &&
      (action === "inserted_active_from_prior_v2" || action === "inserted_active_from_profile")
    ) {
      commitment_id_touched = null;
    }

    rows.push({
      ...readiness,
      action,
      commitment_id_touched,
      dry_run: args.dryRun,
      error_message,
    });
  }

  return { rows };
}

export async function buildCutoverInventoryReport(): Promise<{
  rows: CutoverReadinessRow[];
  counts: Record<string, number>;
}> {
  const audience = await loadSmsAudienceSupportedUsers();
  const rows: CutoverReadinessRow[] = [];
  const counts: Record<string, number> = {};

  for (const u of audience) {
    const r = await classifyCutoverReadinessForUser(u.clerk_user_id, u.phone_number);
    rows.push(r);
    counts[r.primary] = (counts[r.primary] ?? 0) + 1;
    counts[`detail:${r.detail}`] = (counts[`detail:${r.detail}`] ?? 0) + 1;
  }

  return { rows, counts };
}
