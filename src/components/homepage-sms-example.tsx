const MESSAGES = [
  {
    speaker: "Coach Pat",
    text: "Good morning, Judy! You wanted to walk every day this week. How's that going?",
  },
  {
    speaker: "Judy",
    text: "I've walked four days in a row!",
  },
  {
    speaker: "Coach Pat",
    text: "That's real progress! What's helped you stick with it?",
  },
  {
    speaker: "Judy",
    text: "My granddaughter has been walking with me.",
  },
  {
    speaker: "Coach Pat",
    text: "Look at that. You're getting healthier and spending time together.",
  },
  {
    speaker: "Judy",
    text: "We even stopped for ice cream yesterday. She told me all about school.",
  },
  {
    speaker: "Coach Pat",
    text: "That's a moment worth remembering. What was your favorite part?",
  },
  {
    speaker: "Judy",
    text: "Just hearing her laugh. I don't want to forget days like that.",
  },
  {
    speaker: "Coach Pat",
    text: "Then let's keep making progress and noticing those special moments!",
  },
] as const;

export function HomepageSmsExample() {
  return (
    <section
      aria-labelledby="sms-example-heading"
      className="border-b border-[var(--border)] bg-white px-4 py-12 sm:px-6 sm:py-16"
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
        <p className="mt-6 text-lg font-semibold leading-relaxed text-slate-950">
          {"Example conversation. This is not a real member's text thread."}
        </p>
        <div className="mt-6 min-w-0 md:mx-auto md:max-w-lg md:rounded-[2rem] md:border md:border-slate-300 md:bg-[#F3F4F6] md:px-5 md:pb-6 md:pt-5">
          <p className="text-lg font-bold leading-relaxed text-slate-950">Coach Pat</p>
          <ol className="mt-4 space-y-3" aria-label="Example text messages between Coach Pat and Judy">
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
