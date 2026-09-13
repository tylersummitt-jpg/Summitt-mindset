/**
 * Mechanical persist of Sol Coach Relationship Memory (F) item operations.
 * All semantic writes go through v2_apply_coach_relationship_memory_mutations.
 * No English merge, append, dedupe, or eviction.
 * V1 model contract is ADD + DELETE + null. Live RPC still accepts p_updates;
 * this app always sends p_updates: []. update_count remains on the result as a
 * mechanical RPC field with V1 invariant 0.
 */

import { supabaseServer } from "@/lib/supabase-server";
import {
  coachRelationshipMemoryTotalChars,
  isCoachRelationshipMemoryChangesNoop,
  validateCoachRelationshipMemoryChanges,
  type CoachRelationshipMemoryChanges,
  type CoachRelationshipMemoryItem,
} from "@/lib/coach-relationship-memory";

export const V2_APPLY_COACH_RELATIONSHIP_MEMORY_MUTATIONS_RPC =
  "v2_apply_coach_relationship_memory_mutations" as const;

export type PersistSolCoachRelationshipMemoryStatus =
  | "none"
  | "applied"
  | "validation_rejected"
  | "failed";

export type PersistSolCoachRelationshipMemoryResult = {
  status: PersistSolCoachRelationshipMemoryStatus;
  reason: string | null;
  add_count: number;
  /** Mechanical live-RPC field. V1 invariant is 0 because p_updates is always []. */
  update_count: number;
  delete_count: number;
  old_item_count: number;
  new_item_count: number | null;
  old_total_chars: number | null;
  new_total_chars: number | null;
};

function emptyResult(
  status: PersistSolCoachRelationshipMemoryStatus,
  reason: string | null,
  oldItems: readonly CoachRelationshipMemoryItem[],
  proposal?: CoachRelationshipMemoryChanges | null
): PersistSolCoachRelationshipMemoryResult {
  return {
    status,
    reason,
    add_count: proposal?.add.length ?? 0,
    update_count: 0,
    delete_count: proposal?.delete.length ?? 0,
    old_item_count: oldItems.length,
    new_item_count: null,
    old_total_chars: coachRelationshipMemoryTotalChars(oldItems),
    new_total_chars: null,
  };
}

function warnPersistFailed(
  clerkUserId: string,
  error: string,
  code?: string | null
): void {
  console.warn("[inbound-sol-coach-relationship-memory-persist-failed]", {
    clerk_user_id: clerkUserId,
    code: code ?? null,
    error: error.slice(0, 160),
  });
}

function firstRpcRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
    return data[0] as Record<string, unknown>;
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return null;
}

function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Math.floor(Number(value));
  }
  return null;
}

export async function persistSolCoachRelationshipMemory(args: {
  clerkUserId: string;
  changes: CoachRelationshipMemoryChanges | null | undefined;
  oldItems: readonly CoachRelationshipMemoryItem[];
}): Promise<PersistSolCoachRelationshipMemoryResult> {
  const oldItems = Array.isArray(args.oldItems) ? args.oldItems : [];

  if (args.changes == null || isCoachRelationshipMemoryChangesNoop(args.changes)) {
    return emptyResult("none", "null_or_empty_changes", oldItems, args.changes);
  }

  const changes = args.changes;
  const clerkUserId = args.clerkUserId.trim();
  if (!clerkUserId) {
    return emptyResult(
      "validation_rejected",
      "missing_clerk_user_id",
      oldItems,
      changes
    );
  }

  const validated = validateCoachRelationshipMemoryChanges(changes, oldItems);
  if (!validated.ok) {
    return emptyResult("validation_rejected", validated.reason, oldItems, changes);
  }

  try {
    const { data, error } = await supabaseServer.rpc(
      V2_APPLY_COACH_RELATIONSHIP_MEMORY_MUTATIONS_RPC,
      {
        p_clerk_user_id: clerkUserId,
        p_adds: validated.changes.add,
        p_updates: [],
        p_deletes: validated.changes.delete,
      }
    );

    if (error) {
      warnPersistFailed(
        clerkUserId,
        error.message,
        (error as { code?: string }).code ?? null
      );
      return emptyResult(
        "failed",
        error.message.slice(0, 120),
        oldItems,
        validated.changes
      );
    }

    const row = firstRpcRow(data);
    if (!row || row.result !== "applied") {
      warnPersistFailed(clerkUserId, "malformed_rpc_result");
      return emptyResult(
        "failed",
        "malformed_rpc_result",
        oldItems,
        validated.changes
      );
    }

    return {
      status: "applied",
      reason: null,
      add_count: asInt(row.add_count) ?? validated.changes.add.length,
      update_count: asInt(row.update_count) ?? 0,
      delete_count: asInt(row.delete_count) ?? validated.changes.delete.length,
      old_item_count: oldItems.length,
      new_item_count: asInt(row.item_count),
      old_total_chars: coachRelationshipMemoryTotalChars(oldItems),
      new_total_chars: asInt(row.total_chars),
    };
  } catch (err) {
    warnPersistFailed(
      clerkUserId,
      err instanceof Error ? err.message : "unknown"
    );
    return emptyResult(
      "failed",
      err instanceof Error ? err.message.slice(0, 120) : "unknown",
      oldItems,
      validated.changes
    );
  }
}
