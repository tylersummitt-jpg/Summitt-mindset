import "server-only";

import { planClaim, planReenroll, planSuppress } from "@/lib/challenge-send-outcome";
import type { ReenrollPlan } from "@/lib/challenge-send-outcome";
import {
  participantDeliveryPatch,
  participantFromDbRow,
  type ChallengeStore,
} from "@/lib/challenge-store";
import type { ChallengeParticipant } from "@/lib/challenge-types";
import { sanitizeProviderError } from "@/lib/challenge-send-outcome";
import { supabaseServer } from "@/lib/supabase-server";

type DbError = { code?: string; message?: string } | null;

function logStoreError(op: string, error: DbError): void {
  console.error("[challenge] store_error", {
    op,
    code: error?.code ?? null,
    message: sanitizeProviderError(error?.message),
  });
}

function quoteTimestamp(iso: string): string {
  return `"${iso}"`;
}

function prefer(rows: ChallengeParticipant[]): ChallengeParticipant | null {
  if (rows.length === 0) return null;
  return rows.find((row) => !row.completed) ?? rows[0];
}

function firstRpcRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const row = data[0];
    return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
  }
  if (data && typeof data === "object") return data as Record<string, unknown>;
  return null;
}

/**
 * One atomic write. The SQL function keeps a suppression that landed after
 * the application read the row. Re-enrollment does not use this path.
 */
async function commitPreservingSuppression(args: {
  op: string;
  previous: ChallengeParticipant;
  next: ChallengeParticipant;
}): Promise<ChallengeParticipant | null> {
  const { data, error } = await supabaseServer.rpc("apply_challenge_send_bookkeeping", {
    p_id: args.previous.id,
    p_expected_day: args.previous.challengeDay,
    p_expected_attempt_count: args.previous.attemptCount,
    p_expected_claim_token: args.previous.sendClaimToken,
    p_patch: participantDeliveryPatch(args.next),
  });
  if (error) {
    logStoreError(args.op, error);
    return null;
  }
  const row = firstRpcRow(data);
  if (!row) return null;
  return participantFromDbRow(row);
}

