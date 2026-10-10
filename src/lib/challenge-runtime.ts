import "server-only";

import {
  enrollChallenge,
  processDueChallengeLessons,
  reenrollChallenge,
  unsubscribeChallenge,
  type ChallengeCronResult,
  type ReenrollResult,
} from "@/lib/challenge-sequence";
import { createSupabaseChallengeStore } from "@/lib/challenge-supabase-store";
import { isUnsubscribeTokenShape } from "@/lib/challenge-send-outcome";
import { notifyChallengeDeliveryAttention } from "@/lib/notify-challenge-delivery-attention";
import { sendChallengeEmail } from "@/lib/send-challenge-email";
import type { PublicSignupResult } from "@/lib/challenge-types";

function deps() {
  return {
    store: createSupabaseChallengeStore(),
    send: sendChallengeEmail,
    notifyAttention: notifyChallengeDeliveryAttention,
  };
}

export function enrollChallengeEmail(email: string): Promise<PublicSignupResult> {
  return enrollChallenge(deps(), email);
}

export function runChallengeCron(): Promise<ChallengeCronResult> {
  return processDueChallengeLessons(deps());
}

export function unsubscribeChallengeToken(token: string) {
  return unsubscribeChallenge(deps(), token);
}

export function reenrollChallengeToken(token: string): Promise<ReenrollResult> {
  return reenrollChallenge(deps(), token);
}

export async function loadChallengeUnsubscribeView(tokenRaw: string): Promise<
  | { kind: "invalid" }
  | { kind: "confirm"; token: string }
  | { kind: "suppressed"; token: string; completed: boolean }
> {
  const token = tokenRaw.trim();
  if (!isUnsubscribeTokenShape(token)) return { kind: "invalid" };
  const row = await deps().store.findByToken(token);
  if (!row) return { kind: "invalid" };
  if (row.suppressedAt || row.completed) {
    return { kind: "suppressed", token, completed: row.completed };
  }
  return { kind: "confirm", token };
}
