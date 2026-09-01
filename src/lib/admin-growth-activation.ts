import "server-only";

import { evaluateTrialActivatedWithin24h } from "@/lib/admin-growth-activation-pure";
import { isLikelySmsComplianceOrOptOutTurn } from "@/lib/v2-sms-conversation-brain-eligibility";
import { supabaseServer } from "@/lib/supabase-server";

export type TrialActivationSeed = {
  clerkUserId: string;
  trialStartUnix: number;
};

/**
 * Stripe trials only. Requires onboarding timestamp, goal started_at, check_sent,
 * and a non-compliance inbound after that check_sent — all within 24h of trial_start.
 * Batched queries. raw_body is read only to classify; never returned.
 */
export async function clerkIdsActivatedWithin24h(
  seeds: TrialActivationSeed[]
): Promise<Set<string>> {
  const out = new Set<string>();
  const unique = new Map<string, number>();
  for (const seed of seeds) {
    const id = seed.clerkUserId.trim();
    if (!id || !Number.isFinite(seed.trialStartUnix)) continue;
    unique.set(id, seed.trialStartUnix);
  }
  if (unique.size === 0) return out;

  const clerkIds = [...unique.keys()];
  const starts = clerkIds.map((id) => unique.get(id)!);
  const minStart = Math.min(...starts);
  const maxEnd = Math.max(...starts) + 24 * 3600;
  const minIso = new Date(minStart * 1000).toISOString();
  const maxIso = new Date(maxEnd * 1000).toISOString();

  try {
    const [profilesRes, commitmentsRes, checksRes, inboundRes] = await Promise.all([
      supabaseServer
        .from("user_profiles")
        .select("clerk_user_id, identity_intake_completed_at")
        .in("clerk_user_id", clerkIds)
        .not("identity_intake_completed_at", "is", null),
      supabaseServer
        .from("v2_commitment")
        .select("clerk_user_id, started_at")
        .in("clerk_user_id", clerkIds)
        .gte("started_at", minIso)
        .lt("started_at", maxIso),
      supabaseServer
        .from("v2_commitment_event")
        .select("clerk_user_id, occurred_at")
        .in("clerk_user_id", clerkIds)
        .eq("event_type", "check_sent")
        .gte("occurred_at", minIso)
        .lt("occurred_at", maxIso),
      supabaseServer
        .from("sms_inbound_messages")
        .select("clerk_user_id, received_at, raw_body")
        .in("clerk_user_id", clerkIds)
        .gte("received_at", minIso)
        .lt("received_at", maxIso),
    ]);

    if (profilesRes.error || commitmentsRes.error || checksRes.error || inboundRes.error) {
      console.warn("[admin-growth-activation] query failed", {
        profiles: profilesRes.error?.message,
        commitments: commitmentsRes.error?.message,
        checks: checksRes.error?.message,
        inbound: inboundRes.error?.message,
      });
      return out;
    }

    const onboardedAt = new Map<string, number>();
    for (const row of profilesRes.data ?? []) {
      const id = typeof row.clerk_user_id === "string" ? row.clerk_user_id : "";
      const at = Date.parse(String(row.identity_intake_completed_at ?? ""));
      if (id && Number.isFinite(at)) onboardedAt.set(id, at);
    }

    const goalsByUser = new Map<string, number[]>();
    for (const row of commitmentsRes.data ?? []) {
      const id = typeof row.clerk_user_id === "string" ? row.clerk_user_id : "";
      const at = Date.parse(String(row.started_at ?? ""));
      if (!id || !Number.isFinite(at)) continue;
      const list = goalsByUser.get(id) ?? [];
      list.push(at);
      goalsByUser.set(id, list);
    }

    const checksByUser = new Map<string, number[]>();
    for (const row of checksRes.data ?? []) {
      const id = typeof row.clerk_user_id === "string" ? row.clerk_user_id : "";
      const at = Date.parse(String(row.occurred_at ?? ""));
      if (!id || !Number.isFinite(at)) continue;
      const list = checksByUser.get(id) ?? [];
      list.push(at);
      checksByUser.set(id, list);
    }

    type Inbound = { receivedAt: number; body: string };
    const inboundByUser = new Map<string, Inbound[]>();
    for (const row of inboundRes.data ?? []) {
      const id = typeof row.clerk_user_id === "string" ? row.clerk_user_id : "";
      const at = Date.parse(String(row.received_at ?? ""));
      if (!id || !Number.isFinite(at)) continue;
      const body = typeof row.raw_body === "string" ? row.raw_body : "";
      const list = inboundByUser.get(id) ?? [];
      list.push({ receivedAt: at, body });
      inboundByUser.set(id, list);
    }

    for (const [clerkUserId, trialStartUnix] of unique) {
      const activated = evaluateTrialActivatedWithin24h({
        trialStartUnix,
        identityIntakeCompletedAtMs: onboardedAt.get(clerkUserId) ?? null,
        goalStartedAtMs: goalsByUser.get(clerkUserId) ?? [],
        checkSentAtMs: checksByUser.get(clerkUserId) ?? [],
        inbounds: (inboundByUser.get(clerkUserId) ?? []).map((msg) => ({
          receivedAtMs: msg.receivedAt,
          rawBody: msg.body,
        })),
        isComplianceOrOptOut: isLikelySmsComplianceOrOptOutTurn,
      });
      if (activated) out.add(clerkUserId);
    }
  } catch (err) {
    console.warn("[admin-growth-activation] threw", err);
  }

  return out;
}

export function activationSeedsFromTrials(
  rows: Array<{ clerkUserId: string | null; trialStartUnix: number | null | undefined }>
): TrialActivationSeed[] {
  const out: TrialActivationSeed[] = [];
  for (const row of rows) {
    if (!row.clerkUserId || row.trialStartUnix == null) continue;
    if (!Number.isFinite(row.trialStartUnix)) continue;
    out.push({ clerkUserId: row.clerkUserId, trialStartUnix: row.trialStartUnix });
  }
  return out;
}
