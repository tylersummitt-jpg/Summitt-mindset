import Link from "next/link";
import { ProgramsShell } from "@/components/programs/programs-shell";
import {
  programsAccentRule,
  programsCatalogCard,
  programsCatalogTitle,
  programsStatusActive,
  programsStatusPill,
} from "@/components/programs/programs-visual";
import {
  utBody,
  utBodyMuted,
  utErrorPanel,
  utSectionHeading,
} from "@/components/utility-page-visual";
import { listLearningCollections } from "@/lib/learning/load-curriculum";
import { listMiniProgramProgress } from "@/lib/learning/mini-program-progress";
import { supabaseProgressDb } from "@/lib/learning/mini-program-progress-db";
import { learningProgramEntryPath } from "@/lib/learning/program-paths";
import { requireProgramsMemberId } from "@/lib/learning/programs-session";
import { programCardAction, programCardState } from "@/lib/learning/step-access";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Programs",
};

export default async function ProgramsPage() {
  const memberId = await requireProgramsMemberId();
  const collections = listLearningCollections();
  const ids = collections.flatMap((collection) =>
    collection.miniPrograms.map((program) => program.id)
  );
  const progress = await listMiniProgramProgress(supabaseProgressDb(), memberId, ids);
  const byId = new Map(
    progress.ok ? progress.rows.map((row) => [row.mini_program_id, row]) : []
  );

  return (
    <ProgramsShell>
      <header>
        <h1 className={programsCatalogTitle}>Programs</h1>
        <div className={`mt-4 ${programsAccentRule}`} aria-hidden="true" />
        <p className={`mt-4 max-w-xl ${utBody}`}>
          Start a lesson, continue where you left off, or revisit one you have finished.
        </p>
      </header>
      {!progress.ok ? (
        <p className={`mt-6 ${utErrorPanel}`} role="alert">
          {progress.message}
        </p>
      ) : null}
      <div className="mt-12 space-y-12">
        {collections.map((collection) => (
          <section key={collection.id} className="space-y-5">
            <h2 className={utSectionHeading}>{collection.title}</h2>
            <ul className="space-y-5">
              {collection.miniPrograms.map((program) => {
                const row = byId.get(program.id) ?? null;
                const state = programCardState(row);
                const action = programCardAction(state);
                return (
                  <li key={program.id}>
                    <Link href={learningProgramEntryPath(program.id)} className={programsCatalogCard}>
                      <div className="h-1 bg-[var(--brand)]" aria-hidden="true" />
                      <div className="p-6 sm:p-7">
                        <h3 className="text-2xl font-semibold tracking-tight text-stone-50">
                          {program.title}
                        </h3>
                        <p className={`mt-4 max-w-2xl whitespace-pre-line ${utBody}`}>
                          {program.description}
                        </p>
                        <div className="mt-6 flex flex-col gap-4 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap items-center gap-3">
                            {progress.ok ? (
                              <span className={state === "In Progress" ? programsStatusActive : programsStatusPill}>
                                {state}
                              </span>
                            ) : (
                              <span className={utBodyMuted}>Status unavailable</span>
                            )}
                            <span className={utBodyMuted}>{program.estimated_minutes} min</span>
                          </div>
                          <span className="text-sm font-semibold text-[var(--brand)]">
                            {action} →
                          </span>
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </ProgramsShell>
  );
}
