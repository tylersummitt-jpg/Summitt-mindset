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

  it("timeout is retryable", async () => {
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
    ).rejects.toMatchObject({ code: "timeout", retryable: true });
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
