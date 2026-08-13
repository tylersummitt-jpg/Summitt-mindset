import { describe, expect, it } from "vitest";

import {
  extractTwilioMediaSidFromMediaUrl,
  collectInboundMmsEnqueueCandidates,
  TWILIO_INBOUND_MMS_MEDIA_ENUM_CAP,
} from "@/lib/victory-media/parse-inbound-mms-media";

const AC = "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SM = "SMbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ME = "MEcccccccccccccccccccccccccccccccc";

function twilioMediaUrl(args?: {
  accountSid?: string;
  messageSid?: string;
  mediaSid?: string;
  host?: string;
  protocol?: string;
}): string {
  const accountSid = args?.accountSid ?? AC;
  const messageSid = args?.messageSid ?? SM;
  const mediaSid = args?.mediaSid ?? ME;
  const host = args?.host ?? "api.twilio.com";
  const protocol = args?.protocol ?? "https";
  return `${protocol}://${host}/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}/Media/${mediaSid}`;
}

describe("extractTwilioMediaSidFromMediaUrl", () => {
  it("extracts ME sid from valid api.twilio.com media URL", () => {
    expect(
      extractTwilioMediaSidFromMediaUrl({
        mediaUrl: twilioMediaUrl(),
        inboundMessageSid: SM,
        twilioAccountSid: AC,
      })
    ).toBe(ME);
  });

  it("allows missing account env (skips account check)", () => {
    expect(
      extractTwilioMediaSidFromMediaUrl({
        mediaUrl: twilioMediaUrl(),
        inboundMessageSid: SM,
        twilioAccountSid: null,
      })
    ).toBe(ME);
  });

  it("malformed URL → null", () => {
    expect(
      extractTwilioMediaSidFromMediaUrl({
        mediaUrl: "not-a-url",
        inboundMessageSid: SM,
      })
    ).toBeNull();
  });

  it("foreign host → null", () => {
    expect(
      extractTwilioMediaSidFromMediaUrl({
        mediaUrl: twilioMediaUrl({ host: "evil.example.com" }),
        inboundMessageSid: SM,
      })
    ).toBeNull();
  });

  it("http URL → null", () => {
    expect(
      extractTwilioMediaSidFromMediaUrl({
        mediaUrl: twilioMediaUrl({ protocol: "http" }),
        inboundMessageSid: SM,
      })
    ).toBeNull();
  });

  it("wrong MessageSid in path → null", () => {
    expect(
      extractTwilioMediaSidFromMediaUrl({
        mediaUrl: twilioMediaUrl({ messageSid: "SMdddddddddddddddddddddddddddddddd" }),
        inboundMessageSid: SM,
      })
    ).toBeNull();
  });

  it("no URL → null", () => {
    expect(
      extractTwilioMediaSidFromMediaUrl({
        mediaUrl: null,
        inboundMessageSid: SM,
      })
    ).toBeNull();
  });

  it("wrong account sid when env provided → null", () => {
    expect(
      extractTwilioMediaSidFromMediaUrl({
        mediaUrl: twilioMediaUrl(),
        inboundMessageSid: SM,
        twilioAccountSid: "ACffffffffffffffffffffffffffffffff",
      })
    ).toBeNull();
  });
});

describe("collectInboundMmsEnqueueCandidates", () => {
  it("one supported ordinal → one candidate with ME sid", () => {
    const params = new URLSearchParams({
      MediaUrl0: twilioMediaUrl(),
      MediaContentType0: "image/jpeg",
    });
    const c = collectInboundMmsEnqueueCandidates({
      params,
      messageSid: SM,
      numMedia: 1,
      twilioAccountSid: AC,
    });
    expect(c).toEqual([
      { ordinal: 0, declaredContentType: "image/jpeg", twilioMediaSid: ME },
    ]);
  });

  it("multiple supported ordinals → one each", () => {
    const params = new URLSearchParams({
      MediaUrl0: twilioMediaUrl({ mediaSid: "MEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
      MediaContentType0: "image/png",
      MediaUrl1: twilioMediaUrl({ mediaSid: "MEbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
      MediaContentType1: "image/webp",
    });
    const c = collectInboundMmsEnqueueCandidates({
      params,
      messageSid: SM,
      numMedia: 2,
      twilioAccountSid: AC,
    });
    expect(c).toHaveLength(2);
    expect(c.map((x) => x.ordinal)).toEqual([0, 1]);
  });

  it("unsupported ordinal skipped (video / gif)", () => {
    const params = new URLSearchParams({
      MediaUrl0: twilioMediaUrl({ mediaSid: "MEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
      MediaContentType0: "video/mp4",
      MediaUrl1: twilioMediaUrl({ mediaSid: "MEbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
      MediaContentType1: "image/gif",
      MediaUrl2: twilioMediaUrl({ mediaSid: "MEcccccccccccccccccccccccccccccccc" }),
      MediaContentType2: "image/jpeg",
    });
    const c = collectInboundMmsEnqueueCandidates({
      params,
      messageSid: SM,
      numMedia: 3,
      twilioAccountSid: AC,
    });
    expect(c).toEqual([
      {
        ordinal: 2,
        declaredContentType: "image/jpeg",
        twilioMediaSid: "MEcccccccccccccccccccccccccccccccc",
      },
    ]);
  });

  it("malformed MediaUrl still enqueues with null twilioMediaSid", () => {
    const params = new URLSearchParams({
      MediaUrl0: "https://evil.example/x",
      MediaContentType0: "image/jpeg",
    });
    const c = collectInboundMmsEnqueueCandidates({
      params,
      messageSid: SM,
      numMedia: 1,
    });
    expect(c).toEqual([
      { ordinal: 0, declaredContentType: "image/jpeg", twilioMediaSid: null },
    ]);
  });

  it("caps enumeration at Twilio max 10", () => {
    expect(TWILIO_INBOUND_MMS_MEDIA_ENUM_CAP).toBe(10);
    const params = new URLSearchParams();
    for (let i = 0; i < 12; i++) {
      params.set(`MediaContentType${i}`, "image/jpeg");
      params.set(`MediaUrl${i}`, twilioMediaUrl({ mediaSid: `ME${String(i).padStart(32, "0")}` }));
    }
    const c = collectInboundMmsEnqueueCandidates({
      params,
      messageSid: SM,
      numMedia: 12,
    });
    expect(c).toHaveLength(10);
    expect(c[9]?.ordinal).toBe(9);
  });
});
