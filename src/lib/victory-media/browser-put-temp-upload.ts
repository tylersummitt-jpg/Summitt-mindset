/**
 * Direct browser PUT of a selected File to a Victory Media signed temp upload URL.
 * No Supabase client. Token is expected inside signedUrl (query param).
 */

export type BrowserPutTempUploadArgs = {
  signedUrl: string;
  file: Blob;
  declaredMime: string;
};

export type BrowserPutTempUploadResult =
  | { ok: true }
  | { ok: false; reason: "network" | "http" | "invalid_input" };

/**
 * PUT raw bytes to the signed temp URL with Content-Type = declared MIME.
 * Does not log the URL or token.
 */
export async function uploadVictoryMediaTempObject(
  args: BrowserPutTempUploadArgs
): Promise<BrowserPutTempUploadResult> {
  const signedUrl = typeof args.signedUrl === "string" ? args.signedUrl.trim() : "";
  const declaredMime =
    typeof args.declaredMime === "string" ? args.declaredMime.trim().toLowerCase() : "";
  if (!signedUrl || !declaredMime || !args.file) {
    return { ok: false, reason: "invalid_input" };
  }

  let res: Response;
  try {
    res = await fetch(signedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": declaredMime,
      },
      body: args.file,
    });
  } catch {
    return { ok: false, reason: "network" };
  }

  if (!res.ok) {
    return { ok: false, reason: "http" };
  }
  return { ok: true };
}
