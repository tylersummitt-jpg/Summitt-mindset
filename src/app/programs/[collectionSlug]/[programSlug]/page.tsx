import { notFound, redirect } from "next/navigation";
import { utErrorPanel } from "@/components/utility-page-visual";
import { ProgramsShell } from "@/components/programs/programs-shell";
import { getLearningMiniProgram } from "@/lib/learning/load-curriculum";
import {
  getMiniProgramProgress,
  repairFrontierIfMissing,
} from "@/lib/learning/mini-program-progress";
import { supabaseProgressDb } from "@/lib/learning/mini-program-progress-db";
import { learningStepPath, resolveLearningRoute } from "@/lib/learning/program-paths";
import { requireProgramsMemberId } from "@/lib/learning/programs-session";
import { entryStepId } from "@/lib/learning/step-access";

export const dynamic = "force-dynamic";

export default async function ProgramEntryPage({
  params,
}: {
  params: Promise<{ collectionSlug: string; programSlug: string }>;
}) {
  const { collectionSlug, programSlug } = await params;
  const memberId = await requireProgramsMemberId();
  const miniProgramId = resolveLearningRoute(collectionSlug, programSlug);
  if (!miniProgramId) notFound();

  const program = getLearningMiniProgram(miniProgramId);
  if (!program) notFound();

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

  redirect(learningStepPath(program.id, entryStepId(program.steps, row)));
}
