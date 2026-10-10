export const NO_CONTROLLED_EXPERIMENTS =
  "No controlled experiments are running yet.";

export const EXPERIMENT_NO_AUTOMATIC_WINNER =
  "A completed experiment is not a win. This registry does not calculate a winner.";

export const EXPERIMENT_AREAS = ["distribution", "retention"] as const;
export const EXPERIMENT_STATUSES = [
  "planned",
  "running",
  "paused",
  "completed",
] as const;
export const EXPERIMENT_EVIDENCE = [
  "not_yet_tested",
  "not_enough_mature_data",
  "directional",
  "proven",
  "disproven",
  "tracking_untrustworthy",
] as const;

export type ExperimentArea = (typeof EXPERIMENT_AREAS)[number];
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];
export type ExperimentEvidence = (typeof EXPERIMENT_EVIDENCE)[number];

export type ExperimentAmendment = {
  id: string;
  note: string;
  createdAt: string;
};

export type ExperimentRecord = {
  id: string;
  name: string;
  area: ExperimentArea;
  hypothesis: string;
  control: string;
  challenger: string;
  primaryOutcome: string;
  decisionCriteria: string;
  secondaryOutcomes: string | null;
  startOn: string | null;
  endOn: string | null;
  decisionOn: string | null;
  status: ExperimentStatus;
  evidence: ExperimentEvidence;
  conclusion: string | null;
  nextAction: string | null;
  limitations: string | null;
  amendments: ExperimentAmendment[];
};

export type ExperimentDefinition = {
  name: string;
  area: ExperimentArea;
  hypothesis: string;
  control: string;
  challenger: string;
  primaryOutcome: string;
  decisionCriteria: string;
  secondaryOutcomes: string | null;
};

export type ExperimentRegistry = {
  available: boolean;
  records: ExperimentRecord[];
};

export const EMPTY_EXPERIMENT_REGISTRY: ExperimentRegistry = {
  available: true,
  records: [],
};

const NAME_MAX = 120;
const SHORT_MAX = 500;
const TEXT_MAX = 2000;

export function experimentEvidenceLabel(evidence: ExperimentEvidence): string {
  switch (evidence) {
    case "not_yet_tested":
      return "Not yet tested";
    case "not_enough_mature_data":
      return "Not enough mature data";
    case "directional":
      return "Directional";
    case "proven":
      return "Proven";
    case "disproven":
      return "Disproven";
    case "tracking_untrustworthy":
      return "Tracking untrustworthy";
  }
}

export function experimentStatusLabel(status: ExperimentStatus): string {
  switch (status) {
    case "planned":
      return "Planned";
    case "running":
      return "Running";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
  }
}

function clean(value: string, max: number, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  if (trimmed.length > max) throw new Error(`${label} is too long.`);
  return trimmed;
}

function optional(value: string | null | undefined, max: number, label: string) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new Error(`${label} is too long.`);
  return trimmed;
}

function optionalDate(value: string | null | undefined, label: string) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error(`${label} must be a date.`);
  }
  return trimmed;
}

export function parseExperimentDefinition(input: {
  name: string;
  area: string;
  hypothesis: string;
  control: string;
  challenger: string;
  primaryOutcome: string;
  decisionCriteria: string;
  secondaryOutcomes?: string | null;
}): ExperimentDefinition {
  if (input.area !== "distribution" && input.area !== "retention") {
    throw new Error("Choose Distribution or Retention.");
  }
  return {
    name: clean(input.name, NAME_MAX, "Name"),
    area: input.area,
    hypothesis: clean(input.hypothesis, TEXT_MAX, "Hypothesis"),
    control: clean(input.control, TEXT_MAX, "Control"),
    challenger: clean(input.challenger, TEXT_MAX, "Challenger"),
    primaryOutcome: clean(input.primaryOutcome, SHORT_MAX, "Primary outcome"),
    decisionCriteria: clean(
      input.decisionCriteria,
      TEXT_MAX,
      "Decision criteria"
    ),
    secondaryOutcomes: optional(
      input.secondaryOutcomes,
      TEXT_MAX,
      "Secondary outcomes"
    ),
  };
}

