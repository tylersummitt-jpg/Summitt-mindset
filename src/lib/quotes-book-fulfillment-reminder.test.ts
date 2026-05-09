import { describe, expect, it } from "vitest";
import {
  addTwentyDays,
  canSendOpsReminder,
  extractPrimaryEmail,
  isDue,
  isEntitledForQuotesBookReminder,
  isNotDueYet,
  isUserCreatedOnOrAfterCutoff,
  parseAutomationCutover,
  parseClerkCreatedAtMs,
  shouldSendDueOpsReminder,
} from "@/lib/quotes-book-fulfillment-reminder";

describe("quotes-book-fulfillment-reminder", () => {
  const cutover = parseAutomationCutover("2026-05-08T00:00:00.000Z")!;

  it("user created before cutover is not eligible", () => {
    const ms = new Date("2026-05-07T23:59:59.999Z").getTime();
    expect(isUserCreatedOnOrAfterCutoff(ms, cutover)).toBe(false);
  });

  it("user created on/after cutover can be eligible", () => {
    const ms = new Date("2026-05-08T00:00:00.000Z").getTime();
    expect(isUserCreatedOnOrAfterCutoff(ms, cutover)).toBe(true);
    expect(
      isUserCreatedOnOrAfterCutoff(
        new Date("2026-06-01T12:00:00.000Z").getTime(),
        cutover
      )
    ).toBe(true);
  });

  it("not eligible if not subscribed/trialing (metadata)", () => {
    expect(isEntitledForQuotesBookReminder({})).toBe(false);
    expect(isEntitledForQuotesBookReminder(null)).toBe(false);
    expect(isEntitledForQuotesBookReminder({ summittSubscribed: true })).toBe(
      true
    );
  });

  it("not eligible if no email", () => {
    expect(extractPrimaryEmail({})).toBe(null);
    expect(extractPrimaryEmail({ email_addresses: [] })).toBe(null);
  });

  it("quotes_book_due_at is exactly 20 days after entitled_first_seen_at", () => {
    const entitled = new Date("2026-05-10T12:00:00.000Z");
    const due = addTwentyDays(entitled);
    expect(due.getTime() - entitled.getTime()).toBe(20 * 86_400_000);
  });

  it("not due before Day 20", () => {
    const entitled = new Date("2026-01-01T00:00:00.000Z");
    const dueAt = addTwentyDays(entitled);
    const day19 = new Date(dueAt.getTime() - 86_400_000);
    expect(isNotDueYet(dueAt, day19)).toBe(true);
    expect(isDue(dueAt, day19)).toBe(false);
  });

  it("due on/after Day 20", () => {
    const entitled = new Date("2026-01-01T00:00:00.000Z");
    const dueAt = addTwentyDays(entitled);
    expect(isDue(dueAt, dueAt)).toBe(true);
    expect(isDue(dueAt, new Date(dueAt.getTime() + 60_000))).toBe(true);
  });

  it("already ops_email_sent_at means do not send again", () => {
    const entitled = new Date("2026-01-01T00:00:00.000Z");
    const dueAt = addTwentyDays(entitled);
    const now = new Date(dueAt.getTime() + 60_000);
    expect(canSendOpsReminder(null)).toBe(true);
    expect(canSendOpsReminder("2026-02-01T00:00:00.000Z")).toBe(false);
    expect(
      shouldSendDueOpsReminder(dueAt, now, "2026-02-01T00:00:00.000Z")
    ).toBe(false);
  });

  it("failure path (ops_email_sent_at null) can retry send when still due", () => {
    const entitled = new Date("2026-01-01T00:00:00.000Z");
    const dueAt = addTwentyDays(entitled);
    const now = new Date(dueAt.getTime() + 60_000);
    expect(shouldSendDueOpsReminder(dueAt, now, null)).toBe(true);
  });

  it("one user should never receive more than one internal reminder email in V1", () => {
    const entitled = new Date("2026-01-01T00:00:00.000Z");
    const dueAt = addTwentyDays(entitled);
    const now = new Date(dueAt.getTime() + 60_000);

    expect(shouldSendDueOpsReminder(dueAt, now, null)).toBe(true);

    const afterFirstSuccess = new Date("2026-02-15T00:00:00.000Z");
    expect(shouldSendDueOpsReminder(dueAt, now, afterFirstSuccess)).toBe(
      false
    );
    expect(
      shouldSendDueOpsReminder(
        dueAt,
        new Date(now.getTime() + 7 * 86_400_000),
        afterFirstSuccess
      )
    ).toBe(false);
  });

  it("parseClerkCreatedAtMs rejects invalid values", () => {
    expect(parseClerkCreatedAtMs({})).toBe(null);
    expect(parseClerkCreatedAtMs({ created_at: 0 })).toBe(null);
    expect(parseClerkCreatedAtMs({ created_at: 1 })).toBe(1);
  });
});
