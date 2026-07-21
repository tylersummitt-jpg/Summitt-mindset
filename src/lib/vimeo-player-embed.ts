/**
 * Shared Vimeo player embed URL builder.
 * Privacy-oriented: HTTPS + dnt=1; never autoplay; never attaches identity/PII.
 */

const VIMEO_NUMERIC_ID = /^\d+$/;

/**
 * Returns a player embed URL, or null if the ID is missing/invalid.
 * Shape: https://player.vimeo.com/video/{id}?dnt=1
 *
 * dnt=1 requests Vimeo’s Do Not Track player option. It does not make playback
 * anonymous or guarantee zero technical logging / essential storage.
 */
export function buildVimeoPlayerEmbedUrl(
  videoId: string | number | null | undefined
): string | null {
  if (videoId === null || videoId === undefined) return null;
  const id = String(videoId).trim();
  if (!VIMEO_NUMERIC_ID.test(id)) return null;
  return `https://player.vimeo.com/video/${id}?dnt=1`;
}
