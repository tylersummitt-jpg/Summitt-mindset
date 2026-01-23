export type InSeasonActionItem = {
  id: string; // stable key
  text: string;
};

/**
 * ======================================================
 * In-Season Action Library (V1 LOCKED)
 * ======================================================
 *
 * - Neutral
 * - 3–7 minutes
 * - Zero setup
 * - Safe forever
 * - Repeatable
 *
 * Exactly 120 items.
 */
export const IN_SEASON_ACTIONS: InSeasonActionItem[] = [
  // 1–20 Presence & Awareness
  { id: "is-001", text: "Pause once today and notice what you’re bringing into the room." },
  { id: "is-002", text: "Take one quiet moment today to notice how your body feels." },
  { id: "is-003", text: "At some point today, slow your pace for one full minute." },
  { id: "is-004", text: "Notice one moment today where you felt fully present." },
  { id: "is-005", text: "Before responding to someone today, take one breath." },
  { id: "is-006", text: "Step outside briefly today and notice what you see or hear." },
  { id: "is-007", text: "Pay attention to how you start one task today." },
  { id: "is-008", text: "Notice one moment today when your attention wandered." },
  { id: "is-009", text: "Sit still for one minute today without reaching for anything." },
  { id: "is-010", text: "Notice how your environment affects your mood today." },
  { id: "is-011", text: "Pause once today before transitioning to the next thing." },
  { id: "is-012", text: "Notice one sound today that you usually tune out." },
  { id: "is-013", text: "Pay attention to your posture at one point today." },
  { id: "is-014", text: "Take one intentional breath today with no agenda." },
  { id: "is-015", text: "Notice one moment today where time felt slower or faster." },
  { id: "is-016", text: "Observe how you enter one conversation today." },
  { id: "is-017", text: "Notice one habit today that runs automatically." },
  { id: "is-018", text: "Spend one minute today doing nothing on purpose." },
  { id: "is-019", text: "Pay attention to how you end one interaction today." },
  { id: "is-020", text: "Notice one small detail today that you normally miss." },

  // 21–40 Effort, Standards & Care (neutral)
  { id: "is-021", text: "Choose one small thing today and do it the right way." },
  { id: "is-022", text: "Follow through on one thing today without rushing it." },
  { id: "is-023", text: "Notice one moment today where you chose effort over ease." },
  { id: "is-024", text: "Finish one task today without multitasking." },
  { id: "is-025", text: "Do one ordinary thing today with full attention." },
  { id: "is-026", text: "Take responsibility for one small thing today without explaining it." },
  { id: "is-027", text: "Complete one task today even if it feels unimportant." },
  { id: "is-028", text: "Keep one promise you made to yourself today." },
  { id: "is-029", text: "Do one thing today the way you’d want it done every day." },
  { id: "is-030", text: "Notice how you treat small responsibilities today." },
  { id: "is-031", text: "Show care in one routine task today." },
  { id: "is-032", text: "Take one extra moment today to do something cleanly." },
  { id: "is-033", text: "Notice one place today where cutting corners was tempting." },
  { id: "is-034", text: "Handle one detail today without delegating or delaying it." },
  { id: "is-035", text: "Stay with one task today until it’s finished." },
  { id: "is-036", text: "Choose consistency over intensity once today." },
  { id: "is-037", text: "Treat one obligation today as practice." },
  { id: "is-038", text: "Do one thing today without seeking credit." },
  { id: "is-039", text: "Notice how you respond to inconvenience today." },
  { id: "is-040", text: "Complete one small task today with quiet pride." },

  // 41–60 Self-Awareness & Reflection
  { id: "is-041", text: "Notice one thought today that influenced how you showed up." },
  { id: "is-042", text: "At the end of the day, recall one moment that stayed with you." },
  { id: "is-043", text: "Pay attention to what you avoided today, without judging it." },
  { id: "is-044", text: "Notice one reaction today before explaining it to yourself." },
  { id: "is-045", text: "Name one moment today that felt steady." },
  { id: "is-046", text: "Notice one emotion today without trying to change it." },
  { id: "is-047", text: "Reflect briefly on one decision you made today." },
  { id: "is-048", text: "Notice one moment today where you felt resistance." },
  { id: "is-049", text: "Pay attention to how you speak to yourself today." },
  { id: "is-050", text: "Recall one moment today where you felt calm or tense." },
  { id: "is-051", text: "Notice what drew your focus most today." },
  { id: "is-052", text: "Observe one habit today without correcting it." },
  { id: "is-053", text: "Identify one moment today that felt intentional." },
  { id: "is-054", text: "Notice how you respond to uncertainty today." },
  { id: "is-055", text: "Reflect on one interaction today after it ends." },
  { id: "is-056", text: "Notice one assumption you made today." },
  { id: "is-057", text: "Pay attention to how you react when plans change today." },
  { id: "is-058", text: "Observe one moment today when you felt rushed." },
  { id: "is-059", text: "Recall one moment today when you felt grounded." },
  { id: "is-060", text: "Take one minute tonight to mentally review your day." },

  // 61–80 Communication & Interaction
  { id: "is-061", text: "Listen fully to one person today without planning your response." },
  { id: "is-062", text: "Notice how your tone changes in one conversation today." },
  { id: "is-063", text: "Allow one brief pause in a conversation today." },
  { id: "is-064", text: "Notice one interaction today that felt calm or tense." },
  { id: "is-065", text: "Say less than usual in one moment today." },
  { id: "is-066", text: "Let someone finish their thought today without interrupting." },
  { id: "is-067", text: "Pay attention to how you respond when someone disagrees with you." },
  { id: "is-068", text: "Notice one conversation today where you felt defensive." },
  { id: "is-069", text: "Speak more slowly in one conversation today." },
  { id: "is-070", text: "Choose listening over explaining once today." },
  { id: "is-071", text: "Notice how your body reacts during a conversation today." },
  { id: "is-072", text: "Pause before answering a question today." },
  { id: "is-073", text: "Let silence exist briefly in one interaction today." },
  { id: "is-074", text: "Observe how you enter and exit conversations today." },
  { id: "is-075", text: "Notice one moment today where you felt understood or not." },
  { id: "is-076", text: "Respond to one message today with care, not speed." },
  { id: "is-077", text: "Pay attention to how you ask one question today." },
  { id: "is-078", text: "Notice one habit you bring into conversations today." },
  { id: "is-079", text: "Acknowledge someone today without adding anything else." },
  { id: "is-080", text: "Be fully present in one short conversation today." },

  // 81–100 Emotional Regulation & Resilience (neutral)
  { id: "is-081", text: "Notice one moment today when you felt irritated." },
  { id: "is-082", text: "Pause briefly when something doesn’t go as planned today." },
  { id: "is-083", text: "Allow one uncomfortable feeling today without reacting to it." },
  { id: "is-084", text: "Notice how you recover after a small frustration today." },
  { id: "is-085", text: "Take one steady breath when you feel tension today." },
  { id: "is-086", text: "Observe how you handle waiting today." },
  { id: "is-087", text: "Notice one moment today when you felt pressure." },
  { id: "is-088", text: "Give yourself a moment today without trying to fix anything." },
  { id: "is-089", text: "Pay attention to how stress shows up for you today." },
  { id: "is-090", text: "Allow one moment today to pass without controlling it." },
  { id: "is-091", text: "Notice how you respond to minor setbacks today." },
  { id: "is-092", text: "Pause once today when emotions rise." },
  { id: "is-093", text: "Observe how quickly you move on from a mistake today." },
  { id: "is-094", text: "Notice one moment today when you felt relief." },
  { id: "is-095", text: "Stay present with one uncomfortable moment today." },
  { id: "is-096", text: "Notice how your energy shifts throughout the day." },
  { id: "is-097", text: "Respond calmly to one small challenge today." },
  { id: "is-098", text: "Allow one situation today to be imperfect." },
  { id: "is-099", text: "Observe how you react to unexpected changes today." },
  { id: "is-100", text: "Take one moment today to reset before continuing." },

  // 101–120 Closing / Integration / Continuity
  { id: "is-101", text: "End your day today by acknowledging one thing you showed up for." },
  { id: "is-102", text: "Notice how you transition from work to rest today." },
  { id: "is-103", text: "Reflect briefly on what carried you through the day." },
  { id: "is-104", text: "Pay attention to how you prepare for tomorrow today." },
  { id: "is-105", text: "Acknowledge one effort you made today, quietly." },
  { id: "is-106", text: "Take one moment tonight to slow down intentionally." },
  { id: "is-107", text: "Notice one thing today that supported you." },
  { id: "is-108", text: "Let go of one unfinished thought tonight." },
  { id: "is-109", text: "Close one mental loop today before resting." },
  { id: "is-110", text: "Notice how you end your day emotionally." },
  { id: "is-111", text: "Reflect on one thing you handled better than before." },
  { id: "is-112", text: "Take one moment tonight to feel settled." },
  { id: "is-113", text: "Acknowledge one ordinary win today." },
  { id: "is-114", text: "Pay attention to how you unwind today." },
  { id: "is-115", text: "Notice what you carry with you into rest tonight." },
  { id: "is-116", text: "End the day today without replaying everything." },
  { id: "is-117", text: "Allow yourself to stop today without earning it." },
  { id: "is-118", text: "Notice one thing you’re leaving behind tonight." },
  { id: "is-119", text: "Close the day today with intention." },
  { id: "is-120", text: "Take one quiet moment tonight before sleep." },
];

if (IN_SEASON_ACTIONS.length !== 120) {
  throw new Error(`IN_SEASON_ACTIONS must contain exactly 120 items. Found ${IN_SEASON_ACTIONS.length}.`);
}
