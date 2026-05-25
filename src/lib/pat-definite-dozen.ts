export type PatPrincipleId =
  | "respect_self_and_others"
  | "take_full_responsibility"
  | "loyalty"
  | "great_communicator"
  | "discipline_yourself"
  | "hard_work_passion"
  | "work_smart"
  | "team_before_self"
  | "winning_attitude"
  | "be_a_competitor"
  | "change_is_a_must"
  | "handle_success_and_failure";

export type PatPrincipleDefinition = {
  id: PatPrincipleId;
  order: number;
  title: string;
  shortCoachLine: string;
  focusPracticeHint: string;
};

export const PAT_DEFINITE_DOZEN: readonly PatPrincipleDefinition[] = [
  {
    id: "respect_self_and_others",
    order: 1,
    title: "Respect Yourself and Others",
    shortCoachLine:
      "Hold yourself to honest standards and treat the people around you with dignity.",
    focusPracticeHint:
      "Speak clearly and keep your word in one relationship that matters this week.",
  },
  {
    id: "take_full_responsibility",
    order: 2,
    title: "Take Full Responsibility",
    shortCoachLine: "Own your choices without excuses when you miss or when you follow through.",
    focusPracticeHint:
      "When you miss, name it plainly and say what you will do next — no blame shifting.",
  },
  {
    id: "loyalty",
    order: 3,
    title: "Develop and Demonstrate Loyalty",
    shortCoachLine: "Stay committed to people and promises that define who you are becoming.",
    focusPracticeHint: "Pick one promise you made and follow through on it before the week ends.",
  },
  {
    id: "great_communicator",
    order: 4,
    title: "Learn to Be a Great Communicator",
    shortCoachLine: "Say what is true early so others are not left guessing.",
    focusPracticeHint: "Give one clear update before someone has to ask how you are doing.",
  },
  {
    id: "discipline_yourself",
    order: 5,
    title: "Discipline Yourself So No One Else Has To",
    shortCoachLine: "Build the habit before you need motivation.",
    focusPracticeHint: "Do the daily bar you agreed to before the day gets away from you.",
  },
  {
    id: "hard_work_passion",
    order: 6,
    title: "Make Hard Work Your Passion",
    shortCoachLine: "Show up with effort that matches the standard you set for yourself.",
    focusPracticeHint: "Protect one block of time for your commitment and treat it as non-negotiable.",
  },
  {
    id: "work_smart",
    order: 7,
    title: "Don’t Just Work Hard, Work Smart",
    shortCoachLine: "Adjust the plan when the old way stops working instead of quitting.",
    focusPracticeHint: "If the bar feels too heavy, shrink it honestly instead of disappearing.",
  },
  {
    id: "team_before_self",
    order: 8,
    title: "Put the Team Before Yourself",
    shortCoachLine: "Let the people counting on you see you show up for the shared standard.",
    focusPracticeHint: "Do one act this week that helps someone else succeed, not just you.",
  },
  {
    id: "winning_attitude",
    order: 9,
    title: "Make Winning an Attitude",
    shortCoachLine: "Bring competitive focus to the daily bar, not just the big moment.",
    focusPracticeHint: "Treat today’s check-in as a chance to win the day, not coast through it.",
  },
  {
    id: "be_a_competitor",
    order: 10,
    title: "Be a Competitor",
    shortCoachLine: "Come back after a miss and stay in the fight.",
    focusPracticeHint: "After a miss, answer honestly and take the next check-in instead of going quiet.",
  },
  {
    id: "change_is_a_must",
    order: 11,
    title: "Change Is a Must",
    shortCoachLine: "Grow the goal when the season calls for a new chapter.",
    focusPracticeHint: "Name one honest adjustment your commitment needs this week.",
  },
  {
    id: "handle_success_and_failure",
    order: 12,
    title: "Handle Success Like You Handle Failure",
    shortCoachLine: "Stay grounded when you win and when you stumble.",
    focusPracticeHint: "After a win or a miss, stay in the conversation instead of checking out.",
  },
] as const;

const BY_ID = new Map(PAT_DEFINITE_DOZEN.map((p) => [p.id, p]));

export function getPatPrincipleById(id: PatPrincipleId): PatPrincipleDefinition {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`Unknown principle id: ${id}`);
  return p;
}

export function isPatPrincipleId(value: string): value is PatPrincipleId {
  return BY_ID.has(value as PatPrincipleId);
}

export const PAT_PRINCIPLE_IDS: PatPrincipleId[] = PAT_DEFINITE_DOZEN.map((p) => p.id);
