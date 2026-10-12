import { VrIconGoal, VrIconStar } from "@/components/VictoryRoomIcons";

/**
 * Sunday-first September 2026 grid.
 * September 1, 2026 is a Tuesday, so the first date sits in column 3.
 */
export function exampleSeptemberSlots(): Array<number | null> {
  const leadingBlanks = new Date(Date.UTC(2026, 8, 1)).getUTCDay();
  const slots: Array<number | null> = [];
  for (let index = 0; index < leadingBlanks; index += 1) slots.push(null);
  for (let day = 1; day <= 30; day += 1) slots.push(day);
  while (slots.length % 7 !== 0) slots.push(null);
  return slots;
}

const WEEKDAYS = [
  { short: "S", name: "Sunday" },
  { short: "M", name: "Monday" },
  { short: "T", name: "Tuesday" },
  { short: "W", name: "Wednesday" },
  { short: "T", name: "Thursday" },
  { short: "F", name: "Friday" },
  { short: "S", name: "Saturday" },
] as const;

/** Unnamed example marks plus the three stories shown on the cards. Not a lifetime count. */
const CALENDAR_MARKS: Record<number, "goal" | "proud"> = {
  2: "proud",
  3: "goal",
  5: "proud",
  7: "proud",
  9: "goal",
  11: "proud",
  14: "goal",
  16: "proud",
  18: "goal",
  19: "proud",
  21: "proud",
  23: "proud",
  25: "goal",
  26: "proud",
  28: "proud",
  30: "proud",
};

const NAMED_DAYS: Record<number, string> = {
  18: "Walked Four Days This Week",
  21: "Ice Cream With My Granddaughter",
  28: "An Afternoon at the Park",
};

const EXAMPLE_CARDS = [
  {
    kind: "goal" as const,
    type: "Goal Win",
    date: "September 18",
    title: "Walked Four Days This Week!",
    body: "I promised myself I'd get moving again. This week, I followed through. Four walks, and I'm feeling stronger already.",
  },
  {
    kind: "proud" as const,
    type: "Proud Moment",
    date: "September 21",
    title: "Ice Cream With My Granddaughter",
    body: "After our walk, we stopped for ice cream. We talked about school, laughed, and enjoyed being together. It's a day I never want to forget.",
  },
  {
    kind: "proud" as const,
    type: "Proud Moment",
    date: "September 28",
    title: "An Afternoon at the Park",
    body: "My grandson and I spent the afternoon playing and laughing at the park. A few months ago, I would not have had the energy. Today, I did. I want to remember that.",
  },
];

const TOTALS = [
  { value: "37", label: "Total Victories" },
  { value: "7", label: "Goal Wins" },
  { value: "30", label: "Proud Moments" },
] as const;

function weeksOf(slots: Array<number | null>) {
  const rows: Array<Array<number | null>> = [];
  for (let index = 0; index < slots.length; index += 7) {
    rows.push(slots.slice(index, index + 7));
  }
  return rows;
}

