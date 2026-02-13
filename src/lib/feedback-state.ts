import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";

/**
 * ======================================================
 * Feedback State Guardrails (CANONICAL)
 * ======================================================
 *
 * Prevents Summitt from ever feeling like survey software.
 *
 * Stored in Clerk publicMetadata:
 *
 * feedbackState: {
 *   lastPromptedAt: ISO string | null
 *   ignoredCount: number
 *   pausedUntil: ISO string | null
 * }
 */

export type FeedbackState = {
  lastPromptedAt: string | null;
  ignoredCount: number;
  pausedUntil: string | null;
};

function normalize(state: any): FeedbackState {
  return {
    lastPromptedAt:
      typeof state?.lastPromptedAt === "string"
        ? state.lastPromptedAt
        : null,

    ignoredCount:
      typeof state?.ignoredCount === "number" ? state.ignoredCount : 0,

    pausedUntil:
      typeof state?.pausedUntil === "string" ? state.pausedUntil : null,
  };
}

/**
 * ✅ Returns current feedbackState from Clerk
 */
export async function getFeedbackState(
  userId: string
): Promise<FeedbackState> {
  const metadata = await getClerkPublicMetadata(userId);
  return normalize(metadata.feedbackState);
}

/**
 * ✅ Record that a feedback prompt was shown today
 */
export async function recordFeedbackPromptShown(userId: string) {
  const now = new Date().toISOString();

  const state = await getFeedbackState(userId);

  await updateClerkPublicMetadata(userId, {
    feedbackState: {
      ...state,
      lastPromptedAt: now,
    },
  });
}

/**
 * ✅ Record that user ignored a prompt (dismissed or skipped)
 * After 2 ignores → pause for 7 days
 */
export async function recordFeedbackIgnored(userId: string) {
  const state = await getFeedbackState(userId);

  const nextIgnored = state.ignoredCount + 1;

  let pausedUntil = state.pausedUntil;

  // ✅ Ignore twice → pause 7 days
  if (nextIgnored >= 2) {
    const pause = new Date();
    pause.setDate(pause.getDate() + 7);
    pausedUntil = pause.toISOString();
  }

  await updateClerkPublicMetadata(userId, {
    feedbackState: {
      ...state,
      ignoredCount: nextIgnored,
      pausedUntil,
    },
  });
}

/**
 * ✅ If user gives written feedback → pause prompts for 3 days
 */
export async function pauseFeedbackAfterText(userId: string) {
  const state = await getFeedbackState(userId);

  const pause = new Date();
  pause.setDate(pause.getDate() + 3);

  await updateClerkPublicMetadata(userId, {
    feedbackState: {
      ...state,
      ignoredCount: 0, // reset ignore counter
      pausedUntil: pause.toISOString(),
    },
  });
}

/**
 * ✅ Check whether feedback is currently paused
 */
export async function isFeedbackPaused(userId: string): Promise<boolean> {
  const state = await getFeedbackState(userId);

  if (!state.pausedUntil) return false;

  return new Date(state.pausedUntil) > new Date();
}
