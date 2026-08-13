import { describe, expect, it, vi } from "vitest";

import {
  downloadTwilioMmsMediaBytes,
  listTwilioMessageMediaSids,
  TwilioMmsDownloadError,
} from "@/lib/victory-media/download-twilio-mms-media";

const AC = "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SM = "SMbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ME = "MEcccccccccccccccccccccccccccccccc";
const TOKEN = "auth-token-test";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

function streamBody(bytes: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
}

describe("downloadTwilioMmsMediaBytes", () => {
  it("first hop uses api.twilio.com + Basic Auth + redirect manual", async () => {
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(async (url: string, init?: RequestInit) => {
        expect(url).toContain("api.twilio.com");
        expect(url).toContain(`/Messages/${SM}/Media/${ME}`);
        expect(init?.redirect).toBe("manual");
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")?.startsWith("Basic ")).toBe(true);
        return new Response(null, {
          status: 302,
          headers: { Location: `https://mms.twiliocdn.com/obj?sig=1` },
        });
      })
      .mockImplementationOnce(async (url: string, init?: RequestInit) => {
        expect(url.startsWith("https://mms.twiliocdn.com/")).toBe(true);
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toBeNull();
        expect(init?.redirect).toBe("manual");
        return new Response(streamBody(JPEG), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      });

    const r = await downloadTwilioMmsMediaBytes(
      { messageSid: SM, mediaSid: ME },
      { fetchFn: fetchFn as unknown as typeof fetch, accountSid: AC, authToken: TOKEN }
    );
    expect(r.byteCount).toBe(JPEG.length);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("rejects hostile redirect host", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://evil.example/x" },
      })
    );
    await expect(
      downloadTwilioMmsMediaBytes(
        { messageSid: SM, mediaSid: ME },
        { fetchFn: fetchFn as unknown as typeof fetch, accountSid: AC, authToken: TOKEN }
      )
    ).rejects.toMatchObject({ code: "redirect_host_forbidden", retryable: false });
  });

  it("rejects wildcard sibling host", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://cdn.twiliocdn.com/x" },
      })
    );
    await expect(
      downloadTwilioMmsMediaBytes(
        { messageSid: SM, mediaSid: ME },
        { fetchFn: fetchFn as unknown as typeof fetch, accountSid: AC, authToken: TOKEN }
      )
    ).rejects.toMatchObject({ code: "redirect_host_forbidden" });
  });

  it("rejects http redirect", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "http://mms.twiliocdn.com/x" },
      })
    );
    await expect(
      downloadTwilioMmsMediaBytes(
        { messageSid: SM, mediaSid: ME },
        { fetchFn: fetchFn as unknown as typeof fetch, accountSid: AC, authToken: TOKEN }
      )
    ).rejects.toMatchObject({ code: "redirect_not_https" });
  });

  it("rejects userinfo in redirect", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://u:p@mms.twiliocdn.com/x" },
      })
    );
    await expect(
      downloadTwilioMmsMediaBytes(
        { messageSid: SM, mediaSid: ME },
        { fetchFn: fetchFn as unknown as typeof fetch, accountSid: AC, authToken: TOKEN }
      )
    ).rejects.toMatchObject({ code: "redirect_userinfo_forbidden" });
  });

  it("rejects second redirect", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://mms.twiliocdn.com/a" },
        })
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://mms.twiliocdn.com/b" },
        })
      );
    await expect(
      downloadTwilioMmsMediaBytes(
        { messageSid: SM, mediaSid: ME },
        { fetchFn: fetchFn as unknown as typeof fetch, accountSid: AC, authToken: TOKEN }
      )
    ).rejects.toMatchObject({ code: "second_redirect_forbidden", retryable: false });
  });

  it("AbortError without our timer → request_aborted (first_hop)", async () => {
    const fetchFn = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    await expect(
      downloadTwilioMmsMediaBytes(
        { messageSid: SM, mediaSid: ME },
        { fetchFn: fetchFn as unknown as typeof fetch, accountSid: AC, authToken: TOKEN }
      )
    ).rejects.toMatchObject({
      code: "request_aborted",
      retryable: true,
      stage: "first_hop",
      abortName: "AbortError",
    });
  });

  it("our AbortController timer → timeout (first_hop)", async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("missing_signal"));
            return;
          }
          signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      });

      const pending = downloadTwilioMmsMediaBytes(
        { messageSid: SM, mediaSid: ME },
        {
          fetchFn: fetchFn as unknown as typeof fetch,
          accountSid: AC,
          authToken: TOKEN,
          firstHopTimeoutMs: 50,
        }
      );

      const expectation = expect(pending).rejects.toMatchObject({
        code: "timeout",
        retryable: true,
        stage: "first_hop",
      });
      await vi.advanceTimersByTimeAsync(50);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("CDN AbortError without timer → request_aborted stage=cdn_fetch", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://mms.twiliocdn.com/a" },
        })
      )
      .mockImplementationOnce(async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      });
    await expect(
      downloadTwilioMmsMediaBytes(
        { messageSid: SM, mediaSid: ME },
        { fetchFn: fetchFn as unknown as typeof fetch, accountSid: AC, authToken: TOKEN }
      )
    ).rejects.toMatchObject({
      code: "request_aborted",
      stage: "cdn_fetch",
      retryable: true,
    });
  });

  it("stream Content-Length reject uses stage=stream_read", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://mms.twiliocdn.com/big" },
        })
      )
      .mockResolvedValueOnce(
        new Response(streamBody(JPEG), {
          status: 200,
          headers: { "content-length": String(12_000_001) },
        })
      );
    await expect(
      downloadTwilioMmsMediaBytes(
        { messageSid: SM, mediaSid: ME },
        { fetchFn: fetchFn as unknown as typeof fetch, accountSid: AC, authToken: TOKEN }
      )
    ).rejects.toMatchObject({
      code: "content_length_too_large",
      stage: "stream_read",
    });
  });

  it("hostile redirect stage=redirect_validation", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://evil.example/x" },
      })
    );
    await expect(
      downloadTwilioMmsMediaBytes(
        { messageSid: SM, mediaSid: ME },
        { fetchFn: fetchFn as unknown as typeof fetch, accountSid: AC, authToken: TOKEN }
      )
    ).rejects.toMatchObject({
      code: "redirect_host_forbidden",
      stage: "redirect_validation",
    });
  });

  it("404 first hop includes stage=first_hop", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(
      downloadTwilioMmsMediaBytes(
        { messageSid: SM, mediaSid: ME },
        { fetchFn: fetchFn as unknown as typeof fetch, accountSid: AC, authToken: TOKEN }
      )
    ).rejects.toMatchObject({ code: "http_404", stage: "first_hop", retryable: true });
  });

  it("timeout constants remain milliseconds (10s/15s/20s)", async () => {
    const {
      TWILIO_MMS_LIST_TIMEOUT_MS,
      TWILIO_MMS_FIRST_HOP_TIMEOUT_MS,
      TWILIO_MMS_BYTE_FETCH_TIMEOUT_MS,
    } = await import("@/lib/victory-media/download-twilio-mms-media");
    expect(TWILIO_MMS_LIST_TIMEOUT_MS).toBe(10_000);
    expect(TWILIO_MMS_FIRST_HOP_TIMEOUT_MS).toBe(15_000);
    expect(TWILIO_MMS_BYTE_FETCH_TIMEOUT_MS).toBe(20_000);
  });

  it("429 and 5xx are retryable", async () => {
    for (const status of [429, 503]) {
      const fetchFn = vi.fn(async () => new Response(null, { status }));
      try {
        await downloadTwilioMmsMediaBytes(
          { messageSid: SM, mediaSid: ME },
          { fetchFn: fetchFn as unknown as typeof fetch, accountSid: AC, authToken: TOKEN }
        );
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(TwilioMmsDownloadError);
        expect((e as TwilioMmsDownloadError).retryable).toBe(true);
        expect((e as TwilioMmsDownloadError).stage).toBe("first_hop");
      }
    }
  });

  it("404 is retryable at download layer", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(
      downloadTwilioMmsMediaBytes(
        { messageSid: SM, mediaSid: ME },
        { fetchFn: fetchFn as unknown as typeof fetch, accountSid: AC, authToken: TOKEN }
      )
    ).rejects.toMatchObject({ code: "http_404", retryable: true });
  });

  it("Content-Length > 12MB rejected", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://mms.twiliocdn.com/big" },
        })
      )
      .mockResolvedValueOnce(
        new Response(streamBody(JPEG), {
          status: 200,
          headers: { "content-length": String(12_000_001) },
        })
      );
    await expect(
      downloadTwilioMmsMediaBytes(
        { messageSid: SM, mediaSid: ME },
        { fetchFn: fetchFn as unknown as typeof fetch, accountSid: AC, authToken: TOKEN }
      )
    ).rejects.toMatchObject({ code: "content_length_too_large", retryable: false });
  });
});

describe("listTwilioMessageMediaSids", () => {
  it("returns ME SIDs from media_list", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain(`/Messages/${SM}/Media.json`);
      expect(new Headers(init?.headers).get("Authorization")?.startsWith("Basic ")).toBe(
        true
      );
      return new Response(
        JSON.stringify({
          media_list: [{ sid: ME, content_type: "image/jpeg" }],
        }),
        { status: 200 }
      );
    });
    const list = await listTwilioMessageMediaSids(SM, {
      fetchFn: fetchFn as unknown as typeof fetch,
      accountSid: AC,
      authToken: TOKEN,
    });
    expect(list).toEqual([{ sid: ME, contentType: "image/jpeg" }]);
  });
});
