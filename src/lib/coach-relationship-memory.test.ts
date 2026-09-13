import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFrom = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: supabaseFrom },
}));

import {
  fetchCoachRelationshipMemory,
  fetchCoachRelationshipMemorySnapshot,
} from "@/lib/coach-relationship-memory-load";
import {
  COACH_RELATIONSHIP_MEMORY_MAX_ITEM_CHARS,
  COACH_RELATIONSHIP_MEMORY_MAX_ITEMS,
  COACH_RELATIONSHIP_MEMORY_MAX_OPS,
  COACH_RELATIONSHIP_MEMORY_MAX_TOTAL_CHARS,
  canonicalizeCoachRelationshipMemoryUuid,
  coachRelationshipMemoryCharCount,
  coachRelationshipMemoryTotalChars,
  normalizeCoachRelationshipMemoryItemText,
  parseCoachRelationshipMemoryChanges,
  renderCoachRelationshipMemory,
  validateCoachRelationshipMemoryChanges,
  type CoachRelationshipMemoryItem,
} from "@/lib/coach-relationship-memory";

const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID_UNSEEN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TEXT_A = "Quiet one-on-one time with Brooke matters more than elaborate plans.";
const TEXT_B = "Breck initiating time together is especially meaningful to Tyler.";

function item(memory_id: string, text: string): CoachRelationshipMemoryItem {
  return { memory_id, text };
}

function itemQuery(args: {
  rows?: unknown;
  error?: { message: string } | null;
  eqs?: Array<[string, string]>;
  orders?: Array<[string, { ascending: boolean }]>;
  selects?: string[];
}) {
  const result = { data: args.rows ?? [], error: args.error ?? null };
  const builder = {
    select: (cols: string) => {
      args.selects?.push(cols);
      return builder;
    },
    eq: (col: string, val: string) => {
      args.eqs?.push([col, val]);
      return builder;
    },
    order: (col: string, opts: { ascending: boolean }) => {
      args.orders?.push([col, opts]);
      return builder;
    },
    then: (resolve: (v: typeof result) => void) => resolve(result),
  };
  return builder;
}

describe("normalizeCoachRelationshipMemoryItemText", () => {
  it("null and missing-like values become null", () => {
    expect(normalizeCoachRelationshipMemoryItemText(null)).toBeNull();
    expect(normalizeCoachRelationshipMemoryItemText(undefined)).toBeNull();
  });

  it("non-string becomes null", () => {
    expect(normalizeCoachRelationshipMemoryItemText(12)).toBeNull();
    expect(normalizeCoachRelationshipMemoryItemText({ text: "no" })).toBeNull();
    expect(normalizeCoachRelationshipMemoryItemText(["line"])).toBeNull();
  });

  it("empty and whitespace-only become null", () => {
    expect(normalizeCoachRelationshipMemoryItemText("")).toBeNull();
    expect(normalizeCoachRelationshipMemoryItemText("   \n  ")).toBeNull();
  });

  it("preserves internal newlines and trims only ends", () => {
    expect(
      normalizeCoachRelationshipMemoryItemText(
        "  Quiet one-on-one time with Brooke matters more than elaborate plans.  "
      )
    ).toBe("Quiet one-on-one time with Brooke matters more than elaborate plans.");
  });

  it("rejects >400 without slicing", () => {
    const tooLong = "A".repeat(401);
    expect(tooLong.length).toBe(401);
    expect(normalizeCoachRelationshipMemoryItemText(tooLong)).toBeNull();
    expect(tooLong.slice(0, COACH_RELATIONSHIP_MEMORY_MAX_ITEM_CHARS).length).toBe(400);
  });

  it("accepts length 1 and 400", () => {
    expect(normalizeCoachRelationshipMemoryItemText("X")).toBe("X");
    const max = "B".repeat(COACH_RELATIONSHIP_MEMORY_MAX_ITEM_CHARS);
    expect(normalizeCoachRelationshipMemoryItemText(max)).toBe(max);
  });

  it("ASCII 400 code points accepted and 401 rejected", () => {
    const ascii400 = "A".repeat(400);
    const ascii401 = "A".repeat(401);
    expect(coachRelationshipMemoryCharCount(ascii400)).toBe(400);
    expect(normalizeCoachRelationshipMemoryItemText(ascii400)).toBe(ascii400);
    expect(normalizeCoachRelationshipMemoryItemText(ascii401)).toBeNull();
  });

  it("400 emoji code points accepted even when JS .length exceeds 400", () => {
    const emoji400 = "😀".repeat(400);
    expect(emoji400.length).toBeGreaterThan(400);
    expect(coachRelationshipMemoryCharCount(emoji400)).toBe(400);
    expect(normalizeCoachRelationshipMemoryItemText(emoji400)).toBe(emoji400);
  });

  it("401 emoji code points rejected", () => {
    const emoji401 = "😀".repeat(401);
    expect(coachRelationshipMemoryCharCount(emoji401)).toBe(401);
    expect(normalizeCoachRelationshipMemoryItemText(emoji401)).toBeNull();
  });

  it("mixed ASCII + emoji uses code-point count", () => {
    const mixed = `Hi😀${"A".repeat(397)}`;
    expect(coachRelationshipMemoryCharCount(mixed)).toBe(400);
    expect(mixed.length).toBeGreaterThan(400);
    expect(normalizeCoachRelationshipMemoryItemText(mixed)).toBe(mixed);
    expect(normalizeCoachRelationshipMemoryItemText(`${mixed}B`)).toBeNull();
  });
});

