import { describe, expect, it } from "vitest";
import { TWILIO_SMS_BODY_MAX_CHARS } from "@/lib/sms-transport-max";
import {
  MAX_WEEKLY_EDITABLE_BODY,
  WEEKLY_TTO_COMPLIANCE_FOOTER,
  WEEKLY_TTO_FOOTER_SEPARATOR,
  buildWeeklyTtoFinalBodyWithFooter,
  weeklyEditableBodyExceedsMax,
  weeklyFinalBodyExceedsTwilioMax,
} from "@/lib/weekly-tto-length";
import { evaluateWeeklySolBlockOnlyBody } from "@/lib/weekly-tto-body-validate";

describe("weekly footer-aware length law", () => {
  it("footer overhead is 45 and max editable body is 1555", () => {
    expect(WEEKLY_TTO_COMPLIANCE_FOOTER).toBe(
      "Reply STOP to opt out. Reply HELP for help."
    );
    expect(WEEKLY_TTO_FOOTER_SEPARATOR).toBe("\n\n");
    expect(WEEKLY_TTO_COMPLIANCE_FOOTER.length).toBe(43);
    expect(MAX_WEEKLY_EDITABLE_BODY).toBe(1555);
    expect(TWILIO_SMS_BODY_MAX_CHARS).toBe(1600);
  });

  it("B length 1555 is within editable max; 1556 is not", () => {
    expect(weeklyEditableBodyExceedsMax("x".repeat(1555))).toBe(false);
    expect(weeklyEditableBodyExceedsMax("x".repeat(1556))).toBe(true);
    expect(evaluateWeeklySolBlockOnlyBody("x".repeat(1555))).toEqual({ ok: true });
    expect(evaluateWeeklySolBlockOnlyBody("x".repeat(1556))).toEqual({
      ok: false,
      reason: "editable_body_too_long",
    });
  });

  it("B 1555 + separator + footer final == 1600", () => {
    const body = "x".repeat(1555);
    const finalBody = buildWeeklyTtoFinalBodyWithFooter(body);
    expect(finalBody).toBe(`${body}\n\n${WEEKLY_TTO_COMPLIANCE_FOOTER}`);
    expect(finalBody.length).toBe(1600);
    expect(weeklyFinalBodyExceedsTwilioMax(finalBody)).toBe(false);
  });

  it("does not truncate or rewrite", () => {
    const body = "Exact Tyler body.";
    expect(buildWeeklyTtoFinalBodyWithFooter(body)).toBe(
      `${body}\n\n${WEEKLY_TTO_COMPLIANCE_FOOTER}`
    );
  });
});
