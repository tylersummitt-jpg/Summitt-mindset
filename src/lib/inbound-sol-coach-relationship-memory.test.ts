import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { rpc, from },
}));

import {
  persistSolCoachRelationshipMemory,
  V2_APPLY_COACH_RELATIONSHIP_MEMORY_MUTATIONS_RPC,
} from "@/lib/inbound-sol-coach-relationship-memory";
import type { CoachRelationshipMemoryItem } from "@/lib/coach-relationship-memory";

const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEXT_A = "Quiet one-on-one time with Brooke matters more than elaborate plans.";
const ADD = "Breck initiating time together is especially meaningful to Tyler.";
const oldItems: CoachRelationshipMemoryItem[] = [{ memory_id: ID_A, text: TEXT_A }];

describe("persistSolCoachRelationshipMemory", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
  });

  it("null → no RPC / none", async () => {
    const r = await persistSolCoachRelationshipMemory({
      clerkUserId: "user_1",
      changes: null,
      oldItems,
    });
    expect(r.status).toBe("none");
    expect(r.reason).toBe("null_or_empty_changes");
    expect(r.add_count).toBe(0);
    expect(r.update_count).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("empty object → no RPC / none", async () => {
    const r = await persistSolCoachRelationshipMemory({
      clerkUserId: "user_1",
      changes: { add: [], delete: [] },
      oldItems,
    });
    expect(r.status).toBe("none");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("mechanically invalid → no RPC / validation_rejected", async () => {
    const r = await persistSolCoachRelationshipMemory({
      clerkUserId: "user_1",
      changes: {
        add: [],
        delete: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
      },
      oldItems,
    });
    expect(r.status).toBe("validation_rejected");
    expect(r.reason).toBe("id_not_in_old_set");
    expect(r.update_count).toBe(0);
    expect(r.new_item_count).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("valid → exact RPC name and params", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          result: "applied",
          item_count: 2,
          total_chars: TEXT_A.length + ADD.length,
          add_count: 1,
          update_count: 0,
          delete_count: 0,
        },
      ],
      error: null,
    });
    const r = await persistSolCoachRelationshipMemory({
      clerkUserId: " user_1 ",
      changes: { add: [`  ${ADD}  `], delete: [] },
      oldItems,
    });
    expect(r.status).toBe("applied");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe(V2_APPLY_COACH_RELATIONSHIP_MEMORY_MUTATIONS_RPC);
    expect(rpc.mock.calls[0]?.[0]).toBe("v2_apply_coach_relationship_memory_mutations");
    expect(rpc.mock.calls[0]?.[1]).toEqual({
      p_clerk_user_id: "user_1",
      p_adds: [ADD],
      p_updates: [],
      p_deletes: [],
    });
    expect(from).not.toHaveBeenCalled();
    expect(r.add_count).toBe(1);
    expect(r.update_count).toBe(0);
    expect(r.old_item_count).toBe(1);
    expect(r.new_item_count).toBe(2);
    expect(r.new_total_chars).toBe(TEXT_A.length + ADD.length);
  });

  it("valid DELETE still sends p_updates: []", async () => {
    rpc.mockResolvedValue({
      data: {
        result: "applied",
        item_count: 0,
        total_chars: 0,
        add_count: 0,
        update_count: 0,
        delete_count: 1,
      },
      error: null,
    });
    const r = await persistSolCoachRelationshipMemory({
      clerkUserId: "user_1",
      changes: {
        add: [],
        delete: [ID_A],
      },
      oldItems,
    });
    expect(r.status).toBe("applied");
    expect(rpc.mock.calls[0]?.[1]).toEqual({
      p_clerk_user_id: "user_1",
      p_adds: [],
      p_updates: [],
      p_deletes: [ID_A],
    });
    expect(r.update_count).toBe(0);
    expect(r.delete_count).toBe(1);
  });

  it("RPC error → failed and does not throw", async () => {
    rpc.mockResolvedValue({ error: { message: "write failed", code: "P0001" }, data: null });
    const r = await persistSolCoachRelationshipMemory({
      clerkUserId: "user_1",
      changes: { add: [ADD], delete: [] },
      oldItems,
    });
    expect(r.status).toBe("failed");
    expect(r.reason).toContain("write failed");
    expect(r.new_item_count).toBeNull();
  });

  it("RPC throw → failed and does not throw into caller", async () => {
    rpc.mockRejectedValue(new Error("socket down"));
    const r = await persistSolCoachRelationshipMemory({
      clerkUserId: "user_1",
      changes: { add: [ADD], delete: [] },
      oldItems,
    });
    expect(r.status).toBe("failed");
    expect(r.reason).toContain("socket down");
  });

  it("does not log memory text on failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    rpc.mockResolvedValue({ error: { message: "constraint" }, data: null });
    await persistSolCoachRelationshipMemory({
      clerkUserId: "user_1",
      changes: { add: [ADD], delete: [] },
      oldItems,
    });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(ADD);
    expect(logged).not.toContain(TEXT_A);
    expect(logged).not.toContain("p_adds");
    warn.mockRestore();
  });

  it("RPC payload uses canonical lowercase UUID and p_updates is always []", async () => {
    rpc.mockResolvedValue({
      data: {
        result: "applied",
        item_count: 1,
        total_chars: TEXT_A.length,
        add_count: 0,
        update_count: 0,
        delete_count: 1,
      },
      error: null,
    });
    const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const r = await persistSolCoachRelationshipMemory({
      clerkUserId: "user_1",
      changes: {
        add: [],
        delete: [ID_B.toUpperCase()],
      },
      oldItems: [
        { memory_id: ID_A, text: TEXT_A },
        { memory_id: ID_B, text: "Older standing meaning no longer belongs." },
      ],
    });
    expect(r.status).toBe("applied");
    expect(rpc.mock.calls[0]?.[1]).toEqual({
      p_clerk_user_id: "user_1",
      p_adds: [],
      p_updates: [],
      p_deletes: [ID_B],
    });
    expect(r.update_count).toBe(0);
  });

  it("old_total_chars uses Unicode code-point semantics", async () => {
    const emoji400 = "😀".repeat(400);
    expect(emoji400.length).toBeGreaterThan(400);
    const r = await persistSolCoachRelationshipMemory({
      clerkUserId: "user_1",
      changes: null,
      oldItems: [{ memory_id: ID_A, text: emoji400 }],
    });
    expect(r.status).toBe("none");
    expect(r.old_total_chars).toBe(400);
  });
});
