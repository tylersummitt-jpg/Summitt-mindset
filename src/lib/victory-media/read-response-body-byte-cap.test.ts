import { describe, expect, it } from "vitest";

import {
  ContentLengthTooLargeError,
  readResponseBodyWithByteCap,
  StreamByteLimitExceededError,
} from "@/lib/victory-media/read-response-body-byte-cap";

function streamResponse(
  chunks: Uint8Array[],
  headers?: Record<string, string>
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return new Response(stream, { headers });
}

describe("readResponseBodyWithByteCap", () => {
  it("rejects Content-Length > max before streaming", async () => {
    const res = streamResponse([new Uint8Array([1])], {
      "content-length": "13",
    });
    await expect(readResponseBodyWithByteCap(res, 12)).rejects.toBeInstanceOf(
      ContentLengthTooLargeError
    );
  });

  it("rejects when streamed bytes exceed max", async () => {
    const res = streamResponse([
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5]),
    ]);
    await expect(readResponseBodyWithByteCap(res, 4)).rejects.toBeInstanceOf(
      StreamByteLimitExceededError
    );
  });

  it("accepts exactly maxBytes", async () => {
    const buf = Buffer.alloc(12, 0xab);
    const res = streamResponse([buf], { "content-length": "12" });
    const out = await readResponseBodyWithByteCap(res, 12);
    expect(out.length).toBe(12);
  });

  it("does not trust Content-Length alone when body is smaller", async () => {
    const res = streamResponse([new Uint8Array([1, 2])], {
      "content-length": "2",
    });
    const out = await readResponseBodyWithByteCap(res, 12_000_000);
    expect(out.length).toBe(2);
  });
});