describe("renderCoachRelationshipMemory", () => {
  it("joins ordered texts with newlines and never includes IDs", () => {
    const rendered = renderCoachRelationshipMemory([
      item(ID_A, TEXT_A),
      item(ID_B, TEXT_B),
    ]);
    expect(rendered).toBe(`${TEXT_A}\n${TEXT_B}`);
    expect(rendered).not.toContain(ID_A);
    expect(rendered).not.toContain(ID_B);
    expect(rendered).not.toContain("memory_id");
  });

  it("empty array is null", () => {
    expect(renderCoachRelationshipMemory([])).toBeNull();
  });
});

describe("parseCoachRelationshipMemoryChanges", () => {
  it("null → null", () => {
    expect(parseCoachRelationshipMemoryChanges(null)).toBeNull();
  });

  it("missing parser input → null", () => {
    expect(parseCoachRelationshipMemoryChanges(undefined)).toBeNull();
  });

  it("wrong root type → null", () => {
    expect(parseCoachRelationshipMemoryChanges("add")).toBeNull();
    expect(parseCoachRelationshipMemoryChanges(12)).toBeNull();
    expect(parseCoachRelationshipMemoryChanges(["add"])).toBeNull();
  });

  it("bad add type → null", () => {
    expect(
      parseCoachRelationshipMemoryChanges({
        add: [12],
        delete: [],
      })
    ).toBeNull();
  });

  it("old update-only shape does not become a valid mutation", () => {
    expect(
      parseCoachRelationshipMemoryChanges({
        add: [],
        update: [{ memory_id: ID_A, text: "x" }],
        delete: [],
      })
    ).toBeNull();
    expect(
      parseCoachRelationshipMemoryChanges({
        add: ["new standing meaning"],
        update: [{ memory_id: ID_A, text: "rewritten" }],
        delete: [],
      })
    ).toBeNull();
  });

  it("bad delete shape → null", () => {
    expect(
      parseCoachRelationshipMemoryChanges({
        add: [],
        delete: [12],
      })
    ).toBeNull();
  });

  it("all-empty arrays parse as a noop object", () => {
    expect(parseCoachRelationshipMemoryChanges({ add: [], delete: [] })).toEqual({
      add: [],
      delete: [],
    });
  });

  it("well-shaped object is accepted without length/UUID checks", () => {
    expect(
      parseCoachRelationshipMemoryChanges({
        add: ["  new standing meaning  "],
        delete: ["also-not-uuid"],
      })
    ).toEqual({
      add: ["  new standing meaning  "],
      delete: ["also-not-uuid"],
    });
  });
});

