import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

const { fromMock, updateResult, selectResult, lastUpdatePayload, lastUpdateEqs, tablesTouched } =
  vi.hoisted(() => {
    const updateResult = {
      data: null as { id: string } | null,
      error: null as { code?: string; message?: string } | null,
    };
    const selectResult = {
      data: null as Record<string, unknown> | null,
      error: null as { code?: string; message?: string } | null,
    };
    const lastUpdatePayload = { current: null as Record<string, unknown> | null };
    const lastUpdateEqs: Array<[string, string]> = [];
    const tablesTouched: string[] = [];
    const fromMock = vi.fn();
    return {
      fromMock,
      updateResult,
      selectResult,
      lastUpdatePayload,
      lastUpdateEqs,
      tablesTouched,
    };
  });

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

import {
  USER_WIN_DELETE_HIDDEN_REASON,
  deleteUserVictoryWin,
} from "@/lib/v2-win-user-delete";

const UPDATED = "2026-08-09T12:00:00.000Z";
const HIDDEN_AT_RE = /^\d{4}-\d{2}-\d{2}T/;

function installFromMock() {
  lastUpdateEqs.length = 0;
  tablesTouched.length = 0;
  lastUpdatePayload.current = null;

  fromMock.mockImplementation((table: string) => {
    tablesTouched.push(table);
    expect(table).toBe("v2_win");

    const updateChain: Record<string, unknown> = {};
    updateChain.eq = vi.fn((col: string, val: string) => {
      lastUpdateEqs.push([col, val]);
      return updateChain;
    });
    updateChain.select = vi.fn(() => updateChain);
    updateChain.maybeSingle = vi.fn(async () => ({
      data: updateResult.data,
      error: updateResult.error,
    }));

    const selectChain: Record<string, unknown> = {};
    selectChain.eq = vi.fn(() => selectChain);
    selectChain.maybeSingle = vi.fn(async () => ({
      data: selectResult.data,
      error: selectResult.error,
    }));

    return {
      update: (payload: Record<string, unknown>) => {
        lastUpdatePayload.current = payload;
        return updateChain;
      },
      select: () => selectChain,
    };
  });
}

