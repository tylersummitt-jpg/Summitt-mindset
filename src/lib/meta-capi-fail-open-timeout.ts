/**
 * Bound optional Meta identifier I/O so attribution cannot hang billing.
 * Timeout resolves to the fallback; the original work may still finish later.
 * Never logs the raced value.
 */

export const META_CAPI_WEB_IDENTIFIERS_TIMEOUT_MS = 400 as const;

export async function failOpenWithTimeout<T>(
  work: Promise<T>,
  fallback: T,
  timeoutMs: number = META_CAPI_WEB_IDENTIFIERS_TIMEOUT_MS
): Promise<T> {
  const ms =
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.floor(timeoutMs)
      : META_CAPI_WEB_IDENTIFIERS_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
