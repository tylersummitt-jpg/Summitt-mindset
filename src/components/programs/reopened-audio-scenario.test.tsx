/** @vitest-environment jsdom */

import { existsSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { getLearningStepForClient } from "@/lib/learning/load-curriculum";
import { ProgramsAudio } from "./programs-structured";
import { StepExperience } from "./step-experience";

vi.mock("@/app/programs/actions", () => ({
  saveLearningReflection: vi.fn(),
  continueLearningStep: vi.fn(),
  gradeLearningStep: vi.fn(),
  checkLearningSortCard: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const AUDIO = [
  ["potl_mp_03", "potl_mp_03_st_002", "/learning/power-of-team-leader/potl_mp_03_st_002_audio.mp3"],
  ["potl_mp_08", "potl_mp_08_st_007", "/learning/power-of-team-leader/potl_mp_08_st_007_audio.mp3"],
  ["potl_mp_10", "potl_mp_10_st_003", "/learning/power-of-team-leader/potl_mp_10_st_003_audio.mp3"],
  ["cw_mp_03", "cw_mp_03_st_006", "/learning/championing-women/cw_mp_03_st_006_audio.mp3"],
] as const;

describe("reopened audio and scenario findings", () => {
  it("emits a static mpeg source and ignores play and pause", () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    HTMLMediaElement.prototype.play = play;
    HTMLMediaElement.prototype.pause = pause;
    const { container } = render(
      <ProgramsAudio
        src="/learning/power-of-team-leader/potl_mp_03_st_002_audio.mp3"
        label="Pat Summitt on ownership"
        transcript="A sense of ownership is the most powerful weapon a team or organization can have."
      />
    );
    const audio = container.querySelector("audio");
    const source = container.querySelector("source");
    expect(audio?.hasAttribute("controls")).toBe(true);
    expect(audio?.getAttribute("preload")).toBe("none");
    expect(source?.getAttribute("type")).toBe("audio/mpeg");
    expect(source?.getAttribute("src")).toBe(
      "/learning/power-of-team-leader/potl_mp_03_st_002_audio.mp3"
    );
    expect(() => {
      audio?.dispatchEvent(new Event("play"));
      audio?.dispatchEvent(new Event("pause"));
      void audio?.play();
      audio?.pause();
    }).not.toThrow();
    expect(container.textContent).toContain("most powerful weapon");
  });

  it("points every restored clip at a static public mp3", () => {
    const root = path.resolve(__dirname, "../../..");
    for (const [programId, stepId, src] of AUDIO) {
      const step = getLearningStepForClient(programId, stepId);
      const audio = step?.blocks.find((block) => block.type === "audio");
      expect(audio && audio.type === "audio" ? audio.src : "").toBe(src);
      expect(src.startsWith("/learning/")).toBe(true);
      expect(src.includes("/api/")).toBe(false);
      expect(existsSync(path.join(root, "public", src.slice(1)))).toBe(true);
    }
  });

  it("switches Lei, Allison, and Felicia without leaving a static copy", async () => {
    const user = userEvent.setup();
    const step = getLearningStepForClient("cw_mp_04", "cw_mp_04_st_004");
    if (!step) throw new Error("missing scenario");
    const scenario = step.blocks.find((block) => block.type === "choice_prompt");
    expect(scenario && scenario.type === "choice_prompt" ? scenario.choices.map((choice) => choice.label) : []).toEqual([
      "Lei",
      "Allison",
      "Felicia",
    ]);
    expect(step.blocks.some((block) => block.type === "heading" && block.text.includes("Scenario"))).toBe(
      false
    );
    render(
      <StepExperience
        miniProgramId="cw_mp_04"
        collectionTitle="Championing Women"
        step={step}
        stepCount={8}
        previousHref={null}
        initialAnswers={{}}
        enforceRequirements={false}
        isLastStep={false}
      />
    );
    expect(screen.getAllByText(/sparrow in a hen house/)).toHaveLength(1);
    expect(screen.queryByText(/secretly dreams of going into real estate/)).toBeNull();
    screen.getByRole("tab", { name: "Lei" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Allison" }).getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Felicia" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("img", { name: "Felicia" })).toBeTruthy();
    expect(screen.getByText(/become a freelancer/)).toBeTruthy();
    expect(screen.queryByText(/sparrow in a hen house/)).toBeNull();
  });
});
