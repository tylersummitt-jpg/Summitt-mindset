import { describe, expect, it } from "vitest";
import { evaluateWeeklySolBlockOnlyBody } from "@/lib/weekly-tto-body-validate";

describe("weekly-tto-body-validate", () => {
  it("accepts a natural coaching body without rewriting it", () => {
    const body = "Broke your ankle and still showed up in the thread — rest is the work this week.";
    expect(evaluateWeeklySolBlockOnlyBody(body)).toEqual({ ok: true });
  });

  it("blocks empty, internal labels, UUID, robotic menu, footer, and event tokens without editing", () => {
    expect(evaluateWeeklySolBlockOnlyBody("   ")).toEqual({ ok: false, reason: "empty_body" });
    expect(evaluateWeeklySolBlockOnlyBody("See event_type in the notes")).toEqual({
      ok: false,
      reason: "internal_label_event_type",
    });
    expect(
      evaluateWeeklySolBlockOnlyBody("Call 550e8400-e29b-41d4-a716-446655440000")
    ).toEqual({ ok: false, reason: "internal_uuid" });
    expect(
      evaluateWeeklySolBlockOnlyBody("Reply with yes, no, or partial for the week.")
    ).toMatchObject({ ok: false });
    expect(
      evaluateWeeklySolBlockOnlyBody("Nice week. Reply STOP to opt out. Reply HELP for help.")
    ).toEqual({ ok: false, reason: "compliance_footer_in_body" });
    expect(evaluateWeeklySolBlockOnlyBody("blocker_captured tonight")).toEqual({
      ok: false,
      reason: "internal_event_token",
    });
  });

  it("allows ordinary English partial and still blocks internal tokens", () => {
    expect(evaluateWeeklySolBlockOnlyBody("Partial progress still matters.")).toEqual({
      ok: true,
    });
    expect(evaluateWeeklySolBlockOnlyBody("Even partial progress can tell you something.")).toEqual(
      { ok: true }
    );
    expect(evaluateWeeklySolBlockOnlyBody("You made partial progress.")).toEqual({ ok: true });
    expect(evaluateWeeklySolBlockOnlyBody("Even partial progress counts.")).toEqual({ ok: true });
    expect(evaluateWeeklySolBlockOnlyBody("event_type=user_partial")).toMatchObject({
      ok: false,
    });
    expect(evaluateWeeklySolBlockOnlyBody("Your event_type is user_partial.")).toMatchObject({
      ok: false,
    });
    expect(evaluateWeeklySolBlockOnlyBody("I marked blocker_captured.")).toEqual({
      ok: false,
      reason: "internal_event_token",
    });
  });
});