export function HomepageVictoryRoom() {
  const weeks = weeksOf(exampleSeptemberSlots());

  return (
    <section
      data-exp-section="home_victory"
      aria-labelledby="victory-room-heading"
      className="border-b border-[var(--border)] bg-white px-4 py-12 sm:px-6 sm:py-16"
    >
      <div className="mx-auto min-w-0 max-w-6xl break-words">
        <h2
          id="victory-room-heading"
          className="max-w-3xl text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl"
        >
          {"Don't Just Live the Moments. Remember Them."}
        </h2>
        <p className="mt-4 max-w-3xl text-lg leading-relaxed text-slate-800 sm:text-xl">
          Your Victory Room is a place to save your Goal Wins and Proud Moments. Big accomplishments, small victories, and memories you want to look back on.
        </p>
        <div className="mt-8 grid max-w-3xl gap-4 sm:grid-cols-2">
          <article className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:p-6">
            <h3 className="text-2xl font-bold leading-tight text-slate-950">Goal Wins</h3>
            <p className="mt-2 text-lg leading-relaxed text-slate-800">
              The progress you make toward your goals.
            </p>
          </article>
          <article className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:p-6">
            <h3 className="text-2xl font-bold leading-tight text-slate-950">Proud Moments</h3>
            <p className="mt-2 text-lg leading-relaxed text-slate-800">
              The special moments in your life you want to remember.
            </p>
          </article>
        </div>

        <div className="mt-8 rounded-3xl border border-amber-500/30 bg-[#060a11] px-4 py-6 text-stone-100 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.85)] sm:px-6 sm:py-8 lg:px-8">
          <p className="text-lg font-semibold leading-relaxed text-amber-200">
            Example Victory Room
          </p>
          <div className="mt-6 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-start lg:gap-8">
            <div className="min-w-0">
              <h3 className="font-serif text-3xl font-semibold tracking-tight text-stone-50">
                Your Victories
              </h3>
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                {TOTALS.map((total) => (
                  <p key={total.label} className="min-w-0">
                    <span className="block font-serif text-4xl font-semibold leading-none text-amber-100">
                      {total.value}
                    </span>
                    <span className="mt-2 block text-lg leading-snug text-stone-100">
                      {total.label}
                    </span>
                  </p>
                ))}
              </div>
              <h3 className="mt-8 font-serif text-2xl font-semibold tracking-tight text-stone-50 sm:text-3xl">
                This Month&apos;s Victories
              </h3>
              <p className="mt-2 text-lg leading-relaxed text-stone-100">September 2026</p>
              <table className="mt-4 w-full table-fixed border-separate border-spacing-[4px]">
                <caption className="sr-only">
                  Example September 2026 calendar. A target marks a Goal Win. A star marks a Proud Moment. The marks in this month are not the lifetime totals.
                </caption>
                <thead>
                  <tr>
                    {WEEKDAYS.map((weekday) => (
                      <th
                        key={weekday.name}
                        scope="col"
                        className="pb-2 text-center text-[clamp(13px,3.4vw,16px)] font-semibold text-stone-300"
                      >
                        <abbr title={weekday.name} className="no-underline">
                          {weekday.short}
                        </abbr>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week) => (
                    <tr key={week.map((day) => day ?? "x").join("-")}>
                      {week.map((day, index) => {
                        const mark = day == null ? null : CALENDAR_MARKS[day];
                        const named = day == null ? null : NAMED_DAYS[day];
                        const spoken = day == null
                          ? ""
                          : named
                            ? `September ${day}, ${mark === "goal" ? "Goal Win" : "Proud Moment"}, ${named}`
                            : mark
                              ? `September ${day}, ${mark === "goal" ? "Goal Win" : "Proud Moment"}, example`
                              : `September ${day}`;
                        return (
                          <td key={`${week[0] ?? "blank"}-${index}`} className="p-0 align-top">
                            {day == null ? (
                              <span className="block min-h-11" />
                            ) : (
                              <div
                                className={`flex min-h-[40px] flex-col items-center justify-center overflow-hidden rounded-lg px-0.5 py-1 ${
                                  mark ? "bg-amber-500/15" : ""
                                } ${named ? "ring-1 ring-inset ring-amber-400/80" : ""}`}
                              >
                                <span className="text-[clamp(15px,4vw,18px)] font-semibold leading-none tabular-nums text-stone-50">
                                  {day}
                                </span>
                                {mark === "goal" ? (
                                  <VrIconGoal className="mt-0.5 size-[14px] text-amber-300" />
                                ) : null}
                                {mark === "proud" ? (
                                  <VrIconStar className="mt-0.5 size-[14px] text-amber-300" />
                                ) : null}
                                <span className="sr-only">{spoken}</span>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-8 min-w-0 space-y-4 lg:mt-0">
              {EXAMPLE_CARDS.map((card) => (
                <article
                  key={card.title}
                  className="rounded-2xl border border-amber-500/30 bg-[#0a0e16] p-5 sm:p-6"
                >
                  <p className="flex items-center gap-2 text-lg font-semibold text-amber-200">
                    {card.kind === "goal" ? (
                      <VrIconGoal className="h-6 w-6 shrink-0 text-amber-300" />
                    ) : (
                      <VrIconStar className="h-6 w-6 shrink-0 text-amber-300" />
                    )}
                    {card.type}
                  </p>
                  <p className="mt-3 text-lg text-stone-300">{card.date}</p>
                  <h3 className="mt-2 font-serif text-2xl font-semibold leading-tight text-stone-50">
                    {card.title}
                  </h3>
                  <p className="mt-3 text-lg leading-relaxed text-stone-100">{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
