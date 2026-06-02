import { describe, expect, it } from "vitest";

import { buildTemporalContractV1 } from "@/lib/sms-temporal-contract-v1";
import {
  detectTemporalWordingViolations,
  pickSalientReferencedEvent,
} from "@/lib/sms-temporal-wording-validator";

const TZ = "America/New_York";

/** Tyler June 2 regression — wrong "yesterday" for May 31 completion */
describe("Tyler June 2 temporal wording", () => {
  const sendNow = new Date("2026-06-02T12:00:00.000Z");
  const contract = buildTemporalContractV1({
    timezone: TZ,
    now: sendNow,
    sendDayKey: "2026-06-02",
    referencedEvents: [
      {
        ref_id: "memory_7d_latest_win",
        event_type: "user_yes",
        local_day_key: "2026-05-31",
        allowed_relative_label: "the_other_day",
        evidence_preview: "distribution time done today",
        occurred_at: "2026-05-31T21:17:00.000Z",
        spoken_local_day_key: "2026-05-31",
      },
    ],
  });

  const referenced = contract.referenced_events!;

  it("detects invalid_yesterday_reference", () => {
    const body =
      "You did great with your distribution time yesterday! As you continue today, does sticking with two hours still feel right?";
    const violations = detectTemporalWordingViolations(body, {
      temporal_contract: contract,
      referenced_events: referenced,
      mode: "daily",
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.reason).toBe("invalid_yesterday_reference");
    expect(pickSalientReferencedEvent(referenced)?.local_day_key).toBe("2026-05-31");
  });

  it("does not block generic yesterday without salient completion event", () => {
    const noRefsContract = buildTemporalContractV1({
      timezone: TZ,
      now: sendNow,
      sendDayKey: "2026-06-02",
    });
    const violations = detectTemporalWordingViolations("Yesterday is behind us — what's one honest move?", {
      temporal_contract: noRefsContract,
      referenced_events: [],
      mode: "daily",
    });
    expect(violations).toHaveLength(0);
  });

  it("allows yesterday when event is actually yesterday", () => {
    const june1Contract = buildTemporalContractV1({
      timezone: TZ,
      now: sendNow,
      sendDayKey: "2026-06-02",
      referencedEvents: [
        {
          ref_id: "win",
          event_type: "user_yes",
          local_day_key: "2026-06-01",
          allowed_relative_label: "yesterday",
          evidence_preview: "hit the bar",
        },
      ],
    });
    const violations = detectTemporalWordingViolations("Nice follow-through yesterday on distribution.", {
      temporal_contract: june1Contract,
      referenced_events: june1Contract.referenced_events!,
      mode: "daily",
    });
    expect(violations).toHaveLength(0);
  });
});