export function assertEvidence(value: string): ExperimentEvidence {
  if ((EXPERIMENT_EVIDENCE as readonly string[]).includes(value)) {
    return value as ExperimentEvidence;
  }
  throw new Error("Choose an evidence status.");
}

/**
 * Completing or recording a result never infers a winner.
 * Proven is valid only when an admin explicitly selects it.
 */
export function assertRecordedEvidence(value: string): ExperimentEvidence {
  const evidence = assertEvidence(value);
  if (evidence === "not_yet_tested") {
    throw new Error("Choose what the evidence actually shows before recording a result.");
  }
  return evidence;
}

export function definitionLocked(status: ExperimentStatus): boolean {
  return status !== "planned";
}

export function createPlannedExperiment(
  id: string,
  definition: ExperimentDefinition
): ExperimentRecord {
  return {
    id,
    ...definition,
    startOn: null,
    endOn: null,
    decisionOn: null,
    status: "planned",
    evidence: "not_yet_tested",
    conclusion: null,
    nextAction: null,
    limitations: null,
    amendments: [],
  };
}

export function editPlannedExperiment(
  current: ExperimentRecord,
  definition: ExperimentDefinition
): ExperimentRecord {
  if (current.status !== "planned") {
    throw new Error(
      "This experiment is no longer planned. Record an amendment instead of rewriting the hypothesis, variants, or primary outcome."
    );
  }
  return {
    ...current,
    ...definition,
  };
}

export function startExperiment(
  current: ExperimentRecord,
  today: string
): ExperimentRecord {
  if (current.status !== "planned") {
    throw new Error("Only a planned experiment can be started.");
  }
  return {
    ...current,
    status: "running",
    startOn: current.startOn ?? optionalDate(today, "Start date"),
    evidence: current.evidence,
  };
}

export function pauseExperiment(current: ExperimentRecord): ExperimentRecord {
  if (current.status !== "running") {
    throw new Error("Only a running experiment can be paused.");
  }
  return { ...current, status: "paused" };
}

export function resumeExperiment(current: ExperimentRecord): ExperimentRecord {
  if (current.status !== "paused") {
    throw new Error("Only a paused experiment can be resumed.");
  }
  return { ...current, status: "running" };
}

export function recordExperimentResult(
  current: ExperimentRecord,
  input: {
    evidence: string;
    conclusion: string;
    nextAction: string;
    limitations?: string | null;
    secondaryOutcomes?: string | null;
    endOn?: string | null;
    decisionOn?: string | null;
  }
): ExperimentRecord {
  if (current.status !== "running" && current.status !== "paused") {
    throw new Error("Record a result while the experiment is running or paused.");
  }
  return {
    ...current,
    evidence: assertRecordedEvidence(input.evidence),
    conclusion: clean(input.conclusion, TEXT_MAX, "Conclusion"),
    nextAction: clean(input.nextAction, TEXT_MAX, "Next action"),
    limitations: optional(input.limitations, TEXT_MAX, "Limitations"),
    secondaryOutcomes:
      input.secondaryOutcomes === undefined
        ? current.secondaryOutcomes
        : optional(input.secondaryOutcomes, TEXT_MAX, "Secondary outcomes"),
    endOn:
      input.endOn === undefined ? current.endOn : optionalDate(input.endOn, "End date"),
    decisionOn:
      input.decisionOn === undefined
        ? current.decisionOn
        : optionalDate(input.decisionOn, "Decision date"),
    hypothesis: current.hypothesis,
    control: current.control,
    challenger: current.challenger,
    primaryOutcome: current.primaryOutcome,
    decisionCriteria: current.decisionCriteria,
    area: current.area,
    name: current.name,
  };
}

export function finishExperiment(
  current: ExperimentRecord,
  input: {
    today: string;
    evidence: string;
    conclusion: string;
    nextAction: string;
    limitations?: string | null;
  }
): ExperimentRecord {
  if (current.status !== "running" && current.status !== "paused") {
    throw new Error("Finish a running or paused experiment.");
  }
  const today = optionalDate(input.today, "Decision date");
  return {
    ...recordExperimentResult(current, input),
    status: "completed",
    endOn: current.endOn ?? today,
    decisionOn: today,
  };
}

