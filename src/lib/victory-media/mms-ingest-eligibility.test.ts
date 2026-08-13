import { describe, expect, it } from "vitest";
import { canEnqueueInboundMedia } from "@/lib/victory-media/mms-ingest-eligibility";

describe("canEnqueueInboundMedia", () => {
  it("eligible when identity enabled, not stopped, Clerk smsEnabled true", () => {
    expect(
      canEnqueueInboundMedia({
        identitySmsEnabled: true,
        identityStoppedAt: null,
        clerkSmsEnabled: true,
      })
    ).toBe(true);
  });

  it("stopped/disabled identity → false (sms_enabled false)", () => {
    expect(
      canEnqueueInboundMedia({
        identitySmsEnabled: false,
        identityStoppedAt: null,
        clerkSmsEnabled: true,
      })
    ).toBe(false);
  });

  it("stopped_at string → false even if sms_enabled true", () => {
    expect(
      canEnqueueInboundMedia({
        identitySmsEnabled: true,
        identityStoppedAt: "2026-08-12T00:00:00.000Z",
        clerkSmsEnabled: true,
      })
    ).toBe(false);
  });

  it("Clerk smsEnabled not true → false", () => {
    expect(
      canEnqueueInboundMedia({
        identitySmsEnabled: true,
        identityStoppedAt: null,
        clerkSmsEnabled: false,
      })
    ).toBe(false);
    expect(
      canEnqueueInboundMedia({
        identitySmsEnabled: true,
        identityStoppedAt: null,
        clerkSmsEnabled: undefined,
      })
    ).toBe(false);
  });

  it("does not require commitment/Body facts (only the three opt-out gates)", () => {
    // Pure function — absence of commitment/body args is the proof.
    expect(
      canEnqueueInboundMedia({
        identitySmsEnabled: true,
        identityStoppedAt: null,
        clerkSmsEnabled: true,
      })
    ).toBe(true);
  });
});
