/**
 * Server helpers for v2_commitment_evolution_recommendation rows.
 * Does not mutate commitments; only recommendation status rows.
 */

import { supabaseServer } from "@/lib/supabase-server";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { getRecentV2EventsForAi } from "@/lib/v2-commitment";
import {
  EVOLUTION_V1_ACTIONS,
  EVOLUTION_V1_PENDING_ROW_ACTIONS,
  evaluateCommitmentEvolutionV1,
  type EvolutionV1RecommendedAction,
} from "@/lib/v2-commitment-evolution-engine-v1";

function parseRecommendedAction(raw: unknown): EvolutionV1RecommendedAction | null {
  if (typeof raw !== "string") return null;
  return (EVOLUTION_V1_ACTIONS as readonly string[]).includes(raw)
    ? (raw as EvolutionV1RecommendedAction)
    : null;
}

export type EvolutionRecommendationRow = {
  id: string;
  clerk_user_id: string;
  commitment_id: string;
  engine_version: string;
  recommended_action: EvolutionV1RecommendedAction;
  evidence_json: Record<string, unknown>;
  status: "pending" | "accepted" | "dismissed" | "superseded";
  created_at: string;
  resolved_at: string | null;
  superseded_at: string | null;
};

function mapRow(raw: Record<string, unknown>): EvolutionRecommendationRow | null {
  const id = typeof raw.id === "string" ? raw.id : null;
  const clerk_user_id = typeof raw.clerk_user_id === "string" ? raw.clerk_user_id : null;
  const commitment_id = typeof raw.commitment_id === "string" ? raw.commitment_id : null;
  const engine_version = typeof raw.engine_version === "string" ? raw.engine_version : "v1";
  const recommended_action = parseRecommendedAction(raw.recommended_action);
  if (!recommended_action) return null;
  const status = raw.status as EvolutionRecommendationRow["status"];
  const created_at = typeof raw.created_at === "string" ? raw.created_at : null;
  if (!id || !clerk_user_id || !commitment_id || !created_at) return null;
  if (
    status !== "pending" &&
    status !== "accepted" &&
    status !== "dismissed" &&
    status !== "superseded"
  ) {
    return null;
  }
  const ev = raw.evidence_json;
  const evidence_json =
    ev != null && typeof ev === "object" && !Array.isArray(ev) ? (ev as Record<string, unknown>) : {};
  return {
    id,
    clerk_user_id,
    commitment_id,
    engine_version,
    recommended_action,
    evidence_json,
    status,
    created_at,
    resolved_at: typeof raw.resolved_at === "string" ? raw.resolved_at : null,
    superseded_at: typeof raw.superseded_at === "string" ? raw.superseded_at : null,
  };
}

export async function fetchPendingEvolutionRecommendation(
  commitmentId: string
): Promise<EvolutionRecommendationRow | null> {
  const { data, error } = await supabaseServer
    .from("v2_commitment_evolution_recommendation")
    .select("*")
    .eq("commitment_id", commitmentId)
    .eq("status", "pending")
    .maybeSingle();

  if (error) {
    console.error("[v2-evolution-rec] fetchPending failed", { commitmentId, message: error.message });
    return null;
  }
  if (!data) return null;
  return mapRow(data as Record<string, unknown>);
}

/**
 * Evaluates engine and ensures a single pending row matches the evaluation.
 * If action unchanged vs current pending, returns existing row (no write).
 * If action changed, supersedes prior pending and inserts a new pending row.
 */
export async function syncEvolutionRecommendationForCommitment(args: {
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow;
}): Promise<EvolutionRecommendationRow | null> {
  const { clerkUserId, commitment } = args;
  const events = await getRecentV2EventsForAi(commitment.id);
  const evaluation = evaluateCommitmentEvolutionV1({
    commitment,
    eventsNewestFirst: events,
    nowMs: Date.now(),
  });

  const pending = await fetchPendingEvolutionRecommendation(commitment.id);
  const persistable = EVOLUTION_V1_PENDING_ROW_ACTIONS.has(evaluation.recommended_action);

  const shouldSupersedeExisting =
    Boolean(pending?.id) &&
    (!persistable ||
      (pending != null && pending.recommended_action !== evaluation.recommended_action));

  const nowIso = new Date().toISOString();

  if (shouldSupersedeExisting && pending?.id) {
    const { error: supErr } = await supabaseServer
      .from("v2_commitment_evolution_recommendation")
      .update({
        status: "superseded",
        superseded_at: nowIso,
      })
      .eq("id", pending.id)
      .eq("status", "pending");

    if (supErr) {
      console.error("[v2-evolution-rec] supersede pending failed", {
        id: pending.id,
        message: supErr.message,
      });
      return fetchPendingEvolutionRecommendation(commitment.id);
    }
  }

  if (!persistable) {
    return null;
  }

  const pendingAfterSupersede = shouldSupersedeExisting
    ? null
    : await fetchPendingEvolutionRecommendation(commitment.id);

  if (
    pendingAfterSupersede &&
    pendingAfterSupersede.recommended_action === evaluation.recommended_action &&
    pendingAfterSupersede.status === "pending"
  ) {
    return pendingAfterSupersede;
  }

  const insertPayload = {
    clerk_user_id: clerkUserId,
    commitment_id: commitment.id,
    engine_version: "v1",
    recommended_action: evaluation.recommended_action,
    evidence_json: evaluation.evidence_json,
    status: "pending" as const,
  };

  const { data: inserted, error: insErr } = await supabaseServer
    .from("v2_commitment_evolution_recommendation")
    .insert(insertPayload)
    .select("*")
    .maybeSingle();

  if (insErr) {
    const code = (insErr as { code?: string }).code;
    if (code === "23505") {
      const afterRace = await fetchPendingEvolutionRecommendation(commitment.id);
      return afterRace;
    }
    console.error("[v2-evolution-rec] insert pending failed", {
      commitment_id: commitment.id,
      message: insErr.message,
    });
    return fetchPendingEvolutionRecommendation(commitment.id);
  }

  return inserted ? mapRow(inserted as Record<string, unknown>) : null;
}

export async function resolveEvolutionRecommendationForUser(args: {
  userId: string;
  recommendationId: string;
  intent: "dismiss" | "accept";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId, recommendationId, intent } = args;
  const nextStatus = intent === "dismiss" ? "dismissed" : "accepted";
  const nowIso = new Date().toISOString();

  const { data, error } = await supabaseServer
    .from("v2_commitment_evolution_recommendation")
    .update({
      status: nextStatus,
      resolved_at: nowIso,
    })
    .eq("id", recommendationId)
    .eq("clerk_user_id", userId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: "update_failed" };
  }
  if (!data) {
    return { ok: false, error: "not_found_or_not_pending" };
  }
  return { ok: true };
}
