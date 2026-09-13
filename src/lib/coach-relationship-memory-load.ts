/**
 * Server-only Coach Relationship Memory read.
 * One row per active item. Fail-soft. No phone/email fallback. No cache.
 */

import { supabaseServer } from "@/lib/supabase-server";
import {
  isCoachRelationshipMemoryUuid,
  normalizeCoachRelationshipMemoryItemText,
  renderCoachRelationshipMemory,
  type CoachRelationshipMemoryItem,
  type CoachRelationshipMemorySnapshot,
} from "@/lib/coach-relationship-memory";

const ITEM_SELECT = "memory_id, memory_text, created_at" as const;

function warnLoadFailed(clerk: string, error: string): void {
  console.warn("[coach-relationship-memory-load-failed]", {
    clerk_user_id: clerk,
    error: error.slice(0, 160),
  });
}

function parseLoadedItem(row: unknown): CoachRelationshipMemoryItem | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const rec = row as Record<string, unknown>;
  if (typeof rec.memory_id !== "string" || !isCoachRelationshipMemoryUuid(rec.memory_id)) {
    return null;
  }
  const text = normalizeCoachRelationshipMemoryItemText(rec.memory_text);
  if (text == null) return null;
  return { memory_id: rec.memory_id, text };
}

export async function fetchCoachRelationshipMemorySnapshot(
  clerkUserId: string
): Promise<CoachRelationshipMemorySnapshot> {
  const clerk = clerkUserId.trim();
  if (!clerk) return { items: [], rendered: null };

  try {
    const { data, error } = await supabaseServer
      .from("v2_coach_relationship_memory")
      .select(ITEM_SELECT)
      .eq("clerk_user_id", clerk)
      .order("created_at", { ascending: true })
      .order("memory_id", { ascending: true });

    if (error) {
      warnLoadFailed(clerk, error.message);
      return { items: [], rendered: null };
    }
    if (!Array.isArray(data)) {
      return { items: [], rendered: null };
    }

    const items: CoachRelationshipMemoryItem[] = [];
    for (const row of data) {
      const item = parseLoadedItem(row);
      if (item) items.push(item);
    }
    return {
      items,
      rendered: renderCoachRelationshipMemory(items),
    };
  } catch (err) {
    warnLoadFailed(clerk, err instanceof Error ? err.message : "unknown");
    return { items: [], rendered: null };
  }
}

/** Writer/proactive projection. Inbound persist uses the snapshot items. */
export async function fetchCoachRelationshipMemory(
  clerkUserId: string
): Promise<string | null> {
  return (await fetchCoachRelationshipMemorySnapshot(clerkUserId)).rendered;
}
