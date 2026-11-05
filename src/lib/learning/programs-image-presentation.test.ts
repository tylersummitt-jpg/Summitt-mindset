import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { getLearningMiniProgram, listLearningCollections } from "./load-curriculum";
import { readPublicLearningImageSize } from "./image-file-size";

const ROOT = process.cwd();

function step(programId: string, stepId: string) {
  const found = getLearningMiniProgram(programId)?.steps.find((candidate) => candidate.id === stepId);
  if (!found) throw new Error(stepId);
  return found;
}

function imageSrcs(programId: string, stepId: string): string[] {
  return step(programId, stepId).blocks.flatMap((block) =>
    block.type === "image" ? [block.src] : []
  );
}

describe("Programs image dimensions", () => {
  it("measures every runtime image from the file and rejects a mismatch", async () => {
    const seen = new Set<string>();
    for (const collection of listLearningCollections()) {
      for (const card of collection.miniPrograms) {
        const program = getLearningMiniProgram(card.id);
        if (!program) throw new Error(card.id);
        for (const lesson of program.steps) {
          for (const block of lesson.blocks) {
            const images =
              block.type === "image"
                ? [block]
                : block.type === "gallery"
                  ? block.images
                  : [];
            for (const image of images) {
              expect(image.width).toBeGreaterThan(0);
              expect(image.height).toBeGreaterThan(0);
              const measured = readPublicLearningImageSize(image.src);
              expect(measured).toEqual({ width: image.width, height: image.height });
              if (seen.has(image.src)) continue;
              seen.add(image.src);
              const oriented = await sharp(path.join(ROOT, "public", image.src.slice(1)))
                .rotate()
                .metadata();
              expect(image.width).toBe(oriented.width);
              expect(image.height).toBe(oriented.height);
            }
          }
        }
      }
    }
    expect(seen.size).toBeGreaterThan(300);
  });
});

