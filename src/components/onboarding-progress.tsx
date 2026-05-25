type Step = {
  label: string;
};

const STEPS: Step[] = [
  { label: "Identity" },
  { label: "Goal" },
  { label: "Review" },
  { label: "Texts" },
  { label: "Complete" },
];

export default function OnboardingProgress({
  currentStep,
}: {
  currentStep: 1 | 2 | 3 | 4 | 5;
}) {
  return (
    <div className="mb-10">
      <p className="text-xs uppercase tracking-wide text-gray-500 mb-3">
        Onboarding step {currentStep} of {STEPS.length}
      </p>

      <div className="flex items-center justify-between gap-2">
        {STEPS.map((s, i) => {
          const filled = i < currentStep;
          return (
            <div
              key={s.label}
              className={[
                "flex-1 rounded-full h-2 transition",
                filled ? "bg-[var(--brand)]" : "bg-gray-200",
              ].join(" ")}
            />
          );
        })}
      </div>

      <div className="flex justify-between text-xs text-gray-500 mt-3">
        {STEPS.map((s, i) => {
          const labelDone = currentStep > i + 1;
          return (
            <span key={s.label} className={labelDone ? "text-black font-medium" : ""}>
              {s.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
