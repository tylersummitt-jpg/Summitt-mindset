/**
 * Bounded streaming download of a Response body (Slice B1).
 * Never trusts Content-Length alone; aborts at maxBytes+1.
 */

export class StreamByteLimitExceededError extends Error {
  readonly code = "byte_limit_exceeded" as const;
  constructor() {
    super("byte_limit_exceeded");
    this.name = "StreamByteLimitExceededError";
  }
}

export class ContentLengthTooLargeError extends Error {
  readonly code = "content_length_too_large" as const;
  constructor() {
    super("content_length_too_large");
    this.name = "ContentLengthTooLargeError";
  }
}

/**
 * Read response body into a Buffer with a hard byte cap.
 * Accepts exactly maxBytes; rejects on the (maxBytes+1)th byte.
 */
export async function readResponseBodyWithByteCap(
  res: Response,
  maxBytes: number
): Promise<Buffer> {
  if (!Number.isInteger(maxBytes) || maxBytes < 0) {
    throw new Error("invalid_max_bytes");
  }

  const clRaw = res.headers.get("content-length");
  if (clRaw != null && clRaw.trim() !== "") {
    const cl = Number.parseInt(clRaw.trim(), 10);
    if (Number.isFinite(cl) && cl > maxBytes) {
      throw new ContentLengthTooLargeError();
    }
  }

  if (!res.body) {
    // No body stream — empty is fine if max allows.
    return Buffer.alloc(0);
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      if (total + value.byteLength > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw new StreamByteLimitExceededError();
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c)), total);
}
