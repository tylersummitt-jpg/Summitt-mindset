// SUMMITT ASSESSMENT – RANDOMIZED + RESULTS + MEMBERSHIP CTA
"use client";

import { useState, useEffect } from "react";

type PrincipleId =
  | "respect"
  | "responsibility"
  | "loyalty"
  | "communication"
  | "discipline"
  | "hardWork"
  | "workSmart"
  | "teamFirst"
  | "winningAttitude"
  | "competitor"
  | "change"
  | "handleSuccess";

type Question = {
  id: string;
  principleId: PrincipleId;
  principleLabel: string;
  text: string;
};

const questions: Question[] = [
  // 1. Respect Yourself and Others
  {
    id: "q1",
    principleId: "respect",
    principleLabel: "Respect Yourself and Others",
    text: "I consistently treat people with respect, regardless of their role, status, or how I feel.",
  },
  {
    id: "q2",
    principleId: "respect",
    principleLabel: "Respect Yourself and Others",
    text: "I set boundaries and hold myself to high personal standards in how I talk, act, and show up.",
  },
  {
    id: "q3",
    principleId: "respect",
    principleLabel: "Respect Yourself and Others",
    text: "People would describe me as someone who listens well and makes others feel valued.",
  },

  // 2. Take Full Responsibility
  {
    id: "q4",
    principleId: "responsibility",
    principleLabel: "Take Full Responsibility",
    text: "When things go wrong, my first instinct is to look at what I could have done differently.",
  },
  {
    id: "q5",
    principleId: "responsibility",
    principleLabel: "Take Full Responsibility",
    text: "I own my mistakes quickly instead of making excuses or blaming other people or circumstances.",
  },
  {
    id: "q6",
    principleId: "responsibility",
    principleLabel: "Take Full Responsibility",
    text: "I follow through on commitments and do what I say I will do, even when it’s inconvenient.",
  },

  // 3. Develop and Demonstrate Loyalty
  {
    id: "q7",
    principleId: "loyalty",
    principleLabel: "Develop and Demonstrate Loyalty",
    text: "I support my team, family, or organization in public, even when we’re under pressure.",
  },
  {
    id: "q8",
    principleId: "loyalty",
    principleLabel: "Develop and Demonstrate Loyalty",
    text: "If I have an issue with someone, I address it directly with them instead of talking behind their back.",
  },
  {
    id: "q9",
    principleId: "loyalty",
    principleLabel: "Develop and Demonstrate Loyalty",
    text: "I show gratitude and appreciation to the people who invest in me and my growth.",
  },

  // 4. Learn to Be a Great Communicator
  {
    id: "q10",
    principleId: "communication",
    principleLabel: "Learn to Be a Great Communicator",
    text: "I communicate expectations clearly instead of assuming people know what I want.",
  },
  {
    id: "q11",
    principleId: "communication",
    principleLabel: "Learn to Be a Great Communicator",
    text: "I am willing to have hard conversations rather than avoiding them.",
  },
  {
    id: "q12",
    principleId: "communication",
    principleLabel: "Learn to Be a Great Communicator",
    text: "People would say I’m clear, honest, and direct without being disrespectful.",
  },

  // 5. Discipline Yourself So No One Else Has To
  {
    id: "q13",
    principleId: "discipline",
    principleLabel: "Discipline Yourself So No One Else Has To",
    text: "I have daily habits and routines that keep me moving toward my goals.",
  },
  {
    id: "q14",
    principleId: "discipline",
    principleLabel: "Discipline Yourself So No One Else Has To",
    text: "I do the right thing even when no one is watching and there is no immediate reward.",
  },
  {
    id: "q15",
    principleId: "discipline",
    principleLabel: "Discipline Yourself So No One Else Has To",
    text: "I rarely need someone else to “get on me” to do what I’m supposed to do.",
  },

  // 6. Make Hard Work Your Passion
  {
    id: "q16",
    principleId: "hardWork",
    principleLabel: "Make Hard Work Your Passion",
    text: "I am known as someone who gives full effort, not someone who coasts.",
  },
  {
    id: "q17",
    principleId: "hardWork",
    principleLabel: "Make Hard Work Your Passion",
    text: "I regularly push myself beyond what is comfortable in order to grow.",
  },
  {
    id: "q18",
    principleId: "hardWork",
    principleLabel: "Make Hard Work Your Passion",
    text: "I take pride in outworking my past self, not just other people.",
  },

  // 7. Don't Just Work Hard, Work Smart
  {
    id: "q19",
    principleId: "workSmart",
    principleLabel: "Don’t Just Work Hard, Work Smart",
    text: "I regularly step back to think about whether my effort is focused on the right things.",
  },
  {
    id: "q20",
    principleId: "workSmart",
    principleLabel: "Don’t Just Work Hard, Work Smart",
    text: "I plan my time and priorities instead of letting the day control me.",
  },
  {
    id: "q21",
    principleId: "workSmart",
    principleLabel: "Don’t Just Work Hard, Work Smart",
    text: "I seek coaching, feedback, or better systems so I can be more effective, not just busier.",
  },

  // 8. Put the Team Before Yourself
  {
    id: "q22",
    principleId: "teamFirst",
    principleLabel: "Put the Team Before Yourself",
    text: "I’m willing to sacrifice personal preferences for what’s best for the team or family.",
  },
  {
    id: "q23",
    principleId: "teamFirst",
    principleLabel: "Put the Team Before Yourself",
    text: "I celebrate others’ success instead of feeling threatened or jealous.",
  },
  {
    id: "q24",
    principleId: "teamFirst",
    principleLabel: "Put the Team Before Yourself",
    text: "I understand my role and try to star in that role instead of chasing attention.",
  },

  // 9. Make Winning an Attitude
  {
    id: "q25",
    principleId: "winningAttitude",
    principleLabel: "Make Winning an Attitude",
    text: "I carry myself with confidence and positive expectancy, even before I see results.",
  },
  {
    id: "q26",
    principleId: "winningAttitude",
    principleLabel: "Make Winning an Attitude",
    text: "I bring energy and focus to important moments instead of going through the motions.",
  },
  {
    id: "q27",
    principleId: "winningAttitude",
    principleLabel: "Make Winning an Attitude",
    text: "I recover quickly from setbacks and get back to doing the work.",
  },

  // 10. Be a Competitor
  {
    id: "q28",
    principleId: "competitor",
    principleLabel: "Be a Competitor",
    text: "I like challenges and see them as chances to prove and improve myself.",
  },
  {
    id: "q29",
    principleId: "competitor",
    principleLabel: "Be a Competitor",
    text: "Pressure situations bring out a better focus in me, not a worse one.",
  },
  {
    id: "q30",
    principleId: "competitor",
    principleLabel: "Be a Competitor",
    text: "I prepare like a pro instead of just showing up and hoping things go well.",
  },

  // 11. Change Is a Must
  {
    id: "q31",
    principleId: "change",
    principleLabel: "Change is a Must",
    text: "I’m willing to change habits, systems, or attitudes when they’re not working.",
  },
  {
    id: "q32",
    principleId: "change",
    principleLabel: "Change is a Must",
    text: "I seek feedback and new ideas instead of defending the way I’ve always done things.",
  },
  {
    id: "q33",
    principleId: "change",
    principleLabel: "Change is a Must",
    text: "I make adjustments quickly instead of waiting until problems are huge.",
  },

  // 12. Handle Success Like You Handle Failure
  {
    id: "q34",
    principleId: "handleSuccess",
    principleLabel: "Handle Success Like You Handle Failure",
    text: "When things go well, I stay humble and focused instead of getting complacent.",
  },
  {
    id: "q35",
    principleId: "handleSuccess",
    principleLabel: "Handle Success Like You Handle Failure",
    text: "I don’t let failure or success define my identity; both are feedback, not a verdict.",
  },
  {
    id: "q36",
    principleId: "handleSuccess",
    principleLabel: "Handle Success Like You Handle Failure",
    text: "After a win, I quickly shift back to preparation for what’s next.",
  },
];