describe("Programs image curriculum, first pass", () => {
  it("keeps 37 mini-programs and 336 steps", () => {
    const collections = listLearningCollections();
    const programs = collections.flatMap((collection) => collection.miniPrograms);
    expect(programs).toHaveLength(37);
    expect(
      programs.reduce((count, program) => {
        return count + (getLearningMiniProgram(program.id)?.steps.length ?? 0);
      }, 0)
    ).toBe(336);
  });

  it("turns the six approved related sets into galleries and leaves the rival sequence separate", () => {
    const characters = step("dd_mp_05", "dd_mp_05_st_008").blocks.find(
      (block) => block.type === "gallery"
    );
    expect(characters && characters.type === "gallery" ? characters.images.map((image) => image.src) : []).toEqual(
      Array.from({ length: 12 }, (_, index) => {
        const number = String(index + 3).padStart(2, "0");
        return `/learning/definite-dozen/dd_mp_05_st_008_image_${number}.png`;
      })
    );
    expect(imageSrcs("dd_mp_05", "dd_mp_05_st_008")).toEqual([
      "/learning/definite-dozen/dd_mp_05_st_008_image_02.jpg",
      "/learning/definite-dozen/dd_mp_05_st_008_image_15.jpg",
      "/learning/definite-dozen/dd_mp_05_st_008_image_16.jpg",
      "/learning/definite-dozen/dd_mp_05_st_008_image_17.jpg",
      "/learning/definite-dozen/dd_mp_05_st_008_image_18.jpg",
      "/learning/definite-dozen/dd_mp_05_st_008_image_19.jpg",
      "/learning/definite-dozen/dd_mp_05_st_008_image_20.jpg",
      "/learning/definite-dozen/dd_mp_05_st_008_image_21.jpg",
    ]);

    const goals = step("dd_mp_06", "dd_mp_06_st_008").blocks.find((block) => block.type === "gallery");
    expect(goals && goals.type === "gallery" ? goals.images.map((image) => path.basename(image.src)) : []).toEqual([
      "dd_mp_06_st_008_image_03.jpg",
      "dd_mp_06_st_008_image_04.jpg",
      "dd_mp_06_st_008_image_05.jpg",
      "dd_mp_06_st_008_image_06.jpg",
    ]);
    expect(imageSrcs("dd_mp_06", "dd_mp_06_st_008")).toEqual([
      "/learning/definite-dozen/dd_mp_06_st_008_image_02.jpg",
      "/learning/definite-dozen/dd_mp_06_st_008_image_07.jpg",
      "/learning/definite-dozen/dd_mp_06_st_008_image_08.jpg",
    ]);

    const team = step("dd_mp_08", "dd_mp_08_st_008").blocks.find((block) => block.type === "gallery");
    expect(team && team.type === "gallery" ? team.images.map((image) => path.basename(image.src)) : []).toEqual([
      "dd_mp_08_st_008_image_03.jpg",
      "dd_mp_08_st_008_image_04.jpg",
    ]);
    expect(imageSrcs("dd_mp_08", "dd_mp_08_st_008")).toContain(
      "/learning/definite-dozen/dd_mp_08_st_008_image_02.jpg"
    );

    const competitor = step("dd_mp_11", "dd_mp_11_st_003");
    const pair = competitor.blocks.find((block) => block.type === "gallery");
    expect(pair && pair.type === "gallery" ? pair.images.map((image) => path.basename(image.src)) : []).toEqual([
      "dd_mp_11_st_003_image_02.jpg",
      "dd_mp_11_st_003_image_03.jpg",
    ]);
    expect(imageSrcs("dd_mp_11", "dd_mp_11_st_003")).toEqual([
      "/learning/definite-dozen/dd_mp_11_st_003_image_04.jpg",
      "/learning/definite-dozen/dd_mp_11_st_003_image_05.jpg",
      "/learning/definite-dozen/dd_mp_11_st_003_image_06.jpg",
      "/learning/definite-dozen/dd_mp_11_st_003_image_07.jpg",
      "/learning/definite-dozen/dd_mp_11_st_003_image_08.jpg",
    ]);
    expect(competitor.blocks.some((block) => block.type === "process")).toBe(true);
    expect(competitor.blocks.some((block) => block.type === "reflection")).toBe(true);

    const extroverts = step("potl_mp_08", "potl_mp_08_st_003");
    const introvertPair = extroverts.blocks.find((block) => block.type === "gallery");
    expect(
      introvertPair && introvertPair.type === "gallery"
        ? introvertPair.images.map((image) => image.alt)
        : []
    ).toEqual([
      "Four coworkers cheering while rolling through an office in chairs",
      "A woman working alone at a laptop with headphones on",
    ]);
    expect(extroverts.blocks.some((block) => block.type === "sort")).toBe(true);

    const feelers = step("potl_mp_08", "potl_mp_08_st_004");
    const thinkerPair = feelers.blocks.find((block) => block.type === "gallery");
    expect(
      thinkerPair && thinkerPair.type === "gallery"
        ? thinkerPair.images.map((image) => image.alt)
        : []
    ).toEqual([
      "Two coworkers reviewing charts on computer monitors",
      "Five coworkers gathered around a laptop, smiling",
    ]);
    expect(feelers.blocks.some((block) => block.type === "sort")).toBe(true);
  });

  it("keeps the history gallery as one ordered group of 16", () => {
    const gallery = step("cw_mp_01", "cw_mp_01_st_002").blocks.find((block) => block.type === "gallery");
    if (!gallery || gallery.type !== "gallery") throw new Error("history gallery");
    expect(gallery.images).toHaveLength(16);
    expect(gallery.images.map((image) => image.src)).toEqual(
      Array.from({ length: 16 }, (_, index) => {
        const number = String(index + 1).padStart(2, "0");
        return `/learning/championing-women/cw_mp_01_st_002_image_${number}.jpg`;
      })
    );
  });

  it("removes only the approved source chrome and duplicate copies", () => {
    const banner = "/learning/power-of-team-leader/potl_mp_01_st_002_image_03.png";
    const bannerSteps = [
      ["potl_mp_01", "potl_mp_01_st_002"],
      ["potl_mp_02", "potl_mp_02_st_001"],
      ["potl_mp_03", "potl_mp_03_st_002"],
      ["potl_mp_06", "potl_mp_06_st_001"],
      ["potl_mp_07", "potl_mp_07_st_001"],
      ["potl_mp_08", "potl_mp_08_st_001"],
      ["potl_mp_09", "potl_mp_09_st_001"],
      ["potl_mp_10", "potl_mp_10_st_001"],
      ["potl_mp_11", "potl_mp_11_st_001"],
    ] as const;
    for (const [programId, stepId] of bannerSteps) {
      expect(imageSrcs(programId, stepId)).not.toContain(banner);
    }
    const runtime = listLearningCollections()
      .flatMap((collection) => collection.miniPrograms)
      .map((program) => JSON.stringify(getLearningMiniProgram(program.id)))
      .join("\n");
    expect(runtime).not.toContain(banner);

    const covers = [
      ["potl_mp_02", "potl_mp_02_st_001", "potl_mp_02_st_001_image_07.png"],
      ["potl_mp_03", "potl_mp_03_st_001", "potl_mp_03_st_001_image_02.png"],
      ["potl_mp_04", "potl_mp_04_st_001", "potl_mp_04_st_001_image_02.png"],
      ["potl_mp_05", "potl_mp_05_st_001", "potl_mp_05_st_001_image_02.png"],
      ["potl_mp_06", "potl_mp_06_st_001", "potl_mp_06_st_001_image_03.png"],
      ["potl_mp_07", "potl_mp_07_st_001", "potl_mp_07_st_001_image_04.png"],
      ["potl_mp_08", "potl_mp_08_st_001", "potl_mp_08_st_001_image_06.png"],
      ["potl_mp_09", "potl_mp_09_st_001", "potl_mp_09_st_001_image_03.png"],
      ["potl_mp_10", "potl_mp_10_st_001", "potl_mp_10_st_001_image_03.png"],
      ["potl_mp_11", "potl_mp_11_st_001", "potl_mp_11_st_001_image_03.png"],
      ["potl_mp_12", "potl_mp_12_st_001", "potl_mp_12_st_001_image_02.png"],
    ] as const;
    for (const [programId, stepId, file] of covers) {
      expect(imageSrcs(programId, stepId).some((src) => src.endsWith(file))).toBe(false);
      expect(step(programId, stepId).blocks.some((block) => block.type === "video" || block.type === "markdown" || block.type === "image")).toBe(true);
    }
    expect(JSON.stringify(getLearningMiniProgram("potl_mp_02"))).not.toContain(
      "Rise course cover image shown on the course start screen"
    );

    expect(imageSrcs("cw_mp_04", "cw_mp_04_st_006").filter((src) => src.endsWith("cw_mp_04_st_006_image_01.jpg"))).toEqual([
      "/learning/championing-women/cw_mp_04_st_006_image_01.jpg",
    ]);
    expect(step("cw_mp_04", "cw_mp_04_st_006").blocks.some((block) => block.type === "markdown" && block.markdown.includes("Five leadership-trap markers"))).toBe(true);
    expect(imageSrcs("cw_mp_05", "cw_mp_05_st_002").filter((src) => src.endsWith("cw_mp_05_st_002_image_02.jpg"))).toEqual([
      "/learning/championing-women/cw_mp_05_st_002_image_02.jpg",
    ]);
    expect(step("cw_mp_05", "cw_mp_05_st_002").blocks.some((block) => block.type === "markdown" && block.markdown.includes("Twelve examples of gender microaggressions"))).toBe(true);
  });

  it("leaves medium-confidence and unclear images in place", () => {
    expect(imageSrcs("potl_mp_09", "potl_mp_09_st_004")).toHaveLength(7);
    expect(imageSrcs("potl_mp_11", "potl_mp_11_st_005")).toHaveLength(8);
    expect(imageSrcs("cw_mp_02", "cw_mp_02_st_003")).toHaveLength(4);
    expect(imageSrcs("cw_mp_03", "cw_mp_03_st_002")).toHaveLength(4);
    expect(step("cw_mp_02", "cw_mp_02_st_003").blocks.some((block) => block.type === "gallery")).toBe(false);
    expect(step("cw_mp_03", "cw_mp_03_st_002").blocks.some((block) => block.type === "gallery")).toBe(false);
    expect(imageSrcs("cw_mp_07", "cw_mp_07_st_001")).toHaveLength(2);
    const completion = step("dd_mp_02", "dd_mp_02_st_018").blocks.find((block) => block.type === "image");
    expect(completion && completion.type === "image" ? completion.role : null).toBe("completion");
    expect(imageSrcs("dd_mp_11", "dd_mp_11_st_003")).toContain(
      "/learning/definite-dozen/dd_mp_11_st_003_image_05.jpg"
    );
    expect(imageSrcs("potl_mp_11", "potl_mp_11_st_003")).toContain(
      "/learning/power-of-team-leader/potl_mp_11_st_003_image_01.jpg"
    );
    const svg = readFileSync(
      path.join(ROOT, "public/learning/definite-dozen/dd_mp_05_st_011_image_03.svg"),
      "utf8"
    );
    expect(svg).toContain("Words — 7%");
    expect(svg).toContain("How words are said — 38%");
    expect(svg).toContain("Facial expression / nonverbal — 55%");
    expect(imageSrcs("dd_mp_05", "dd_mp_05_st_011")).toContain(
      "/learning/definite-dozen/dd_mp_05_st_011_image_03.svg"
    );
  });
});
