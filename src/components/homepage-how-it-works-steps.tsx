const STEPS = [
  {
    number: "1",
    title: "Tell Coach Pat About Yourself",
    body: "Share your goals and what's important in your life.",
  },
  {
    number: "2",
    title: "Get Personal Daily Texts",
    body: "Coach Pat checks in, encourages you, and helps you keep going.",
  },
  {
    number: "3",
    title: "Celebrate and Remember",
    body: "Save your victories and the moments you want to remember.",
  },
] as const;

export function HomepageHowItWorksSteps() {
  return (
    <section
      aria-labelledby="how-it-works-heading"
      className="border-b border-[var(--border)] bg-slate-50 px-4 py-12 sm:px-6 sm:py-16"
    >
      <div className="mx-auto min-w-0 max-w-3xl break-words">
        <h2
          id="how-it-works-heading"
          className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl"
        >
          {"It's as Easy as Sending a Text."}
        </h2>
        <ol className="mt-8 grid gap-6 lg:grid-cols-3">
          {STEPS.map((step) => (
            <li
              key={step.number}
              className="flex min-w-0 gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:gap-5 sm:p-6"
            >
              <span
                className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-2xl font-bold text-white"
                aria-hidden
              >
                {step.number}
              </span>
              <div className="min-w-0">
                <h3 className="text-2xl font-bold leading-tight text-slate-950">
                  <span className="sr-only">Step {step.number}. </span>
                  {step.title}
                </h3>
                <p className="mt-2 text-lg leading-relaxed text-slate-800">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
