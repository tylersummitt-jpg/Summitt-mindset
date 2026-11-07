"use client";

import { useState } from "react";
import { ProgramsProse } from "@/components/programs/programs-prose";
import { programsRevealControl, programsSectionCard } from "@/components/programs/programs-visual";

export function ProgramsReveal({
  sections,
}: {
  sections: Array<{ id: string; title: string; body: string }>;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="space-y-3">
      {sections.map((section) => {
        const expanded = Boolean(open[section.id]);
        return (
          <section key={section.id} className={programsSectionCard}>
            <h3>
              <button
                type="button"
                className="flex w-full items-start justify-between gap-4 rounded-md text-left text-base font-semibold text-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                aria-expanded={expanded}
                onClick={() =>
                  setOpen((current) => ({ ...current, [section.id]: !current[section.id] }))
                }
              >
                <span>{section.title}</span>
                <span aria-hidden="true" className={programsRevealControl}>
                  {expanded ? "–" : "+"}
                </span>
              </button>
            </h3>
            {expanded ? (
              <div className="mt-4 border-t border-white/10 pt-4">
                <ProgramsProse text={section.body} />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
