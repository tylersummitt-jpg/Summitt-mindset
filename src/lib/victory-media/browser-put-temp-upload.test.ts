import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadVictoryMediaTempObject } from "@/lib/victory-media/browser-put-temp-upload";

describe("uploadVictoryMediaTempObject", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("PUTs file with Content-Type = declaredMime", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });

    const result = await uploadVictoryMediaTempObject({
      signedUrl: "https://example.supabase.co/storage/v1/object/upload/sign/x?token=tok",
      file,
      declaredMime: "image/heic",
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/storage/v1/object/upload/sign/x?token=tok",
      {
        method: "PUT",
        headers: { "Content-Type": "image/heic" },
        body: file,
      }
    );
  });

  it("returns network on fetch throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("offline"))
    );
    const result = await uploadVictoryMediaTempObject({
      signedUrl: "https://example/sign?token=t",
      file: new Blob(["x"]),
      declaredMime: "image/jpeg",
    });
    expect(result).toEqual({ ok: false, reason: "network" });
  });

  it("returns http when response not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const result = await uploadVictoryMediaTempObject({
      signedUrl: "https://example/sign?token=t",
      file: new Blob(["x"]),
      declaredMime: "image/jpeg",
    });
    expect(result).toEqual({ ok: false, reason: "http" });
  });

  it("rejects blank url/mime", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await uploadVictoryMediaTempObject({
        signedUrl: "  ",
        file: new Blob(["x"]),
        declaredMime: "image/jpeg",
      })
    ).toEqual({ ok: false, reason: "invalid_input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
