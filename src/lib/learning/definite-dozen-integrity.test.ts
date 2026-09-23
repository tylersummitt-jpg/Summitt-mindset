import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getLearningMiniProgram,
  getLearningMiniProgramForClient,
  listLearningCollections,
} from "./load-curriculum";
import { learningProgramEntryPath, resolveLearningRoute } from "./program-paths";
import { decideContinue } from "./step-access";
import { buildVimeoPlayerEmbedUrl } from "../vimeo-player-embed";

const ROOT = path.resolve(__dirname, "../../..");

const PROGRAM_IDS = [
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
] as const;

const VERIFIED_VIMEO: Record<string, string> = {
  dd_mp_02_st_001: "1150754411",
  dd_mp_02_st_003: "1150754378",
  dd_mp_02_st_006: "1150754397",
  dd_mp_02_st_011: "1150754357",
  dd_mp_02_st_014: "1150754332",
  dd_mp_02_st_016: "1150754314",
  dd_mp_03_st_001: "1150835643",
  dd_mp_03_st_006: "1150835625",
  dd_mp_03_st_008: "1150835679",
  dd_mp_03_st_011: "1150835653",
  dd_mp_04_st_001: "1150854785",
  dd_mp_04_st_003: "1150854664",
  dd_mp_04_st_006: "1150854693",
  dd_mp_04_st_008: "1150854736",
  dd_mp_04_st_011: "1150854768",
  dd_mp_04_st_013: "1150854719",
  dd_mp_05_st_001: "1150855821",
  dd_mp_05_st_003: "1150855851",
  dd_mp_05_st_006: "1150855840",
  dd_mp_05_st_008: "1150855809",
  dd_mp_05_st_011: "1150855793",
  dd_mp_05_st_013: "1150855870",
  dd_mp_06_st_001: "1150856433",
  dd_mp_06_st_003: "1150856471",
  dd_mp_06_st_006: "1150856403",
  dd_mp_06_st_008: "1150856421",
  dd_mp_06_st_011: "1150856443",
  dd_mp_06_st_013: "1150856490",
  dd_mp_07_st_001: "1150857088",
  dd_mp_07_st_003: "1150857108",
  dd_mp_07_st_006: "1150857028",
  dd_mp_07_st_008: "1150857063",
  dd_mp_07_st_011: "1150857124",
  dd_mp_07_st_013: "1150857045",
  dd_mp_08_st_001: "1150857764",
  dd_mp_08_st_003: "1150857695",
  dd_mp_08_st_006: "1150857738",
  dd_mp_08_st_008: "1150857782",
  dd_mp_08_st_011: "1150857725",
  dd_mp_08_st_013: "1150857800",
  dd_mp_09_st_001: "1150858901",
  dd_mp_09_st_003: "1150858884",
  dd_mp_09_st_006: "1150858960",
  dd_mp_09_st_008: "1150858921",
  dd_mp_09_st_011: "1150858869",
  dd_mp_09_st_013: "1150858939",
  dd_mp_10_st_001: "1150859498",
  dd_mp_10_st_003: "1150859478",
  dd_mp_10_st_006: "1150859511",
  dd_mp_10_st_008: "1150859419",
  dd_mp_10_st_011: "1150859446",
  dd_mp_10_st_013: "1150859397",
  dd_mp_11_st_001: "1150859971",
  dd_mp_11_st_003: "1150859976",
  dd_mp_11_st_006: "1150859998",
  dd_mp_11_st_008: "1150859987",
  dd_mp_11_st_011: "1150859951",
  dd_mp_11_st_013: "1150860016",
  dd_mp_12_st_001: "1150861188",
  dd_mp_12_st_003: "1150861133",
  dd_mp_12_st_006: "1150861228",
  dd_mp_12_st_008: "1150861152",
  dd_mp_12_st_011: "1150861264",
  dd_mp_12_st_013: "1150861250",
  dd_mp_13_st_001: "1150861856",
  dd_mp_13_st_003: "1150861933",
  dd_mp_13_st_006: "1150862012",
  dd_mp_13_st_008: "1150861951",
  dd_mp_13_st_011: "1150862029",
  dd_mp_13_st_013: "1150861779",
};

const UNMATCHED_VIDEOS = ["dd_mp_03_st_003", "dd_mp_03_st_013"] as const;

