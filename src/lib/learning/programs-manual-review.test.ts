import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { programsBody, programsInstructionHeading } from "@/components/programs/programs-visual";
import { utBody } from "@/components/utility-page-visual";
import { getLearningMiniProgram, listLearningCollections } from "./load-curriculum";

function program(id: string) {
  const found = getLearningMiniProgram(id);
  if (!found) throw new Error(id);
  return found;
}

function step(id: string, stepId: string) {
  const found = program(id).steps.find((candidate) => candidate.id === stepId);
  if (!found) throw new Error(stepId);
  return found;
}

describe("approved Programs review changes", () => {
  it("keeps the runtime at 37 programs and 336 steps", () => {
    const programs = listLearningCollections().flatMap((collection) => collection.miniPrograms);
    expect(programs).toHaveLength(37);
    expect(programs.reduce((count, card) => count + (getLearningMiniProgram(card.id)?.steps.length ?? 0), 0)).toBe(
      336
    );
  });

  it("updates the catalog descriptions Tyler named", () => {
    expect(program("dd_mp_04").description.endsWith("to our system. - Pat Summitt")).toBe(true);
    expect(program("dd_mp_11").description).toBe(
      "We keep score in life because it matters. It counts. Too many people opt out and never discover their own abilities, because they fear failure. They don't understand commitment. When you learn to keep fighting in the face of potential failure, it gives you a larger skill set to do what you want to do in life. It gives you vision. But you can't acquire it if you're afraid of keeping score."
    );
    expect(program("potl_mp_01").description.startsWith("Going it solo")).toBe(true);
    expect(program("potl_mp_02").description).toContain("Pat said");
    expect(program("potl_mp_02").description).not.toContain("admonished");
    expect(program("potl_mp_03").description).toBe(
      "“A sense of ownership is the most powerful weapon a team or organization can have.” - Pat Summitt"
    );
    expect(program("potl_mp_05").description).toBe("“Who are you? What do you stand for? - Pat Summitt”");
    expect(program("potl_mp_06").description.startsWith("“You can have the brightest")).toBe(true);
    expect(program("potl_mp_06").description.endsWith("- Pat Summitt")).toBe(true);
    expect(program("potl_mp_07").description.startsWith("“I wouldn’t speak")).toBe(true);
    expect(program("potl_mp_09").description.startsWith("“How many of us")).toBe(true);
    expect(program("potl_mp_10").description.startsWith("“Loyalty is a selfless proposition")).toBe(true);
    expect(program("potl_mp_11").description).toContain("The absolute heart of loyalty");
    expect(program("potl_mp_11").description).not.toContain("self-less");
    expect(program("potl_mp_12").description).toContain("temporary authority that others grant you");
    expect(JSON.stringify(step("potl_mp_12", "potl_mp_12_st_003"))).toContain(
      "When it comes to loyalty, which is a part of principle #1"
    );
  });

  it("renames the Championing Women programs and trims the roadblocks opening", () => {
    expect(program("cw_mp_07").title).toBe("Climbing With Confidence As A Woman In Leadership");
    expect(program("cw_mp_08").title).toBe("How Women Leaders Can Own Their Game");
    expect(program("cw_mp_09").title).toBe("Women Who Are In It For The Long Haul");
    expect(program("cw_mp_10").title).toBe("How to Communicate As A Woman In Leadership");
    expect(program("cw_mp_11").title).toBe("Powerful Conversations from Female Leaders");
    expect(program("cw_mp_13").title).toBe("Women Thriving Together");
    expect(program("cw_mp_04").description.startsWith("Let’s take a look")).toBe(true);
    expect(program("cw_mp_04").description).not.toContain("overall obstacles");
    const roadblocks = JSON.stringify(step("cw_mp_04", "cw_mp_04_st_001"));
    expect(roadblocks).toContain("Let’s take a look at specific obstacles");
    expect(roadblocks).not.toContain("overall obstacles");
  });

  it("keeps the named lesson edits and the teaching around them", () => {
    const approaches = step("dd_mp_02", "dd_mp_02_st_011").blocks.find(
      (block) => block.type === "heading" && block.text.startsWith("Which of these 3")
    );
    expect(approaches).toMatchObject({ role: "instruction", level: 2 });

    const responsibility = JSON.stringify(step("dd_mp_03", "dd_mp_03_st_011"));
    expect(responsibility).toContain("DO MORE.\\n\\n— Pat Summitt");
    expect(responsibility).toContain("Give away power and responsibilities to the team.");
    expect(responsibility).toContain("Model behaviors that are different from their requirements.");
    expect(responsibility).toContain("leaders need to give away power");

    const loyalty = JSON.stringify(step("dd_mp_04", "dd_mp_04_st_001"));
    expect(loyalty).toContain("— Pat Summitt");
    expect(loyalty).toContain("1150854785");
    const intelligence = step("dd_mp_04", "dd_mp_04_st_008");
    expect(JSON.stringify(intelligence)).not.toContain("The keys to developing emotional intelligence are");
    expect(intelligence.blocks.some((block) => block.type === "process")).toBe(true);

    const communicator = step("dd_mp_05", "dd_mp_05_st_001");
    expect(JSON.stringify(communicator)).toContain("— Pat Summitt");
    expect(JSON.stringify(communicator)).not.toContain("Based on the images");
    expect(communicator.blocks.some((block) => block.type === "sections")).toBe(true);
    const introduction = step("dd_mp_05", "dd_mp_05_st_003");
    expect(JSON.stringify(introduction)).not.toContain("image_04.jpg");
    expect(introduction.blocks.some((block) => block.type === "video")).toBe(true);
    expect(JSON.stringify(step("dd_mp_05", "dd_mp_05_st_006"))).not.toContain("Authenticity comparison");
    expect(JSON.stringify(step("dd_mp_05", "dd_mp_05_st_008"))).not.toContain("image_03.png");
    expect(JSON.stringify(step("dd_mp_05", "dd_mp_05_st_008"))).toContain("Why invest in developing good relationships?");
    const nonverbals = JSON.stringify(step("dd_mp_05", "dd_mp_05_st_011"));
    expect(nonverbals).not.toContain("Albert Mehrabian");
    expect(nonverbals).toContain("dd_mp_05_st_011_image_03.svg");
    expect(nonverbals).toContain("To help better break this down");
    const wrap = step("dd_mp_05", "dd_mp_05_st_013");
    expect(wrap.blocks.some((block) => block.type === "image")).toBe(false);
    expect(wrap.blocks.some((block) => block.type === "video")).toBe(true);
    const faces = step("dd_mp_05", "dd_mp_05_st_015");
    expect(faces.blocks.filter((block) => block.type === "image")).toEqual([
      expect.objectContaining({ role: "completion" }),
    ]);

    const discipline = step("dd_mp_06", "dd_mp_06_st_001");
    const disciplineQuote = discipline.blocks.find((block) => block.type === "callout");
    expect(disciplineQuote).toMatchObject({
      text: "You’ve got to have it in your heart. You've got to be invested.\n\n— Pat Summitt",
    });
    expect(JSON.stringify(discipline)).toContain("outstanding work ethic");
    expect(discipline.blocks.some((block) => block.type === "video")).toBe(true);
    const subject = JSON.stringify(step("dd_mp_06", "dd_mp_06_st_003"));
    expect(subject).not.toContain("bite my lip");
    expect(subject).toContain("1150856471");
    expect(subject).toContain("dd_mp_06_st_003_q01");
  });

  it("enlarges Programs body copy without changing the shared website body or painting paragraphs orange", () => {
    expect(programsBody).toContain("text-base");
    expect(programsBody).toContain("sm:text-lg");
    expect(programsBody).not.toContain("brand");
    expect(utBody).toBe("text-sm leading-relaxed text-stone-300 sm:text-base");
    expect(programsInstructionHeading).toContain("text-[var(--brand)]");
    const film = readFileSync("src/app/film-room/page.tsx", "utf8");
    const prose = readFileSync("src/components/programs/programs-prose.tsx", "utf8");
    expect(film).toContain("utBody");
    expect(film).not.toContain("programsBody");
    expect(prose).toContain("programsBody");
    expect(prose).not.toContain("utBody");
  });
});
