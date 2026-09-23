import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listLearningCollections, getLearningMiniProgram } from "./load-curriculum";

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, "public");

describe("Programs media integrity", () => {
  it("resolves every runtime image and keeps videos numeric", () => {
    const mismatches: string[] = [];
    for (const collection of listLearningCollections()) {
      for (const card of collection.miniPrograms) {
        const program = getLearningMiniProgram(card.id);
        if (!program) throw new Error(card.id);
        for (const step of program.steps) {
          const seenOnStep = new Set<string>();
          for (const block of step.blocks) {
            if (block.type === "image") {
              expect(block.src.startsWith("/learning/")).toBe(true);
              expect(block.src).not.toContain("data/learning/source");
              expect(existsSync(path.join(PUBLIC, block.src)), block.src).toBe(true);
              if (block.src.includes("/definite-dozen/")) {
                expect(seenOnStep.has(block.src), `${step.id} duplicates ${block.src}`).toBe(false);
              }
              seenOnStep.add(block.src);
              if (block.src.includes("/definite-dozen/")) {
                const embedded = block.src.match(/dd_mp_\d+_st_\d+/);
                if (embedded && embedded[0] !== step.id) {
                  mismatches.push(`${step.id} -> ${block.src}`);
                }
              }
            }
            if (block.type === "video" && block.vimeo_video_id) {
              expect(block.vimeo_video_id).toMatch(/^\d+$/);
            }
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("keeps the Doug Buce Principle 1 videos on the visually verified ids", () => {
    const program = getLearningMiniProgram("dd_mp_02");
    const video = (stepId: string) => {
      const step = program?.steps.find((candidate) => candidate.id === stepId);
      const block = step?.blocks.find((candidate) => candidate.type === "video");
      return block && block.type === "video" ? block.vimeo_video_id : null;
    };
    expect(video("dd_mp_02_st_006")).toBe("1150754357");
    expect(video("dd_mp_02_st_011")).toBe("1150754332");
    expect(video("dd_mp_02_st_014")).toBe("1150754397");
  });

  it("rejects implementation placeholder alt text on repaired images", () => {
    const violations: string[] = [];
    for (const collection of listLearningCollections()) {
      for (const card of collection.miniPrograms) {
        const program = getLearningMiniProgram(card.id);
        if (!program) continue;
        for (const step of program.steps) {
          for (const block of step.blocks) {
            if (block.type !== "image") continue;
            const alt = block.alt.toLowerCase();
            const repaired =
              step.id === "dd_mp_05_st_008" ||
              [
                "dd_mp_08_st_008_image_02.jpg",
                "dd_mp_08_st_010_image_01.jpg",
                "dd_mp_08_st_010_image_02.jpg",
                "dd_mp_08_st_011_image_02.jpg",
                "dd_mp_08_st_015_image_01.jpg",
              ].some((file) => block.src.endsWith(file));
            if (alt.includes("original docebo lesson image") || alt.includes("course image")) {
              violations.push(`${step.id} ${block.src} ${block.alt}`);
            }
            if (
              repaired &&
              (alt.includes("lesson image") ||
                alt.includes("original docebo lesson image") ||
                alt.includes("course image"))
            ) {
              violations.push(`${step.id} ${block.src} ${block.alt}`);
            }
          }
        }
      }
    }
    expect(violations).toEqual([]);

    const relationships = getLearningMiniProgram("dd_mp_05")?.steps.find(
      (step) => step.id === "dd_mp_05_st_008"
    );
    const characterAlts = relationships?.blocks.flatMap((block) =>
      block.type === "image" && /dd_mp_05_st_008_image_(0[3-9]|1[0-4])\.png$/.test(block.src)
        ? [block.alt]
        : []
    );
    expect(characterAlts).toEqual(
      Array.from({ length: 12 }, (_, index) => `Relationship scenario character image ${index + 1}`)
    );

    const workingSmart = getLearningMiniProgram("dd_mp_08");
    const altFor = (stepId: string, file: string) => {
      const block = workingSmart?.steps
        .find((step) => step.id === stepId)
        ?.blocks.find((candidate) => candidate.type === "image" && candidate.src.endsWith(file));
      return block && block.type === "image" ? block.alt : null;
    };
    expect(altFor("dd_mp_08_st_008", "dd_mp_08_st_008_image_02.jpg")).toBe(
      "A highway running between a cliff and a river"
    );
    expect(altFor("dd_mp_08_st_010", "dd_mp_08_st_010_image_01.jpg")).toBe(
      "A roadside sign reading Success Ahead"
    );
    expect(altFor("dd_mp_08_st_010", "dd_mp_08_st_010_image_02.jpg")).toBe(
      "An arrow aimed at the center of a target"
    );
    expect(altFor("dd_mp_08_st_011", "dd_mp_08_st_011_image_02.jpg")).toBe(
      "Cars stacked in a multi-level parking structure"
    );
    expect(altFor("dd_mp_08_st_015", "dd_mp_08_st_015_image_01.jpg")).toBe(
      "Eyeglasses resting on an open book"
    );
  });
});