export function createSupabaseChallengeStore(): ChallengeStore {
  return {
    async findByEmail(normalizedEmail) {
      const { data, error } = await supabaseServer.rpc("find_challenge_participants_by_email", {
        p_email: normalizedEmail,
      });
      if (error) {
        logStoreError("find_by_email", error);
        throw new Error("challenge_lookup_failed");
      }
      const rows = Array.isArray(data)
        ? data.map((row) => participantFromDbRow(row as Record<string, unknown>))
        : [];
      return prefer(rows);
    },
    async findByToken(token) {
      const { data, error } = await supabaseServer
        .from("challenge_participants")
        .select("*")
        .eq("unsubscribe_token", token)
        .maybeSingle();
      if (error) {
        logStoreError("find_by_token", error);
        return null;
      }
      if (!data) return null;
      return participantFromDbRow(data as Record<string, unknown>);
    },
    async getById(id) {
      const { data, error } = await supabaseServer
        .from("challenge_participants")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) {
        logStoreError("get_by_id", error);
        return null;
      }
      if (!data) return null;
      return participantFromDbRow(data as Record<string, unknown>);
    },
    async insert(row) {
      const { error } = await supabaseServer.from("challenge_participants").insert({
        email: row.email,
        challenge_day: row.challengeDay,
        started_at: row.startedAt,
        completed: false,
        next_send_at: null,
        reliable_send_tracking: true,
        send_tracking_cutover_at: row.sendTrackingCutoverAt,
        send_state: "pending",
        attempt_count: 0,
        unsubscribe_token: row.unsubscribeToken,
      });
      if (!error) return "inserted";
      if (error.code === "23505" || (error.message?.toLowerCase().includes("unique") ?? false)) {
        return "duplicate";
      }
      logStoreError("insert", error);
      return "error";
    },
    async listCandidates() {
      const { data, error } = await supabaseServer
        .from("challenge_participants")
        .select("*")
        .eq("completed", false)
        .gte("challenge_day", 1)
        .lte("challenge_day", 7);
      if (error) {
        logStoreError("list_candidates", error);
        throw new Error("challenge_list_failed");
      }
      return (data ?? []).map((row) => participantFromDbRow(row as Record<string, unknown>));
    },
    async countLegacyDay1Held() {
      const { count, error } = await supabaseServer
        .from("challenge_participants")
        .select("id", { count: "exact", head: true })
        .eq("completed", false)
        .eq("challenge_day", 1)
        .eq("reliable_send_tracking", false)
        .is("suppressed_at", null);
      if (error) {
        logStoreError("count_legacy_day1", error);
        return -1;
      }
      return count ?? 0;
    },
    async countNeedsAttention() {
      const { count, error } = await supabaseServer
        .from("challenge_participants")
        .select("id", { count: "exact", head: true })
        .eq("completed", false)
        .not("send_attention", "is", null);
      if (error) {
        logStoreError("count_attention", error);
        return -1;
      }
      return count ?? 0;
    },
    async claim(previous, args) {
      const current = await this.getById(previous.id);
      if (!current) return null;
      if (current.challengeDay !== previous.challengeDay) return null;
      if (current.attemptCount !== previous.attemptCount) return null;
      if (current.sendClaimToken !== previous.sendClaimToken) return null;
      const planned = planClaim(current, args);
      if (!planned) return null;
      const nowIso = args.now.toISOString();
      let query = supabaseServer
        .from("challenge_participants")
        .update(participantDeliveryPatch(planned))
        .eq("id", current.id)
        .eq("challenge_day", current.challengeDay)
        .eq("attempt_count", current.attemptCount)
        .eq("completed", false)
        .is("suppressed_at", null)
        .is("send_attention", null)
        .or(`send_claim_until.is.null,send_claim_until.lt.${quoteTimestamp(nowIso)}`);
      query = current.sendClaimToken
        ? query.eq("send_claim_token", current.sendClaimToken)
        : query.is("send_claim_token", null);
      if (current.challengeDay === 1) {
        query = query.eq("reliable_send_tracking", true);
      }
      const { data, error } = await query.select("*");
      if (error) {
        logStoreError("claim", error);
        return null;
      }
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) return null;
      return participantFromDbRow(row as Record<string, unknown>);
    },
    async commitSendResult(claimed, next) {
      return commitPreservingSuppression({
        op: "commit_send_result",
        previous: claimed,
        next,
      });
    },
    async commitBookkeeping(previous, next) {
      return commitPreservingSuppression({
        op: "commit_bookkeeping",
        previous,
        next,
      });
    },
    async suppressByToken(token, now) {
      const { data, error } = await supabaseServer
        .from("challenge_participants")
        .select("*")
        .eq("unsubscribe_token", token)
        .maybeSingle();
      if (error) {
        logStoreError("suppress_lookup", error);
        return "missing";
      }
      if (!data) return "missing";
      const row = participantFromDbRow(data as Record<string, unknown>);
      if (row.suppressedAt) return "already";
      const next = planSuppress(row, now);
      const { data: updated, error: updateError } = await supabaseServer
        .from("challenge_participants")
        .update({
          suppressed_at: next.suppressedAt,
          next_send_at: null,
          next_retry_at: null,
          send_state: "suppressed",
        })
        .eq("id", row.id)
        .is("suppressed_at", null)
        .select("id");
      if (updateError) {
        logStoreError("suppress", updateError);
        return "missing";
      }
      if (!updated || updated.length === 0) return "already";
      return "suppressed";
    },
    async reenrollByToken(token, now, nextSendAt): Promise<ReenrollPlan | "missing"> {
      const { data, error } = await supabaseServer
        .from("challenge_participants")
        .select("*")
        .eq("unsubscribe_token", token)
        .maybeSingle();
      if (error || !data) {
        if (error) logStoreError("reenroll_lookup", error);
        return "missing";
      }
      const row = participantFromDbRow(data as Record<string, unknown>);
      const plan = planReenroll(row, now, nextSendAt);
      if (plan.kind !== "resume_day1" && plan.kind !== "resume_later") return plan;
      // Only explicit re-enrollment may clear suppressed_at.
      const { data: updated, error: updateError } = await supabaseServer
        .from("challenge_participants")
        .update(participantDeliveryPatch(plan.row))
        .eq("id", row.id)
        .eq("challenge_day", row.challengeDay)
        .eq("completed", false)
        .not("suppressed_at", "is", null)
        .is("send_attention", null)
        .select("*");
      if (updateError || !updated || updated.length === 0) {
        if (updateError) logStoreError("reenroll", updateError);
        return planReenroll(
          (await this.getById(row.id)) ?? row,
          now,
          nextSendAt
        );
      }
      const saved = participantFromDbRow(updated[0] as Record<string, unknown>);
      return { kind: plan.kind, row: saved };
    },
    async markAttentionNotified(id, attention) {
      const { data, error } = await supabaseServer
        .from("challenge_participants")
        .update({ attention_notified_at: new Date().toISOString() })
        .eq("id", id)
        .eq("send_attention", attention)
        .is("attention_notified_at", null)
        .select("id");
      if (error) {
        logStoreError("mark_attention_notified", error);
        return false;
      }
      return Array.isArray(data) && data.length > 0;
    },
  };
}
