import { beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table !== "v2_sms_pattern_correction") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        insert: (row: unknown) => {
          insertMock(row);
          return {
            select: () => ({
              single: async () => ({
                data: { id: "corr-1", ...(row as object) },
                error: null,
              }),
            }),
          };
        },
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            select: () => ({
              single: async () => ({ data: { id: "corr-1" }, error: null }),
            }),
          }),
        }),
      };
    },
  },
}));

import {
  createSmsPatternCorrection,
  listApprovedSmsPatternCorrectionsForReview,
  normalizeSmsPatternCorrectionInput,
} from "@/lib/sms-pattern-correction";

describe("sms-pattern-correction helper", () => {
  beforeEach(() => {
    insertMock.mockClear();
  });

  it("createSmsPatternCorrection writes validated row with defaults", async () => {
    const r = await createSmsPatternCorrection({
      scope: "user",
      clerk_user_id: "user_1",
      correction_type: "user_phrase_meaning",
      phrase_pattern: "done",
      meaning_label: "done means bar",
      correction_summary: "User means daily bar complete.",
      source: "operator_seed",
    });
    expect(r.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledOnce();
    const row = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(row.status).toBe("suggested");
    expect(row.usage_policy).toBe("prompt_hint_only");
    expect(row.use_count).toBe(0);
  });

  it("normalizeSmsPatternCorrectionInput returns validated shape", () => {
    const v = normalizeSmsPatternCorrectionInput({
      scope: "global",
      correction_type: "global_parser_rule_candidate",
      phrase_pattern: "k",
      meaning_label: "label",
      correction_summary: "summary",
      source: "operator_seed",
    });
    expect(v.scope).toBe("global");
    expect(v.normalized_pattern).toBe("k");
  });

  it("listApprovedSmsPatternCorrectionsForReview returns ok", async () => {
    const r = await listApprovedSmsPatternCorrectionsForReview({ limit: 10 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toEqual([]);
  });
});