describe("deleteUserVictoryWin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateResult.data = null;
    updateResult.error = null;
    selectResult.data = null;
    selectResult.error = null;
    installFromMock();
  });

  it("soft-hides a manual active Win with user_deleted", async () => {
    updateResult.data = { id: "win-manual" };
    const r = await deleteUserVictoryWin({
      clerkUserId: "user_1",
      winId: "win-manual",
      expectedUpdatedAt: UPDATED,
    });
    expect(r).toEqual({ ok: true, win_id: "win-manual" });
    expect(lastUpdatePayload.current).toEqual({
      status: "hidden",
      hidden_at: expect.stringMatching(HIDDEN_AT_RE),
      hidden_reason: USER_WIN_DELETE_HIDDEN_REASON,
    });
    expect(USER_WIN_DELETE_HIDDEN_REASON).toBe("user_deleted");
    expect(lastUpdateEqs).toEqual([
      ["id", "win-manual"],
      ["clerk_user_id", "user_1"],
      ["status", "active"],
      ["updated_at", UPDATED],
    ]);
    expect(Object.keys(lastUpdatePayload.current!).sort()).toEqual([
      "hidden_at",
      "hidden_reason",
      "status",
    ]);
  });

  it("soft-hides an sms active Win and preserves mutation narrowness", async () => {
    updateResult.data = { id: "win-sms" };
    const r = await deleteUserVictoryWin({
      clerkUserId: "user_1",
      winId: "win-sms",
      expectedUpdatedAt: UPDATED,
    });
    expect(r.ok).toBe(true);
    const payload = lastUpdatePayload.current!;
    expect(payload.status).toBe("hidden");
    expect(payload.hidden_reason).toBe("user_deleted");
    expect(payload).not.toHaveProperty("user_edited_at");
    expect(payload).not.toHaveProperty("display_title");
    expect(payload).not.toHaveProperty("source_type");
    expect(payload).not.toHaveProperty("commitment_id");
    expect(payload).not.toHaveProperty("action_fact");
    expect(payload).not.toHaveProperty("why_meaningful");
    expect(payload).not.toHaveProperty("relationship_type");
    expect(payload).not.toHaveProperty("recognition_mode");
  });

  it("soft-hides an edited Win without clearing user_edited_at in payload", async () => {
    updateResult.data = { id: "win-edited" };
    const r = await deleteUserVictoryWin({
      clerkUserId: "user_1",
      winId: "win-edited",
      expectedUpdatedAt: UPDATED,
    });
    expect(r.ok).toBe(true);
    expect(lastUpdatePayload.current).not.toHaveProperty("user_edited_at");
  });

  it("rejects foreign Win as not_found", async () => {
    updateResult.data = null;
    selectResult.data = {
      id: "win-1",
      clerk_user_id: "other",
      status: "active",
      updated_at: UPDATED,
    };
    const r = await deleteUserVictoryWin({
      clerkUserId: "user_1",
      winId: "win-1",
      expectedUpdatedAt: UPDATED,
    });
    expect(r).toEqual({ ok: false, error: "Win not found.", code: "not_found" });
  });

  it("rejects already-hidden Win as not_found", async () => {
    updateResult.data = null;
    selectResult.data = {
      id: "win-1",
      clerk_user_id: "user_1",
      status: "hidden",
      updated_at: UPDATED,
    };
    const r = await deleteUserVictoryWin({
      clerkUserId: "user_1",
      winId: "win-1",
      expectedUpdatedAt: UPDATED,
    });
    expect(r).toEqual({ ok: false, error: "Win not found.", code: "not_found" });
  });

  it("returns conflict on stale updated_at", async () => {
    updateResult.data = null;
    selectResult.data = {
      id: "win-1",
      clerk_user_id: "user_1",
      status: "active",
      updated_at: "2026-08-09T13:00:00.000Z",
    };
    const r = await deleteUserVictoryWin({
      clerkUserId: "user_1",
      winId: "win-1",
      expectedUpdatedAt: UPDATED,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("conflict");
      expect(r.error).toContain("changed since you opened");
    }
  });

  it("returns not_found when row missing", async () => {
    updateResult.data = null;
    selectResult.data = null;
    const r = await deleteUserVictoryWin({
      clerkUserId: "user_1",
      winId: "missing",
      expectedUpdatedAt: UPDATED,
    });
    expect(r).toEqual({ ok: false, error: "Win not found.", code: "not_found" });
  });

  it("returns conflict when expected_updated_at missing", async () => {
    const r = await deleteUserVictoryWin({
      clerkUserId: "user_1",
      winId: "win-1",
      expectedUpdatedAt: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("conflict");
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns unauthorized for blank clerk", async () => {
    const r = await deleteUserVictoryWin({
      clerkUserId: "  ",
      winId: "win-1",
      expectedUpdatedAt: UPDATED,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unauthorized");
  });

  it("returns persist_failed on update error", async () => {
    updateResult.error = { code: "42P01", message: "missing table" };
    const r = await deleteUserVictoryWin({
      clerkUserId: "user_1",
      winId: "win-1",
      expectedUpdatedAt: UPDATED,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("persist_failed");
      expect(r.error).toContain("couldn’t delete");
    }
  });

  it("second delete after hide is not_found (no duplicate side effects)", async () => {
    updateResult.data = null;
    selectResult.data = {
      id: "win-1",
      clerk_user_id: "user_1",
      status: "hidden",
      updated_at: UPDATED,
    };
    const r = await deleteUserVictoryWin({
      clerkUserId: "user_1",
      winId: "win-1",
      expectedUpdatedAt: UPDATED,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_found");
  });

  it("does not touch revision or commitment_event tables", async () => {
    updateResult.data = { id: "win-1" };
    await deleteUserVictoryWin({
      clerkUserId: "user_1",
      winId: "win-1",
      expectedUpdatedAt: UPDATED,
    });
    expect(tablesTouched.every((t) => t === "v2_win")).toBe(true);
    expect(tablesTouched).not.toContain("v2_win_revision");
    expect(tablesTouched).not.toContain("v2_commitment_event");
  });

  it("source law: helper never calls delete() and never reuses stale-recognition reason", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-win-user-delete.ts"),
      "utf8"
    );
    expect(src).toContain('hidden_reason: USER_WIN_DELETE_HIDDEN_REASON');
    expect(src).toContain('"user_deleted"');
    expect(src).not.toContain("superseded_by_accountability_user_yes_win");
    expect(src).not.toContain("hideStaleRecognitionCompletionWinForAccountability");
    expect(src).not.toContain(".delete(");
    expect(src).not.toContain("v2_win_revision");
    expect(src).not.toContain("openai");
    expect(src).not.toContain("evaluateTextSafetyTier");
  });
});
