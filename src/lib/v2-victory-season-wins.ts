/**
 * Season-scoped active Wins from public.v2_win.
 * Membership = commitment_id only. Source-agnostic (manual + SMS/accountability).
 */

import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import { enrichPublicWinsWithMedia } from "@/lib/victory-media/enrich-public-wins-with-media";
import {
  mapV2WinRowToPublicDto,
  PUBLIC_WIN_SELECT_COLUMNS,
  type PublicWinDto,
} from "@/lib/v2-win-public-read";

/** Bounded Season detail list — aligns with Season proof display cap; no pagination in this patch. */
export const SEASON_WINS_DISPLAY_LIMIT = 20;

type WinRow = {
  id: string;
  occurred_at: string;
  display_title: string;
  display_body: string;
  supporting_quote: string | null;
  sensitivity_caution: boolean;
  celebration_appropriate: boolean;
  commitment_id: string | null;
  status: string;
  updated_at: string;
};

function isWinRow(raw: unknown): raw is WinRow {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.occurred_at === "string" &&
    typeof r.display_title === "string" &&
    typeof r.display_body === "string" &&
    typeof r.updated_at === "string"
  );
}

/**
 * Load active Wins for one owned Season's commitment.
 * Caller must pass clerkUserId + commitmentId already authorized from owned Season.
 */
export async function loadActiveWinsForSeasonCommitment(args: {
  clerkUserId: string;
  commitmentId: string;
  limit?: number;
}): Promise<PublicWinDto[]> {
  const clerk = args.clerkUserId.trim();
  const commitmentId = args.commitmentId.trim();
  if (!clerk || !commitmentId) return [];

  const limit = Math.max(
    1,
    Math.min(args.limit ?? SEASON_WINS_DISPLAY_LIMIT, SEASON_WINS_DISPLAY_LIMIT)
  );

  const { data, error } = await supabaseServer
    .from("v2_win")
    .select(PUBLIC_WIN_SELECT_COLUMNS)
    .eq("clerk_user_id", clerk)
    .eq("commitment_id", commitmentId)
    .eq("status", "active")
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[v2-victory-season-wins] load failed", {
      clerk_user_id: clerk,
      commitment_id: commitmentId,
      message: error.message,
    });
    return [];
  }

  const wins = (data ?? [])
    .filter(isWinRow)
    .map((row) => mapV2WinRowToPublicDto(row));

  return enrichPublicWinsWithMedia({ clerkUserId: clerk, wins });
}
