import { describe, expect, it } from "vitest";

import { classifyV2InboundReply, buildV2ContractOverlayYesAckSms, naturalizeCommitmentForSms } from "@/lib/v2-sms-accountability";

describe("v2-sms-accountability", () => {
  it('classifies "already got it done" as user_yes (proof, not partial)', () => {
    const r = classifyV2InboundReply("1 hour sounds good. I actually already got it done!");
    expect(r.eventType).toBe("user_yes");
  });

  it('classifies short proof like "2 stories today" as user_yes', () => {
    const r = classifyV2InboundReply("2 stories today");
    expect(r.eventType).toBe("user_yes");
  });

  it('classifies follow-up reflection like "It went great!" as user_yes (prevents re-checking)', () => {
    const r = classifyV2InboundReply("It went great!");
    expect(r.eventType).toBe("user_yes");
  });

  it('classifies proof detail like "I was super focused..." as user_yes (proof detail, not a new check)', () => {
    const r = classifyV2InboundReply(
      "I was super focused. I did not get distracted. I was just proud of myself for being focused."
    );
    expect(r.eventType).toBe("user_yes");
    expect(r.normalizedHint).toMatch(/success_reflection|completion_detail/);
  });

  it('classifies "I stayed focused and got it done." as user_yes/proof', () => {
    const r = classifyV2InboundReply("I stayed focused and got it done.");
    expect(r.eventType).toBe("user_yes");
    expect(r.normalizedHint).toMatch(/success_reflection|completion_detail/);
  });

  it('classifies "I did not get distracted." as user_yes/proof detail', () => {
    const r = classifyV2InboundReply("I did not get distracted.");
    expect(r.eventType).toBe("user_yes");
    expect(r.normalizedHint).toMatch(/success_reflection/);
  });

  it('classifies "I’m proud of myself for being focused." as user_yes/proof detail', () => {
    const r = classifyV2InboundReply("I’m proud of myself for being focused.");
    expect(r.eventType).toBe("user_yes");
    expect(r.normalizedHint).toMatch(/success_reflection/);
  });

  it('does NOT treat "I feel tired" as user_yes', () => {
    const r = classifyV2InboundReply("I feel tired");
    expect(r.eventType).not.toBe("user_yes");
  });

  it('does NOT treat "I’m proud of myself" alone as user_yes', () => {
    const r = classifyV2InboundReply("I’m proud of myself");
    expect(r.eventType).not.toBe("user_yes");
  });

  it("overlay activation ack avoids banned system phrases", () => {
    const ack = buildV2ContractOverlayYesAckSms({
      messageSid: "SM123",
      adoptedAskText: "Today only: 30 minutes of deep work",
      contractKind: "shrink_ask",
    }).body.toLowerCase();
    expect(ack).not.toContain("smaller window");
    expect(ack).not.toContain("active for 7 days");
    expect(ack).not.toContain("daily check-ins");
    expect(ack).not.toContain("stay on track");
    expect(ack).not.toContain("contract");
    expect(ack).not.toContain("overlay");
    expect(ack).not.toContain("pending resolution");
    expect(ack).not.toContain("v2");
  });

  it("naturalizes glued today-hour punctuation for outbound glue", () => {
    expect(naturalizeCommitmentForSms("Just for today-1 hour of distribution", 120)).toContain(
      "today — 1"
    );
    expect(naturalizeCommitmentForSms("Just for today—2 hours of deep work", 120)).toContain(
      "today — 2"
    );
  });
});

describe("classifyV2InboundReply — done abandonment vs completion (P1)", () => {
  const expectNotCompletionYes = (body: string) => {
    const r = classifyV2InboundReply(body);
    expect(r.eventType).not.toBe("user_yes");
    expect(r.normalizedHint).not.toBe("completion_phrase");
    expect(r.normalizedHint).not.toBe("completion_detail");
  };

  it("does not treat I'm done with you as user_yes completion", () => {
    const r = classifyV2InboundReply("I'm done with you");
    expect(r.eventType).not.toBe("user_yes");
    expect(r.normalizedHint).toBe("relationship_exit_context");
  });

  it.each([
    "I'm done with this app",
    "I'm done with the app",
    "I'm done with this goal",
    "I'm done with this commitment",
    "I'm done with texting",
    "I'm done with texts",
    "I'm done with SMS",
    "I'm done here",
    "Done with this subscription",
    "I'm done with this program",
    "I'm done with Summitt Mindset",
  ])("does not treat %j as user_yes completion", (body) => {
    expectNotCompletionYes(body);
    const r = classifyV2InboundReply(body);
    expect(r.normalizedHint).toBe("done_abandonment_context");
  });

  it.each([
    "done",
    "already got it done",
    "I did it",
    "finished it",
    "Done today",
    "Got the walk done",
    "done with my workout",
    "I'm done",
    "I'm done for today",
  ])('still treats "%s" as user_yes completion', (body) => {
    const r = classifyV2InboundReply(body);
    expect(r.eventType).toBe("user_yes");
    expect(r.normalizedHint).toMatch(/completion_/);
  });
});

