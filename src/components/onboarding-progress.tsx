type Step = {
  label: string;
  done: boolean;
};

export default function OnboardingProgress({
  currentStep,
}: {
  currentStep: 1 | 2 | 3 | 4;
}) {
  const steps: Step[] = [
    { label: "Goal", done: currentStep > 1 },
    { label: "Focus", done: currentStep > 2 },
    { label: "Preferences", done: currentStep > 3 },
    { label: "Day 1", done: currentStep > 4 },
  ];

  return (
    <div className="mb-10">
      <p className="text-xs uppercase tracking-wide text-gray-500 mb-3">
        Step {currentStep} of 4
      </p>

      <div className="flex items-center justify-between gap-2">
        {steps.map((s, i) => (
          <div
            key={i}
            className={[
              "flex-1 rounded-full h-2 transition",
              s.done ? "bg-black" : "bg-gray-200",
            ].join(" ")}
          />
        ))}
      </div>

      <div className="flex justify-between text-xs text-gray-500 mt-3">
        {steps.map((s, i) => (
          <span key={i} className={s.done ? "text-black font-medium" : ""}>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
