import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHECKOUT_RETURN_FALLBACK_ORIGIN,
  isAllowedCheckoutReturnOrigin,
  resolveStripeCheckoutReturnOrigin,
} from "@/lib/stripe-checkout-return-origin";

function req(url: string, headers?: Record<string, string>): Request {
  return new Request(url, { method: "POST", headers });
}

describe("stripe checkout return origin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("apex forwarded host → apex origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.summittmindset.com");
    expect(
      resolveStripeCheckoutReturnOrigin(
        req("https://www.summittmindset.com/api/stripe/create-checkout-session", {
          "x-forwarded-host": "summittmindset.com",
          "x-forwarded-proto": "https",
        })
      )
    ).toBe("https://summittmindset.com");
  });

  it("www forwarded host → www origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://summittmindset.com");
    expect(
      resolveStripeCheckoutReturnOrigin(
        req("https://summittmindset.com/api/stripe/create-checkout-session", {
          "x-forwarded-host": "www.summittmindset.com",
          "x-forwarded-proto": "https",
        })
      )
    ).toBe("https://www.summittmindset.com");
  });

  it("localhost:3000 in development", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://summittmindset.com");
    expect(
      resolveStripeCheckoutReturnOrigin(
        req("http://localhost:3000/api/stripe/create-checkout-session", {
          "x-forwarded-host": "localhost:3000",
          "x-forwarded-proto": "http",
        })
      )
    ).toBe("http://localhost:3000");
  });

  it("127.0.0.1:3000 in development", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(
      resolveStripeCheckoutReturnOrigin(
        req("http://127.0.0.1:3000/api/stripe/create-checkout-session")
      )
    ).toBe("http://127.0.0.1:3000");
  });

  it("spoofed evil x-forwarded-host never wins", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    const origin = resolveStripeCheckoutReturnOrigin(
      req("http://localhost:3000/api/stripe/create-checkout-session", {
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "https",
        origin: "https://evil.example",
      })
    );
    expect(origin).toBe("http://localhost:3000");
    expect(origin).not.toContain("evil.example");
  });

  it("spoofed evil Origin header is ignored", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    const origin = resolveStripeCheckoutReturnOrigin(
      req("http://localhost:3000/api/stripe/create-checkout-session", {
        origin: "https://evil.example",
      })
    );
    expect(origin).toBe("http://localhost:3000");
    expect(origin).not.toContain("evil.example");
  });

  it("comma / slash / whitespace / @ forwarded host is rejected", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    for (const host of [
      "www.summittmindset.com,evil.example",
      "www.summittmindset.com/evil",
      "www.summittmindset.com evil.example",
      "www.summittmindset.com@evil.example",
    ]) {
      const origin = resolveStripeCheckoutReturnOrigin(
        req("http://localhost:3000/api/stripe/create-checkout-session", {
          "x-forwarded-host": host,
          "x-forwarded-proto": "https",
        })
      );
      expect(origin).toBe("http://localhost:3000");
    }
  });

  it("env fallback must itself be allowlisted", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://evil.example");
    expect(
      resolveStripeCheckoutReturnOrigin(
        req("https://evil.example/api/stripe/create-checkout-session")
      )
    ).toBe(CHECKOUT_RETURN_FALLBACK_ORIGIN);
    expect(isAllowedCheckoutReturnOrigin("https://evil.example")).toBe(false);
  });

  it("production ignores localhost env and falls back to apex", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect(
      resolveStripeCheckoutReturnOrigin(
        req("http://localhost/api/stripe/create-checkout-session")
      )
    ).toBe(CHECKOUT_RETURN_FALLBACK_ORIGIN);
  });

  it("http://localhost without port is not allowlisted and uses env", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect(
      resolveStripeCheckoutReturnOrigin(
        req("http://localhost/api/stripe/create-checkout-session")
      )
    ).toBe("http://localhost:3000");
  });

  it("preview allows exact https://${VERCEL_URL} only", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "summitt-app-git-foo.vercel.app");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://summittmindset.com");
    expect(
      resolveStripeCheckoutReturnOrigin(
        req("https://summitt-app-git-foo.vercel.app/api/stripe/create-checkout-session", {
          "x-forwarded-host": "summitt-app-git-foo.vercel.app",
          "x-forwarded-proto": "https",
        })
      )
    ).toBe("https://summitt-app-git-foo.vercel.app");
  });

  it("preview rejects VERCEL_URL with slash, comma, whitespace, or @", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://summittmindset.com");
    for (const bad of [
      "foo.vercel.app/evil",
      "foo.vercel.app,evil.example",
      "foo.vercel.app evil",
      "foo.vercel.app@evil.example",
    ]) {
      vi.stubEnv("VERCEL_URL", bad);
      expect(
        resolveStripeCheckoutReturnOrigin(
          req("https://foo.vercel.app/api/stripe/create-checkout-session", {
            "x-forwarded-host": bad,
            "x-forwarded-proto": "https",
          })
        )
      ).toBe("https://summittmindset.com");
    }
  });

  it("production defaults missing proto to https", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      resolveStripeCheckoutReturnOrigin(
        req("http://internal/api/stripe/create-checkout-session", {
          "x-forwarded-host": "www.summittmindset.com",
        })
      )
    ).toBe("https://www.summittmindset.com");
  });
});
