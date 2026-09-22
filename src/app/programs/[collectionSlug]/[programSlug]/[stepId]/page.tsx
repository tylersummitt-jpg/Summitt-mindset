import { notFound, redirect } from "next/navigation";
import { utErrorPanel } from "@/components/utility-page-visual";
import { ProgramsShell } from "@/components/programs/programs-shell";
import { StepExperience } from "@/components/programs/step-experience";
import {
  getLearningMiniProgram,
  getLearningStep,
  toPublicLearningStep,
} from "@/lib/learning/load-curriculum";
import {
  getMiniProgramProgress,
  initializeMiniProgramProgress,
  repairFrontierIfMissing,
} from "@/lib/learning/mini-program-progress";
import { supabaseProgressDb } from "@/lib/learning/mini-program-progress-db";
import { learningStepPath, resolveLearningRoute } from "@/lib/learning/program-paths";
import { requireProgramsMemberId } from "@/lib/learning/programs-session";
import { listReflectionAnswers } from "@/lib/learning/reflection-answers";
import { supabaseReflectionDb } from "@/lib/learning/reflection-answers-db";
import { decideStepView, orderedSteps } from "@/lib/learning/step-access";

export const dynamic = "force-dynamic";

export default async function LearningStepPage({
  params,
}: {
  params: Promise<{ collectionSlug: string; programSlug: string; stepId: string }>;
}) {
  const { collectionSlug, programSlug, stepId } = await params;
  const memberId = await requireProgramsMemberId();
  const miniProgramId = resolveLearningRoute(collectionSlug, programSlug);
  if (!miniProgramId) notFound();

  const program = getLearningMiniProgram(miniProgramId);
  if (!program) notFound();
  const step = getLearningStep(program.id, stepId);
  if (!step) notFound();

  const progressDb = supabaseProgressDb();
  const loaded = await getMiniProgramProgress(progressDb, memberId, program.id);
  if (!loaded.ok) {
    return (
      <ProgramsShell>
        <p className={utErrorPanel} role="alert">
          {loaded.message}
        </p>
      </ProgramsShell>
    );
  }

  let row = loaded.row;
  if (row) {
    const repaired = await repairFrontierIfMissing(progressDb, memberId, program.steps, row);
    if (!repaired.ok) {
      return (
        <ProgramsShell>
          <p className={utErrorPanel} role="alert">
            {repaired.message}
          </p>
        </ProgramsShell>
      );
    }
    row = repaired.row;
  }

  let decision = decideStepView(row, program.steps, step.id);
  if (decision.kind === "missing") notFound();
  if (decision.kind === "redirect") {
    redirect(learningStepPath(program.id, decision.stepId));
  }

  if (decision.kind === "initialize") {
    const created = await initializeMiniProgramProgress(progressDb, {
      memberId,
      program,
      now: new Date().toISOString(),
    });
    if (!created.ok) {
      return (
        <ProgramsShell>
          <p className={utErrorPanel} role="alert">
            {created.message}
          </p>
        </ProgramsShell>
      );
    }
    row = created.row;
    decision = decideStepView(row, program.steps, step.id);
    if (decision.kind === "redirect") {
      redirect(learningStepPath(program.id, decision.stepId));
    }
    if (decision.kind !== "render") notFound();
  }

  if (decision.kind !== "render") notFound();

  const reflections = await listReflectionAnswers(
    supabaseReflectionDb(),
    memberId,
    program.id,
    step.id
  );
  if (!reflections.ok) {
    return (
      <ProgramsShell>
        <p className={utErrorPanel} role="alert">
          {reflections.message}
        </p>
      </ProgramsShell>
    );
  }

  const ordered = orderedSteps(program.steps);
  const index = ordered.findIndex((candidate) => candidate.id === step.id);
  const previous = index > 0 ? ordered[index - 1] : null;

  return (
    <ProgramsShell>
      <StepExperience
        key={step.id}
        miniProgramId={program.id}
        collectionTitle={program.collection_title}
        programTitle={program.title}
        step={toPublicLearningStep(step)}
        stepCount={program.steps.length}
        previousHref={previous ? learningStepPath(program.id, previous.id) : null}
        initialAnswers={Object.fromEntries(
          reflections.rows.map((answer) => [answer.question_id, answer.answer_text])
        )}
        enforceRequirements={decision.enforceRequirements}
        isLastStep={index === ordered.length - 1}
      />
    </ProgramsShell>
  );
}
