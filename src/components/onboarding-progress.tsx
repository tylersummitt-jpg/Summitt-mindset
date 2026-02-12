type Step = {
  label: string;
  done: boolean;
};

export default function OnboardingProgress({
  currentStep,
}: {
  currentStep: 1 | 2 | 3 | 4 | 5 | 6 | 7;
}) {
  const steps: Step[] = [
    { label: "Arena", done: currentStep > 1 },
    { label: "Outcome", done: currentStep > 2 },
    { label: "Schedule", done: currentStep > 3 },
    { label: "Reset Plan", done: currentStep > 4 },
    { label: "Focus", done: currentStep > 5 },
    { label: "SMS", done: currentStep > 6 },
    { label: "Pledge", done: currentStep > 7 },
  ];

  return (
    <div className="mb-10">
      <p className="text-xs uppercase tracking-wide text-gray-500 mb-3">
        Step {currentStep} of 7
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
