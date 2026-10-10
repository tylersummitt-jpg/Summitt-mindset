import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import {
  EXPERIMENT_EVIDENCE,
  EXPERIMENT_STATUSES,
  editPlannedExperiment,
  finishExperiment,
  parseExperimentDefinition,
  pauseExperiment,
  plannedWritePayload,
  recordExperimentResult,
  resumeExperiment,
  startExperiment,
  statusWritePayload,
  type ExperimentDefinition,
  type ExperimentRecord,
  type ExperimentRegistry,
} from "@/lib/operating-experiments";

type ExperimentRow = {
  id: string;
  name: string;
  area: string;
  hypothesis: string;
  control_description: string;
  challenger_description: string;
  primary_outcome: string;
  decision_criteria: string;
  secondary_outcomes: string | null;
  start_on: string | null;
  end_on: string | null;
  decision_on: string | null;
  status: string;
  evidence: string;
  conclusion: string | null;
  next_action: string | null;
  limitations: string | null;
};

type AmendmentRow = {
  id: string;
  experiment_id: string;
  note: string;
  created_at: string;
};

export type ExperimentSaveResult = { ok: true } | { ok: false; error: string };

function saveError(error: { message: string } | null): string | null {
  if (!error) return null;
  console.warn("[operating-experiments] save failed", { reason: error.message });
  if (error.message.includes("operating_experiment_definition_locked")) {
    return "This experiment has left the plan. Record an amendment instead of rewriting the hypothesis, variants, or primary outcome.";
  }
  if (error.message.includes("operating_experiment_completed_locked")) {
    return "This experiment is finished. Add an amendment instead of changing the recorded decision.";
  }
  if (error.message.includes("operating_experiment_decision_incomplete")) {
    return "Finishing needs evidence, a conclusion, a next action, and a decision date.";
  }
  if (error.message.includes("operating_experiment_invalid_transition")) {
    return "That status change is not allowed.";
  }
  return "The experiment registry could not be saved.";
}

function mapRecord(row: ExperimentRow, amendments: AmendmentRow[]): ExperimentRecord {
  if (!(EXPERIMENT_STATUSES as readonly string[]).includes(row.status)) {
    throw new Error("unexpected experiment status");
  }
  if (!(EXPERIMENT_EVIDENCE as readonly string[]).includes(row.evidence)) {
    throw new Error("unexpected experiment evidence");
  }
  const definition = parseExperimentDefinition({
    name: row.name,
    area: row.area,
    hypothesis: row.hypothesis,
    control: row.control_description,
    challenger: row.challenger_description,
    primaryOutcome: row.primary_outcome,
    decisionCriteria: row.decision_criteria,
    secondaryOutcomes: row.secondary_outcomes,
  });
  return {
    id: row.id,
    ...definition,
    startOn: row.start_on,
    endOn: row.end_on,
    decisionOn: row.decision_on,
    status: row.status as ExperimentRecord["status"],
    evidence: row.evidence as ExperimentRecord["evidence"],
    conclusion: row.conclusion,
    nextAction: row.next_action,
    limitations: row.limitations,
    amendments: amendments
      .filter((amendment) => amendment.experiment_id === row.id)
      .map((amendment) => ({
        id: amendment.id,
        note: amendment.note,
        createdAt: amendment.created_at,
      })),
  };
}

export async function loadExperimentRegistry(): Promise<ExperimentRegistry> {
  const experiments = await supabaseServer
    .from("operating_experiments")
    .select(
      "id, name, area, hypothesis, control_description, challenger_description, primary_outcome, decision_criteria, secondary_outcomes, start_on, end_on, decision_on, status, evidence, conclusion, next_action, limitations, updated_at"
    )
    .order("updated_at", { ascending: false })
    .limit(200);

  if (experiments.error) {
    console.warn("[operating-experiments] registry read failed", {
      reason: experiments.error.message,
    });
    return { available: false, records: [] };
  }

  const rows = (experiments.data ?? []) as ExperimentRow[];
  const ids = rows.map((row) => row.id);
  let amendments: AmendmentRow[] = [];
  if (ids.length > 0) {
    const amendmentResult = await supabaseServer
      .from("operating_experiment_amendments")
      .select("id, experiment_id, note, created_at")
      .in("experiment_id", ids)
      .order("created_at", { ascending: true });
    if (amendmentResult.error) {
      console.warn("[operating-experiments] amendment read failed", {
        reason: amendmentResult.error.message,
      });
      return { available: false, records: [] };
    }
    amendments = (amendmentResult.data ?? []) as AmendmentRow[];
  }

  try {
    return {
      available: true,
      records: rows.map((row) => mapRecord(row, amendments)),
    };
  } catch (err) {
    console.warn("[operating-experiments] registry row was unreadable", {
      reason: err instanceof Error ? err.message : "unreadable_row",
    });
    return { available: false, records: [] };
  }
}

