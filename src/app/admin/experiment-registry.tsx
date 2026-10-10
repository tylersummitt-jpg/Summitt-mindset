"use client";

import { useState, type ReactNode } from "react";

import {
  amendOperatingExperiment,
  createOperatingExperiment,
  editOperatingExperiment,
  finishOperatingExperiment,
  pauseOperatingExperiment,
  recordOperatingExperiment,
  resumeOperatingExperiment,
  startOperatingExperiment,
} from "@/app/admin/experiment-actions";
import {
  EXPERIMENT_EVIDENCE,
  experimentEvidenceLabel,
  experimentStatusLabel,
  measuredOutcomeText,
  recentCompletedExperiments,
  type ExperimentArea,
  type ExperimentRecord,
} from "@/lib/operating-experiments";

const fieldClass = "mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm";

function TextField({
  label,
  name,
  defaultValue,
  required,
  multiline,
  hint,
  type,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  multiline?: boolean;
  hint?: string;
  type?: string;
}) {
  return (
    <label className="block text-xs text-gray-600">
      {label}
      {hint ? <span className="mt-1 block font-normal text-gray-500">{hint}</span> : null}
      {multiline ? (
        <textarea
          name={name}
          defaultValue={defaultValue ?? ""}
          required={required}
          rows={3}
          className={fieldClass}
        />
      ) : (
        <input
          name={name}
          type={type ?? "text"}
          defaultValue={defaultValue ?? ""}
          required={required}
          className={fieldClass}
        />
      )}
    </label>
  );
}

function EvidenceField({ defaultValue }: { defaultValue?: string }) {
  const choices = EXPERIMENT_EVIDENCE.filter((value) => value !== "not_yet_tested");
  return (
    <label className="block text-xs text-gray-600">
      Evidence
      <select
        name="evidence"
        defaultValue={choices.includes(defaultValue as (typeof choices)[number]) ? defaultValue : ""}
        required
        className={fieldClass}
      >
        <option value="" disabled>
          Choose what the evidence shows
        </option>
        {choices.map((value) => (
          <option key={value} value={value}>
            {experimentEvidenceLabel(value)}
          </option>
        ))}
      </select>
    </label>
  );
}

function SaveForm({
  action,
  submitLabel,
  children,
}: {
  action: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
  submitLabel: string;
  children: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        setPending(true);
        setError(null);
        void action(data)
          .then((result) => {
            if (!result.ok) setError(result.error ?? "Could not save.");
          })
          .catch((err: unknown) => {
            setError(err instanceof Error ? err.message : "Could not save.");
          })
          .finally(() => setPending(false));
      }}
    >
      {children}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-900 disabled:opacity-50"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

function DefinitionFields({
  area,
  record,
}: {
  area: ExperimentArea;
  record?: ExperimentRecord;
}) {
  return (
    <>
      <TextField label="Name" name="name" defaultValue={record?.name} required />
      <label className="block text-xs text-gray-600">
        Category
        <select name="area" defaultValue={record?.area ?? area} className={fieldClass}>
          <option value="distribution">Distribution</option>
          <option value="retention">Retention</option>
        </select>
      </label>
      <TextField
        label="Hypothesis"
        name="hypothesis"
        defaultValue={record?.hypothesis}
        required
        multiline
      />
      <TextField label="Control" name="control" defaultValue={record?.control} required multiline />
      <TextField
        label="Challenger"
        name="challenger"
        defaultValue={record?.challenger}
        required
        multiline
      />
      <TextField
        label="Primary outcome"
        name="primaryOutcome"
        defaultValue={record?.primaryOutcome}
        required
        hint="For checkout or homepage tests, use eventual paid conversion, not a click. For retention, name the cohort that has to mature."
      />
      <TextField
        label="Decision criteria"
        name="decisionCriteria"
        defaultValue={record?.decisionCriteria}
        required
        multiline
        hint="Write this before launch. The registry will not decide a winner for you."
      />
      <TextField
        label="Secondary outcomes"
        name="secondaryOutcomes"
        defaultValue={record?.secondaryOutcomes}
        multiline
      />
    </>
  );
}

