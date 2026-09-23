import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lessonGroupForSequence } from "./lesson-groups";
import {
  getLearningMiniProgram,
  getLearningMiniProgramForClient,
  getLearningStep,
  getLearningStepById,
  listLearningCollections,
  toPublicLearningMiniProgram,
} from "./load-curriculum";

const ROOT = path.resolve(__dirname, "../../..");
const SOURCE_PROGRAM = path.join(
  ROOT,
  "data/learning/source/definite_dozen/program.json"
);
const LEARNING_LIB = path.join(ROOT, "src/lib/learning");

const PRINCIPLE_1_VIMEO: Array<[string, string]> = [
  ["dd_mp_02_st_001", "1150754411"],
  ["dd_mp_02_st_003", "1150754378"],
  ["dd_mp_02_st_006", "1150754397"],
  ["dd_mp_02_st_011", "1150754357"],
  ["dd_mp_02_st_014", "1150754332"],
  ["dd_mp_02_st_016", "1150754314"],
];

const REFLECTION_IDS = [
  "dd_mp_02_st_005_reflection_01",
  "dd_mp_02_st_005_reflection_02",
  "dd_mp_02_st_005_reflection_03",
  "dd_mp_02_st_013_reflection_01",
  "dd_mp_02_st_018_reflection_01",
  "dd_mp_02_st_018_reflection_02",
];

function program() {
  const loaded = getLearningMiniProgram("dd_mp_02");
  if (!loaded) throw new Error("missing dd_mp_02");
  return loaded;
}

