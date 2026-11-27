import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyOnboardingClient,
  clientDiagnosticPairingAllowed,
  onboardingDiagnosticIdempotencyKey,
} from "@/lib/onboarding-journey-diagnostics";
import {
  newOnboardingAttemptId,
  reportOnboardingClient,
} from "@/lib/onboarding-journey-diagnostics-client";

describe("onboarding client classification", () => {
  it("classifies desktop browsers without storing the user agent", () => {
    expect(
      classifyOnboardingClient(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
      )
    ).toEqual({ clientShell: "browser", deviceClass: "desktop", browserFamily: "chrome" });
    expect(
      classifyOnboardingClient(
        "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15"
      ).browserFamily
    ).toBe("safari");
    expect(
      classifyOnboardingClient("Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/120.0").browserFamily
    ).toBe("firefox");
    expect(
      classifyOnboardingClient(
        "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
      ).browserFamily
    ).toBe("edge");
  });

  it("classifies phone, tablet, in-app, and native shells", () => {
    expect(
      classifyOnboardingClient(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"
      )
    ).toMatchObject({ clientShell: "browser", deviceClass: "phone", browserFamily: "safari" });
    expect(
      classifyOnboardingClient(
        "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"
      ).deviceClass
    ).toBe("tablet");
    expect(
      classifyOnboardingClient(
        "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36"
      )
    ).toMatchObject({ clientShell: "browser", deviceClass: "phone", browserFamily: "chrome" });
    expect(
      classifyOnboardingClient(
        "Mozilla/5.0 (iPhone) AppleWebKit Mobile Instagram Safari/604.1"
      ).clientShell
    ).toBe("in_app_browser");
    expect(
      classifyOnboardingClient("Mozilla/5.0 (iPhone) FBAN/FBIOS Safari/604.1").clientShell
    ).toBe("in_app_browser");
    expect(
      classifyOnboardingClient(
        "Mozilla/5.0 (iPhone) AppleWebKit Mobile Safari/604.1 SummittMindsetiOS"
      )
    ).toMatchObject({ clientShell: "ios_app", deviceClass: "phone" });
    expect(
      classifyOnboardingClient("Mozilla/5.0 (Linux; Android 14) AppleWebKit SummittMindsetAndroid")
        .clientShell
    ).toBe("android_app");
    expect(classifyOnboardingClient(null)).toEqual({
      clientShell: "unknown",
      deviceClass: "unknown",
      browserFamily: "none",
    });
  });
});

describe("onboarding diagnostic identity and retries", () => {
  it("keeps one key for a repeated delivery and a new key for a new attempt", () => {
    const first = newOnboardingAttemptId();
    const second = newOnboardingAttemptId();
    const base = {
      clerkUserId: "user_1",
      journeyId: "journey_1",
      step: "identity" as const,
      outcome: "submission_attempted" as const,
      errorCode: "none" as const,
    };
    expect(onboardingDiagnosticIdempotencyKey({ ...base, attemptId: first })).toBe(
      onboardingDiagnosticIdempotencyKey({ ...base, attemptId: first })
    );
    expect(onboardingDiagnosticIdempotencyKey({ ...base, attemptId: first })).not.toBe(
      onboardingDiagnosticIdempotencyKey({ ...base, attemptId: second })
    );
  });

  it("collapses only the first Film Room arrival", () => {
    const key = onboardingDiagnosticIdempotencyKey({
      clerkUserId: "user_1",
      journeyId: "server",
      attemptId: "ignored",
      step: "film_room",
      outcome: "step_reached",
      errorCode: "none",
      oncePerMember: true,
    });
    expect(key).toBe("once:user_1:film_room:step_reached");
  });

  it("refuses client assertions of a successful or failed save", () => {
    expect(clientDiagnosticPairingAllowed("save_failed", "persistence")).toBe(false);
    expect(clientDiagnosticPairingAllowed("request_received", "none")).toBe(false);
    expect(clientDiagnosticPairingAllowed("step_reached", "none")).toBe(false);
    expect(clientDiagnosticPairingAllowed("completion_failed", "server")).toBe(false);
    expect(clientDiagnosticPairingAllowed("validation_blocked", "none")).toBe(false);
    expect(clientDiagnosticPairingAllowed("validation_blocked", "missing_name")).toBe(true);
    expect(clientDiagnosticPairingAllowed("submission_attempted", "none")).toBe(true);
    expect(clientDiagnosticPairingAllowed("client_error", "request_failed")).toBe(true);
  });
});

describe("client diagnostic delivery", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses fetch keepalive when sendBeacon is unavailable", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", {});
    reportOnboardingClient({
      step: "identity",
      outcome: "submission_attempted",
      attemptId: "attempt_1",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/onboarding/diagnostic",
      expect.objectContaining({ method: "POST", keepalive: true, credentials: "include" })
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.step).toBe("identity");
    expect(body.outcome).toBe("submission_attempted");
    expect(body.attemptId).toBe("attempt_1");
    expect(body.clerkUserId).toBeUndefined();
  });

  it("does not send a forbidden outcome", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", {});
    reportOnboardingClient({
      step: "identity",
      outcome: "save_failed" as "submission_attempted",
      attemptId: "attempt_1",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
