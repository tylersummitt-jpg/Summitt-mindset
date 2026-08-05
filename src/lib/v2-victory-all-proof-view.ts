/**
 * All Wins page loader — public archive from `v2_win` (not commitment-event proof).
 * Prefer calling `loadPublicAllWinsForUser` directly; this module remains for the all-proof route name.
 */

import "server-only";

import {
  loadPublicAllWinsForUser,
  type PublicAllWinsResult,
} from "@/lib/v2-win-public-read";

export type VictoryAllProofViewData = PublicAllWinsResult;

export async function loadVictoryAllProofView(
  clerkUserId: string,
  options?: { cursorRaw?: string | null; pageLimit?: number }
): Promise<VictoryAllProofViewData> {
  return loadPublicAllWinsForUser({
    clerkUserId,
    cursorRaw: options?.cursorRaw,
    pageLimit: options?.pageLimit,
  });
}
