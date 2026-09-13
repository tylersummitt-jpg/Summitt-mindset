/**
 * Coach Relationship Memory (F) — item types, renderer, fail-soft parse,
 * mechanical validator, writer use law.
 * Sol owns English meaning. Code owns type/length/IDs/bounds only.
 * Server load lives in coach-relationship-memory-load.ts so parsers/prompts
 * can import this module without a Supabase client.
 */

export const COACH_RELATIONSHIP_MEMORY_MAX_ITEM_CHARS = 400 as const;
export const COACH_RELATIONSHIP_MEMORY_MAX_ITEMS = 40 as const;
export const COACH_RELATIONSHIP_MEMORY_MAX_TOTAL_CHARS = 4000 as const;
export const COACH_RELATIONSHIP_MEMORY_MAX_OPS = 6 as const;

/** @deprecated Blob-era alias. Use COACH_RELATIONSHIP_MEMORY_MAX_TOTAL_CHARS. */
export const COACH_RELATIONSHIP_MEMORY_MAX_CHARS =
  COACH_RELATIONSHIP_MEMORY_MAX_TOTAL_CHARS;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CoachRelationshipMemoryItem = {
  memory_id: string;
  text: string;
};

export type CoachRelationshipMemorySnapshot = {
  items: CoachRelationshipMemoryItem[];
  rendered: string | null;
};

export type CoachRelationshipMemoryChanges = {
  add: string[];
  delete: string[];
};

export const EMPTY_COACH_RELATIONSHIP_MEMORY_SNAPSHOT: CoachRelationshipMemorySnapshot =
  {
    items: [],
    rendered: null,
  };

export const COACH_RELATIONSHIP_MEMORY_WRITER_USE_LAW = `COACH RELATIONSHIP MEMORY
coach_relationship_memory is background relationship context, not content you are required to mention.

CURRENT TURN FIRST.
Newest explicit user truth outranks old memory.
Direct user questions, urgent or live issues, grief or crisis, Goal Change, a clear accountability miss, an important open loop, current action, support or product questions, and newest explicit user truth outrank relationship memory.

Use relationship memory only when it naturally improves the next coaching move.
Most good uses should be silent personalization: better judgment, better relevance, better question choice, better continuity.

AVAILABLE DOES NOT MEAN MENTION.
Never recite memory to prove Coach remembers.
Never force a person's name, a family reference, a callback, or a historical detail into an unrelated message.

F alone does NOT prove repetition or a pattern.
F alone cannot justify "lately", "you keep", "you always", or "this is becoming a pattern".
Pattern claims require repeated evidence visible in current context.

Never say "I saved that", "I'll remember that", "I've got that stored", or "I'll keep that in mind".
Do not claim persistence.`;

export function isCoachRelationshipMemoryUuid(raw: string): boolean {
  return UUID_RE.test(raw);
}

/**
 * Address-format canonicalization only. Lowercases a syntactically valid UUID.
 * Does not invent IDs or rewrite any character except case.
 */
export function canonicalizeCoachRelationshipMemoryUuid(
  raw: string
): string | null {
  const trimmed = raw.trim();
  if (!isCoachRelationshipMemoryUuid(trimmed)) return null;
  return trimmed.toLowerCase();
}

/**
 * Postgres char_length equivalent for F capacity: Unicode code points,
 * not UTF-16 code units and not grapheme clusters.
 */
export function coachRelationshipMemoryCharCount(text: string): number {
  return Array.from(text).length;
}

/**
 * Mechanical item-text gate. Preserves internal newlines. Trims only ends.
 * Over-cap is rejected, never sliced.
 */
export function normalizeCoachRelationshipMemoryItemText(
  raw: unknown
): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (
    coachRelationshipMemoryCharCount(trimmed) >
    COACH_RELATIONSHIP_MEMORY_MAX_ITEM_CHARS
  ) {
    return null;
  }
  return trimmed;
}

export function renderCoachRelationshipMemory(
  items: readonly CoachRelationshipMemoryItem[]
): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const joined = items.map((item) => item.text).join("\n");
  return joined.length > 0 ? joined : null;
}

export function coachRelationshipMemoryTotalChars(
  items: readonly CoachRelationshipMemoryItem[]
): number {
  let total = 0;
  for (const item of items) total += coachRelationshipMemoryCharCount(item.text);
  return total;
}