describe("validateCoachRelationshipMemoryChanges", () => {
  const old = [item(ID_A, TEXT_A), item(ID_B, TEXT_B)];

  it("add one valid", () => {
    const r = validateCoachRelationshipMemoryChanges(
      { add: ["Protecting evenings for family matters after periods of heavy work."], delete: [] },
      old
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changes.add).toHaveLength(1);
    expect(r.resulting_item_count).toBe(3);
  });

  it("add several valid", () => {
    const r = validateCoachRelationshipMemoryChanges(
      { add: ["New standing A.", "New standing B."], delete: [] },
      old
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changes.add).toEqual(["New standing A.", "New standing B."]);
  });

  it("delete valid OLD id", () => {
    const r = validateCoachRelationshipMemoryChanges(
      { add: [], delete: [ID_B] },
      old
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.resulting_item_count).toBe(1);
  });

  it("add + delete valid", () => {
    const r = validateCoachRelationshipMemoryChanges(
      {
        add: ["A new standing meaning about coaching honesty."],
        delete: [ID_B],
      },
      old
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.resulting_item_count).toBe(2);
  });

  it("invalid UUID → reject", () => {
    expect(
      validateCoachRelationshipMemoryChanges(
        { add: [], delete: ["nope"] },
        old
      )
    ).toEqual({ ok: false, reason: "invalid_id" });
  });

  it("delete id not in OLD set → reject", () => {
    expect(
      validateCoachRelationshipMemoryChanges(
        { add: [], delete: [ID_UNSEEN] },
        old
      )
    ).toEqual({ ok: false, reason: "id_not_in_old_set" });
  });

  it("another-user/unseen id → reject at app allowlist", () => {
    expect(
      validateCoachRelationshipMemoryChanges(
        { add: [], delete: [ID_UNSEEN] },
        old
      ).ok
    ).toBe(false);
  });

  it("duplicate delete id → reject", () => {
    expect(
      validateCoachRelationshipMemoryChanges(
        { add: [], delete: [ID_A, ID_A] },
        old
      )
    ).toEqual({ ok: false, reason: "duplicate_delete_id" });
  });

  it("blank add → reject", () => {
    expect(
      validateCoachRelationshipMemoryChanges(
        { add: ["   "], delete: [] },
        old
      )
    ).toEqual({ ok: false, reason: "empty_add_text" });
  });

  it(">400 add → reject with no truncation", () => {
    const tooLong = "A".repeat(401);
    expect(
      validateCoachRelationshipMemoryChanges(
        { add: [tooLong], delete: [] },
        old
      )
    ).toEqual({ ok: false, reason: "add_text_too_long" });
    expect(tooLong.length).toBe(401);
  });

  it(">6 total ops → reject", () => {
    expect(COACH_RELATIONSHIP_MEMORY_MAX_OPS).toBe(6);
    expect(
      validateCoachRelationshipMemoryChanges(
        {
          add: ["1", "2", "3", "4", "5"],
          delete: [ID_A, ID_B],
        },
        old
      )
    ).toEqual({ ok: false, reason: "op_cap" });
    expect(
      validateCoachRelationshipMemoryChanges(
        {
          add: ["1", "2", "3", "4", "5", "6", "7"],
          delete: [],
        },
        old
      )
    ).toEqual({ ok: false, reason: "op_cap" });
  });

  it("resulting >40 items → reject", () => {
    const forty: CoachRelationshipMemoryItem[] = Array.from({ length: 40 }, (_, i) =>
      item(
        `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
        `Standing meaning ${i}.`
      )
    );
    expect(forty).toHaveLength(COACH_RELATIONSHIP_MEMORY_MAX_ITEMS);
    expect(
      validateCoachRelationshipMemoryChanges(
        { add: ["One more standing meaning."], delete: [] },
        forty
      )
    ).toEqual({ ok: false, reason: "item_cap" });
  });

  it("resulting >4000 chars → reject", () => {
    const bulky = [item(ID_A, "X".repeat(3990))];
    expect(
      validateCoachRelationshipMemoryChanges(
        { add: ["Y".repeat(20)], delete: [] },
        bulky
      )
    ).toEqual({ ok: false, reason: "char_cap" });
    expect(COACH_RELATIONSHIP_MEMORY_MAX_TOTAL_CHARS).toBe(4000);
  });

  it("valid add + bad delete rejects the whole mutation", () => {
    expect(
      validateCoachRelationshipMemoryChanges(
        {
          add: ["A valid new standing meaning."],
          delete: [ID_UNSEEN],
        },
        old
      )
    ).toEqual({ ok: false, reason: "id_not_in_old_set" });
  });

  it("does not semantically dedupe similar English", () => {
    const r = validateCoachRelationshipMemoryChanges(
      {
        add: ["Tyler especially values when Breck asks him to do things."],
        delete: [],
      },
      [item(ID_A, TEXT_B)]
    );
    expect(r.ok).toBe(true);
  });

  it("OLD 40 DELETE one ADD one → valid resulting count 40", () => {
    const forty: CoachRelationshipMemoryItem[] = Array.from({ length: 40 }, (_, i) =>
      item(
        `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
        `Standing meaning ${i}.`
      )
    );
    const r = validateCoachRelationshipMemoryChanges(
      {
        add: ["Replacement standing meaning."],
        delete: [forty[0]!.memory_id],
      },
      forty
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.resulting_item_count).toBe(40);
  });

  it("OLD 3990 DELETE 100 ADD 70 → valid resulting total 3960", () => {
    const r = validateCoachRelationshipMemoryChanges(
      {
        add: ["Y".repeat(70)],
        delete: [ID_A],
      },
      [item(ID_A, "X".repeat(100)), item(ID_B, "W".repeat(3890))]
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.resulting_total_chars).toBe(3960);
  });

  it("OLD 3950 DELETE 200 ADD 300 → reject resulting 4050", () => {
    expect(
      validateCoachRelationshipMemoryChanges(
        {
          add: ["Y".repeat(300)],
          delete: [ID_B],
        },
        [item(ID_A, "X".repeat(3750)), item(ID_B, "W".repeat(200))]
      )
    ).toEqual({ ok: false, reason: "char_cap" });
  });

  it("4000 code-point total is accepted; 4001 is rejected", () => {
    const tenEmojiItems: CoachRelationshipMemoryItem[] = Array.from(
      { length: 10 },
      (_, i) =>
        item(
          `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
          "😀".repeat(400)
        )
    );
    expect(coachRelationshipMemoryTotalChars(tenEmojiItems)).toBe(4000);
    expect(
      validateCoachRelationshipMemoryChanges(
        { add: [], delete: [] },
        tenEmojiItems
      ).ok
    ).toBe(true);
    expect(
      validateCoachRelationshipMemoryChanges(
        { add: ["x"], delete: [] },
        tenEmojiItems
      )
    ).toEqual({ ok: false, reason: "char_cap" });
  });

  it("exact lowercase OLD UUID is accepted", () => {
    const r = validateCoachRelationshipMemoryChanges(
      { add: [], delete: [ID_A] },
      old
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changes.delete[0]).toBe(ID_A);
  });

  it("uppercase form of the same OLD UUID is accepted", () => {
    const r = validateCoachRelationshipMemoryChanges(
      { add: [], delete: [ID_A.toUpperCase()] },
      old
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changes.delete[0]).toBe(ID_A);
  });

  it("mixed-case form of the same OLD UUID is accepted", () => {
    const mixed = "AaAaAaAa-aAaA-4aAa-8aAa-AaAaAaAaAaAa";
    const r = validateCoachRelationshipMemoryChanges(
      { add: [], delete: [mixed] },
      old
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changes.delete).toEqual([ID_A]);
  });

  it("uppercase unseen UUID is still rejected", () => {
    expect(
      validateCoachRelationshipMemoryChanges(
        { add: [], delete: [ID_UNSEEN.toUpperCase()] },
        old
      )
    ).toEqual({ ok: false, reason: "id_not_in_old_set" });
  });

  it("duplicate delete with same UUID in different case is rejected", () => {
    expect(
      validateCoachRelationshipMemoryChanges(
        { add: [], delete: [ID_A, ID_A.toUpperCase()] },
        old
      )
    ).toEqual({ ok: false, reason: "duplicate_delete_id" });
  });
});

describe("canonicalizeCoachRelationshipMemoryUuid", () => {
  it("lowercases valid UUID syntax and rejects invalid syntax", () => {
    expect(canonicalizeCoachRelationshipMemoryUuid(` ${ID_A.toUpperCase()} `)).toBe(
      ID_A
    );
    expect(canonicalizeCoachRelationshipMemoryUuid("not-a-uuid")).toBeNull();
  });
});

describe("fetchCoachRelationshipMemorySnapshot", () => {
  beforeEach(() => {
    supabaseFrom.mockReset();
  });

  it("blank Clerk → no query / empty result", async () => {
    expect(await fetchCoachRelationshipMemorySnapshot("   ")).toEqual({
      items: [],
      rendered: null,
    });
    expect(supabaseFrom).not.toHaveBeenCalled();
  });

  it("selects item columns, exact clerk eq, and stable created_at + memory_id order", async () => {
    const eqs: Array<[string, string]> = [];
    const orders: Array<[string, { ascending: boolean }]> = [];
    const selects: string[] = [];
    supabaseFrom.mockImplementation((table: string) => {
      expect(table).toBe("v2_coach_relationship_memory");
      return itemQuery({
        rows: [
          {
            memory_id: ID_B,
            memory_text: TEXT_B,
            created_at: "2026-08-02T12:00:00.000Z",
          },
          {
            memory_id: ID_A,
            memory_text: TEXT_A,
            created_at: "2026-08-01T12:00:00.000Z",
          },
        ],
        eqs,
        orders,
        selects,
      });
    });

    const snap = await fetchCoachRelationshipMemorySnapshot(" user_1 ");
    expect(selects).toEqual(["memory_id, memory_text, created_at"]);
    expect(eqs).toEqual([["clerk_user_id", "user_1"]]);
    expect(orders).toEqual([
      ["created_at", { ascending: true }],
      ["memory_id", { ascending: true }],
    ]);
    expect(snap.items).toEqual([item(ID_B, TEXT_B), item(ID_A, TEXT_A)]);
    expect(snap.rendered).toBe(`${TEXT_B}\n${TEXT_A}`);
    expect(snap.rendered).not.toContain(ID_A);
    expect(snap.rendered).not.toContain(ID_B);
  });

  it("does not fall back across users, phone, or email", async () => {
    const eqs: Array<[string, string]> = [];
    supabaseFrom.mockReturnValue(itemQuery({ rows: [], eqs }));
    await fetchCoachRelationshipMemory("user_a");
    expect(eqs).toEqual([["clerk_user_id", "user_a"]]);
    expect(JSON.stringify(eqs)).not.toMatch(/phone|email|user_b/i);
  });

  it("skips invalid row shapes fail-soft", async () => {
    supabaseFrom.mockReturnValue(
      itemQuery({
        rows: [
          { memory_id: "nope", memory_text: TEXT_A, created_at: "2026-08-01T12:00:00.000Z" },
          { memory_id: ID_A, memory_text: TEXT_A, created_at: "2026-08-01T12:00:00.000Z" },
          { memory_id: ID_B, memory_text: "   ", created_at: "2026-08-02T12:00:00.000Z" },
        ],
      })
    );
    const snap = await fetchCoachRelationshipMemorySnapshot("user_1");
    expect(snap.items).toEqual([item(ID_A, TEXT_A)]);
  });

  it("does not skip a DB-valid 400-code-point emoji item", async () => {
    const emoji400 = "😀".repeat(400);
    expect(emoji400.length).toBeGreaterThan(400);
    supabaseFrom.mockReturnValue(
      itemQuery({
        rows: [
          {
            memory_id: ID_A,
            memory_text: emoji400,
            created_at: "2026-08-01T12:00:00.000Z",
          },
        ],
      })
    );
    const snap = await fetchCoachRelationshipMemorySnapshot("user_1");
    expect(snap.items).toEqual([item(ID_A, emoji400)]);
    expect(snap.rendered).toBe(emoji400);
  });

  it("fail-softs load errors without throwing", async () => {
    supabaseFrom.mockReturnValue(itemQuery({ error: { message: "boom" } }));
    expect(await fetchCoachRelationshipMemorySnapshot("user_1")).toEqual({
      items: [],
      rendered: null,
    });
    supabaseFrom.mockImplementation(() => {
      throw new Error("network");
    });
    expect(await fetchCoachRelationshipMemory("user_1")).toBeNull();
  });
});
