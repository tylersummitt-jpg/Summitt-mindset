import { describe, expect, it } from "vitest";
import { listLearningCollections } from "./load-curriculum";
import {
  learningProgramEntryPath,
  learningStepPath,
  resolveLearningRoute,
} from "./program-paths";

describe("program paths", () => {
  it("routes every registered program without using the step id as a slug", () => {
    const programs = listLearningCollections().flatMap((collection) => collection.miniPrograms);
    expect(programs.map((program) => program.id).slice(0, 12)).toEqual([
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
    expect(programs).toHaveLength(37);
    for (const program of programs) {
      const entry = learningProgramEntryPath(program.id);
      const [, , collectionSlug, programSlug] = entry.split("/");
      expect(resolveLearningRoute(collectionSlug, programSlug)).toBe(program.id);
      expect(programSlug).not.toBe(program.id);
    }
    expect(learningProgramEntryPath("dd_mp_02")).toBe(
      "/programs/definite-dozen/respect-yourself-and-others"
    );
    expect(learningStepPath("dd_mp_02", "dd_mp_02_st_004")).toBe(
      "/programs/definite-dozen/respect-yourself-and-others/dd_mp_02_st_004"
    );
    expect(resolveLearningRoute("definite-dozen", "respect-yourself-and-others")).toBe("dd_mp_02");
    expect(resolveLearningRoute("definite-dozen", "missing")).toBeNull();
  });
});
