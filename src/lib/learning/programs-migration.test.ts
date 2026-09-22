import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260922120000_learning_programs.sql"),
  "utf8"
);

describe("Programs migration SQL", () => {
  it("defines the two new tables, RLS, and service-role grants", () => {
    expect(SQL).toContain("CREATE TABLE public.learning_mini_program_progress");
    expect(SQL).toContain("CREATE TABLE public.learning_reflection_answers");
    expect(SQL).toContain("PRIMARY KEY (clerk_user_id, mini_program_id)");
    expect(SQL).toContain("UNIQUE (clerk_user_id, mini_program_id, question_id)");
    expect(SQL).toContain("status = 'in_progress'");
    expect(SQL).toContain("status = 'completed'");
    expect(SQL).toContain("AND completed_at IS NULL");
    expect(SQL).toContain("AND completed_at IS NOT NULL");
    expect(SQL).toContain("char_length(answer_text) <= 4000");
    expect(SQL).toContain("char_length(question_text) <= 1000");
    expect(SQL).toContain(
      "CREATE INDEX learning_reflection_answers_member_program_idx"
    );
    expect(SQL).toContain(
      "ALTER TABLE public.learning_mini_program_progress ENABLE ROW LEVEL SECURITY"
    );
    expect(SQL).toContain(
      "ALTER TABLE public.learning_reflection_answers ENABLE ROW LEVEL SECURITY"
    );
    expect(SQL).toContain("REVOKE ALL ON TABLE public.learning_mini_program_progress FROM anon");
    expect(SQL).toContain(
      "REVOKE ALL ON TABLE public.learning_mini_program_progress FROM authenticated"
    );
    expect(SQL).toContain("REVOKE ALL ON TABLE public.learning_reflection_answers FROM anon");
    expect(SQL).toContain(
      "REVOKE ALL ON TABLE public.learning_reflection_answers FROM authenticated"
    );
    expect(SQL).toContain("TO service_role");
    expect(SQL).toContain("TO readonly_user");
    expect(SQL).not.toContain(
      "CREATE OR REPLACE FUNCTION public.purge_app_data_for_account_deletion"
    );
    expect(SQL).toContain(
      "DELETE FROM public.learning_reflection_answers WHERE clerk_user_id = v_clerk;"
    );
    expect(SQL).toContain(
      "DELETE FROM public.learning_mini_program_progress WHERE clerk_user_id = v_clerk;"
    );
  });
});
