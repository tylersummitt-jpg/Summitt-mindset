const MESSAGES = [
  {
    speaker: "Coach Pat",
    text: "Judy, how's our goal of walking four days a week?",
  },
  {
    speaker: "Judy",
    text: "I did it! Four walks this week!",
  },
  {
    speaker: "Coach Pat",
    text: "That's a victory! Anything special happen along the way?",
  },
  {
    speaker: "Judy",
    text: "My daughter joined me yesterday. We got ice cream afterward and laughed the whole way home.",
  },
  {
    speaker: "Coach Pat",
    text: "I'll make sure we remember that one, Judy. Let's keep making progress next week!",
  },
] as const;

export function HomepageSmsExample() {
  return (
    <section
      data-exp-section="home_demo"
      aria-labelledby="sms-example-heading"
      className="border-b border-[var(--border)] bg-white px-4 pb-12 pt-8 sm:px-6 sm:pb-16 sm:pt-12"
    >
      <div className="mx-auto min-w-0 max-w-3xl break-words">
        <h2
          id="sms-example-heading"
          className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl"
        >
          A Little Conversation Can Change Your Day.
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-slate-800 sm:text-xl">
          Coach Pat helps you keep going toward your goals and notice the moments that make life special.
        </p>
        <div className="mt-6 min-w-0 md:mx-auto md:max-w-lg md:rounded-[2rem] md:border md:border-slate-300 md:bg-[#F3F4F6] md:px-5 md:pb-6 md:pt-5">
          <ol className="space-y-3" aria-label="Example text messages between Coach Pat and Judy">
            {MESSAGES.map((message) => {
              const fromCoach = message.speaker === "Coach Pat";
              return (
                <li
                  key={`${message.speaker}-${message.text}`}
                  className={fromCoach ? "flex justify-start" : "flex justify-end"}
                >
                  <div
                    className={`min-w-0 max-w-[96%] break-words rounded-2xl px-4 py-3 ${
                      fromCoach
                        ? "bg-[#E9E9EB] text-[#111827]"
                        : "bg-[#0E6B32] text-white"
                    }`}
                  >
                    <p className="text-lg font-bold leading-relaxed">{message.speaker}</p>
                    <p className="mt-1 text-lg leading-relaxed">{message.text}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
