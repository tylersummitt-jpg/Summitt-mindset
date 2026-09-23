import { describe, expect, it, vi } from "vitest";
import { continueMiniProgramStep } from "./continue-step";
import { gradeQuiz, gradeSort, checkSortPlacement } from "./grade-step";
import { getLearningMiniProgram } from "./load-curriculum";
import {
  getMiniProgramProgress,
  initializeMiniProgramProgress,
  listMiniProgramProgress,
  repairFrontierIfMissing,
  type LearningProgressRow,
  type ProgressDb,
} from "./mini-program-progress";
import { PROGRAMS_COPY } from "./programs-copy";
import {
  isMissingProgramsTable,
  isUniqueProgramsConflict,
  logProgramsDbFailure,
} from "./programs-db-error";
import {
  listReflectionAnswers,
  type LearningReflectionRow,
  type ReflectionDb,
} from "./reflection-answers";
import type { LearningStep } from "./curriculum-types";
import type { StepSubmission } from "./grade-step";

const NOW = "2026-09-22T14:00:00.000Z";
const LATER = "2026-09-22T15:00:00.000Z";

function program() {
  const loaded = getLearningMiniProgram("dd_mp_02");
  if (!loaded) throw new Error("missing dd_mp_02");
  return loaded;
}

function step(id: string): LearningStep {
  const found = program().steps.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

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
    async list(clerkUserId, miniProgramIds) {
      return {
        data: rows.filter(
          (candidate) =>
            candidate.clerk_user_id === clerkUserId &&
            miniProgramIds.includes(candidate.mini_program_id)
        ),
        error: null,
      };
    },
    async insert(row) {
      const exists = rows.some(
        (candidate) =>
          candidate.clerk_user_id === row.clerk_user_id &&
          candidate.mini_program_id === row.mini_program_id
      );
      if (exists) return { data: null, error: { code: "23505", message: "duplicate" } };
      rows.push({ ...row });
      return { data: rows[rows.length - 1] ?? null, error: null };
    },
    async updateFrontier(args) {
      const row = rows.find(
        (candidate) =>
          candidate.clerk_user_id === args.clerkUserId &&
          candidate.mini_program_id === args.miniProgramId &&
          candidate.status === "in_progress" &&
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
    async listForStep(clerkUserId, miniProgramId, stepId) {
      return {
        data: rows.filter(
          (row) =>
            row.clerk_user_id === clerkUserId &&
            row.mini_program_id === miniProgramId &&
            row.step_id === stepId
        ),
        error: null,
      };
    },
    async upsert(input) {
      if (options?.failUpsert) {
        return { data: null, error: { message: "write failed" } };
      }
      const existing = rows.find(
        (row) =>
          row.clerk_user_id === input.clerkUserId &&
          row.mini_program_id === input.miniProgramId &&
          row.question_id === input.questionId
      );
      if (existing) {
        existing.step_id = input.stepId;
        existing.question_text = input.questionText;
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

function passingSubmission(current: LearningStep): StepSubmission {
  const reflections: Record<string, string> = {};
  const quizAnswers: Record<string, string[]> = {};
  const sortPlacements: Record<string, string> = {};
  for (const block of current.blocks) {
    if (block.type === "reflection") {
      reflections[block.question_id] = `  Written answer for ${block.question_id}  `;
    }
    if (block.type === "quiz") {
      for (const question of block.questions) {
        quizAnswers[question.question_id] = [...question.correct_choice_ids];
      }
    }
    if (block.type === "sort") {
      for (const card of block.cards) {
        sortPlacements[card.id] = card.correct_category;
      }
    }
  }
  return { reflections, quizAnswers, sortPlacements };
}

const emptySubmission: StepSubmission = {
  reflections: {},
  quizAnswers: {},
  sortPlacements: {},
};

async function start(memberId = "user_a") {
  const progressDb = memoryProgress();
  const reflectionDb = memoryReflections();
  const created = await initializeMiniProgramProgress(progressDb, {
    memberId,
    program: program(),
    now: NOW,
  });
  if (!created.ok) throw new Error(created.message);
  return { progressDb, reflectionDb, row: created.row };
}

describe("Respect Yourself and Others progress", () => {
  it("creates in-progress on the first open of step 1, before Continue", async () => {
    const { row, progressDb } = await start();
    expect(row).toMatchObject({
      clerk_user_id: "user_a",
      mini_program_id: "dd_mp_02",
      current_step_id: "dd_mp_02_st_001",
      status: "in_progress",
      curriculum_version: 1,
      completed_at: null,
    });
    expect(progressDb.rows).toHaveLength(1);

    progressDb.rows[0]!.current_step_id = "dd_mp_02_st_006";
    const again = await initializeMiniProgramProgress(progressDb, {
      memberId: "user_a",
      program: program(),
      now: LATER,
    });
    if (!again.ok) throw new Error(again.message);
    expect(again.row.current_step_id).toBe("dd_mp_02_st_006");
    expect(again.row.started_at).toBe(NOW);
    expect(progressDb.rows).toHaveLength(1);
  });

  it("does not treat a missing table as Not Started", async () => {
    const progressDb = memoryProgress();
    progressDb.getOne = async () => ({
      data: null,
      error: { code: "42P01", message: "learning_mini_program_progress does not exist" },
    });
    progressDb.list = async () => ({
      data: null,
      error: { code: "PGRST205", message: "schema cache" },
    });
    const loaded = await getMiniProgramProgress(progressDb, "user_a", "dd_mp_02");
    expect(loaded).toEqual({ ok: false, message: PROGRAMS_COPY.tablesMissing });
    const listed = await listMiniProgramProgress(progressDb, "user_a", ["dd_mp_02"]);
    expect(listed).toEqual({ ok: false, message: PROGRAMS_COPY.tablesMissing });
    expect(isMissingProgramsTable({ message: "schema cache" })).toBe(true);
    expect(isMissingProgramsTable({ message: "timeout" })).toBe(false);
    const duplicate = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "learning_mini_program_progress_pkey"',
    };
    expect(isUniqueProgramsConflict(duplicate)).toBe(true);
    expect(isMissingProgramsTable(duplicate)).toBe(false);
    expect(
      isMissingProgramsTable({
        message:
          'duplicate key value violates unique constraint "learning_mini_program_progress_pkey"',
      })
    ).toBe(false);
  });

  it("keeps one row when two initializes overlap, and does not log the conflict", async () => {
    const progressDb = memoryProgress();
    let reads = 0;
    let writes = 0;
    let releaseReads: () => void = () => {};
    let releaseWrites: () => void = () => {};
    const bothRead = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    const bothWrite = new Promise<void>((resolve) => {
      releaseWrites = resolve;
    });
    const readStored = progressDb.getOne.bind(progressDb);
    const writeRow = progressDb.insert.bind(progressDb);
    progressDb.getOne = async (clerkUserId, miniProgramId) => {
      reads += 1;
      if (reads <= 2) {
        if (reads === 2) releaseReads();
        await bothRead;
        return { data: null, error: null };
      }
      return readStored(clerkUserId, miniProgramId);
    };
    progressDb.insert = async (row) => {
      writes += 1;
      if (writes === 2) releaseWrites();
      await bothWrite;
      return writeRow(row);
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const [first, second] = await Promise.all([
      initializeMiniProgramProgress(progressDb, {
        memberId: "user_a",
        program: program(),
        now: NOW,
      }),
      initializeMiniProgramProgress(progressDb, {
        memberId: "user_a",
        program: program(),
        now: LATER,
      }),
    ]);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("initialize failed");
    expect(progressDb.rows).toHaveLength(1);
    expect(first.row).toMatchObject({
      current_step_id: "dd_mp_02_st_001",
      status: "in_progress",
      started_at: NOW,
      completed_at: null,
      curriculum_version: 1,
    });
    expect(second.row).toEqual(first.row);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("returns the stored row after a duplicate-key conflict and does not regress it", async () => {
    const progressDb = memoryProgress();
    const stored: LearningProgressRow = {
      clerk_user_id: "user_a",
      mini_program_id: "dd_mp_02",
      current_step_id: "dd_mp_02_st_006",
      status: "completed",
      curriculum_version: 1,
      started_at: NOW,
      completed_at: LATER,
      updated_at: LATER,
    };
    progressDb.rows.push(stored);
    let reads = 0;
    progressDb.getOne = async () => {
      reads += 1;
      if (reads === 1) return { data: null, error: null };
      return { data: { ...stored }, error: null };
    };
    progressDb.insert = async () => ({
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint "learning_mini_program_progress_pkey"',
      },
    });
    progressDb.updateFrontier = async () => {
      throw new Error("initialize must not update");
    };
    progressDb.markCompleted = async () => {
      throw new Error("initialize must not complete");
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const again = await initializeMiniProgramProgress(progressDb, {
      memberId: "user_a",
      program: program(),
      now: "2026-09-22T16:00:00.000Z",
    });
    if (!again.ok) throw new Error(again.message);
    expect(again.row).toMatchObject({
      current_step_id: "dd_mp_02_st_006",
      status: "completed",
      started_at: NOW,
      completed_at: LATER,
      curriculum_version: 1,
    });
    expect(progressDb.rows[0]).toEqual(stored);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    logProgramsDbFailure("learning_mini_program_progress", {
      message:
        'duplicate key value violates unique constraint "learning_mini_program_progress_pkey"',
    });
    expect(logged).not.toHaveBeenCalled();
    logProgramsDbFailure("learning_mini_program_progress", {
      code: "23505",
      message: "duplicate",
    });
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("repairs a removed frontier back to step 1 and leaves completion alone", async () => {
    const { progressDb, row } = await start();
    row.current_step_id = "removed-step";
    const repaired = await repairFrontierIfMissing(progressDb, "user_a", program().steps, row);
    if (!repaired.ok) throw new Error(repaired.message);
    expect(repaired.row.current_step_id).toBe("dd_mp_02_st_001");
    expect(repaired.row.status).toBe("in_progress");

    const completed = await start("user_b");
    completed.row.status = "completed";
    completed.row.completed_at = NOW;
    completed.row.current_step_id = "removed-step";
    const left = await repairFrontierIfMissing(
      completed.progressDb,
      "user_b",
      program().steps,
      completed.row
    );
    if (!left.ok) throw new Error(left.message);
    expect(left.row.status).toBe("completed");
    expect(left.row.current_step_id).toBe("removed-step");
  });

  it("walks all 18 steps, saves six reflections, and does not revert completion", async () => {
    const { progressDb, reflectionDb } = await start();
    const steps = program().steps;
    expect(steps.map((item) => item.id)).toEqual([
      "dd_mp_02_st_001",
      "dd_mp_02_st_002",
      "dd_mp_02_st_003",
      "dd_mp_02_st_004",
      "dd_mp_02_st_005",
      "dd_mp_02_st_006",
      "dd_mp_02_st_007",
      "dd_mp_02_st_008",
      "dd_mp_02_st_009",
      "dd_mp_02_st_010",
      "dd_mp_02_st_011",
      "dd_mp_02_st_012",
      "dd_mp_02_st_013",
      "dd_mp_02_st_014",
      "dd_mp_02_st_015",
      "dd_mp_02_st_016",
      "dd_mp_02_st_017",
      "dd_mp_02_st_018",
    ]);
    expect(steps.some((item) => item.id === "dd_mp_02_st_019")).toBe(false);

    for (const current of steps) {
      const result = await continueMiniProgramStep({
        progressDb,
        reflectionDb,
        memberId: "user_a",
        program: program(),
        stepId: current.id,
        submission: passingSubmission(current),
        now: LATER,
      });
      expect(result.ok, current.id).toBe(true);
    }

    expect(progressDb.rows).toHaveLength(1);
    expect(progressDb.rows[0]).toMatchObject({
      status: "completed",
      current_step_id: "dd_mp_02_st_018",
      completed_at: LATER,
    });

    const ids = reflectionDb.rows.map((row) => row.question_id).sort();
    expect(ids).toEqual([
      "dd_mp_02_st_005_reflection_01",
      "dd_mp_02_st_005_reflection_02",
      "dd_mp_02_st_005_reflection_03",
      "dd_mp_02_st_013_reflection_01",
      "dd_mp_02_st_018_reflection_01",
      "dd_mp_02_st_018_reflection_02",
    ]);
    expect(reflectionDb.rows.every((row) => row.answer_text.startsWith("Written answer"))).toBe(
      true
    );
    expect(reflectionDb.rows.every((row) => row.clerk_user_id === "user_a")).toBe(true);

    const other = await listReflectionAnswers(
      reflectionDb,
      "user_b",
      "dd_mp_02",
      "dd_mp_02_st_018"
    );
    if (!other.ok) throw new Error(other.message);
    expect(other.rows).toEqual([]);

    const completedAt = progressDb.rows[0]!.completed_at;
    const review = await continueMiniProgramStep({
      progressDb,
      reflectionDb,
      memberId: "user_a",
      program: program(),
      stepId: "dd_mp_02_st_001",
      submission: emptySubmission,
      now: "2026-09-22T16:00:00.000Z",
    });
    expect(review).toEqual({
      ok: true,
      destination: { type: "step", stepId: "dd_mp_02_st_002" },
    });
    expect(progressDb.rows[0]).toMatchObject({
      status: "completed",
      completed_at: completedAt,
      current_step_id: "dd_mp_02_st_018",
    });
  });

  it("does not move the frontier backward from Previous or an earlier Continue", async () => {
    const { progressDb, reflectionDb, row } = await start();
    row.current_step_id = "dd_mp_02_st_006";
    const earlier = await continueMiniProgramStep({
      progressDb,
      reflectionDb,
      memberId: "user_a",
      program: program(),
      stepId: "dd_mp_02_st_002",
      submission: emptySubmission,
      now: LATER,
    });
    expect(earlier).toEqual({
      ok: true,
      destination: { type: "step", stepId: "dd_mp_02_st_003" },
    });
    expect(row.current_step_id).toBe("dd_mp_02_st_006");
    expect(row.status).toBe("in_progress");

    const locked = await continueMiniProgramStep({
      progressDb,
      reflectionDb,
      memberId: "user_a",
      program: program(),
      stepId: "dd_mp_02_st_010",
      submission: passingSubmission(step("dd_mp_02_st_010")),
      now: LATER,
    });
    expect(locked).toEqual({ ok: false, message: PROGRAMS_COPY.stepLocked });
    expect(row.current_step_id).toBe("dd_mp_02_st_006");
  });

  it("requires every reflection, overwrites in place, and blocks advancement when saving fails", async () => {
    const { progressDb, reflectionDb, row } = await start();
    row.current_step_id = "dd_mp_02_st_005";

    const blank = await continueMiniProgramStep({
      progressDb,
      reflectionDb,
      memberId: "user_a",
      program: program(),
      stepId: "dd_mp_02_st_005",
      submission: {
        reflections: {
          dd_mp_02_st_005_reflection_01: "   ",
          dd_mp_02_st_005_reflection_02: "One answer",
          dd_mp_02_st_005_reflection_03: "",
        },
        quizAnswers: {},
        sortPlacements: {},
      },
      now: LATER,
    });
    expect(blank).toEqual({ ok: false, message: PROGRAMS_COPY.reflectionRequired });
    expect(row.current_step_id).toBe("dd_mp_02_st_005");
    expect(reflectionDb.rows.map((item) => item.question_id)).toEqual([
      "dd_mp_02_st_005_reflection_02",
    ]);

    const tooLong = await continueMiniProgramStep({
      progressDb,
      reflectionDb,
      memberId: "user_a",
      program: program(),
      stepId: "dd_mp_02_st_005",
      submission: {
        reflections: {
          dd_mp_02_st_005_reflection_01: "a",
          dd_mp_02_st_005_reflection_02: "b",
          dd_mp_02_st_005_reflection_03: "c".repeat(4001),
        },
        quizAnswers: {},
        sortPlacements: {},
      },
      now: LATER,
    });
    expect(tooLong).toEqual({ ok: false, message: PROGRAMS_COPY.reflectionTooLong });
    expect(row.current_step_id).toBe("dd_mp_02_st_005");

    const saved = await continueMiniProgramStep({
      progressDb,
      reflectionDb,
      memberId: "user_a",
      program: program(),
      stepId: "dd_mp_02_st_005",
      submission: passingSubmission(step("dd_mp_02_st_005")),
      now: LATER,
    });
    expect(saved).toEqual({
      ok: true,
      destination: { type: "step", stepId: "dd_mp_02_st_006" },
    });
    expect(reflectionDb.rows).toHaveLength(3);
    const first = reflectionDb.rows.find(
      (item) => item.question_id === "dd_mp_02_st_005_reflection_01"
    );
    expect(first?.question_text.length).toBeGreaterThan(0);
    expect(first?.question_text.length).toBeLessThanOrEqual(1000);

    row.current_step_id = "dd_mp_02_st_013";
    const firstSave = await continueMiniProgramStep({
      progressDb,
      reflectionDb,
      memberId: "user_a",
      program: program(),
      stepId: "dd_mp_02_st_013",
      submission: {
        reflections: { dd_mp_02_st_013_reflection_01: "First draft" },
        quizAnswers: {},
        sortPlacements: {},
      },
      now: LATER,
    });
    expect(firstSave.ok).toBe(true);
    const createdId = reflectionDb.rows.find(
      (item) => item.question_id === "dd_mp_02_st_013_reflection_01"
    )?.id;

    row.current_step_id = "dd_mp_02_st_013";
    row.status = "in_progress";
    row.completed_at = null;
    await continueMiniProgramStep({
      progressDb,
      reflectionDb,
      memberId: "user_a",
      program: program(),
      stepId: "dd_mp_02_st_013",
      submission: {
        reflections: { dd_mp_02_st_013_reflection_01: "Replaced draft" },
        quizAnswers: {},
        sortPlacements: {},
      },
      now: "2026-09-22T16:00:00.000Z",
    });
    const replaced = reflectionDb.rows.filter(
      (item) => item.question_id === "dd_mp_02_st_013_reflection_01"
    );
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({
      id: createdId,
      answer_text: "Replaced draft",
      clerk_user_id: "user_a",
    });

    const failing = memoryReflections({ failUpsert: true });
    row.current_step_id = "dd_mp_02_st_018";
    const blocked = await continueMiniProgramStep({
      progressDb,
      reflectionDb: failing,
      memberId: "user_a",
      program: program(),
      stepId: "dd_mp_02_st_018",
      submission: passingSubmission(step("dd_mp_02_st_018")),
      now: LATER,
    });
    expect(blocked).toEqual({ ok: false, message: PROGRAMS_COPY.reflectionSaveFailed });
    expect(row.current_step_id).toBe("dd_mp_02_st_018");
    expect(row.status).toBe("in_progress");
    expect(failing.rows).toHaveLength(0);
  });

  it("lets every quiz score continue and returns per-question keys only in the grade", async () => {
    const quiz = step("dd_mp_02_st_002").blocks.find((block) => block.type === "quiz");
    if (!quiz || quiz.type !== "quiz") throw new Error("missing quiz");
    const [first, second, third] = quiz.questions;
    if (!first || !second || !third) throw new Error("missing questions");

    const oneRight = { [first.question_id]: [...first.correct_choice_ids] };
    const twoRight = {
      [first.question_id]: [...first.correct_choice_ids],
      [second.question_id]: [...second.correct_choice_ids],
    };
    const threeRight = passingSubmission(step("dd_mp_02_st_002")).quizAnswers;
    expect(gradeQuiz(quiz, {}).correctCount).toBe(0);
    expect(gradeQuiz(quiz, oneRight).correctCount).toBe(1);
    expect(gradeQuiz(quiz, twoRight).correctCount).toBe(2);
    expect(gradeQuiz(quiz, threeRight).correctCount).toBe(3);
    expect(gradeQuiz(quiz, oneRight).passed).toBe(false);
    expect(gradeQuiz(quiz, twoRight).passed).toBe(true);

    const multi = quiz.questions.find((question) => question.question_type === "multiple_choice");
    if (!multi) throw new Error("missing multi-select");
    const partialMulti = {
      [multi.question_id]: [...multi.correct_choice_ids, "c2"],
    };
    const partial = gradeQuiz(quiz, partialMulti);
    const partialQuestion = partial.questions.find((question) => question.questionId === multi.question_id);
    expect(partial.correctCount).toBe(0);
    expect(partialQuestion).toMatchObject({
      correct: false,
      selectedChoiceIds: [...multi.correct_choice_ids, "c2"],
      correctChoiceIds: [...multi.correct_choice_ids],
    });
    expect(
      gradeQuiz(quiz, { [multi.question_id]: [...multi.correct_choice_ids] }).questions.find(
        (question) => question.questionId === multi.question_id
      )?.correct
    ).toBe(true);

    const { progressDb, reflectionDb, row } = await start();
    for (const quizAnswers of [{}, oneRight, twoRight, threeRight, partialMulti]) {
      row.current_step_id = "dd_mp_02_st_002";
      row.status = "in_progress";
      row.completed_at = null;
      const moved = await continueMiniProgramStep({
        progressDb,
        reflectionDb,
        memberId: "user_a",
        program: program(),
        stepId: "dd_mp_02_st_002",
        submission: { reflections: {}, quizAnswers, sortPlacements: {} },
        now: LATER,
      });
      expect(moved.ok).toBe(true);
      if (!moved.ok) throw new Error(moved.message);
      expect(moved.destination).toEqual({ type: "step", stepId: "dd_mp_02_st_003" });
      expect(moved.quiz?.questions.every((question) => question.correctChoiceIds.length > 0)).toBe(
        true
      );
      expect(row.current_step_id).toBe("dd_mp_02_st_003");
    }
    expect(reflectionDb.rows).toHaveLength(0);
    expect(progressDb.rows).toHaveLength(1);
  });

  it("lets a one-question quiz continue at 1 of 1 and 0 of 1", async () => {
    const loaded = getLearningMiniProgram("cw_mp_13");
    if (!loaded) throw new Error("missing cw_mp_13");
    const quizStep = loaded.steps.find((candidate) => candidate.id === "cw_mp_13_st_006");
    if (!quizStep) throw new Error("missing one-question quiz");
    const quiz = quizStep.blocks.find((block) => block.type === "quiz");
    if (!quiz || quiz.type !== "quiz" || quiz.questions.length !== 1) {
      throw new Error("expected a single question");
    }
    const question = quiz.questions[0];
    if (!question) throw new Error("missing question");
    const wrong = question.choices.find((choice) => !question.correct_choice_ids.includes(choice.id));
    if (!wrong) throw new Error("missing wrong choice");

    expect(gradeQuiz(quiz, { [question.question_id]: [...question.correct_choice_ids] }).correctCount).toBe(1);
    expect(gradeQuiz(quiz, { [question.question_id]: [wrong.id] }).correctCount).toBe(0);

    const progressDb = memoryProgress();
    const reflectionDb = memoryReflections();
    const created = await initializeMiniProgramProgress(progressDb, {
      memberId: "user_a",
      program: loaded,
      now: NOW,
    });
    if (!created.ok) throw new Error(created.message);
    for (const quizAnswers of [
      { [question.question_id]: [...question.correct_choice_ids] },
      { [question.question_id]: [wrong.id] },
    ]) {
      created.row.current_step_id = quizStep.id;
      created.row.status = "in_progress";
      created.row.completed_at = null;
      const moved = await continueMiniProgramStep({
        progressDb,
        reflectionDb,
        memberId: "user_a",
        program: loaded,
        stepId: quizStep.id,
        submission: { reflections: {}, quizAnswers, sortPlacements: {} },
        now: LATER,
      });
      expect(moved.ok).toBe(true);
    }
  });

  it("completes a mini-program when the last step quiz is missed", async () => {
    const loaded = getLearningMiniProgram("dd_mp_03");
    if (!loaded) throw new Error("missing dd_mp_03");
    const quizStep = loaded.steps.find((candidate) => candidate.id === "dd_mp_03_st_012");
    if (!quizStep) throw new Error("missing final quiz");
    const progressDb = memoryProgress();
    const reflectionDb = memoryReflections();
    const created = await initializeMiniProgramProgress(progressDb, {
      memberId: "user_a",
      program: loaded,
      now: NOW,
    });
    if (!created.ok) throw new Error(created.message);
    created.row.current_step_id = quizStep.id;
    const missed = await continueMiniProgramStep({
      progressDb,
      reflectionDb,
      memberId: "user_a",
      program: loaded,
      stepId: quizStep.id,
      submission: { reflections: {}, quizAnswers: {}, sortPlacements: {} },
      now: LATER,
    });
    expect(missed.ok).toBe(true);
    if (!missed.ok) throw new Error(missed.message);
    expect(missed.quiz?.correctCount).toBe(0);
    expect(missed.destination).toEqual({ type: "programs" });
    expect(created.row.status).toBe("completed");
  });

  it("rejects a wrong sort category and requires every card", async () => {
    const sortStep = step("dd_mp_02_st_003");
    const sort = sortStep.blocks.find((block) => block.type === "sort");
    if (!sort || sort.type !== "sort") throw new Error("missing sort");
    expect(sort.cards).toHaveLength(6);
    const later = step("dd_mp_02_st_016").blocks.find((block) => block.type === "sort");
    if (!later || later.type !== "sort") throw new Error("missing later sort");
    expect(later.cards).toHaveLength(8);

    const demanding = sort.cards.find((card) => card.id === "demanding");
    if (!demanding) throw new Error("missing demanding card");
    const wrongCategory = sort.categories.find((category) => category !== demanding.correct_category);
    if (!wrongCategory) throw new Error("missing category");
    const checked = checkSortPlacement(sortStep, demanding.id, wrongCategory);
    expect(checked).toEqual({ ok: true, correct: false });
    expect(checked).not.toHaveProperty("correct_category");

    const placements = Object.fromEntries(
      sort.cards.map((card) => [card.id, card.correct_category])
    );
    placements[demanding.id] = wrongCategory;
    expect(gradeSort(sort, placements).complete).toBe(false);

    const { progressDb, reflectionDb, row } = await start();
    row.current_step_id = "dd_mp_02_st_003";
    const blocked = await continueMiniProgramStep({
      progressDb,
      reflectionDb,
      memberId: "user_a",
      program: program(),
      stepId: "dd_mp_02_st_003",
      submission: { reflections: {}, quizAnswers: {}, sortPlacements: placements },
      now: LATER,
    });
    expect(blocked).toEqual({ ok: false, message: PROGRAMS_COPY.sortIncomplete });
    expect(row.current_step_id).toBe("dd_mp_02_st_003");

    const done = await continueMiniProgramStep({
      progressDb,
      reflectionDb,
      memberId: "user_a",
      program: program(),
      stepId: "dd_mp_02_st_003",
      submission: passingSubmission(sortStep),
      now: LATER,
    });
    expect(done).toEqual({
      ok: true,
      destination: { type: "step", stepId: "dd_mp_02_st_004" },
    });
  });
});
