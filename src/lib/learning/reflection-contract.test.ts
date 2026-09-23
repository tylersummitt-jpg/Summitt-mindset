import { describe, expect, it } from "vitest";
import { parseLearningMiniProgram } from "./curriculum-types";
import { validateStepRequirements } from "./grade-step";

const program = {
  id: "fixture_mp",
  collection_id: "definite_dozen",
  collection_title: "Definite Dozen",
  title: "Fixture",
  description: "Fixture",
  sequence: 1,
  estimated_minutes: 10,
  source_mini_program_id: "fixture_mp",
  curriculum_version: 1,
  steps: [
    {
      id: "fixture_st",
      source_step_id: "fixture_st",
      sequence: 1,
      title: "Have you ever led a team?",
      blocks: [
        {
          type: "markdown",
          markdown: "Have you ever wondered what respect requires? This paragraph is teaching, not a field.",
        },
        {
          type: "heading",
          level: 2,
          text: "What does respect look like?",
        },
        {
          type: "reflection",
          question_id: "fixture_saved",
          prompt: "Name one habit you will practice this week.",
        },
        {
          type: "reflection",
          question_id: "fixture_unsaved",
          prompt: "This response will not be saved or graded.",
          persist: false,
        },
      ],
    },
  ],
};

describe("explicit reflection contract", () => {
  it("does not turn titles or question-mark prose into saved fields", () => {
    const parsed = parseLearningMiniProgram(program);
    const step = parsed.steps[0];
    if (!step) throw new Error("missing step");
    const reflections = step.blocks.filter((block) => block.type === "reflection");
    expect(reflections.map((block) => (block.type === "reflection" ? block.question_id : ""))).toEqual([
      "fixture_saved",
      "fixture_unsaved",
    ]);
    expect(step.title).toContain("?");
    expect(step.blocks[0]).toMatchObject({ type: "markdown" });
    expect(step.blocks[1]).toMatchObject({ type: "heading" });

    const missingSaved = validateStepRequirements(step, {
      reflections: {},
      quizAnswers: {},
      sortPlacements: {},
    });
    expect(missingSaved.ok).toBe(false);

    const savedOnly = validateStepRequirements(step, {
      reflections: { fixture_saved: "I will listen first." },
      quizAnswers: {},
      sortPlacements: {},
    });
    expect(savedOnly.ok).toBe(true);
  });
});
