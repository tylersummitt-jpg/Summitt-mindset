import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from },
}));

import { supabaseProgressDb } from "./mini-program-progress-db";
import type { LearningProgressRow } from "./mini-program-progress";

const STORED: LearningProgressRow = {
  clerk_user_id: "user_a",
  mini_program_id: "dd_mp_02",
  current_step_id: "dd_mp_02_st_006",
  status: "completed",
  curriculum_version: 1,
  started_at: "2026-09-22T14:00:00.000Z",
  completed_at: "2026-09-22T15:00:00.000Z",
  updated_at: "2026-09-22T15:00:00.000Z",
};

const FRESH: LearningProgressRow = {
  ...STORED,
  current_step_id: "dd_mp_02_st_001",
  status: "in_progress",
  completed_at: null,
  started_at: "2026-09-22T16:00:00.000Z",
  updated_at: "2026-09-22T16:00:00.000Z",
};

function selectResult(result: { data: unknown; error: { code?: string; message: string } | null }) {
  return {
    eq() {
      return this;
    },
    maybeSingle: async () => result,
  };
}

describe("supabase progress insert", () => {
  beforeEach(() => {
    from.mockReset();
  });

  it("uses ON CONFLICT DO NOTHING and returns the stored row without logging", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const upsert = vi.fn(() => ({
      select: () => ({
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    }));
    from.mockImplementation(() => ({
      upsert,
      select: () => selectResult({ data: STORED, error: null }),
      update: () => {
        throw new Error("insert must not update");
      },
    }));

    const inserted = await supabaseProgressDb().insert(FRESH);
    expect(inserted.error).toBeNull();
    expect(inserted.data).toEqual(STORED);
    expect(upsert).toHaveBeenCalledWith(FRESH, {
      onConflict: "clerk_user_id,mini_program_id",
      ignoreDuplicates: true,
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("re-reads after a unique violation and does not log it", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    from.mockImplementation(() => ({
      upsert: () => ({
        select: () => ({
          maybeSingle: async () => ({
            data: null,
            error: {
              code: "23505",
              message:
                'duplicate key value violates unique constraint "learning_mini_program_progress_pkey"',
            },
          }),
        }),
      }),
      select: () => selectResult({ data: STORED, error: null }),
      update: () => {
        throw new Error("insert must not update");
      },
    }));

    const inserted = await supabaseProgressDb().insert(FRESH);
    expect(inserted.data).toEqual(STORED);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("still logs a missing-table failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    from.mockImplementation(() => ({
      upsert: () => ({
        select: () => ({
          maybeSingle: async () => ({
            data: null,
            error: { code: "42P01", message: "relation learning_mini_program_progress does not exist" },
          }),
        }),
      }),
    }));

    const inserted = await supabaseProgressDb().insert(FRESH);
    expect(inserted.data).toBeNull();
    expect(inserted.error?.code).toBe("42P01");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
