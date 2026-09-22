import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import type { LearningProgressRow, ProgressDb, ProgressDbResult } from "./mini-program-progress";
import { isUniqueProgramsConflict, logProgramsDbFailure } from "./programs-db-error";

const TABLE = "learning_mini_program_progress";

const COLUMNS =
  "clerk_user_id, mini_program_id, current_step_id, status, curriculum_version, started_at, completed_at, updated_at";

export function supabaseProgressDb(): ProgressDb {
  return {
    async getOne(clerkUserId, miniProgramId) {
      const { data, error } = await supabaseServer
        .from(TABLE)
        .select(COLUMNS)
        .eq("clerk_user_id", clerkUserId)
        .eq("mini_program_id", miniProgramId)
        .maybeSingle();
      if (error) return failed(error);
      return { data: parseProgressRow(data), error: null };
    },
    async list(clerkUserId, miniProgramIds) {
      const { data, error } = await supabaseServer
        .from(TABLE)
        .select(COLUMNS)
        .eq("clerk_user_id", clerkUserId)
        .in("mini_program_id", [...miniProgramIds]);
      if (error) return failed(error);
      const rows = Array.isArray(data)
        ? data.flatMap((item) => {
            const row = parseProgressRow(item);
            return row ? [row] : [];
          })
        : [];
      return { data: rows, error: null };
    },
    async insert(row) {
      // ignoreDuplicates is INSERT ... ON CONFLICT DO NOTHING. It must not
      // update current_step_id, status, started_at, completed_at, or curriculum_version.
      const { data, error } = await supabaseServer
        .from(TABLE)
        .upsert(row, {
          onConflict: "clerk_user_id,mini_program_id",
          ignoreDuplicates: true,
        })
        .select(COLUMNS)
        .maybeSingle();
      if (error) {
        if (isUniqueProgramsConflict(error)) {
          return readStored(row.clerk_user_id, row.mini_program_id);
        }
        return failed(error);
      }
      const parsed = parseProgressRow(data);
      if (parsed) return { data: parsed, error: null };
      return readStored(row.clerk_user_id, row.mini_program_id);
    },
    async updateFrontier(args) {
      const { data, error } = await supabaseServer
        .from(TABLE)
        .update({
          current_step_id: args.nextStepId,
          updated_at: args.updatedAt,
        })
        .eq("clerk_user_id", args.clerkUserId)
        .eq("mini_program_id", args.miniProgramId)
        .eq("status", "in_progress")
        .eq("current_step_id", args.fromStepId)
        .select(COLUMNS)
        .maybeSingle();
      if (error) return failed(error);
      return { data: parseProgressRow(data), error: null };
    },
    async markCompleted(args) {
      const { data, error } = await supabaseServer
        .from(TABLE)
        .update({
          status: "completed",
          completed_at: args.completedAt,
          updated_at: args.completedAt,
        })
        .eq("clerk_user_id", args.clerkUserId)
        .eq("mini_program_id", args.miniProgramId)
        .eq("status", "in_progress")
        .eq("current_step_id", args.stepId)
        .select(COLUMNS)
        .maybeSingle();
      if (error) return failed(error);
      return { data: parseProgressRow(data), error: null };
    },
  };
}

async function readStored(
  clerkUserId: string,
  miniProgramId: string
): Promise<ProgressDbResult<LearningProgressRow>> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select(COLUMNS)
    .eq("clerk_user_id", clerkUserId)
    .eq("mini_program_id", miniProgramId)
    .maybeSingle();
  if (error) return failed(error);
  return { data: parseProgressRow(data), error: null };
}

function failed(error: { code?: string; message: string }): ProgressDbResult<never> {
  logProgramsDbFailure(TABLE, { code: error.code, message: error.message });
  return { data: null, error: { code: error.code, message: error.message } };
}

function parseProgressRow(value: unknown): LearningProgressRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.clerk_user_id !== "string") return null;
  if (typeof row.mini_program_id !== "string") return null;
  if (typeof row.current_step_id !== "string") return null;
  if (row.status !== "in_progress" && row.status !== "completed") return null;
  if (typeof row.curriculum_version !== "number") return null;
  if (typeof row.started_at !== "string") return null;
  if (typeof row.updated_at !== "string") return null;
  if (row.completed_at !== null && typeof row.completed_at !== "string") return null;
  if (row.status === "completed" && typeof row.completed_at !== "string") return null;
  if (row.status === "in_progress" && row.completed_at !== null) return null;
  return {
    clerk_user_id: row.clerk_user_id,
    mini_program_id: row.mini_program_id,
    current_step_id: row.current_step_id,
    status: row.status,
    curriculum_version: row.curriculum_version,
    started_at: row.started_at,
    completed_at: row.completed_at,
    updated_at: row.updated_at,
  };
}
