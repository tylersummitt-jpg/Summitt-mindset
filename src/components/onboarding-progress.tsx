type Step = {
  label: string;
};

export default function OnboardingProgress({
  currentStep,
}: {
  currentStep: 1 | 2 | 3 | 4;
}) {
  const steps: Step[] = [
    { label: "Identity" },
    { label: "Commitment" },
    { label: "SMS" },
    { label: "Complete" },
  ];

  return (
    <div className="mb-10">
      <p className="text-xs uppercase tracking-wide text-gray-500 mb-3">
        Onboarding part {currentStep} of 4
      </p>

      <div className="flex items-center justify-between gap-2">
        {steps.map((s, i) => {
          const filled = i < currentStep;
          return (
            <div
              key={i}
              className={[
                "flex-1 rounded-full h-2 transition",
                filled ? "bg-[var(--brand)]" : "bg-gray-200",
              ].join(" ")}
            />
          );
        })}
      </div>

      <div className="flex justify-between text-xs text-gray-500 mt-3">
        {steps.map((s, i) => {
          const labelDone = currentStep > i + 1;
          return (
            <span key={i} className={labelDone ? "text-black font-medium" : ""}>
              {s.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
