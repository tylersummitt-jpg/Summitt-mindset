/**
 * Optional Victory Media enrichment for public Win DTOs.
 * Canonical v2_win load must succeed independently — this never throws page-breaking errors.
 */

import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import type { PublicWinDto, PublicWinMediaDto } from "@/lib/v2-win-public-read";
import {
  VICTORY_MEDIA_BUCKET,
  VICTORY_MEDIA_SIGNED_READ_TTL_SECONDS,
} from "@/lib/victory-media/constants";

/** Columns needed for card display signing only (never master / provenance). */
export const PUBLIC_WIN_MEDIA_SELECT_COLUMNS =
  "id, win_id, clerk_user_id, storage_card_path, card_width, card_height" as const;

type MediaRow = {
  id: string;
  win_id: string;
  clerk_user_id: string;
  storage_card_path: string;
  card_width: number;
  card_height: number;
};

type SignedUrlItem = {
  error: string | null;
  path: string | null;
  signedUrl: string | null;
};

export type EnrichPublicWinsWithMediaDeps = {
  /**
   * Returns media rows, or `null` when the query failed (caller falls back text-only).
   * Empty array = no media attached.
   */
  listMediaForWins: (args: {
    clerkUserId: string;
    winIds: string[];
  }) => Promise<MediaRow[] | null>;
  createSignedUrls: (
    paths: string[],
    expiresIn: number
  ) => Promise<{
    data: SignedUrlItem[] | null;
    error: { message: string } | null;
  }>;
};

function isPositiveInt(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 && Math.floor(n) === n;
}

function isTrustedMediaRow(
  raw: unknown,
  clerkUserId: string,
  winIdSet: Set<string>
): raw is MediaRow {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id.trim()) return false;
  if (typeof r.win_id !== "string" || !winIdSet.has(r.win_id)) return false;
  if (typeof r.clerk_user_id !== "string" || r.clerk_user_id !== clerkUserId) return false;
  if (typeof r.storage_card_path !== "string" || !r.storage_card_path.trim()) return false;
  if (!isPositiveInt(r.card_width) || !isPositiveInt(r.card_height)) return false;
  return true;
}

async function defaultListMediaForWins(args: {
  clerkUserId: string;
  winIds: string[];
}): Promise<MediaRow[] | null> {
  const { data, error } = await supabaseServer
    .from("v2_win_media")
    .select(PUBLIC_WIN_MEDIA_SELECT_COLUMNS)
    .eq("clerk_user_id", args.clerkUserId)
    .in("win_id", args.winIds);

  if (error) {
    console.error("[victory-media/enrich] media query failed", {
      clerk_user_id: args.clerkUserId,
      win_count: args.winIds.length,
      message: error.message,
    });
    return null;
  }

  return (data ?? []) as MediaRow[];
}

async function defaultCreateSignedUrls(
  paths: string[],
  expiresIn: number
): Promise<{
  data: SignedUrlItem[] | null;
  error: { message: string } | null;
}> {
  const { data, error } = await supabaseServer.storage
    .from(VICTORY_MEDIA_BUCKET)
    .createSignedUrls(paths, expiresIn);

  if (error) {
    return { data: null, error: { message: error.message } };
  }

  const items: SignedUrlItem[] = (data ?? []).map((item) => ({
    error: item.error ?? null,
    path: item.path ?? null,
    signedUrl: item.signedUrl ?? null,
  }));

  return { data: items, error: null };
}

function resolveDeps(deps?: EnrichPublicWinsWithMediaDeps): EnrichPublicWinsWithMediaDeps {
  return {
    listMediaForWins: deps?.listMediaForWins ?? defaultListMediaForWins,
    createSignedUrls: deps?.createSignedUrls ?? defaultCreateSignedUrls,
  };
}

/**
 * Attach optional signed card media to already-loaded public Wins.
 * Never mutates DB. Never persists signed URLs. Never throws for media failures.
 */
export async function enrichPublicWinsWithMedia(
  args: {
    clerkUserId: string;
    wins: PublicWinDto[];
  },
  deps?: EnrichPublicWinsWithMediaDeps
): Promise<PublicWinDto[]> {
  const wins = args.wins;
  if (wins.length === 0) return wins;

  const clerkUserId = args.clerkUserId.trim();
  if (!clerkUserId) return wins;

  const winIds = wins.map((w) => w.id);
  const winIdSet = new Set(winIds);
  const { listMediaForWins, createSignedUrls } = resolveDeps(deps);

  let rows: MediaRow[] | null;
  try {
    rows = await listMediaForWins({ clerkUserId, winIds });
  } catch (err) {
    console.error("[victory-media/enrich] media query threw", {
      clerk_user_id: clerkUserId,
      message: err instanceof Error ? err.message : String(err),
    });
    return wins;
  }

  if (rows === null) {
    return wins;
  }

  if (rows.length === 0) {
    return wins;
  }

  /** One trusted media row per win (UNIQUE(win_id); first valid wins). */
  const mediaByWinId = new Map<string, MediaRow>();
  for (const raw of rows) {
    if (!isTrustedMediaRow(raw, clerkUserId, winIdSet)) continue;
    if (mediaByWinId.has(raw.win_id)) continue;
    mediaByWinId.set(raw.win_id, {
      id: raw.id.trim(),
      win_id: raw.win_id,
      clerk_user_id: raw.clerk_user_id,
      storage_card_path: raw.storage_card_path.trim(),
      card_width: raw.card_width,
      card_height: raw.card_height,
    });
  }

  if (mediaByWinId.size === 0) {
    return wins;
  }

  const trustedRows = [...mediaByWinId.values()];
  const paths = trustedRows.map((r) => r.storage_card_path);

  let signed: {
    data: SignedUrlItem[] | null;
    error: { message: string } | null;
  };
  try {
    signed = await createSignedUrls(paths, VICTORY_MEDIA_SIGNED_READ_TTL_SECONDS);
  } catch (err) {
    console.error("[victory-media/enrich] createSignedUrls threw", {
      clerk_user_id: clerkUserId,
      path_count: paths.length,
      message: err instanceof Error ? err.message : String(err),
    });
    return wins;
  }

  if (signed.error || !signed.data) {
    console.error("[victory-media/enrich] createSignedUrls failed", {
      clerk_user_id: clerkUserId,
      path_count: paths.length,
      message: signed.error?.message ?? "missing_data",
    });
    return wins;
  }

  const urlByPath = new Map<string, string>();
  for (const item of signed.data) {
    if (item.error) continue;
    const path = typeof item.path === "string" ? item.path.trim() : "";
    const url = typeof item.signedUrl === "string" ? item.signedUrl.trim() : "";
    if (!path || !url) continue;
    urlByPath.set(path, url);
  }

  return wins.map((win) => {
    const row = mediaByWinId.get(win.id);
    if (!row) return win;
    const cardUrl = urlByPath.get(row.storage_card_path);
    if (!cardUrl) return win;

    const media: PublicWinMediaDto = {
      id: row.id,
      cardUrl,
      width: row.card_width,
      height: row.card_height,
    };

    return { ...win, media };
  });
}