function ExperimentCard({ record }: { record: ExperimentRecord }) {
  return (
    <article className="space-y-2 rounded border border-gray-200 bg-white px-4 py-3 text-sm">
      <p className="font-medium text-gray-900">
        {record.name}{" "}
        <span className="font-normal text-gray-500">
          {experimentStatusLabel(record.status)} · Evidence: {experimentEvidenceLabel(record.evidence)}
        </span>
      </p>
      <p className="text-xs text-gray-500">{record.id}</p>
      {record.status === "completed" ? (
        <p className="text-gray-700">
          Completed means a decision was recorded. It does not mean this experiment won.
        </p>
      ) : null}
      <p className="text-gray-700">Hypothesis: {record.hypothesis}</p>
      <p className="text-gray-700">Control: {record.control}</p>
      <p className="text-gray-700">Challenger: {record.challenger}</p>
      <p className="text-gray-700">Primary outcome: {record.primaryOutcome}</p>
      <p className="text-gray-700">Decision criteria: {record.decisionCriteria}</p>
      <p className="text-gray-700">
        Secondary outcomes: {record.secondaryOutcomes ?? "None recorded."}
      </p>
      <p className="text-gray-700">
        Started: {record.startOn ?? "Not started."} · Ended: {record.endOn ?? "No end date."} ·
        Decision date: {record.decisionOn ?? "No decision date."}
      </p>
      <p className="text-gray-700">Measured outcome: {measuredOutcomeText(record)}</p>
      <p className="text-gray-700">Next: {record.nextAction ?? "No next action recorded."}</p>
      <p className="text-gray-700">Limitations: {record.limitations ?? "None recorded."}</p>
      {record.amendments.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-gray-700">
          {record.amendments.map((amendment) => (
            <li key={amendment.id}>Amendment: {amendment.note}</li>
          ))}
        </ul>
      ) : null}

      {record.status === "planned" ? (
        <details className="space-y-2">
          <summary className="cursor-pointer text-gray-800">Edit plan</summary>
          <SaveForm action={editOperatingExperiment} submitLabel="Save plan">
            <input type="hidden" name="id" value={record.id} />
            <DefinitionFields area={record.area} record={record} />
          </SaveForm>
        </details>
      ) : (
        <p className="text-xs text-gray-500">
          The hypothesis, variants, primary outcome, and decision criteria are locked. Add an
          amendment to document a change.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {record.status === "planned" ? (
          <SaveForm action={startOperatingExperiment} submitLabel="Start">
            <input type="hidden" name="id" value={record.id} />
          </SaveForm>
        ) : null}
        {record.status === "running" ? (
          <SaveForm action={pauseOperatingExperiment} submitLabel="Pause">
            <input type="hidden" name="id" value={record.id} />
          </SaveForm>
        ) : null}
        {record.status === "paused" ? (
          <SaveForm action={resumeOperatingExperiment} submitLabel="Resume">
            <input type="hidden" name="id" value={record.id} />
          </SaveForm>
        ) : null}
      </div>

      {record.status === "running" || record.status === "paused" ? (
        <details>
          <summary className="cursor-pointer text-gray-800">Record a result</summary>
          <SaveForm action={recordOperatingExperiment} submitLabel="Save result">
            <input type="hidden" name="id" value={record.id} />
            <EvidenceField defaultValue={record.evidence} />
            <TextField label="Conclusion" name="conclusion" defaultValue={record.conclusion} required multiline />
            <TextField label="Next action" name="nextAction" defaultValue={record.nextAction} required />
            <TextField label="Limitations" name="limitations" defaultValue={record.limitations} multiline />
            <TextField
              label="Secondary outcomes"
              name="secondaryOutcomes"
              defaultValue={record.secondaryOutcomes}
              multiline
            />
            <TextField label="End date" name="endOn" type="date" defaultValue={record.endOn} />
            <TextField
              label="Decision date"
              name="decisionOn"
              type="date"
              defaultValue={record.decisionOn}
            />
          </SaveForm>
        </details>
      ) : null}

      {record.status === "running" || record.status === "paused" ? (
        <details>
          <summary className="cursor-pointer text-gray-800">Finish and record the decision</summary>
          <SaveForm action={finishOperatingExperiment} submitLabel="Finish">
            <input type="hidden" name="id" value={record.id} />
            <EvidenceField />
            <TextField label="Conclusion" name="conclusion" required multiline />
            <TextField label="Next action" name="nextAction" required />
            <TextField label="Limitations" name="limitations" multiline />
          </SaveForm>
        </details>
      ) : null}

      {record.status !== "planned" ? (
        <details>
          <summary className="cursor-pointer text-gray-800">Add an amendment</summary>
          <SaveForm action={amendOperatingExperiment} submitLabel="Save amendment">
            <input type="hidden" name="id" value={record.id} />
            <TextField label="What changed, and why" name="note" required multiline />
          </SaveForm>
        </details>
      ) : null}
    </article>
  );
}

function Group({ title, records }: { title: string; records: ExperimentRecord[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {records.length === 0 ? (
        <p className="text-sm text-gray-600">None.</p>
      ) : (
        records.map((record) => <ExperimentCard key={record.id} record={record} />)
      )}
    </div>
  );
}

export function ExperimentRegistryPanel({
  focus,
  records,
}: {
  focus: ExperimentArea;
  records: ExperimentRecord[];
}) {
  const mine = records.filter((record) => record.area === focus);
  const completed = mine.filter((record) => record.status === "completed");
  const recent = recentCompletedExperiments(mine);

  return (
    <div className="space-y-4">
      <Group title="Running" records={mine.filter((record) => record.status === "running")} />
      <Group title="Paused" records={mine.filter((record) => record.status === "paused")} />
      <Group title="Planned" records={mine.filter((record) => record.status === "planned")} />
      <Group title="Recently completed" records={recent} />
      {completed.length > recent.length ? (
        <p className="text-sm text-gray-600">
          {completed.length - recent.length} older completed experiments are not in this recent
          list. They remain in the registry.
        </p>
      ) : null}

      <details className="rounded border border-gray-200 bg-white px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-gray-900">
          New experiment
        </summary>
        <div className="mt-3">
          <SaveForm action={createOperatingExperiment} submitLabel="Create planned experiment">
            <DefinitionFields area={focus} />
          </SaveForm>
        </div>
      </details>
    </div>
  );
}
