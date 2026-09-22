import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import type { ReflectionDb, ReflectionDbResult, LearningReflectionRow } from "./reflection-answers";

const TABLE = "learning_reflection_answers";

const COLUMNS =
  "id, clerk_user_id, mini_program_id, step_id, question_id, question_text, answer_text, created_at, updated_at";

export function supabaseReflectionDb(): ReflectionDb {
  return {
    async listForStep(clerkUserId, miniProgramId, stepId) {
      const { data, error } = await supabaseServer
        .from(TABLE)
        .select(COLUMNS)
        .eq("clerk_user_id", clerkUserId)
        .eq("mini_program_id", miniProgramId)
        .eq("step_id", stepId);
      if (error) return failed(error);
      const rows = Array.isArray(data)
        ? data.flatMap((item) => {
            const row = parseReflectionRow(item);
            return row ? [row] : [];
          })
        : [];
      return { data: rows, error: null };
    },
    async upsert(input) {
      const { data, error } = await supabaseServer
        .from(TABLE)
        .upsert(
          {
            clerk_user_id: input.clerkUserId,
            mini_program_id: input.miniProgramId,
            step_id: input.stepId,
            question_id: input.questionId,
            question_text: input.questionText,
            answer_text: input.answerText,
            updated_at: input.updatedAt,
          },
          { onConflict: "clerk_user_id,mini_program_id,question_id" }
        )
        .select(COLUMNS)
        .single();
      if (error) return failed(error);
      return { data: parseReflectionRow(data), error: null };
    },
  };
}

function failed(error: { code?: string; message: string }): ReflectionDbResult<never> {
  console.error(TABLE, error.code ?? "", error.message);
  return { data: null, error: { code: error.code, message: error.message } };
}

function parseReflectionRow(value: unknown): LearningReflectionRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string") return null;
  if (typeof row.clerk_user_id !== "string") return null;
  if (typeof row.mini_program_id !== "string") return null;
  if (typeof row.step_id !== "string") return null;
  if (typeof row.question_id !== "string") return null;
  if (typeof row.question_text !== "string") return null;
  if (typeof row.answer_text !== "string") return null;
  if (typeof row.created_at !== "string") return null;
  if (typeof row.updated_at !== "string") return null;
  return {
    id: row.id,
    clerk_user_id: row.clerk_user_id,
    mini_program_id: row.mini_program_id,
    step_id: row.step_id,
    question_id: row.question_id,
    question_text: row.question_text,
    answer_text: row.answer_text,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
