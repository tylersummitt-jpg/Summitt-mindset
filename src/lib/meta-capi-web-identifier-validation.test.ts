import { describe, expect, it } from "vitest";
import {
  clientIpFromRequestHeaders,
  constructFbcFromRealFbclid,
  sanitizeMetaClientIp,
  sanitizeMetaClientUserAgent,
  sanitizeMetaFbc,
  sanitizeMetaFbp,
  sanitizeMetaFbclid,
} from "@/lib/meta-capi-web-identifier-validation";

describe("meta CAPI identifier validation", () => {
  it("accepts a real fbclid and rejects email/control/oversized values", () => {
    expect(sanitizeMetaFbclid("AbCdEf123_-~.")).toBe("AbCdEf123_-~.");
    expect(sanitizeMetaFbclid(" user@example.com ")).toBeNull();
    expect(sanitizeMetaFbclid("abc def")).toBeNull();
    expect(sanitizeMetaFbclid("a".repeat(513))).toBeNull();
    expect(sanitizeMetaFbclid("")).toBeNull();
    expect(sanitizeMetaFbclid(null)).toBeNull();
  });

  it("accepts real _fbc and rejects malformed/fabricated-looking values", () => {
    expect(sanitizeMetaFbc("fb.1.1700000000000.AbCdEf")).toBe(
      "fb.1.1700000000000.AbCdEf"
    );
    expect(sanitizeMetaFbc("not-a-cookie")).toBeNull();
    expect(sanitizeMetaFbc("fb.1.now.AbCdEf")).toBeNull();
  });

  it("accepts real _fbp and never invents one", () => {
    expect(sanitizeMetaFbp("fb.1.1700000000000.1234567890")).toBe(
      "fb.1.1700000000000.1234567890"
    );
    expect(sanitizeMetaFbp(null)).toBeNull();
    expect(sanitizeMetaFbp("")).toBeNull();
    expect(sanitizeMetaFbp("fb.1.1700000000000.not-a-number")).toBeNull();
  });

  it("constructs fbc from a real fbclid and first-observed timestamp, not Date.now()", () => {
    const fbc = constructFbcFromRealFbclid(
      "AbCdEf",
      "2026-09-01T12:00:00.000Z"
    );
    expect(fbc).toBe(`fb.1.${Date.parse("2026-09-01T12:00:00.000Z")}.AbCdEf`);
    expect(constructFbcFromRealFbclid("AbCdEf", "not-a-date")).toBeNull();
    expect(constructFbcFromRealFbclid("bad id", "2026-09-01T12:00:00.000Z")).toBeNull();
  });

  it("extracts a public Vercel client IP and rejects private/malformed", () => {
    expect(sanitizeMetaClientIp("8.8.8.8")).toBe("8.8.8.8");
    expect(sanitizeMetaClientIp("127.0.0.1")).toBeNull();
    expect(sanitizeMetaClientIp("10.0.0.1")).toBeNull();
    expect(sanitizeMetaClientIp("192.168.1.9")).toBeNull();
    expect(sanitizeMetaClientIp("172.16.0.1")).toBeNull();
    expect(sanitizeMetaClientIp("169.254.1.1")).toBeNull();
    expect(sanitizeMetaClientIp("not-an-ip")).toBeNull();
    expect(sanitizeMetaClientIp("::1")).toBeNull();
    expect(
      clientIpFromRequestHeaders(
        new Headers({
          "x-vercel-forwarded-for": "8.8.4.4",
          "x-forwarded-for": "10.0.0.1, 8.8.8.8",
        })
      )
    ).toBe("8.8.4.4");
    expect(
      clientIpFromRequestHeaders(
        new Headers({
          "x-forwarded-for": "10.0.0.1, 1.1.1.1",
        })
      )
    ).toBe("1.1.1.1");
    expect(
      clientIpFromRequestHeaders(new Headers({ "x-forwarded-for": "127.0.0.1" }))
    ).toBeNull();
  });

  it("caps and strips control characters from user-agent", () => {
    expect(sanitizeMetaClientUserAgent("Mozilla/5.0 Chrome")).toBe(
      "Mozilla/5.0 Chrome"
    );
    expect(sanitizeMetaClientUserAgent("Mozilla\u0000Bad")).toBe("MozillaBad");
    expect(sanitizeMetaClientUserAgent("a".repeat(2000))?.length).toBe(1024);
    expect(sanitizeMetaClientUserAgent("   ")).toBeNull();
  });
});
