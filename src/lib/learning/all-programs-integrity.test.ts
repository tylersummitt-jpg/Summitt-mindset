import { existsSync, readFileSync } from "node:fs";
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

const MINDFULNESS_BOILERPLATE =
  "When we show up to the present moment with all of our senses, we invite the world to fill us with joy. The pains of the past are behind us. The future has yet to unfold. But the now is full of beauty simply waiting for our attention.";

describe("all live Programs collections", () => {
  it("registers Definite Dozen, Championing Women, and The Power of Team only", () => {
    const collections = listLearningCollections();
    expect(collections.map((collection) => collection.id)).toEqual([
      "definite_dozen",
      "power_of_team_leader",
      "championing_women",
    ]);
    expect(collections.map((collection) => collection.title)).toEqual([
      "Definite Dozen",
      "The Power of Team",
      "Championing Women in Leadership",
    ]);
    expect(collections[0]?.miniPrograms.map((program) => program.id)).toEqual([
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
    expect(collections[1]?.miniPrograms.map((program) => program.id)).toEqual([
      "potl_mp_01",
      "potl_mp_02",
      "potl_mp_03",
      "potl_mp_04",
      "potl_mp_05",
      "potl_mp_06",
      "potl_mp_07",
      "potl_mp_08",
      "potl_mp_09",
      "potl_mp_10",
      "potl_mp_11",
      "potl_mp_12",
    ]);
    expect(collections[2]?.miniPrograms.map((program) => program.id)).toEqual([
      "cw_mp_01",
      "cw_mp_02",
      "cw_mp_03",
      "cw_mp_04",
      "cw_mp_05",
      "cw_mp_06",
      "cw_mp_07",
      "cw_mp_08",
      "cw_mp_09",
      "cw_mp_10",
      "cw_mp_11",
      "cw_mp_12",
      "cw_mp_13",
    ]);
    expect(collections.flatMap((collection) => collection.miniPrograms)).toHaveLength(37);
    const ids = collections.flatMap((collection) => collection.miniPrograms.map((program) => program.id));
    for (const retired of ["cw_mp_14", "cw_mp_15", "potl_mp_13", "potl_mp_14"]) {
      expect(ids).not.toContain(retired);
    }
    expect(JSON.stringify(collections)).not.toContain("power_of_team_team");
    expect(JSON.stringify(collections)).not.toContain("coming soon");
    expect(JSON.stringify(collections)).not.toContain("Power of Team — Leader Version");
    expect(JSON.stringify(collections)).not.toContain("Power of Team - Leader Version");
  });

  it("keeps curriculum, media, quizzes, reflections, and videos internally consistent", () => {
    const collections = listLearningCollections();
    const reflectionIds = new Set<string>();
    const stepIds = new Set<string>();
    let matchedVideos = 0;
    const stepTotals = { definite_dozen: 0, championing_women: 0, power_of_team_leader: 0 };

    for (const collection of collections) {
      for (const card of collection.miniPrograms) {
        const program = getLearningMiniProgram(card.id);
        const client = getLearningMiniProgramForClient(card.id);
        expect(program, card.id).toBeTruthy();
        expect(client, card.id).toBeTruthy();
        if (!program || !client) continue;
        expect(program.collection_id).toBe(collection.id);
        expect(program.collection_title).toBe(collection.title);
        stepTotals[collection.id as keyof typeof stepTotals] += program.steps.length;
        const entry = learningProgramEntryPath(program.id);
        const slug = entry.split("/").at(-1) ?? "";
        const collectionSlug = entry.split("/")[2] ?? "";
        expect(resolveLearningRoute(collectionSlug, slug)).toBe(program.id);
        expect(JSON.stringify(client)).not.toContain("correct_choice_ids");
        expect(JSON.stringify(client)).not.toContain("correct_category");
        expect(JSON.stringify(client)).not.toContain("data/learning/source");

        expect(program.steps.map((step) => step.sequence)).toEqual(
          program.steps.map((_, index) => index + 1)
        );
        const last = program.steps.at(-1);
        expect(last).toBeTruthy();
        if (last) {
          expect(
            decideContinue(
              { status: "in_progress", current_step_id: last.id },
              program.steps,
              last.id
            )
          ).toEqual({ kind: "complete" });
          expect(
            decideContinue(
              { status: "completed", current_step_id: last.id },
              program.steps,
              last.id
            )
          ).toEqual({ kind: "review-end" });
        }

        for (const step of program.steps) {
          expect(stepIds.has(step.id)).toBe(false);
          stepIds.add(step.id);
          for (const block of step.blocks) {
            if (block.type === "image") {
              expect(block.src.startsWith("/learning/")).toBe(true);
              expect(block.src).not.toContain("data/learning/source");
              expect(existsSync(path.join(ROOT, "public", block.src.slice(1)))).toBe(true);
            }
            if (block.type === "video") {
              matchedVideos += 1;
              expect(block.vimeo_video_id).toMatch(/^\d+$/);
              expect(buildVimeoPlayerEmbedUrl(block.vimeo_video_id)).toBe(
                `https://player.vimeo.com/video/${block.vimeo_video_id}?dnt=1`
              );
              expect(block.visible_title).not.toMatch(/^Lesson \d+:/);
            }
            if (block.type === "quiz") {
              expect(block.minimum_correct).toBeGreaterThanOrEqual(1);
              expect(block.minimum_correct).toBeLessThanOrEqual(block.questions.length);
              for (const question of block.questions) {
                const choiceIds = new Set(question.choices.map((choice) => choice.id));
                expect(question.correct_choice_ids.every((id) => choiceIds.has(id))).toBe(true);
                if (question.question_type === "single_choice") {
                  expect(question.correct_choice_ids).toHaveLength(1);
                }
              }
            }
            if (block.type === "reflection") {
              expect(reflectionIds.has(block.question_id)).toBe(false);
              reflectionIds.add(block.question_id);
              expect(block.prompt.length).toBeGreaterThan(0);
              expect(block.prompt.length).toBeLessThanOrEqual(1000);
            }
            if (block.type === "sort") {
              const categories = new Set(block.categories);
              expect(categories.size).toBeGreaterThanOrEqual(2);
              for (const card of block.cards) {
                expect(categories.has(card.correct_category)).toBe(true);
              }
            }
            if (block.type === "choice_prompt") {
              expect(block.choices.length).toBeGreaterThanOrEqual(2);
            }
            if (block.type === "sections") {
              expect(block.sections.length).toBeGreaterThan(0);
              for (const section of block.sections) {
                expect(section.title.length).toBeGreaterThan(0);
                expect(section.body.length).toBeGreaterThan(0);
              }
            }
          }
        }
      }
    }

    expect(stepTotals).toEqual({
      definite_dozen: 177,
      championing_women: 74,
      power_of_team_leader: 85,
    });
    expect(matchedVideos).toBe(118);
    const messageAcross = getLearningMiniProgram("cw_mp_10")?.steps
      .find((step) => step.id === "cw_mp_10_st_001")
      ?.blocks.find((block) => block.type === "video");
    expect(messageAcross && messageAcross.type === "video" ? messageAcross.vimeo_video_id : null).toBe(
      "1151015774"
    );
    expect(messageAcross && messageAcross.type === "video" ? messageAcross.speaker : null).toBe(
      "Danni Varlan"
    );
    const patCommunication = getLearningMiniProgram("cw_mp_10")?.steps.find(
      (step) => step.id === "cw_mp_10_st_007"
    );
    expect(patCommunication?.blocks.some((block) => block.type === "video")).toBe(false);
    expect(JSON.stringify(patCommunication)).not.toContain("1150877298");
    expect(JSON.stringify(patCommunication)).not.toContain("Michelle Marciniak");
    expect(JSON.stringify(patCommunication)).not.toContain("Remembering Pat");

    const selfTalk = getLearningMiniProgram("cw_mp_07");
    const selfTalkStep = selfTalk?.steps.find((step) => step.id === "cw_mp_07_st_004");
    const nikki = selfTalkStep?.blocks.find((block) => block.type === "video");
    expect(selfTalk?.steps.some((step) => step.id === "cw_mp_07_st_006")).toBe(true);
    expect(nikki && nikki.type === "video" ? nikki.speaker : null).toBe("Nikki Anosike");
    expect(nikki && nikki.type === "video" ? nikki.visible_title : null).toBe(
      "Deep Dive: Self-Talk and Affirmations"
    );
    expect(nikki && nikki.type === "video" ? nikki.vimeo_video_id : null).toBe("1151015040");
    expect(JSON.stringify(selfTalkStep)).not.toContain("Christina Gradillas");
    expect(JSON.stringify(selfTalkStep)).not.toContain("The Three Types of Confidence");
    const selfTalkQuiz = selfTalk?.steps
      .find((step) => step.id === "cw_mp_07_st_005")
      ?.blocks.find((block) => block.type === "quiz");
    expect(
      selfTalkQuiz && selfTalkQuiz.type === "quiz"
        ? selfTalkQuiz.questions.map((question) => question.question_id)
        : []
    ).toEqual(["cw_mp_07_st_005_q01", "cw_mp_07_st_005_q02", "cw_mp_07_st_005_q03"]);

    const fairways = getLearningMiniProgram("potl_mp_07");
    const eyeContact = fairways?.steps.find((step) => step.id === "potl_mp_07_st_005");
    const michelle = eyeContact?.blocks.find((block) => block.type === "video");
    expect(michelle && michelle.type === "video" ? michelle.speaker : null).toBe("Michelle Marciniak");
    expect(michelle && michelle.type === "video" ? michelle.visible_title : null).toBe(
      "The Power of Eye Contact"
    );
    expect(michelle && michelle.type === "video" ? michelle.vimeo_video_id : null).toBe("1150877322");
    expect(JSON.stringify(eyeContact)).not.toContain("Christina Gradillas");
    expect(JSON.stringify(eyeContact)).not.toContain("Tone and Nonverbal Communication");
    expect(fairways?.steps.some((step) => step.id === "potl_mp_07_st_006")).toBe(false);
    expect(fairways?.steps).toHaveLength(7);

    const runtimeText = listLearningCollections()
      .flatMap((collection) => collection.miniPrograms)
      .map((card) => JSON.stringify(getLearningMiniProgram(card.id)))
      .join("\n");
    for (const name of ["Katy Kvalvik", "Christina Reckard", "Patty Hoppenstedt", "Christina Gradillas"]) {
      expect(runtimeText).not.toContain(name);
    }
    expect(runtimeText).not.toContain(MINDFULNESS_BOILERPLATE);
    for (const phrase of [
      "EXIT COURSE",
      "EXIT LESSON",
      "Please remember to close it before opening another course",
      "Please remember to close it before opening another lesson",
      "Refer to your workbook",
      "Click to download the Workbook",
      "final exam",
      "final assessment",
      "certificate",
      "Power of Team — Leader Version",
      "Power of Team - Leader Version",
    ]) {
      expect(runtimeText.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
    const owning = getLearningMiniProgram("cw_mp_08");
    const owningQuiz = owning?.steps
      .find((step) => step.id === "cw_mp_08_st_003")
      ?.blocks.find((block) => block.type === "quiz");
    expect(owning?.steps).toHaveLength(5);
    expect(
      owningQuiz && owningQuiz.type === "quiz"
        ? owningQuiz.questions.map((question) => question.question_id)
        : []
    ).toEqual(["cw_mp_08_st_003_q01", "cw_mp_08_st_003_q02", "cw_mp_08_st_003_q03"]);
    expect(owningQuiz && owningQuiz.type === "quiz" ? owningQuiz.minimum_correct : null).toBe(3);
    const communicate = getLearningMiniProgram("cw_mp_10");
    const fillerQuiz = communicate?.steps
      .find((step) => step.id === "cw_mp_10_st_006")
      ?.blocks.find((block) => block.type === "quiz");
    expect(communicate?.steps).toHaveLength(6);
    expect(
      fillerQuiz && fillerQuiz.type === "quiz"
        ? fillerQuiz.questions.map((question) => question.question_id)
        : []
    ).toEqual(["cw_mp_10_st_006_q01", "cw_mp_10_st_006_q02"]);
    expect(fillerQuiz && fillerQuiz.type === "quiz" ? fillerQuiz.minimum_correct : null).toBe(2);
    expect(JSON.stringify(fillerQuiz)).not.toContain("cw_mp_10_st_006_q03");
    const thriving = getLearningMiniProgram("cw_mp_13");
    const supportQuiz = thriving?.steps
      .find((step) => step.id === "cw_mp_13_st_006")
      ?.blocks.find((block) => block.type === "quiz");
    expect(thriving?.steps).toHaveLength(6);
    expect(
      supportQuiz && supportQuiz.type === "quiz"
        ? supportQuiz.questions.map((question) => question.question_id)
        : []
    ).toEqual(["cw_mp_13_st_006_q03"]);
    expect(supportQuiz && supportQuiz.type === "quiz" ? supportQuiz.minimum_correct : null).toBe(1);
    expect(JSON.stringify(supportQuiz)).not.toContain("cw_mp_13_st_006_q01");
    expect(JSON.stringify(supportQuiz)).not.toContain("cw_mp_13_st_006_q02");
    const playingField = getLearningMiniProgram("cw_mp_01")?.steps.at(-1);
    expect(playingField?.id).toBe("cw_mp_01_st_004");
    expect(JSON.stringify(playingField)).toContain("equal playing field");
    expect(JSON.stringify(playingField)).not.toContain("Over the next few lessons");
    expect(getLearningMiniProgram("potl_mp_01")?.steps.at(-1)?.id).toBe("potl_mp_01_st_007");
    expect(getLearningMiniProgram("potl_mp_01")?.steps.some((step) => step.id === "potl_mp_01_st_006")).toBe(
      false
    );
    const sourceArchive = path.join(
      ROOT,
      "data/learning/source/championing_women/human/cw_mp_10.md"
    );
    expect(readFileSync(sourceArchive, "utf8")).toContain("Christina Gradillas");
    expect(runtimeText).not.toContain("data/learning/source");
    const championing = getLearningMiniProgram("cw_mp_02");
    const womenAtWork = championing?.steps
      .find((step) => step.id === "cw_mp_02_st_001")
      ?.blocks.find((block) => block.type === "video");
    expect(womenAtWork && womenAtWork.type === "video" ? womenAtWork.vimeo_video_id : null).toBe(
      "1151014350"
    );
    expect(getLearningMiniProgram("cw_mp_15")).toBeNull();
    expect(getLearningMiniProgram("potl_mp_14")).toBeNull();
  });
});
