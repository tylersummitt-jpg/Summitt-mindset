import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createPlannedExperiment,
  editPlannedExperiment,
  EXPERIMENT_NO_AUTOMATIC_WINNER,
  finishExperiment,
  formatExperimentReport,
  NO_CONTROLLED_EXPERIMENTS,
  parseExperimentDefinition,
  pauseExperiment,
  recordExperimentResult,
  resumeExperiment,
  startExperiment,
  statusWritePayload,
  type ExperimentDefinition,
} from "@/lib/operating-experiments";

const definition: ExperimentDefinition = parseExperimentDefinition({
  name: "Homepage paid conversion",
  area: "distribution",
  hypothesis: "A shorter homepage increases eventual paid conversion.",
  control: "Current homepage",
  challenger: "Shorter homepage",
  primaryOutcome: "Eventual paid conversion",
  decisionCriteria: "Decide only after enough paid outcomes, not from clicks.",
  secondaryOutcomes: "Checkout starts",
});

describe("experiment registry rules", () => {
  it("starts a plan without declaring evidence or changing the definition", () => {
    const planned = createPlannedExperiment("exp-1", definition);
    const running = startExperiment(planned, "2026-10-10");
    expect(running.status).toBe("running");
    expect(running.evidence).toBe("not_yet_tested");
    expect(running.hypothesis).toBe(definition.hypothesis);
    expect(running.primaryOutcome).toBe(definition.primaryOutcome);
    expect(running.control).toBe(definition.control);
    expect(running.challenger).toBe(definition.challenger);
    expect(running.startOn).toBe("2026-10-10");
    const payload = statusWritePayload(running);
    for (const key of [
      "hypothesis",
      "control_description",
      "challenger_description",
      "primary_outcome",
      "decision_criteria",
      "name",
      "area",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("edits a planned experiment and refuses to rewrite a running one", () => {
    const planned = createPlannedExperiment("exp-1", definition);
    const edited = editPlannedExperiment(planned, {
      ...definition,
      hypothesis: "A revised homepage hypothesis.",
    });
    expect(edited.hypothesis).toBe("A revised homepage hypothesis.");
    const running = startExperiment(planned, "2026-10-10");
    expect(() =>
      editPlannedExperiment(running, {
        ...definition,
        hypothesis: "A silent rewrite.",
      })
    ).toThrow(/amendment/i);
  });

  it("pauses, resumes, records, and finishes without inventing a winner", () => {
    let experiment = startExperiment(
      createPlannedExperiment("exp-1", definition),
      "2026-10-01"
    );
    experiment = pauseExperiment(experiment);
    expect(experiment.status).toBe("paused");
    experiment = resumeExperiment(experiment);
    expect(experiment.status).toBe("running");
    expect(() =>
      recordExperimentResult(experiment, {
        evidence: "not_yet_tested",
        conclusion: "Too early.",
        nextAction: "Wait.",
      })
    ).toThrow(/evidence/i);
    experiment = recordExperimentResult(experiment, {
      evidence: "not_enough_mature_data",
      conclusion: "Paid outcomes have not matured.",
      nextAction: "Keep waiting.",
      limitations: "The cohort is young.",
    });
    expect(experiment.hypothesis).toBe(definition.hypothesis);
    expect(experiment.evidence).toBe("not_enough_mature_data");
    experiment = finishExperiment(experiment, {
      today: "2026-10-10",
      evidence: "directional",
      conclusion: "The difference is only directional.",
      nextAction: "Keep the current homepage.",
      limitations: "Not enough paid outcomes.",
    });
    expect(experiment.status).toBe("completed");
    expect(experiment.evidence).toBe("directional");
    expect(experiment.decisionOn).toBe("2026-10-10");
    expect(experiment.hypothesis).toBe(definition.hypothesis);
    expect(experiment.primaryOutcome).toBe(definition.primaryOutcome);
    const report = formatExperimentReport({
      available: true,
      records: [experiment],
    }).join("\n");
    expect(report).toContain(EXPERIMENT_NO_AUTOMATIC_WINNER);
    expect(report).toContain("Directional");
    expect(report).not.toContain("Proven");
    expect(report).not.toMatch(/\bwon\b/i);
  });

  it("keeps an empty registry honest", () => {
    const report = formatExperimentReport({ available: true, records: [] }).join("\n");
    expect(report).toContain(NO_CONTROLLED_EXPERIMENTS);
    expect(report).toContain("Running: none.");
    expect(report).toContain("Planned: none.");
    expect(report).toContain("Recently completed: none.");
    const unread = formatExperimentReport({ available: false, records: [] }).join("\n");
    expect(unread).not.toContain(NO_CONTROLLED_EXPERIMENTS);
    expect(unread).toContain("could not be read");
  });

  it("keeps experiment history by withholding delete access", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20261010200000_operating_experiments.sql"),
      "utf8"
    );
    expect(sql).toContain("ON DELETE RESTRICT");
    expect(sql).not.toContain("ON DELETE CASCADE");
    expect(sql).toContain(
      "GRANT SELECT, INSERT, UPDATE ON TABLE public.operating_experiments TO service_role;"
    );
    expect(sql).toContain(
      "GRANT SELECT, INSERT, UPDATE ON TABLE public.operating_experiment_amendments TO service_role;"
    );
    expect(sql).not.toContain("GRANT SELECT, INSERT, UPDATE, DELETE");
  });
});