describe("Definite Dozen curriculum integrity", () => {
  it("registers principles 1–12 in source order with routes and independent ids", () => {
    const programs = listLearningCollections().flatMap((collection) => collection.miniPrograms);
    expect(programs.map((program) => program.id)).toEqual([...PROGRAM_IDS]);
    expect(programs.map((program) => program.sequence)).toEqual(
      PROGRAM_IDS.map((_, index) => index + 1)
    );

    for (const id of PROGRAM_IDS) {
      const program = getLearningMiniProgram(id);
      expect(program, id).toBeTruthy();
      if (!program) continue;
      expect(learningProgramEntryPath(id)).toMatch(/^\/programs\/definite-dozen\/[a-z0-9-]+$/);
      const slug = learningProgramEntryPath(id).split("/").at(-1) ?? "";
      expect(resolveLearningRoute("definite-dozen", slug)).toBe(id);

      const stepIds = program.steps.map((step) => step.id);
      expect(new Set(stepIds).size).toBe(stepIds.length);
      expect(program.steps.map((step) => step.sequence)).toEqual(
        program.steps.map((_, index) => index + 1)
      );
      expect(stepIds.every((stepId) => stepId.startsWith(`${id}_`))).toBe(true);

      const last = program.steps.at(-1);
      expect(last, id).toBeTruthy();
      if (!last) continue;
      expect(
        decideContinue(
          { status: "in_progress", current_step_id: last.id },
          program.steps,
          last.id
        )
      ).toEqual({ kind: "complete" });
      expect(
        decideContinue({ status: "completed", current_step_id: last.id }, program.steps, last.id)
      ).toEqual({ kind: "review-end" });
    }
  });

  it("keeps answer keys server-side and validates quizzes, sorts, reflections, and media", () => {
    const reflectionIds = new Set<string>();

    for (const id of PROGRAM_IDS) {
      const program = getLearningMiniProgram(id);
      const client = getLearningMiniProgramForClient(id);
      if (!program || !client) throw new Error(`missing ${id}`);
      const clientJson = JSON.stringify(client);
      expect(clientJson).not.toContain("correct_choice_ids");
      expect(clientJson).not.toContain("correct_category");
      expect(clientJson).not.toContain("data/learning/source");

      for (const step of program.steps) {
        if (step.group_label !== undefined) {
          expect(step.group_label.trim().length).toBeGreaterThan(0);
        }
        for (const block of step.blocks) {
          if (block.type === "quiz") {
            expect(block.minimum_correct).toBeGreaterThanOrEqual(1);
            expect(block.minimum_correct).toBeLessThanOrEqual(block.questions.length);
            for (const question of block.questions) {
              const choiceIds = new Set(question.choices.map((choice) => choice.id));
              expect(choiceIds.size).toBe(question.choices.length);
              expect(question.correct_choice_ids.length).toBeGreaterThan(0);
              expect(question.correct_choice_ids.every((choiceId) => choiceIds.has(choiceId))).toBe(
                true
              );
              if (question.question_type === "single_choice") {
                expect(question.correct_choice_ids).toHaveLength(1);
              }
            }
          }
          if (block.type === "sort") {
            const categories = new Set(block.categories);
            expect(categories.size).toBeGreaterThanOrEqual(2);
            const cardIds = new Set<string>();
            for (const card of block.cards) {
              expect(cardIds.has(card.id)).toBe(false);
              cardIds.add(card.id);
              expect(categories.has(card.correct_category)).toBe(true);
            }
          }
          if (block.type === "reflection") {
            expect(reflectionIds.has(block.question_id)).toBe(false);
            reflectionIds.add(block.question_id);
            expect(block.question_id.startsWith(`${step.id}_reflection_`)).toBe(true);
            expect(block.prompt.length).toBeGreaterThan(0);
            expect(block.prompt.length).toBeLessThanOrEqual(1000);
          }
          if (block.type === "image") {
            expect(block.src.startsWith("/learning/definite-dozen/")).toBe(true);
            expect(block.src).not.toContain("data/learning/source");
            expect(existsSync(path.join(ROOT, "public", block.src.slice(1)))).toBe(true);
          }
          if (block.type === "video") {
            const expected = VERIFIED_VIMEO[step.id] ?? null;
            expect(block.vimeo_video_id).toBe(expected);
            if (block.vimeo_video_id) {
              expect(buildVimeoPlayerEmbedUrl(block.vimeo_video_id)).toBe(
                `https://player.vimeo.com/video/${block.vimeo_video_id}?dnt=1`
              );
            } else {
              expect(buildVimeoPlayerEmbedUrl(block.vimeo_video_id)).toBeNull();
            }
          }
        }
      }
    }

    const assigned = new Set<string>();
    for (const [stepId, vimeoId] of Object.entries(VERIFIED_VIMEO)) {
      const programId = stepId.slice(0, "dd_mp_00".length);
      const program = getLearningMiniProgram(programId);
      const step = program?.steps.find((item) => item.id === stepId);
      const videos = step?.blocks.filter((block) => block.type === "video") ?? [];
      expect(videos).toHaveLength(1);
      const video = videos[0];
      expect(video && video.type === "video" ? video.vimeo_video_id : null).toBe(vimeoId);
      expect(assigned.has(vimeoId)).toBe(false);
      assigned.add(vimeoId);
    }
    expect(Object.keys(VERIFIED_VIMEO)).toHaveLength(70);

    for (const stepId of UNMATCHED_VIDEOS) {
      const program = getLearningMiniProgram("dd_mp_03");
      const step = program?.steps.find((item) => item.id === stepId);
      const video = step?.blocks.find((block) => block.type === "video");
      expect(video && video.type === "video" ? video.vimeo_video_id : "missing-step").toBeNull();
      if (video && video.type === "video") {
        expect(video.visible_title.length).toBeGreaterThan(0);
        expect(video.speaker).toBe("Katy Kvalvik");
      }
    }
  });
});
