import { describe, expect, it } from "vitest";

import {
  appleGrantFromQuery,
  blankToNull,
  cancelModeFromFacts,
  parseExitSurveyBody,
  readAppleGrant,
} from "@/lib/exit-survey";

describe("exit survey", () => {
  it("keeps a current reason and trims a written answer", () => {
    expect(
      parseExitSurveyBody({
        reasonCode: "too_expensive",
        message: "  price  ",
        skippedReason: false,
        skippedComment: false,
      })
    ).toEqual({
      reasonCode: "too_expensive",
      message: "price",
      skippedReason: false,
      skippedComment: false,
    });
  });

  it("treats a skip as different from prefer not to say", () => {
    expect(
      parseExitSurveyBody({
        reasonCode: null,
        message: "   ",
        skippedReason: true,
        skippedComment: true,
      })
    ).toEqual({
      reasonCode: null,
      message: null,
      skippedReason: true,
      skippedComment: true,
    });
    expect(
      parseExitSurveyBody({
        reasonCode: "prefer_not_to_say",
        message: null,
        skippedReason: false,
        skippedComment: true,
      }).reasonCode
    ).toBe("prefer_not_to_say");
  });

  it("does not store a legacy code as a version 2 answer", () => {
    expect(parseExitSurveyBody({ reasonCode: "other", message: "note" })).toEqual({
      reasonCode: null,
      message: "note",
      skippedReason: true,
      skippedComment: false,
    });
  });

  it("turns a bad body into a skip", () => {
    expect(parseExitSurveyBody("nope")).toEqual({
      reasonCode: null,
      message: null,
      skippedReason: true,
      skippedComment: true,
    });
    expect(blankToNull("   ")).toBeNull();
  });

  it("separates Apple-only, Stripe-only, and both", () => {
    expect(cancelModeFromFacts({ stripeSubscriptionId: null, appleGrant: true })).toBe(
      "apple"
    );
    expect(cancelModeFromFacts({ stripeSubscriptionId: "sub_1", appleGrant: false })).toBe(
      "stripe"
    );
    expect(cancelModeFromFacts({ stripeSubscriptionId: "sub_1", appleGrant: null })).toBe(
      "stripe"
    );
    expect(cancelModeFromFacts({ stripeSubscriptionId: "sub_1", appleGrant: true })).toBe(
      "both"
    );
  });

  it("keeps a failed Apple lookup unknown and still offers Stripe cancel", async () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const granting = {
      product_id: "com.summittmindset.ios.membership.monthly",
      status: "active",
      expires_at: "2026-12-01T00:00:00.000Z",
    };
    expect(appleGrantFromQuery({ error: null, rows: [granting], now })).toBe(true);
    expect(
      cancelModeFromFacts({
        stripeSubscriptionId: "sub_1",
        appleGrant: appleGrantFromQuery({ error: null, rows: [granting], now }),
      })
    ).toBe("both");
    expect(appleGrantFromQuery({ error: null, rows: [], now })).toBe(false);
    expect(appleGrantFromQuery({ error: { code: "XX000" }, rows: [], now })).toBeNull();
    expect(appleGrantFromQuery({ error: null, rows: null, now })).toBeNull();
    await expect(readAppleGrant(async () => {
      throw new Error("supabase down");
    })).resolves.toBeNull();
    const unknown = await readAppleGrant(async () => ({
      error: { message: "permission" },
      rows: [],
    }));
    expect(unknown).toBeNull();
    expect(cancelModeFromFacts({ stripeSubscriptionId: "sub_1", appleGrant: unknown })).toBe(
      "stripe"
    );
    expect(cancelModeFromFacts({ stripeSubscriptionId: "sub_1", appleGrant: unknown })).not.toBe(
      "both"
    );
  });
});
