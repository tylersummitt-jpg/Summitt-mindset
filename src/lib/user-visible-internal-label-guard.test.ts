import { describe, expect, it } from "vitest";

import {
  detectUserVisibleInternalLabelViolations,
  mergeInternalLabelRepairInstruction,
  userVisibleInternalLabelBlockedReasons,
} from "@/lib/user-visible-internal-label-guard";
import { evaluateRelationshipVoiceWithPraisePolicy } from "@/lib/v3-sms-voice-ownership";

describe("detectUserVisibleInternalLabelViolations", () => {
  it("N: blocks yes, partial, or not yet", () => {
    const hits = detectUserVisibleInternalLabelViolations(
      "Did you follow through before your appointment — yes, partial, or not yet?"
    );
    expect(hits.some((h) => h.reason === "internal_label_yes_partial_not_yet")).toBe(true);
    expect(hits.some((h) => h.reason === "internal_label_partial_word")).toBe(true);
  });

  it("O: blocks done, partial, or missed", () => {
    const hits = detectUserVisibleInternalLabelViolations(
      "Did that block happen — done, partial, or missed?"
    );
    expect(hits.some((h) => h.reason === "internal_label_done_partial_missed")).toBe(true);
  });

  it("blocks yes, no, or partial triad variants", () => {
    expect(
      userVisibleInternalLabelBlockedReasons("Was that yes, no, or partial?")
    ).toContain("internal_label_yes_no_or_partial");
    expect(userVisibleInternalLabelBlockedReasons("Reply yes, no, or partial.")).toContain(
      "internal_label_yes_no_or_partial"
    );
    expect(userVisibleInternalLabelBlockedReasons("yes/no/partial")).toContain(
      "internal_label_yes_no_partial_menu"
    );
    expect(userVisibleInternalLabelBlockedReasons("yes, no, partial")).toContain(
      "internal_label_yes_no_partial_commas"
    );
    expect(userVisibleInternalLabelBlockedReasons("Reply yes no or partial")).toContain(
      "internal_label_yes_no_or_partial_spaces"
    );
  });

  it("blocks done/missed/partial menu triads", () => {
    expect(
      userVisibleInternalLabelBlockedReasons("Did you get it done, partial, or missed?")
    ).toEqual(
      expect.arrayContaining([
        "internal_label_done_partial_or_missed_menu",
        "internal_label_done_partial_missed",
      ])
    );
    expect(userVisibleInternalLabelBlockedReasons("done, missed, or partial")).toContain(
      "internal_label_done_missed_or_partial"
    );
    expect(userVisibleInternalLabelBlockedReasons("finished, started, or partial")).toContain(
      "internal_label_finished_started_or_partial"
    );
  });

  it("P: allows human outcome-check phrasing", () => {
    expect(
      detectUserVisibleInternalLabelViolations(
        "Did you get it done, start it, or did something get in the way?"
      )
    ).toEqual([]);
    expect(
      detectUserVisibleInternalLabelViolations("What happened with the plan before your appointment?")
    ).toEqual([]);
    expect(detectUserVisibleInternalLabelViolations("I got part of it done")).toEqual([]);
    expect(detectUserVisibleInternalLabelViolations("I got some of it done")).toEqual([]);
    expect(detectUserVisibleInternalLabelViolations("I started it")).toEqual([]);
  });

  it("Q: blocks user_partial and classification tokens", () => {
    expect(userVisibleInternalLabelBlockedReasons("Outcome was user_partial today")).toContain(
      "internal_label_user_partial"
    );
    expect(userVisibleInternalLabelBlockedReasons("The classification says user_yes")).toEqual(
      expect.arrayContaining(["internal_label_classification", "internal_label_user_yes"])
    );
  });

  it("wires into relationship voice evaluation as repairable", () => {
    const voice = evaluateRelationshipVoiceWithPraisePolicy(
      "Did you follow through — yes, partial, or not yet?"
    );
    expect(voice.reasons).toContain("internal_label_yes_partial_not_yet");
  });

  it("mergeInternalLabelRepairInstruction adds repair guidance for internal labels", () => {
    const body = "Was that yes, no, or partial?";
    const merged = mergeInternalLabelRepairInstruction(
      undefined,
      userVisibleInternalLabelBlockedReasons(body),
      body
    );
    expect(merged).toMatch(/INTERNAL LABEL LEAK REPAIR/i);
    expect(merged).toMatch(/human language/i);
  });
});
