import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getLearningMiniProgram, listLearningCollections } from "./load-curriculum";
import { validateStepRequirements } from "./grade-step";
import { decideContinue } from "./step-access";

const ROOT = path.resolve(__dirname, "../../..");

const RETIRED = [
  "potl_mp_01_st_001",
  "potl_mp_01_st_006",
  "potl_mp_07_st_006",
  "cw_mp_01_st_001",
  "cw_mp_03_st_001",
  "cw_mp_05_st_001",
  "cw_mp_08_st_001",
  "cw_mp_09_st_004",
  "cw_mp_09_st_005",
  "cw_mp_10_st_005",
  "cw_mp_11_st_004",
  "cw_mp_11_st_005",
  "cw_mp_13_st_004",
];

function step(programId: string, stepId: string) {
  const program = getLearningMiniProgram(programId);
  const found = program?.steps.find((candidate) => candidate.id === stepId);
  if (!program || !found) throw new Error(`missing ${stepId}`);
  return { program, step: found };
}

function textOf(programId: string, stepId: string) {
  return JSON.stringify(step(programId, stepId).step);
}

describe("new human-QA findings", () => {
  it("keeps the curated runtime counts and retired routes unregistered", () => {
    const collections = listLearningCollections();
    expect(collections.flatMap((collection) => collection.miniPrograms)).toHaveLength(37);
    const runtime = collections
      .flatMap((collection) => collection.miniPrograms)
      .map((card) => getLearningMiniProgram(card.id))
      .filter((program) => program != null);
    expect(runtime.reduce((sum, program) => sum + program.steps.length, 0)).toBe(177 + 85 + 74);
    const ids = new Set(runtime.flatMap((program) => program.steps.map((item) => item.id)));
    for (const retired of RETIRED) expect(ids.has(retired)).toBe(false);
    const joined = runtime.map((program) => JSON.stringify(program)).join("\n");
    for (const name of ["Katy Kvalvik", "Christina Reckard", "Patty Hoppenstedt", "Christina Gradillas"]) {
      expect(joined).not.toContain(name);
    }
    expect(joined).not.toContain("transcript.pdf");
    expect(joined.toLowerCase()).not.toContain("download the transcript");
  });

  it("pairs the bulletin-board flashcard and restores the competitor questions", () => {
    const bulletin = step("dd_mp_11", "dd_mp_11_st_011").step;
    const cards = bulletin.blocks.filter((block) => block.type === "flashcard");
    expect(cards).toHaveLength(1);
    if (cards[0]?.type !== "flashcard") throw new Error("flashcard");
    expect(cards[0].cards).toEqual([
      expect.objectContaining({
        front: "Bulletin Board Material",
        back: "In sports, a rival's comment or detail that is used by the opposite team for motivation",
      }),
    ]);
    const closing = step("dd_mp_11", "dd_mp_11_st_015").step;
    const prompts = closing.blocks
      .filter((block) => block.type === "reflection")
      .map((block) => (block.type === "reflection" ? block.prompt : ""));
    expect(prompts).toEqual([
      "How could your organization commit to growth in the face of powerful competition?",
      "How can you use competitors to inspire you and your team to be a better version of yourselves?",
    ]);
  });

  it("restores the familiarity and wrap-up checks without a score gate", () => {
    for (const [programId, stepId, count] of [
      ["dd_mp_12", "dd_mp_12_st_003", 4],
      ["dd_mp_13", "dd_mp_13_st_013", 4],
    ] as const) {
      const found = step(programId, stepId).step;
      const quizzes = found.blocks.filter((block) => block.type === "quiz");
      expect(quizzes).toHaveLength(1);
      const quiz = quizzes[0];
      if (!quiz || quiz.type !== "quiz") throw new Error(stepId);
      expect(quiz.questions).toHaveLength(1);
      expect(quiz.questions[0]?.choices).toHaveLength(count);
      const reflections = Object.fromEntries(
        found.blocks
          .filter((block) => block.type === "reflection" && block.persist !== false)
          .map((block) => [block.type === "reflection" ? block.question_id : "", "A saved answer."])
      );
      const zero = validateStepRequirements(found, {
        reflections,
        quizAnswers: {},
        sortPlacements: {},
      });
      expect(zero.ok).toBe(true);
      if (zero.ok && zero.quiz) expect(zero.quiz.correctCount).toBe(0);
    }
  });

  it("does not persist responses that promise they will not be saved", () => {
    for (const [programId, stepId] of [
      ["dd_mp_12", "dd_mp_12_st_011"],
      ["dd_mp_13", "dd_mp_13_st_006"],
      ["dd_mp_13", "dd_mp_13_st_008"],
      ["dd_mp_13", "dd_mp_13_st_011"],
    ] as const) {
      const found = step(programId, stepId).step;
      const reflections = found.blocks.filter((block) => block.type === "reflection");
      expect(reflections.length).toBeGreaterThan(0);
      for (const block of reflections) {
        if (block.type !== "reflection") continue;
        expect(block.persist).toBe(false);
        expect(block.confirmation).toContain("Thank you");
      }
      const skipped = validateStepRequirements(found, {
        reflections: { leaked: "should not be required" },
        quizAnswers: {},
        sortPlacements: {},
      });
      expect(skipped.ok).toBe(true);
    }
    expect(textOf("dd_mp_13", "dd_mp_13_st_006")).not.toContain("{'front'");
    const intro = step("dd_mp_13", "dd_mp_13_st_003").step;
    expect(intro.blocks.some((block) => block.type === "reflection")).toBe(false);
  });

  it("keeps native reflections and the exact Personal Brand prompts", () => {
    const brand = step("potl_mp_05", "potl_mp_05_st_010").step;
    const prompts = brand.blocks
      .filter((block) => block.type === "reflection")
      .map((block) => (block.type === "reflection" ? block.prompt : ""));
    expect(prompts).toContain("Who has a personal brand you admire? Why?");
    expect(prompts).toContain(
      "Who around you has a negative personal brand? What are some of the characteristics?"
    );
    expect(prompts.some((prompt) => prompt.includes("What may need to change?"))).toBe(true);
    expect(prompts.some((prompt) => prompt.startsWith("Create your own personal brand statement"))).toBe(
      true
    );
    expect(
      decideContinue(
        { status: "in_progress", current_step_id: brand.id },
        step("potl_mp_05", "potl_mp_05_st_010").program.steps,
        brand.id
      )
    ).toEqual({ kind: "complete" });
    const lcr = step("potl_mp_01", "potl_mp_01_st_004").step;
    const sections = lcr.blocks.find((block) => block.type === "sections");
    expect(sections && sections.type === "sections" ? sections.sections : []).toHaveLength(3);
    expect(JSON.stringify(sections)).toContain("How do you encourage your employees");
  });

  it("renders archived audio without a playback gate and keeps flashcard pairs", () => {
    for (const [programId, stepId, file] of [
      ["potl_mp_03", "potl_mp_03_st_002", "public/learning/power-of-team-leader/potl_mp_03_st_002_audio.mp3"],
      ["potl_mp_08", "potl_mp_08_st_007", "public/learning/power-of-team-leader/potl_mp_08_st_007_audio.mp3"],
      ["potl_mp_10", "potl_mp_10_st_003", "public/learning/power-of-team-leader/potl_mp_10_st_003_audio.mp3"],
      ["cw_mp_03", "cw_mp_03_st_006", "public/learning/championing-women/cw_mp_03_st_006_audio.mp3"],
    ] as const) {
      const found = step(programId, stepId).step;
      const audio = found.blocks.find((block) => block.type === "audio");
      expect(audio && audio.type === "audio" ? audio.label.length : 0).toBeGreaterThan(0);
      if (!audio || audio.type !== "audio") throw new Error(stepId);
      expect(existsSync(path.join(ROOT, file))).toBe(true);
      expect(audio.transcript.length).toBeGreaterThan(20);
      expect(found.blocks.some((block) => block.type === "video" && block.vimeo_video_id === null)).toBe(
        false
      );
    }
    const decks = step("potl_mp_03", "potl_mp_03_st_003").step.blocks.filter(
      (block) => block.type === "flashcard"
    );
    const cards = decks.find((block) => block.type === "flashcard" && block.cards.length === 13);
    expect(cards && cards.type === "flashcard" ? cards.cards : []).toHaveLength(13);
    if (cards && cards.type === "flashcard") {
      expect(cards.cards[0]?.front).toBe("Ignorance of the business’s priorities");
      expect(cards.cards[0]?.back.startsWith("No ownership!")).toBe(true);
    }
    const rules = step("potl_mp_06", "potl_mp_06_st_006").step.blocks.find((block) => block.type === "list");
    expect(rules && rules.type === "list" ? rules.items[0] : "").toBe(
      "Be clear and concise about what you need."
    );
  });

  it("groups the historical photographs and keeps one affirmation field per statement", () => {
    const history = step("cw_mp_01", "cw_mp_01_st_002").step;
    const gallery = history.blocks.find((block) => block.type === "gallery");
    expect(gallery && gallery.type === "gallery" ? gallery.images : []).toHaveLength(16);
    if (!gallery || gallery.type !== "gallery") throw new Error("gallery");
    expect(gallery.images.every((image) => image.alt !== "Lesson image")).toBe(true);
    const affirmations = step("cw_mp_07", "cw_mp_07_st_006").step.blocks.filter(
      (block) => block.type === "reflection"
    );
    expect(affirmations).toHaveLength(7);
    expect(textOf("cw_mp_10", "cw_mp_10_st_004")).not.toContain('"markdown":"storyline"');
    expect(textOf("cw_mp_10", "cw_mp_10_st_007")).not.toContain("Michelle Marciniak");
    expect(textOf("cw_mp_13", "cw_mp_13_st_006")).not.toContain("cw_mp_13_st_006_q01");
  });
});
