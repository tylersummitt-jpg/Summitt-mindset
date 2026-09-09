import { afterEach, describe, expect, it, vi } from "vitest";
import {
  META_CAPI_WEB_IDENTIFIERS_TIMEOUT_MS,
  failOpenWithTimeout,
} from "@/lib/meta-capi-fail-open-timeout";

describe("failOpenWithTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the work value when it finishes before the timeout", async () => {
    await expect(failOpenWithTimeout(Promise.resolve("ok"), "fallback", 50)).resolves.toBe(
      "ok"
    );
  });

  it("returns the fallback when work hangs past the timeout", async () => {
    vi.useFakeTimers();
    const hung = new Promise<string>(() => {});
    const pending = failOpenWithTimeout(hung, "fallback", 400);
    await vi.advanceTimersByTimeAsync(400);
    await expect(pending).resolves.toBe("fallback");
  });

  it("uses the short attribution timeout constant", () => {
    expect(META_CAPI_WEB_IDENTIFIERS_TIMEOUT_MS).toBe(400);
  });
});
