"use server";

import { revalidatePath } from "next/cache";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import {
  addExperimentAmendment,
  applyStoredExperimentChange,
  insertPlannedExperiment,
  updatePlannedExperiment,
} from "@/lib/operating-experiments.server";
import { parseExperimentDefinition } from "@/lib/operating-experiments";
import { getDateKeyInTimezone } from "@/lib/timezone";

function refresh() {
  revalidatePath("/admin/distribution");
  revalidatePath("/admin/retention");
}

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

function invalid(error: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Could not save the experiment.",
  };
}

function definitionFromForm(formData: FormData) {
  return parseExperimentDefinition({
    name: field(formData, "name"),
    area: field(formData, "area"),
    hypothesis: field(formData, "hypothesis"),
    control: field(formData, "control"),
    challenger: field(formData, "challenger"),
    primaryOutcome: field(formData, "primaryOutcome"),
    decisionCriteria: field(formData, "decisionCriteria"),
    secondaryOutcomes: field(formData, "secondaryOutcomes"),
  });
}

export async function createOperatingExperiment(formData: FormData) {
  const { userId } = await requireTylerAdmin();
  try {
    const result = await insertPlannedExperiment(definitionFromForm(formData), userId);
    if (result.ok) refresh();
    return result;
  } catch (err) {
    return invalid(err);
  }
}

export async function editOperatingExperiment(formData: FormData) {
  const { userId } = await requireTylerAdmin();
  try {
    const result = await updatePlannedExperiment(
      field(formData, "id"),
      definitionFromForm(formData),
      userId
    );
    if (result.ok) refresh();
    return result;
  } catch (err) {
    return invalid(err);
  }
}

async function change(formData: FormData, change: Parameters<typeof applyStoredExperimentChange>[0]["change"]) {
  const { userId } = await requireTylerAdmin();
  const result = await applyStoredExperimentChange({
    id: field(formData, "id"),
    actor: userId,
    today: getDateKeyInTimezone(new Date(), "America/New_York"),
    change,
  });
  if (result.ok) refresh();
  return result;
}

export async function startOperatingExperiment(formData: FormData) {
  return change(formData, { type: "start" });
}

export async function pauseOperatingExperiment(formData: FormData) {
  return change(formData, { type: "pause" });
}

export async function resumeOperatingExperiment(formData: FormData) {
  return change(formData, { type: "resume" });
}

export async function recordOperatingExperiment(formData: FormData) {
  const { userId } = await requireTylerAdmin();
  try {
    const result = await applyStoredExperimentChange({
      id: field(formData, "id"),
      actor: userId,
      today: getDateKeyInTimezone(new Date(), "America/New_York"),
      change: {
        type: "record",
        evidence: field(formData, "evidence"),
        conclusion: field(formData, "conclusion"),
        nextAction: field(formData, "nextAction"),
        limitations: field(formData, "limitations"),
        secondaryOutcomes: field(formData, "secondaryOutcomes"),
        endOn: field(formData, "endOn"),
        decisionOn: field(formData, "decisionOn"),
      },
    });
    if (result.ok) refresh();
    return result;
  } catch (err) {
    return invalid(err);
  }
}

export async function finishOperatingExperiment(formData: FormData) {
  const { userId } = await requireTylerAdmin();
  try {
    const result = await applyStoredExperimentChange({
      id: field(formData, "id"),
      actor: userId,
      today: getDateKeyInTimezone(new Date(), "America/New_York"),
      change: {
        type: "finish",
        evidence: field(formData, "evidence"),
        conclusion: field(formData, "conclusion"),
        nextAction: field(formData, "nextAction"),
        limitations: field(formData, "limitations"),
      },
    });
    if (result.ok) refresh();
    return result;
  } catch (err) {
    return invalid(err);
  }
}

export async function amendOperatingExperiment(formData: FormData) {
  const { userId } = await requireTylerAdmin();
  const result = await addExperimentAmendment(
    field(formData, "id"),
    field(formData, "note"),
    userId
  );
  if (result.ok) refresh();
  return result;
}
