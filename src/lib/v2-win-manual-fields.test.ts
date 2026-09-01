import { describe, expect, it } from "vitest";
import {
  buildManualWinIdempotencyKey,
  isValidClientRequestId,
  isValidOccurredOnDateKey,
  mapManualWinUserText,
  MANUAL_WIN_DETAILS_MAX,
  MANUAL_WIN_TITLE_MAX,
  resolveManualWinOccurredOnPrefill,
} from "@/lib/v2-win-manual-fields";

describe("v2-win-manual-fields", () => {
  it("accepts short titles like Done and Did the goal!", () => {
    expect(mapManualWinUserText({ title: "Done" })).toEqual({
      display_title: "Done",
      display_body: "Done",
      action_fact: "Done",
    });
    expect(mapManualWinUserText({ title: "Did the goal!" }).display_title).toBe("Did the goal!");
    expect(mapManualWinUserText({ title: "Got a win!" }).action_fact).toBe("Got a win!");
  });

  it("uses details as display_body when present", () => {
    expect(mapManualWinUserText({ title: "Done", details: "Finished early" })).toEqual({
      display_title: "Done",
      display_body: "Finished early",
      action_fact: "Done",
    });
  });

  it("does not invent quotes or meaning from user text", () => {
    const mapped = mapManualWinUserText({ title: "Done" });
    expect(JSON.stringify(mapped)).not.toMatch(/because|proud|meaningful|quote/i);
  });

  it("enforces title/details max lengths as constants", () => {
    expect(MANUAL_WIN_TITLE_MAX).toBe(80);
    expect(MANUAL_WIN_DETAILS_MAX).toBe(240);
  });

  it("validates UUID client_request_id", () => {
    expect(isValidClientRequestId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isValidClientRequestId("not-a-uuid")).toBe(false);
    expect(isValidClientRequestId("")).toBe(false);
  });

  it("validates occurred_on date keys", () => {
    expect(isValidOccurredOnDateKey("2026-08-08")).toBe(true);
    expect(isValidOccurredOnDateKey("2026-02-30")).toBe(false);
    expect(isValidOccurredOnDateKey("08/08/2026")).toBe(false);
  });

  it("prefills occurredOn only for valid past/today keys against member-local today", () => {
    expect(resolveManualWinOccurredOnPrefill("2026-08-01", "2026-08-08")).toBe("2026-08-01");
    expect(resolveManualWinOccurredOnPrefill("2026-08-08", "2026-08-08")).toBe("2026-08-08");
    expect(resolveManualWinOccurredOnPrefill("2026-08-09", "2026-08-08")).toBe("2026-08-08");
    expect(resolveManualWinOccurredOnPrefill("not-a-date", "2026-08-08")).toBe("2026-08-08");
    expect(resolveManualWinOccurredOnPrefill("08/01/2026", "2026-08-08")).toBe("2026-08-08");
    expect(resolveManualWinOccurredOnPrefill(undefined, "2026-08-08")).toBe("2026-08-08");
  });

  it("builds manual idempotency namespace without timestamp", () => {
    expect(buildManualWinIdempotencyKey("user_1", "550e8400-e29b-41d4-a716-446655440000")).toBe(
      "win_v1:manual:user_1:550e8400-e29b-41d4-a716-446655440000"
    );
  });
});