export function isCoachRelationshipMemoryChangesNoop(
  changes: CoachRelationshipMemoryChanges | null | undefined
): boolean {
  if (changes == null) return true;
  return changes.add.length === 0 && changes.delete.length === 0;
}

export function isCoachRelationshipMemoryChangesProposed(
  changes: CoachRelationshipMemoryChanges | null | undefined
): boolean {
  return !isCoachRelationshipMemoryChangesNoop(changes);
}

/**
 * Structural parse only. Malformed shape → null. Does not invalidate extras.
 * Length, UUID, OLD-set membership, and caps belong to the validator.
 */
export function parseCoachRelationshipMemoryChanges(
  raw: unknown
): CoachRelationshipMemoryChanges | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.some((k) => k !== "add" && k !== "delete")) return null;
  if (!Array.isArray(o.add) || !Array.isArray(o.delete)) {
    return null;
  }

  const add: string[] = [];
  for (const item of o.add) {
    if (typeof item !== "string") return null;
    add.push(item);
  }

  const del: string[] = [];
  for (const id of o.delete) {
    if (typeof id !== "string") return null;
    del.push(id);
  }

  return { add, delete: del };
}

export type CoachRelationshipMemoryValidationOk = {
  ok: true;
  changes: CoachRelationshipMemoryChanges;
  resulting_item_count: number;
  resulting_total_chars: number;
};

export type CoachRelationshipMemoryValidationFail = {
  ok: false;
  reason: string;
};

export type CoachRelationshipMemoryValidation =
  | CoachRelationshipMemoryValidationOk
  | CoachRelationshipMemoryValidationFail;

/**
 * Mechanical mutation check against the exact OLD item set shown to Sol.
 * No English similarity, importance, contradiction, or eviction.
 */
export function validateCoachRelationshipMemoryChanges(
  changes: CoachRelationshipMemoryChanges,
  oldItems: readonly CoachRelationshipMemoryItem[]
): CoachRelationshipMemoryValidation {
  const addCount = changes.add.length;
  const deleteCount = changes.delete.length;
  if (addCount + deleteCount > COACH_RELATIONSHIP_MEMORY_MAX_OPS) {
    return { ok: false, reason: "op_cap" };
  }

  const oldIds = new Set<string>();
  const remaining = new Map<string, string>();
  for (const item of oldItems) {
    const id = canonicalizeCoachRelationshipMemoryUuid(item.memory_id);
    if (id == null) continue;
    oldIds.add(id);
    remaining.set(id, item.text);
  }

  const seenDelete = new Set<string>();
  const normalizedDeletes: string[] = [];
  for (const rawId of changes.delete) {
    const memoryId = canonicalizeCoachRelationshipMemoryUuid(rawId);
    if (memoryId == null) {
      return { ok: false, reason: "invalid_id" };
    }
    if (seenDelete.has(memoryId)) {
      return { ok: false, reason: "duplicate_delete_id" };
    }
    if (!oldIds.has(memoryId)) {
      return { ok: false, reason: "id_not_in_old_set" };
    }
    seenDelete.add(memoryId);
    normalizedDeletes.push(memoryId);
  }

  const normalizedAdds: string[] = [];
  for (const raw of changes.add) {
    const text = normalizeCoachRelationshipMemoryItemText(raw);
    if (text == null) {
      return {
        ok: false,
        reason:
          typeof raw === "string" && raw.trim().length > 0
            ? "add_text_too_long"
            : "empty_add_text",
      };
    }
    normalizedAdds.push(text);
  }

  for (const id of normalizedDeletes) remaining.delete(id);

  const resultingItemCount = remaining.size + normalizedAdds.length;
  if (resultingItemCount > COACH_RELATIONSHIP_MEMORY_MAX_ITEMS) {
    return { ok: false, reason: "item_cap" };
  }

  let resultingTotalChars = 0;
  for (const text of remaining.values()) {
    resultingTotalChars += coachRelationshipMemoryCharCount(text);
  }
  for (const text of normalizedAdds) {
    resultingTotalChars += coachRelationshipMemoryCharCount(text);
  }
  if (resultingTotalChars > COACH_RELATIONSHIP_MEMORY_MAX_TOTAL_CHARS) {
    return { ok: false, reason: "char_cap" };
  }

  return {
    ok: true,
    changes: {
      add: normalizedAdds,
      delete: normalizedDeletes,
    },
    resulting_item_count: resultingItemCount,
    resulting_total_chars: resultingTotalChars,
  };
}
