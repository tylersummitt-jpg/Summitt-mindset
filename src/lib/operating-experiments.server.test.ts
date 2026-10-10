import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const db = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
  row: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from() {
      let operation: "select" | "update" | "insert" = "select";
      const query = {
        select() {
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        eq() {
          return query;
        },
        in() {
          return query;
        },
        update(payload: Record<string, unknown>) {
          operation = "update";
          db.updates.push(payload);
          return query;
        },
        insert(payload: Record<string, unknown>) {
          operation = "insert";
          db.inserts.push(payload);
          return query;
        },
        maybeSingle() {
          if (operation === "select") return Promise.resolve({ data: db.row, error: null });
          return Promise.resolve({ data: { id: "exp-1" }, error: null });
        },
        then(
          resolve: (value: { data: { id: string } | null; error: null }) => unknown
        ) {
          return Promise.resolve(resolve({ data: null, error: null }));
        },
      };
      return query;
    },
  },
}));

import { parseExperimentDefinition } from "@/lib/operating-experiments";
import {
  addExperimentAmendment,
  applyStoredExperimentChange,
  updatePlannedExperiment,
} from "@/lib/operating-experiments.server";

const definition = parseExperimentDefinition({
  name: "Homepage paid conversion",
  area: "distribution",
  hypothesis: "A shorter homepage increases eventual paid conversion.",
  control: "Current homepage",
  challenger: "Shorter homepage",
  primaryOutcome: "Eventual paid conversion",
  decisionCriteria: "Decide only after enough paid outcomes.",
});

function storedRow(status: string) {
  return {
    id: "exp-1",
    name: definition.name,
    area: definition.area,
    hypothesis: definition.hypothesis,
    control_description: definition.control,
    challenger_description: definition.challenger,
    primary_outcome: definition.primaryOutcome,
    decision_criteria: definition.decisionCriteria,
    secondary_outcomes: null,
    start_on: status === "planned" ? null : "2026-10-01",
    end_on: null,
    decision_on: null,
    status,
    evidence: "not_yet_tested",
    conclusion: null,
    next_action: null,
    limitations: null,
  };
}

describe("stored experiment changes", () => {
  beforeEach(() => {
    db.updates.length = 0;
    db.inserts.length = 0;
    db.row = storedRow("planned");
  });

  it("starts an experiment without writing its definition", async () => {
    const result = await applyStoredExperimentChange({
      id: "exp-1",
      actor: "user_tyler",
      today: "2026-10-10",
      change: { type: "start" },
    });
    expect(result).toEqual({ ok: true });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).not.toHaveProperty("hypothesis");
    expect(db.updates[0]).not.toHaveProperty("primary_outcome");
    expect(db.updates[0]).not.toHaveProperty("control_description");
    expect(db.updates[0]?.status).toBe("running");
    expect(db.updates[0]?.evidence).toBe("not_yet_tested");
  });

  it("does not silently rewrite a running definition", async () => {
    db.row = storedRow("running");
    const result = await updatePlannedExperiment("exp-1", {
      ...definition,
      hypothesis: "A silent rewrite.",
    }, "user_tyler");
    expect(result.ok).toBe(false);
    expect(db.updates).toHaveLength(0);
  });

  it("finishes with the evidence a person chose", async () => {
    db.row = storedRow("running");
    const result = await applyStoredExperimentChange({
      id: "exp-1",
      actor: "user_tyler",
      today: "2026-10-10",
      change: {
        type: "finish",
        evidence: "directional",
        conclusion: "The difference is only directional.",
        nextAction: "Keep the current homepage.",
        limitations: "The paid cohort is small.",
      },
    });
    expect(result).toEqual({ ok: true });
    expect(db.updates[0]?.status).toBe("completed");
    expect(db.updates[0]?.evidence).toBe("directional");
    expect(db.updates[0]).not.toHaveProperty("hypothesis");
  });

  it("refuses to finish before any evidence is chosen", async () => {
    db.row = storedRow("running");
    const result = await applyStoredExperimentChange({
      id: "exp-1",
      actor: "user_tyler",
      today: "2026-10-10",
      change: {
        type: "finish",
        evidence: "not_yet_tested",
        conclusion: "Calling this done anyway.",
        nextAction: "Ship it.",
        limitations: "",
      },
    });
    expect(result.ok).toBe(false);
    expect(db.updates).toHaveLength(0);
  });

  it("records an amendment without changing the experiment definition", async () => {
    db.row = storedRow("running");
    const result = await addExperimentAmendment(
      "exp-1",
      "The challenger copy was clarified after launch.",
      "user_tyler"
    );
    expect(result).toEqual({ ok: true });
    expect(db.updates).toHaveLength(0);
    expect(db.inserts[0]).toMatchObject({
      experiment_id: "exp-1",
      note: "The challenger copy was clarified after launch.",
      created_by: "user_tyler",
    });
    expect(db.inserts[0]).not.toHaveProperty("hypothesis");
  });
});
