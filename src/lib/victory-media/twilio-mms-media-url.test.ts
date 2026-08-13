import { describe, expect, it } from "vitest";

import {
  buildTwilioMediaContentUrl,
  isTwilioAccountSid,
  isTwilioMediaSid,
  isTwilioMessageSid,
  twilioBasicAuthHeader,
  TWILIO_MMS_CDN_HOST,
  validateTwilioMmsCdnRedirectUrl,
} from "@/lib/victory-media/twilio-mms-media-url";

const AC = "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SM = "SMbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ME = "MEcccccccccccccccccccccccccccccccc";

describe("twilio MMS SID validators", () => {
  it("accepts AC / SM|MM|MG / ME shapes", () => {
    expect(isTwilioAccountSid(AC)).toBe(true);
    expect(isTwilioMessageSid(SM)).toBe(true);
    expect(isTwilioMessageSid("MMbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).toBe(true);
    expect(isTwilioMediaSid(ME)).toBe(true);
  });

  it("rejects malformed SIDs", () => {
    expect(isTwilioAccountSid("ACshort")).toBe(false);
    expect(isTwilioMediaSid("MEshort")).toBe(false);
    expect(isTwilioMessageSid("XX" + "b".repeat(32))).toBe(false);
  });
});

describe("buildTwilioMediaContentUrl", () => {
  it("builds canonical api.twilio.com first-hop (no MediaUrl)", () => {
    const url = buildTwilioMediaContentUrl({
      accountSid: AC,
      messageSid: SM,
      mediaSid: ME,
    });
    expect(url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${AC}/Messages/${SM}/Media/${ME}`
    );
    expect(url).not.toContain("MediaUrl");
  });

  it("rejects invalid SIDs", () => {
    expect(() =>
      buildTwilioMediaContentUrl({ accountSid: "bad", messageSid: SM, mediaSid: ME })
    ).toThrow("invalid_account_sid");
  });
});

describe("twilioBasicAuthHeader", () => {
  it("encodes Basic base64(account:token) without logging", () => {
    const h = twilioBasicAuthHeader(AC, "secret-token");
    expect(h.startsWith("Basic ")).toBe(true);
    const decoded = Buffer.from(h.slice(6), "base64").toString("utf8");
    expect(decoded).toBe(`${AC}:secret-token`);
  });
});

describe("validateTwilioMmsCdnRedirectUrl", () => {
  it("accepts exact mms.twiliocdn.com HTTPS", () => {
    const u = validateTwilioMmsCdnRedirectUrl(
      `https://${TWILIO_MMS_CDN_HOST}/path?sig=abc`
    );
    expect(u.hostname).toBe("mms.twiliocdn.com");
    expect(u.protocol).toBe("https:");
  });

  it("rejects hostile / sibling / http / userinfo hosts", () => {
    expect(() =>
      validateTwilioMmsCdnRedirectUrl("https://evil.example/x")
    ).toThrow("redirect_host_forbidden");
    expect(() =>
      validateTwilioMmsCdnRedirectUrl("https://cdn.twiliocdn.com/x")
    ).toThrow("redirect_host_forbidden");
    expect(() =>
      validateTwilioMmsCdnRedirectUrl("https://foo.mms.twiliocdn.com/x")
    ).toThrow("redirect_host_forbidden");
    expect(() =>
      validateTwilioMmsCdnRedirectUrl(`http://${TWILIO_MMS_CDN_HOST}/x`)
    ).toThrow("redirect_not_https");
    expect(() =>
      validateTwilioMmsCdnRedirectUrl(
        `https://user:pass@${TWILIO_MMS_CDN_HOST}/x`
      )
    ).toThrow("redirect_userinfo_forbidden");
  });

  it("rejects malformed URL", () => {
    expect(() => validateTwilioMmsCdnRedirectUrl("not a url")).toThrow(
      "invalid_redirect_url"
    );
  });
});
