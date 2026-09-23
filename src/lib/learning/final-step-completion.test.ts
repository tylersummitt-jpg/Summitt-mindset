import { describe, expect, it } from "vitest";
import { continueMiniProgramStep } from "./continue-step";
import { MAX_CONTINUE_REFLECTIONS, parseContinuePayload } from "./continue-payload";
import type { LearningMiniProgram, LearningStep } from "./curriculum-types";
import { getLearningMiniProgram } from "./load-curriculum";
import {
  initializeMiniProgramProgress,
  type LearningProgressRow,
  type ProgressDb,
} from "./mini-program-progress";
import { PROGRAMS_COPY } from "./programs-copy";
import type { LearningReflectionRow, ReflectionDb } from "./reflection-answers";
import { decideContinue } from "./step-access";

const NOW = "2026-09-23T18:00:00.000Z";
const LATER = "2026-09-23T18:05:00.000Z";

function memoryProgress(): ProgressDb & { rows: LearningProgressRow[] } {
  const rows: LearningProgressRow[] = [];
  return {
    rows,
    async getOne(clerkUserId, miniProgramId) {
      const row =
        rows.find(
          (candidate) =>
            candidate.clerk_user_id === clerkUserId && candidate.mini_program_id === miniProgramId
        ) ?? null;
      return { data: row, error: null };
    },
    async list() {
      return { data: rows, error: null };
    },
    async insert(row) {
      rows.push({ ...row });
      return { data: rows[rows.length - 1] ?? null, error: null };
    },
    async updateFrontier(args) {
      const row = rows.find(
        (candidate) =>
          candidate.clerk_user_id === args.clerkUserId &&
          candidate.mini_program_id === args.miniProgramId &&
          candidate.current_step_id === args.fromStepId
      );
      if (!row) return { data: null, error: null };
      row.current_step_id = args.nextStepId;
      row.updated_at = args.updatedAt;
      return { data: { ...row }, error: null };
    },
    async markCompleted(args) {
      const row = rows.find(
        (candidate) =>
          candidate.clerk_user_id === args.clerkUserId &&
          candidate.mini_program_id === args.miniProgramId &&
          candidate.status === "in_progress" &&
          candidate.current_step_id === args.stepId
      );
      if (!row) return { data: null, error: null };
      row.status = "completed";
      row.completed_at = args.completedAt;
      row.current_step_id = args.stepId;
      row.updated_at = args.completedAt;
      return { data: { ...row }, error: null };
    },
  };
}

function memoryReflections(options?: {
  failUpsert?: boolean;
}): ReflectionDb & { rows: LearningReflectionRow[] } {
  const rows: LearningReflectionRow[] = [];
  return {
    rows,
    async listForStep() {
      return { data: rows, error: null };
    },
    async upsert(input) {
      if (options?.failUpsert) return { data: null, error: { message: "write failed" } };
      const existing = rows.find((row) => row.question_id === input.questionId);
      if (existing) {
        existing.answer_text = input.answerText;
        existing.updated_at = input.updatedAt;
        return { data: { ...existing }, error: null };
      }
      const created: LearningReflectionRow = {
        id: `ref-${rows.length + 1}`,
        clerk_user_id: input.clerkUserId,
        mini_program_id: input.miniProgramId,
        step_id: input.stepId,
        question_id: input.questionId,
        question_text: input.questionText,
        answer_text: input.answerText,
        created_at: input.updatedAt,
        updated_at: input.updatedAt,
      };
      rows.push(created);
      return { data: { ...created }, error: null };
    },
  };
}

function reflectionAnswers(step: LearningStep): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const block of step.blocks) {
    if (block.type === "reflection" && block.persist !== false) {
      answers[block.question_id] = `Saved answer for ${block.question_id}`;
    }
  }
  return answers;
}

