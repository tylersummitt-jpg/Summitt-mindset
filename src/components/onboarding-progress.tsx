type Step = {
  label: string;
  done: boolean;
};

export default function OnboardingProgress({
  currentStep,
}: {
  currentStep: 1 | 2 | 3 | 4 | 5;
}) {
  const steps: Step[] = [
    { label: "Identity", done: currentStep > 1 },
    { label: "Relationships", done: currentStep > 2 },
    { label: "Pressure", done: currentStep > 3 },
    { label: "SMS", done: currentStep > 4 },
    { label: "Complete", done: currentStep > 5 },
  ];

  return (
    <div className="mb-10">
      <p className="text-xs uppercase tracking-wide text-gray-500 mb-3">
        Step {currentStep} of 5
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