describe("Principle 1 curriculum", () => {
  it("registers the Definite Dozen principles and no coming-soon rows", () => {
    const collections = listLearningCollections();
    expect(collections.map((collection) => collection.id)).toEqual(["definite_dozen"]);
    expect(collections[0]?.title).toBe("Definite Dozen");
    expect(collections[0]?.miniPrograms.map((item) => item.id)).toEqual([
      "dd_mp_02",
      "dd_mp_03",
      "dd_mp_04",
      "dd_mp_05",
      "dd_mp_06",
      "dd_mp_07",
      "dd_mp_08",
      "dd_mp_09",
      "dd_mp_10",
      "dd_mp_11",
      "dd_mp_12",
      "dd_mp_13",
    ]);
    expect(JSON.stringify(collections)).not.toContain("coming soon");
    expect(JSON.stringify(collections)).not.toContain("power_of_team_team");
    expect(collections[0]?.miniPrograms[0]).not.toHaveProperty("steps");
  });

  it("contains exactly 18 steps from dd_mp_02_st_001 through st_018 and omits st_019", () => {
    const steps = program().steps;
    expect(steps).toHaveLength(18);
    expect(steps.map((step) => step.id)).toEqual(
      steps.map((step) => step.source_step_id)
    );
    expect(steps.map((step) => step.sequence)).toEqual(
      Array.from({ length: 18 }, (_, index) => index + 1)
    );
    expect(steps.map((step) => step.source_step_id)).toEqual([
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
    expect(steps.map((step) => step.id)).not.toContain("dd_mp_02_st_019");
    expect(new Set(steps.map((step) => step.id)).size).toBe(18);
  });

  it("orders steps by curriculum sequence, not Film Room order_index", () => {
    const steps = program().steps;
    const respectBusting = steps.find((step) => step.source_step_id === "dd_mp_02_st_014");
    const itStarts = steps.find((step) => step.source_step_id === "dd_mp_02_st_006");
    expect(respectBusting?.sequence).toBe(14);
    expect(itStarts?.sequence).toBe(6);
    expect((respectBusting?.sequence ?? 0) > (itStarts?.sequence ?? 0)).toBe(true);
    const serialized = JSON.stringify(program());
    expect(serialized).not.toContain("film_room_order_index");
    expect(serialized).not.toContain("order_index");
  });

  it("keeps six reflection prompts and server-side quiz keys", () => {
    const reflections = program().steps.flatMap((step) =>
      step.blocks.flatMap((block) =>
        block.type === "reflection" ? [block.question_id] : []
      )
    );
    expect(reflections).toEqual(REFLECTION_IDS);

    const quizzes = program().steps.flatMap((step) =>
      step.blocks.filter((block) => block.type === "quiz")
    );
    expect(quizzes).toHaveLength(6);
    for (const quiz of quizzes) {
      expect(quiz.minimum_correct).toBe(2);
      expect(quiz.questions).toHaveLength(3);
      for (const question of quiz.questions) {
        expect(question.correct_choice_ids.length).toBeGreaterThan(0);
      }
    }
    const multi = quizzes
      .flatMap((quiz) => quiz.questions)
      .filter((question) => question.question_type === "multiple_choice");
    expect(multi.map((question) => question.question_id).sort()).toEqual([
      "dd_mp_02_st_002_q03",
      "dd_mp_02_st_010_q02",
    ]);
  });

  it("matches archived quiz answer keys without importing source from the loader", () => {
    const archive = JSON.parse(readFileSync(SOURCE_PROGRAM, "utf8")) as {
      mini_programs: Array<{
        mini_program_id: string;
        steps: Array<{
          step_id: string;
          quiz?: { questions?: Array<{ question_id: string; correct_choice_ids: string[] }> };
        }>;
      }>;
    };
    const source = archive.mini_programs.find(
      (item) => item.mini_program_id === "dd_mp_02"
    );
    if (!source) throw new Error("archive missing dd_mp_02");
    const sourceKeys = new Map<string, string[]>();
    for (const step of source.steps) {
      for (const question of step.quiz?.questions ?? []) {
        sourceKeys.set(question.question_id, question.correct_choice_ids);
      }
    }
    const curriculumKeys = program().steps.flatMap((step) =>
      step.blocks.flatMap((block) =>
        block.type === "quiz"
          ? block.questions.map(
              (question) =>
                [question.question_id, question.correct_choice_ids] as const
            )
          : []
      )
    );
    expect(curriculumKeys).toHaveLength(18);
    for (const [questionId, correct] of curriculumKeys) {
      expect(sourceKeys.get(questionId)).toEqual(correct);
    }
  });

  it("uses the verified Principle 1 Vimeo ids on their source steps", () => {
    for (const [stepId, vimeoId] of PRINCIPLE_1_VIMEO) {
      const step = getLearningStep("dd_mp_02", stepId);
      const video = step?.blocks.find((block) => block.type === "video");
      expect(video).toMatchObject({ type: "video", vimeo_video_id: vimeoId });
    }
    const ids = program().steps.flatMap((step) =>
      step.blocks.flatMap((block) =>
        block.type === "video" && block.vimeo_video_id ? [block.vimeo_video_id] : []
      )
    );
    expect(ids).toEqual(PRINCIPLE_1_VIMEO.map(([, vimeoId]) => vimeoId));
  });

  it("removes quiz and sort answer keys from the client payload", () => {
    const server = program();
    const client = getLearningMiniProgramForClient("dd_mp_02");
    expect(client).not.toBeNull();
    const serialized = JSON.stringify(client);
    expect(serialized).not.toContain("correct_choice_ids");
    expect(serialized).not.toContain("correct_category");
    expect(serialized).not.toContain("is_correct");
    expect(JSON.stringify(server)).toContain("correct_choice_ids");
    expect(JSON.stringify(server)).toContain("correct_category");

    const publicProgram = toPublicLearningMiniProgram(server);
    const sort = publicProgram.steps
      .flatMap((step) => step.blocks)
      .find((block) => block.type === "sort");
    expect(sort?.type).toBe("sort");
    if (sort?.type === "sort") {
      expect(sort.categories.length).toBeGreaterThan(0);
      expect(sort.cards[0]).toEqual({
        id: expect.any(String),
        text: expect.any(String),
      });
      expect(sort.cards[0]).not.toHaveProperty("correct_category");
    }

    const located = getLearningStepById("dd_mp_02_st_004");
    expect(located?.step.sequence).toBe(4);
    expect(getLearningStep("dd_mp_02", "dd_mp_02_st_019")).toBeNull();
  });

  it("does not import the raw source archive from learning runtime code", () => {
    const files = readdirSync(LEARNING_LIB).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts")
    );
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const source = readFileSync(path.join(LEARNING_LIB, name), "utf8");
      expect(source).not.toMatch(/data\/learning\/source/);
      expect(source).not.toContain("definite_dozen/program.json");
    }
  });

  it("uses the source title, cover framing, and five curated images", () => {
    const loaded = program();
    expect(loaded.title).toBe("Principle 1: Respect Yourself & Others");
    expect(loaded.description).toContain("teams won’t follow a leader they don’t respect");
    expect(loaded.description).not.toContain("Teams follow leaders they respect");
    const serialized = JSON.stringify(loaded);
    expect(serialized).not.toContain("data/learning/source");
    expect(serialized).not.toContain(".png");
    expect(serialized).not.toContain(".pdf");
    const images = loaded.steps.flatMap((step) =>
      step.blocks.filter((block) => block.type === "image")
    );
    expect(images.map((block) => (block.type === "image" ? block.src : ""))).toEqual([
      "/learning/definite-dozen/dd_mp_02_st_001_quote.jpg",
      "/learning/definite-dozen/dd_mp_02_st_011_quote_1.jpg",
      "/learning/definite-dozen/dd_mp_02_st_011_quote_3.jpg",
      "/learning/definite-dozen/dd_mp_02_st_011_quote_4.jpg",
      "/learning/definite-dozen/dd_mp_02_st_018_wrap_up.jpg",
    ]);
    for (const block of images) {
      if (block.type !== "image") continue;
      expect(existsSync(path.join(ROOT, "public", block.src.slice(1)))).toBe(true);
    }
    for (const step of loaded.steps) {
      const quiz = step.blocks.find((block) => block.type === "quiz");
      if (quiz?.type === "quiz") expect(quiz.minimum_correct).toBe(2);
    }
    expect(lessonGroupForSequence(1)).toBe("1.1 Pat in Her Own Words");
    expect(lessonGroupForSequence(2)).toBe("1.1 Pat in Her Own Words");
    expect(lessonGroupForSequence(3)).toBe("1.2 Simple Truths");
    expect(lessonGroupForSequence(6)).toBe("1.3 It Starts with You");
    expect(lessonGroupForSequence(11)).toBe("1.4 Respect & Accountability");
    expect(lessonGroupForSequence(14)).toBe("1.5 Respect-Busting Behaviors");
    expect(lessonGroupForSequence(16)).toBe("1.6 Wrap-Up");
    expect(lessonGroupForSequence(18)).toBe("1.6 Wrap-Up");
  });
});