describe("Personal Brand final step", () => {
  it("finishes all 13 saved reflections without treating the step as unavailable", async () => {
    const program = getLearningMiniProgram("potl_mp_05");
    if (!program) throw new Error("missing Personal Brand");
    const step = program.steps.at(-1);
    if (!step) throw new Error("missing final step");
    expect(step.id).toBe("potl_mp_05_st_010");
    const reflections = reflectionAnswers(step);
    expect(Object.keys(reflections)).toHaveLength(13);

    const parsed = parseContinuePayload({
      miniProgramId: program.id,
      stepId: step.id,
      reflections,
      quizAnswers: {},
      sortPlacements: {},
    });
    expect(parsed?.reflections).toEqual(reflections);
    expect(PROGRAMS_COPY.unavailable).toBe("This step is unavailable.");

    const progressDb = memoryProgress();
    const reflectionDb = memoryReflections();
    const created = await initializeMiniProgramProgress(progressDb, {
      memberId: "member_a",
      program,
      now: NOW,
    });
    if (!created.ok) throw new Error(created.message);
    created.row.current_step_id = step.id;

    const finished = await continueMiniProgramStep({
      progressDb,
      reflectionDb,
      memberId: "member_a",
      program,
      stepId: step.id,
      submission: { reflections, quizAnswers: {}, sortPlacements: {} },
      now: LATER,
    });
    expect(finished.ok).toBe(true);
    if (!finished.ok) throw new Error(finished.message);
    expect(finished.destination).toEqual({ type: "programs" });
    expect(created.row).toMatchObject({
      status: "completed",
      completed_at: LATER,
      current_step_id: "potl_mp_05_st_010",
    });
    expect(reflectionDb.rows).toHaveLength(13);

    const again = await continueMiniProgramStep({
      progressDb,
      reflectionDb,
      memberId: "member_a",
      program,
      stepId: step.id,
      submission: { reflections, quizAnswers: {}, sortPlacements: {} },
      now: LATER,
    });
    expect(again).toEqual({ ok: true, destination: { type: "programs" } });
    expect(reflectionDb.rows).toHaveLength(13);
    expect(created.row.status).toBe("completed");
  });

  it("does not complete Personal Brand when a required reflection fails to save", async () => {
    const program = getLearningMiniProgram("potl_mp_05");
    const step = program?.steps.at(-1);
    if (!program || !step) throw new Error("missing Personal Brand");
    const progressDb = memoryProgress();
    const created = await initializeMiniProgramProgress(progressDb, {
      memberId: "member_a",
      program,
      now: NOW,
    });
    if (!created.ok) throw new Error(created.message);
    created.row.current_step_id = step.id;
    const finished = await continueMiniProgramStep({
      progressDb,
      reflectionDb: memoryReflections({ failUpsert: true }),
      memberId: "member_a",
      program,
      stepId: step.id,
      submission: {
        reflections: reflectionAnswers(step),
        quizAnswers: {},
        sortPlacements: {},
      },
      now: LATER,
    });
    expect(finished.ok).toBe(false);
    expect(created.row.status).toBe("in_progress");
    expect(created.row.completed_at).toBeNull();
  });

  it("still rejects a reflection payload above the shared cap", () => {
    const reflections = Object.fromEntries(
      Array.from({ length: MAX_CONTINUE_REFLECTIONS + 1 }, (_, index) => [`q_${index}`, "answer"])
    );
    expect(
      parseContinuePayload({
        miniProgramId: "potl_mp_05",
        stepId: "potl_mp_05_st_010",
        reflections,
        quizAnswers: {},
        sortPlacements: {},
      })
    ).toBeNull();
  });
});

describe("final step with a retired id gap", () => {
  it("completes the last surviving step instead of looking up the next source number", async () => {
    const finalStep: LearningStep = {
      id: "gap_st_005",
      source_step_id: "gap_st_005",
      sequence: 5,
      title: "Last surviving step",
      blocks: [
        {
          type: "reflection",
          question_id: "gap_reflection",
          prompt: "What will you carry forward?",
        },
      ],
    };
    const program: LearningMiniProgram = {
      id: "gap_mp",
      collection_id: "definite_dozen",
      collection_title: "Definite Dozen",
      title: "Gapped program",
      description: "Fixture",
      sequence: 1,
      estimated_minutes: 5,
      source_mini_program_id: "gap_mp",
      curriculum_version: 1,
      steps: [
        {
          id: "gap_st_001",
          source_step_id: "gap_st_001",
          sequence: 1,
          title: "First",
          blocks: [],
        },
        {
          id: "gap_st_002",
          source_step_id: "gap_st_002",
          sequence: 2,
          title: "Second",
          blocks: [],
        },
        finalStep,
      ],
    };
    expect(
      decideContinue(
        { status: "in_progress", current_step_id: "gap_st_005" },
        program.steps,
        "gap_st_005"
      )
    ).toEqual({ kind: "complete" });

    const progressDb = memoryProgress();
    const reflectionDb = memoryReflections();
    const created = await initializeMiniProgramProgress(progressDb, {
      memberId: "member_a",
      program,
      now: NOW,
    });
    if (!created.ok) throw new Error(created.message);
    created.row.current_step_id = "gap_st_005";
    const finished = await continueMiniProgramStep({
      progressDb,
      reflectionDb,
      memberId: "member_a",
      program,
      stepId: "gap_st_005",
      submission: {
        reflections: { gap_reflection: "The standard." },
        quizAnswers: {},
        sortPlacements: {},
      },
      now: LATER,
    });
    expect(finished).toEqual({ ok: true, destination: { type: "programs" } });
    expect(created.row).toMatchObject({
      status: "completed",
      completed_at: LATER,
      current_step_id: "gap_st_005",
    });
    expect(program.steps.some((step) => step.id === "gap_st_006")).toBe(false);
  });
});