async function loadOne(id: string): Promise<ExperimentRecord | null | "unavailable"> {
  const result = await supabaseServer
    .from("operating_experiments")
    .select(
      "id, name, area, hypothesis, control_description, challenger_description, primary_outcome, decision_criteria, secondary_outcomes, start_on, end_on, decision_on, status, evidence, conclusion, next_action, limitations, updated_at"
    )
    .eq("id", id)
    .maybeSingle();
  if (result.error) {
    console.warn("[operating-experiments] experiment read failed", {
      reason: result.error.message,
    });
    return "unavailable";
  }
  if (!result.data) return null;
  try {
    return mapRecord(result.data as ExperimentRow, []);
  } catch (err) {
    console.warn("[operating-experiments] experiment row was unreadable", {
      reason: err instanceof Error ? err.message : "unreadable_row",
    });
    return "unavailable";
  }
}

export async function insertPlannedExperiment(
  definition: ExperimentDefinition,
  actor: string
): Promise<ExperimentSaveResult> {
  const { error } = await supabaseServer.from("operating_experiments").insert({
    ...plannedWritePayload(definition),
    updated_by: actor,
  });
  const message = saveError(error);
  return message ? { ok: false, error: message } : { ok: true };
}

export async function updatePlannedExperiment(
  id: string,
  definition: ExperimentDefinition,
  actor: string
): Promise<ExperimentSaveResult> {
  const current = await loadOne(id);
  if (current === "unavailable") {
    return { ok: false, error: "The experiment registry could not be read." };
  }
  if (!current) return { ok: false, error: "Experiment not found." };
  try {
    editPlannedExperiment(current, definition);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not edit this experiment.",
    };
  }
  const { data, error } = await supabaseServer
    .from("operating_experiments")
    .update({
      ...plannedWritePayload(definition),
      updated_by: actor,
    })
    .eq("id", id)
    .eq("status", "planned")
    .select("id")
    .maybeSingle();
  const message = saveError(error);
  if (message) return { ok: false, error: message };
  if (!data) {
    return {
      ok: false,
      error: "This experiment is no longer planned. Reload it before trying again.",
    };
  }
  return { ok: true };
}

async function writeStatus(
  id: string,
  expected: string[],
  next: ExperimentRecord,
  actor: string
): Promise<ExperimentSaveResult> {
  const { data, error } = await supabaseServer
    .from("operating_experiments")
    .update({
      ...statusWritePayload(next),
      updated_by: actor,
    })
    .eq("id", id)
    .in("status", expected)
    .select("id")
    .maybeSingle();
  const message = saveError(error);
  if (message) return { ok: false, error: message };
  if (!data) {
    return {
      ok: false,
      error: "This experiment changed before the save. Reload and try again.",
    };
  }
  return { ok: true };
}

export async function applyStoredExperimentChange(args: {
  id: string;
  actor: string;
  today: string;
  change:
    | { type: "start" }
    | { type: "pause" }
    | { type: "resume" }
    | {
        type: "record";
        evidence: string;
        conclusion: string;
        nextAction: string;
        limitations: string;
        secondaryOutcomes: string;
        endOn: string;
        decisionOn: string;
      }
    | {
        type: "finish";
        evidence: string;
        conclusion: string;
        nextAction: string;
        limitations: string;
      };
}): Promise<ExperimentSaveResult> {
  const current = await loadOne(args.id);
  if (current === "unavailable") {
    return { ok: false, error: "The experiment registry could not be read." };
  }
  if (!current) return { ok: false, error: "Experiment not found." };

  try {
    if (args.change.type === "start") {
      return writeStatus(
        args.id,
        ["planned"],
        startExperiment(current, args.today),
        args.actor
      );
    }
    if (args.change.type === "pause") {
      return writeStatus(args.id, ["running"], pauseExperiment(current), args.actor);
    }
    if (args.change.type === "resume") {
      return writeStatus(args.id, ["paused"], resumeExperiment(current), args.actor);
    }
    if (args.change.type === "record") {
      return writeStatus(
        args.id,
        ["running", "paused"],
        recordExperimentResult(current, args.change),
        args.actor
      );
    }
    return writeStatus(
      args.id,
      ["running", "paused"],
      finishExperiment(current, { ...args.change, today: args.today }),
      args.actor
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not update this experiment.",
    };
  }
}

export async function addExperimentAmendment(
  id: string,
  note: string,
  actor: string
): Promise<ExperimentSaveResult> {
  const current = await loadOne(id);
  if (current === "unavailable") {
    return { ok: false, error: "The experiment registry could not be read." };
  }
  if (!current) return { ok: false, error: "Experiment not found." };
  if (current.status === "planned") {
    return {
      ok: false,
      error: "Edit the plan directly. An amendment is for an experiment that has already started.",
    };
  }
  const cleaned = note.trim();
  if (!cleaned) return { ok: false, error: "Amendment note is required." };
  if (cleaned.length > 2000) return { ok: false, error: "Amendment note is too long." };

  const { error } = await supabaseServer.from("operating_experiment_amendments").insert({
    experiment_id: id,
    note: cleaned,
    created_by: actor,
  });
  const message = saveError(error);
  return message ? { ok: false, error: message } : { ok: true };
}
