export type InSeasonActionItem = {
  id: string; // stable key
  text: string;
};

/**
 * ======================================================
 * In-Season Action Library (V2 LOCKED)
 * ======================================================
 *
 * - Neutral
 * - 3–7 minutes
 * - Zero setup
 * - Safe forever
 * - Repeatable
 * - 3rd/4th grade reading level
 *
 * Exactly 120 items.
 */
export const IN_SEASON_ACTIONS: InSeasonActionItem[] = [
  // 1–20 Presence & Awareness (with visible progress)
  { id: "is-001", text: "Pause once today and name what you are bringing into the room." },
  { id: "is-002", text: "Take a quiet moment and name how your body feels right now." },
  { id: "is-003", text: "Slow down for one full minute today." },
  { id: "is-004", text: "Name one moment today when you felt fully here." },
  { id: "is-005", text: "Before you answer someone today, take one slow breath." },
  { id: "is-006", text: "Step outside for one minute and name one thing you see or hear." },
  { id: "is-007", text: "Before one task today, say your first step out loud." },
  { id: "is-008", text: "Name one moment today when your mind drifted away." },
  { id: "is-009", text: "Sit still for one minute today with empty hands." },
  { id: "is-010", text: "Name one place today that helps you feel calm." },
  { id: "is-011", text: "Pause once today before you start the next thing." },
  { id: "is-012", text: "Name one sound today you usually miss." },
  { id: "is-013", text: "Check your posture once today and stand tall for 10 seconds." },
  { id: "is-014", text: "Take one slow breath today and count to four." },
  { id: "is-015", text: "Name one time today when the day felt fast or slow." },
  { id: "is-016", text: "Before one talk today, choose to enter calm." },
  { id: "is-017", text: "Name one habit you did today on auto-pilot." },
  { id: "is-018", text: "Do nothing for one minute today on purpose." },
  { id: "is-019", text: "After one talk today, name how you want people to feel around you." },
  { id: "is-020", text: "Name one small detail today you usually do not see." },

  // 21–40 Effort, Standards & Care (neutral, with proof)
  { id: "is-021", text: "Choose one small thing today and do it the right way." },
  { id: "is-022", text: "Finish one small thing today without rushing." },
  { id: "is-023", text: "Name one moment today when you chose effort over easy." },
  { id: "is-024", text: "Do one task today with one screen, not many." },
  { id: "is-025", text: "Do one normal thing today with full focus." },
  { id: "is-026", text: "Own one small thing today without making excuses." },
  { id: "is-027", text: "Finish one small task today even if it feels tiny." },
  { id: "is-028", text: "Keep one promise you made to yourself today." },
  { id: "is-029", text: "Do one thing today the way you want to do it every day." },
  { id: "is-030", text: "Name one small job today you often treat like it does not matter." },
  { id: "is-031", text: "Do one routine task today with extra care." },
  { id: "is-032", text: "Take 10 extra seconds today to do one thing clean." },
  { id: "is-033", text: "Name one time today when cutting corners sounded good." },
  { id: "is-034", text: "Handle one small detail today that you have been putting off." },
  { id: "is-035", text: "Stay with one task today until it is done." },
  { id: "is-036", text: "Choose steady over intense one time today." },
  { id: "is-037", text: "Treat one small job today like practice for your future." },
  { id: "is-038", text: "Do one helpful thing today without looking for praise." },
  { id: "is-039", text: "Name how you act when a small thing annoys you." },
  { id: "is-040", text: "Finish one small task today and let yourself feel proud." },

  // 41–60 Self-Awareness & Reflection (simple, no shame, with proof)
  { id: "is-041", text: "Name one thought today that shaped how you acted." },
  { id: "is-042", text: "Tonight, write one short line about a moment you will remember." },
  { id: "is-043", text: "Name one thing you avoided today, with no judging." },
  { id: "is-044", text: "Name one quick reaction you had today." },
  { id: "is-045", text: "Name one moment today when you felt steady." },
  { id: "is-046", text: "Name one feeling you had today without trying to change it." },
  { id: "is-047", text: "Write one sentence about a choice you made today." },
  { id: "is-048", text: "Name one moment today when you did not want to do something." },
  { id: "is-049", text: "Notice your self-talk once today and write one kinder line." },
  { id: "is-050", text: "Name one time today when you felt calm or tight inside." },
  { id: "is-051", text: "Name what took most of your focus today." },
  { id: "is-052", text: "Name one habit you did today without thinking." },
  { id: "is-053", text: "Name one moment today when you acted on purpose." },
  { id: "is-054", text: "Name one time today when you did not know what would happen next." },
  { id: "is-055", text: "After one talk today, name what you wish you had said in one line." },
  { id: "is-056", text: "Name one story your mind told today that may not be true." },
  { id: "is-057", text: "Name one time today when plans changed." },
  { id: "is-058", text: "Name one moment today when you felt rushed." },
  { id: "is-059", text: "Name one moment today when you felt grounded." },
  { id: "is-060", text: "Tonight, take one minute to list three quick moments from your day." },

  // 61–80 Communication & Interaction (simple, with agency/proof)
  { id: "is-061", text: "Listen fully to one person today without planning your reply." },
  { id: "is-062", text: "Name your tone once today: soft, sharp, calm, or rushed." },
  { id: "is-063", text: "Let one short pause happen in a talk today." },
  { id: "is-064", text: "Name one talk today that felt calm or tense." },
  { id: "is-065", text: "Say fewer words in one moment today." },
  { id: "is-066", text: "Let someone finish their thought today before you speak." },
  { id: "is-067", text: "When someone disagrees today, take one breath before you answer." },
  { id: "is-068", text: "Name one time today when you wanted to protect yourself in a talk." },
  { id: "is-069", text: "Speak a little slower in one talk today." },
  { id: "is-070", text: "Choose listening over explaining one time today." },
  { id: "is-071", text: "In one talk today, notice your body and relax your shoulders once." },
  { id: "is-072", text: "Before you answer one question today, pause for one beat." },
  { id: "is-073", text: "Let a few seconds of silence happen once today." },
  { id: "is-074", text: "Name how you want to enter a talk: calm, kind, or clear." },
  { id: "is-075", text: "Name one time today when you felt seen or not seen." },
  { id: "is-076", text: "Reply to one message today with care, not speed." },
  { id: "is-077", text: "Ask one clear question today." },
  { id: "is-078", text: "Name one habit you bring into talks (like rushing, joking, or fixing)." },
  { id: "is-079", text: "Thank someone today in one short line." },
  { id: "is-080", text: "Be fully here for one short talk today." },

  // 81–100 Emotional Strength & Calm (neutral, no therapy words, with agency)
  { id: "is-081", text: "Name one moment today when you felt annoyed." },
  { id: "is-082", text: "When one thing goes off plan today, pause for one slow breath." },
  { id: "is-083", text: "Name one hard feeling today and let it sit for 10 seconds." },
  { id: "is-084", text: "Name one small upset today and choose to reset." },
  { id: "is-085", text: "When you feel tight today, take one steady breath." },
  { id: "is-086", text: "While you wait today, relax your jaw and shoulders once." },
  { id: "is-087", text: "Name one moment today when you felt pressure." },
  { id: "is-088", text: "Give yourself one quiet minute today with no fixing." },
  { id: "is-089", text: "Name where stress shows up for you (head, chest, or stomach)." },
  { id: "is-090", text: "Let one small thing be out of your control today." },
  { id: "is-091", text: "Name one small setback today and choose the next step." },
  { id: "is-092", text: "When feelings rise today, pause and count to three." },
  { id: "is-093", text: "If you make a small mistake today, say: 'I can learn' once." },
  { id: "is-094", text: "Name one moment today when you felt relief." },
  { id: "is-095", text: "Stay with one hard moment today for 10 seconds before you move on." },
  { id: "is-096", text: "Name when your energy felt high and when it felt low today." },
  { id: "is-097", text: "Choose calm for one small challenge today." },
  { id: "is-098", text: "Let one small thing be 'good enough' today without shame." },
  { id: "is-099", text: "When plans change today, say: 'I can adjust' once." },
  { id: "is-100", text: "Take one minute today to reset: breathe in, breathe out, start again." },

  // 101–120 Closing / Integration / Continuity (end with ownership)
  { id: "is-101", text: "Tonight, name one thing you showed up for today." },
  { id: "is-102", text: "Name one way you move from work to rest." },
  { id: "is-103", text: "Write one short line: 'What helped me today was ___'." },
  { id: "is-104", text: "Name one small thing you can do today that helps tomorrow." },
  { id: "is-105", text: "Name one effort you made today, even if it was small." },
  { id: "is-106", text: "Tonight, slow down on purpose for one minute." },
  { id: "is-107", text: "Name one thing today that supported you." },
  { id: "is-108", text: "Write one line you want to let go of tonight." },
  { id: "is-109", text: "Close one small loop tonight by writing the next step for it." },
  { id: "is-110", text: "Name how you want to feel when the day ends." },
  { id: "is-111", text: "Name one thing you handled better than before." },
  { id: "is-112", text: "Tonight, take one quiet moment and let your body settle." },
  { id: "is-113", text: "Name one small win from today." },
  { id: "is-114", text: "Name one thing you do that helps you unwind." },
  { id: "is-115", text: "Name one thought you do not need to carry into sleep." },
  { id: "is-116", text: "Tonight, give yourself permission to stop thinking about the day." },
  { id: "is-117", text: "Tonight, rest without trying to earn it." },
  { id: "is-118", text: "Name one thing you are leaving behind tonight." },
  { id: "is-119", text: "Write one line that closes your day: 'Today, I chose ___'." },
  { id: "is-120", text: "Take one quiet minute before sleep tonight." },
];

if (IN_SEASON_ACTIONS.length !== 120) {
  throw new Error(`IN_SEASON_ACTIONS must contain exactly 120 items. Found ${IN_SEASON_ACTIONS.length}.`);
}