const principleOrder: { id: PrincipleId; label: string }[] = [
  { id: "respect", label: "Respect Yourself and Others" },
  { id: "responsibility", label: "Take Full Responsibility" },
  { id: "loyalty", label: "Develop and Demonstrate Loyalty" },
  { id: "communication", label: "Learn to Be a Great Communicator" },
  { id: "discipline", label: "Discipline Yourself So No One Else Has To" },
  { id: "hardWork", label: "Make Hard Work Your Passion" },
  { id: "workSmart", label: "Don’t Just Work Hard, Work Smart" },
  { id: "teamFirst", label: "Put the Team Before Yourself" },
  { id: "winningAttitude", label: "Make Winning an Attitude" },
  { id: "competitor", label: "Be a Competitor" },
  { id: "change", label: "Change is a Must" },
  { id: "handleSuccess", label: "Handle Success Like You Handle Failure" },
];

const growthCoaching: Record<PrincipleId, string> = {
  respect:
    "Start by choosing one relationship where you will listen fully, put your phone away, and show respect in your tone, eye contact, and follow-through this week.",
  responsibility:
    "Pick one recurring excuse you make and replace it with one specific action you will own this week. No blame, no stories, just responsibility.",
  loyalty:
    "Identify one person or team you’re committed to. Express appreciation directly to them this week, and refuse to speak negatively about them behind their back.",
  communication:
    "Schedule one important conversation you’ve been avoiding. Prepare what you want to say, listen more than you speak, and aim for clarity, not perfection.",
  discipline:
    "Choose one small daily habit (like planning tomorrow the night before or a set wake-up time) and keep it for the next 7 days without exception.",
  hardWork:
    "Pick one area of your life where you’ve been coasting. Commit to 15–30 minutes of focused, uncomfortable effort in that area each day this week.",
  workSmart:
    "Before each day starts, list your top 3 priorities. Do those first before reacting to messages, distractions, or low-value tasks.",
  teamFirst:
    "Do one tangible thing this week that makes life easier for your team or family, even if no one notices or says thank you.",
  winningAttitude:
    "Before key moments each day, take 30 seconds to reset: stand tall, breathe, and decide the energy and attitude you will bring into that moment.",
  competitor:
    "Pick one challenge you usually shy away from. This week, lean into it with preparation instead of avoidance, and treat it as a chance to grow.",
  change:
    "Choose one habit or system that clearly isn’t working. This week, experiment with one new way of doing it instead of repeating the old pattern.",
  handleSuccess:
    "After your next win, write down what worked, who helped you, and one way you’ll stay hungry instead of relaxing back into comfort.",
};

