import { utBodyMuted } from "@/components/utility-page-visual";
import {
  programsAccentRule,
  programsEyebrow,
  programsGroupLabel,
  programsLessonTitle,
  programsProgressFill,
  programsProgressTrack,
} from "@/components/programs/programs-visual";

export function ProgramsLessonHeader({
  collectionTitle,
  groupLabel,
  title,
  sequence,
  stepCount,
}: {
  collectionTitle: string;
  groupLabel: string;
  title: string;
  sequence: number;
  stepCount: number;
}) {
  const progressPercent =
    stepCount > 0 ? Math.min(100, Math.round((sequence / stepCount) * 100)) : 0;
  return (
    <header>
      <p className={programsEyebrow}>{collectionTitle}</p>
      {groupLabel ? <p className={`mt-6 ${programsGroupLabel}`}>{groupLabel}</p> : null}
      <div className={`${groupLabel ? "mt-3" : "mt-6"} ${programsAccentRule}`} aria-hidden="true" />
      <h1 className={`mt-4 ${programsLessonTitle}`}>{title}</h1>
      <div className="mt-6">
        <p className={utBodyMuted}>
          Step {sequence} of {stepCount}
        </p>
        <div
          className={programsProgressTrack}
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={stepCount}
          aria-valuenow={sequence}
          aria-label={`Step ${sequence} of ${stepCount}`}
        >
          <div className={programsProgressFill} style={{ width: `${progressPercent}%` }} />
        </div>
      </div>
    </header>
  );
}
