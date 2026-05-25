import type { EvolutionV1RecommendedAction } from "@/lib/v2-commitment-evolution-engine-v1";

/** Full copy for Daily OS evolution card. */
export function evolutionV1SurfaceCopy(action: EvolutionV1RecommendedAction): {
  headline: string;
  body: string;
} {
  switch (action) {
    case "reframe_commitment":
      return {
        headline: "Coach read: the bar may feel heavy",
        body: "A recent reply looked like the commitment is weighing on you. You do not need to change anything here in the app—this is guidance only. Use your text thread with Pat for the next check-in, or finish any guided follow-up if you already opened one.",
      };
    case "refresh_commitment_only":
      return {
        headline: "Coach read: refresh in progress",
        body: "You have an active coaching refresh in progress. Continue in your text thread with Pat (YES / SAME / CHANGE / STILL and the follow-up prompts there). This dashboard does not replace that flow.",
      };
    default:
      return { headline: "", body: "" };
  }
}

const VICTORY_ROOM_NUDGE_HEADLINE = "Coach Pat has a recommendation";

/** Short SMS-first copy for Victory Room nudge only. */
export function evolutionVictoryRoomNudgeCopy(action: EvolutionV1RecommendedAction): {
  headline: string;
  body: string;
} {
  switch (action) {
    case "reframe_commitment":
      return {
        headline: VICTORY_ROOM_NUDGE_HEADLINE,
        body: "There may be a better way to hold this standard. Review the recommendation — then use your text thread with Pat for the next check-in.",
      };
    case "refresh_commitment_only":
      return {
        headline: VICTORY_ROOM_NUDGE_HEADLINE,
        body: "A coaching refresh may be in progress. Review the recommendation — and continue by text with Pat when you are ready.",
      };
    default:
      return {
        headline: VICTORY_ROOM_NUDGE_HEADLINE,
        body: "There may be a better way to hold this standard. Review the recommendation.",
      };
  }
}