export function measuredOutcomeText(record: ExperimentRecord): string {
  if (!record.conclusion) {
    return "No measured result is stored. This registry does not calculate a winner.";
  }
  return record.conclusion;
}

/** Columns a live experiment may change. The definition is intentionally absent. */
export function statusWritePayload(next: ExperimentRecord) {
  return {
    status: next.status,
    evidence: next.evidence,
    conclusion: next.conclusion,
    next_action: next.nextAction,
    limitations: next.limitations,
    secondary_outcomes: next.secondaryOutcomes,
    start_on: next.startOn,
    end_on: next.endOn,
    decision_on: next.decisionOn,
  };
}

export function plannedWritePayload(definition: ExperimentDefinition) {
  return {
    name: definition.name,
    area: definition.area,
    hypothesis: definition.hypothesis,
    control_description: definition.control,
    challenger_description: definition.challenger,
    primary_outcome: definition.primaryOutcome,
    decision_criteria: definition.decisionCriteria,
    secondary_outcomes: definition.secondaryOutcomes,
    status: "planned" as const,
    evidence: "not_yet_tested" as const,
  };
}

export function recentCompletedExperiments(records: ExperimentRecord[]) {
  return records
    .filter((record) => record.status === "completed")
    .sort((a, b) => (b.decisionOn ?? "").localeCompare(a.decisionOn ?? "") || a.name.localeCompare(b.name))
    .slice(0, 8);
}

function experimentBlock(record: ExperimentRecord): string[] {
  return [
    `- ${record.name} [${record.area}, ${experimentStatusLabel(record.status)}, ${record.id}]`,
    `  Hypothesis: ${record.hypothesis}`,
    `  Control: ${record.control}`,
    `  Challenger: ${record.challenger}`,
    `  Primary outcome: ${record.primaryOutcome}`,
    `  Decision criteria: ${record.decisionCriteria}`,
    `  Secondary outcomes: ${record.secondaryOutcomes ?? "None recorded."}`,
    `  Started: ${record.startOn ?? "Not started."}`,
    `  Ended: ${record.endOn ?? "No end date."}`,
    `  Decision date: ${record.decisionOn ?? "No decision date."}`,
    `  Evidence: ${experimentEvidenceLabel(record.evidence)}`,
    `  Measured outcome: ${measuredOutcomeText(record)}`,
    `  Next: ${record.nextAction ?? "No next action recorded."}`,
    `  Limitations: ${record.limitations ?? "None recorded."}`,
    ...record.amendments.map((amendment) => `  Amendment: ${amendment.note}`),
  ];
}

function groupLines(title: string, records: ExperimentRecord[]): string[] {
  if (records.length === 0) return [`${title}: none.`];
  return [title, ...records.flatMap(experimentBlock)];
}

export function formatExperimentReport(registry: ExperimentRegistry): string[] {
  if (!registry.available) {
    return [
      "The experiment registry could not be read.",
      "Do not treat that as zero experiments.",
      EXPERIMENT_NO_AUTOMATIC_WINNER,
    ];
  }

  const running = registry.records.filter((record) => record.status === "running");
  const planned = registry.records.filter((record) => record.status === "planned");
  const paused = registry.records.filter((record) => record.status === "paused");
  const completed = registry.records.filter((record) => record.status === "completed");
  const recent = recentCompletedExperiments(registry.records);
  const lines = [
    EXPERIMENT_NO_AUTOMATIC_WINNER,
    "Historical marketing changes are not listed as experiments.",
  ];
  if (running.length === 0) lines.push(NO_CONTROLLED_EXPERIMENTS);
  lines.push(
    ...groupLines("Running", running),
    ...groupLines("Paused", paused),
    ...groupLines("Planned", planned),
    ...groupLines("Recently completed", recent)
  );
  if (completed.length > recent.length) {
    lines.push(
      `${completed.length - recent.length} older completed experiments are not in this recent list.`
    );
  }
  return lines;
}

export function experimentDecisionLines(registry: ExperimentRegistry): string[] {
  if (!registry.available) return [];
  return registry.records
    .filter((record) => record.nextAction)
    .map((record) => `${record.name}: ${record.nextAction}`);
}