type ScoresByPrinciple = {
  [P in PrincipleId]: {
    label: string;
    average: number;
    band: string;
    summary: string;
  };
};

function getBand(average: number): { band: string; summary: string } {
  if (average < 2.5) {
    return {
      band: "Needs Attention",
      summary:
        "This area is a current weakness. Getting better here will noticeably raise your overall leadership ceiling.",
    };
  }
  if (average < 3.5) {
    return {
      band: "Developing",
      summary:
        "You have some good habits here, but you’re inconsistent. With focus, this can become a real strength.",
    };
  }
  if (average < 4.5) {
    return {
      band: "Strong",
      summary:
        "This is a solid strength. Keep protecting it with consistent habits and honest feedback.",
    };
  }
  return {
    band: "Summitt Level",
    summary:
      "This is an elite strength for you right now. Your job is to stay humble, keep learning, and use it to lift others.",
  };
}

// Fisher–Yates shuffle
function shuffleQuestions<T>(items: T[]): T[] {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export default function SummittAssessmentPage() {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);

  // stable initial order for SSR
  const [randomizedQuestions, setRandomizedQuestions] =
    useState<Question[]>(questions);

  // randomize only on client
  useEffect(() => {
    setRandomizedQuestions(shuffleQuestions(questions));
  }, []);

  const handleChange = (questionId: string, value: number) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: value,
    }));
  };

  const allAnswered =
    randomizedQuestions.length === Object.keys(answers).length;

  const calculateScores = (): ScoresByPrinciple => {
    const scores: { [P in PrincipleId]: number[] } = {
      respect: [],
      responsibility: [],
      loyalty: [],
      communication: [],
      discipline: [],
      hardWork: [],
      workSmart: [],
      teamFirst: [],
      winningAttitude: [],
      competitor: [],
      change: [],
      handleSuccess: [],
    };

    questions.forEach((q) => {
      const value = answers[q.id];
      if (value) {
        scores[q.principleId].push(value);
      }
    });

    const result: any = {};
    for (const { id, label } of principleOrder) {
      const values = scores[id];
      const avg =
        values.length > 0
          ? values.reduce((sum, v) => sum + v, 0) / values.length
          : 0;
      const { band, summary } = getBand(avg);
      result[id] = {
        label,
        average: Number(avg.toFixed(2)),
        band,
        summary,
      };
    }
    return result as ScoresByPrinciple;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!allAnswered) {
      alert("Please answer all 36 questions before viewing your results.");
      return;
    }
    setSubmitted(true);
  };

  const scores = submitted ? calculateScores() : null;

  // find lowest-scoring principle for personalized coaching
  let lowest:
    | { id: PrincipleId; label: string; average: number; band: string }
    | null = null;
  if (scores) {
    principleOrder.forEach(({ id, label }) => {
      const { average, band } = scores[id];
      if (!lowest || average < lowest.average) {
        lowest = { id, label, average, band };
      }
    });
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold mb-3">
        The Summitt Assessment (Definite Dozen)
      </h1>
      <p className="text-gray-700 mb-6">
        Rate each statement from 1–5 based on how true it is for you right now.
        Be honest. This is a snapshot of your current habits, not your worth as
        a person.
      </p>

      <div className="mb-4 text-sm text-gray-600">
        <p className="font-semibold mb-1">Scale:</p>
        <p>1 = Strongly Disagree · 2 = Disagree</p>
        <p>3 = Neutral · 4 = Agree · 5 = Strongly Agree</p>
      </div>

      {/* RANDOMIZED QUESTIONS */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {randomizedQuestions.map((q, index) => (
          <section
            key={q.id}
            className="border rounded-lg p-4 bg-white shadow-sm"
          >
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="text-md font-semibold">
                Question {index + 1} of {randomizedQuestions.length}
              </h2>
            </div>
            <p className="mb-3 text-gray-800">{q.text}</p>
            <div className="flex gap-3 text-sm">
              {[1, 2, 3, 4, 5].map((value) => (
                <label
                  key={value}
                  className="flex items-center gap-1 cursor-pointer"
                >
                  <input
                    type="radio"
                    name={q.id}
                    value={value}
                    checked={answers[q.id] === value}
                    onChange={() => handleChange(q.id, value)}
                  />
                  <span>{value}</span>
                </label>
              ))}
            </div>
          </section>
        ))}

        <div className="flex items-center justify-between mt-6">
          <p className="text-sm text-gray-600">
            Answered {Object.keys(answers).length} of{" "}
            {randomizedQuestions.length} items.
          </p>
          <button
            type="submit"
            className="rounded-md bg-black px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!allAnswered}
          >
            See My Results
          </button>
        </div>
      </form>

      {submitted && scores && (
        <section className="mt-10 border-t pt-8">
          <h2 className="text-2xl font-bold mb-4">Your Summitt Profile</h2>
          <p className="text-gray-700 mb-6">
            These scores show how consistently you’re living out each Definite
            Dozen principle today. Focus first on the areas marked{" "}
            <span className="font-semibold">“Needs Attention”</span> or{" "}
            <span className="font-semibold">“Developing.”</span>
          </p>

          {/* PERSONALIZED LOWEST-AREA COACHING */}
          {lowest && (
            <div className="mb-8 p-5 border rounded-lg bg-yellow-50 text-sm text-gray-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-yellow-800 mb-2">
                Your #1 Growth Opportunity
              </p>
              <p className="font-semibold mb-1">
                {lowest.label} — {lowest.average.toFixed(2)} / 5 (
                {lowest.band})
              </p>
              <p className="mb-3">
                This is the principle where improving even a little will give
                you the biggest return on your mindset, habits, and leadership
                impact.
              </p>
              <p className="mb-3">
                <span className="font-semibold">One habit to start this week:</span>{" "}
                {growthCoaching[lowest.id]}
              </p>
              <p className="text-xs text-gray-700">
                The Summitt Membership is built to help you steadily raise this
                score over time with coaching, tools, and accountability rooted
                in Pat’s Definite Dozen.
              </p>
            </div>
          )}

          <div className="space-y-4 mb-10">
            {principleOrder.map(({ id, label }) => {
              const item = scores[id];
              return (
                <div
                  key={id}
                  className="border rounded-lg p-4 bg-white shadow-sm"
                >
                  <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2 mb-2">
                    <h3 className="text-lg font-semibold">{label}</h3>
                    <div className="text-sm text-gray-700">
                      <span className="font-semibold">
                        Score: {item.average.toFixed(2)} / 5
                      </span>{" "}
                      · <span>{item.band}</span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-700">{item.summary}</p>
                </div>
              );
            })}
          </div>

          {/* MEMBERSHIP CTA – CLEAN, NO BAIT-AND-SWITCH */}
          <div className="p-5 border rounded-lg bg-gray-50 text-sm text-gray-900">
            <p className="font-semibold mb-2">
              If you want structured help raising these scores…
            </p>
            <p className="mb-3">
              The <span className="font-semibold">Summitt Membership</span>{" "}
              gives you ongoing coaching and tools to live out the Definite
              Dozen:
            </p>
            <ul className="list-disc pl-5 space-y-1 mb-4">
              <li>Monthly coaching focused on your lowest principles</li>
              <li>Access to Ask Pat AI for day-to-day decisions and challenges</li>
              <li>
                Full access to the growing Summitt leadership library and
                future modules
              </li>
              <li>Progress tracking so you can see your scores change over time</li>
            </ul>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-xs text-gray-700">
                Membership is month-to-month. If it stops helping you grow, you
                can cancel anytime.
              </p>
              <a
                href="/subscribe"
                className="inline-flex justify-center rounded-md bg-black px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800 transition"
              >
                Learn About the Summitt Membership
              </a>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
