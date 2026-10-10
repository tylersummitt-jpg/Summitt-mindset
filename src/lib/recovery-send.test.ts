import { describe, expect, it, vi } from "vitest";

import type { ResendSendLike } from "@/lib/challenge-send-outcome";
import {
  combineSuppression,
  executeRecoveryBatch,
  explicitCountryCode,
  interpretContactLookup,
  interpretResendRecoveryEvent,
  planRecoveryEnrollment,
  recoveryGeography,
  RECOVERY_FROM,
  RECOVERY_REPLY_TO,
  recoveryReplyTo,
  recoveryStepsForAssignment,
  type RecoveryBatchJob,
  type RecoveryCandidate,
  type RecoveryDeliveryPayload,
  type RecoveryMessageState,
  type RecoverySettings,
} from "@/lib/recovery-engine";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const START = NOW - 10 * 24 * 60 * 60 * 1000;

function settings(patch: Partial<RecoverySettings> = {}): RecoverySettings {
  return {
    status: "active",
    sendingAuthorized: true,
    inboundReady: true,
    suppressionCheckReady: true,
    suppressionReadable: true,
    postalAddress: "1 Example Street, Knoxville, TN 37902",
    enrollmentStartsAtMs: START,
    dailyCap: 25,
    ...patch,
  };
}

function candidate(patch: Partial<RecoveryCandidate> = {}): RecoveryCandidate {
  return {
    clerkUserId: "user_example",
    createdAtMs: NOW - 25 * 60 * 60 * 1000,
    membership: "verified_nonmember",
    countryCode: "US",
    email: "person@example.com",
    firstName: "Avery",
    suppressed: false,
    providerSuppressed: false,
    humanReplyOpen: false,
    ...patch,
  };
}

function message(patch: Partial<RecoveryMessageState> = {}): RecoveryMessageState {
  return {
    step: 1,
    status: "claimed",
    idempotencyKey: "recovery:enr:1",
    claimHeldByOther: false,
    acceptedAtMs: null,
    ...patch,
  };
}

function payload(): RecoveryDeliveryPayload {
  return {
    from: RECOVERY_FROM,
    to: "person@example.com",
    replyTo: RECOVERY_REPLY_TO,
    subject: "Your Summitt Mindset account is ready",
    text: "Hey!",
    html: "<div>Hey!</div>",
    headers: { "List-Unsubscribe": "<https://summittmindset.com/api/recovery/unsubscribe?token=example>" },
    idempotencyKey: "recovery:enr:1",
  };
}

function job(): RecoveryBatchJob {
  return {
    idempotencyKey: "recovery:enr:1",
    candidate: candidate(),
    assignment: "recovery",
    message: message({ status: "scheduled" }),
    priorAcceptedAtMs: null,
    alreadySentToday: 0,
  };
}

async function run(args: {
  settings?: RecoverySettings;
  reread?: {
    settings?: RecoverySettings;
    candidate?: RecoveryCandidate;
    assignment?: "control" | "recovery";
    message?: RecoveryMessageState;
  };
  claim?: (key: string) => Promise<boolean>;
  send?: (payload: RecoveryDeliveryPayload) => Promise<ResendSendLike>;
}) {
  const send = vi.fn(args.send ?? (async () => ({ data: { id: "email_1" }, error: null })));
  const record = vi.fn(async () => {});
  const result = await executeRecoveryBatch({
    nowMs: NOW,
    settings: args.settings ?? settings(),
    jobs: [job()],
    claim: args.claim ?? (async () => true),
    reread: async () => ({
      settings: args.reread?.settings ?? settings(),
      candidate: args.reread?.candidate ?? candidate(),
      assignment: args.reread?.assignment ?? "recovery",
      message: args.reread?.message ?? message(),
      priorAcceptedAtMs: null,
      alreadySentToday: 0,
    }),
    buildPayload: async () => payload(),
    send,
    record,
  });
  return { result, send, record };
}

describe("recovery provider send", () => {
  it("sends with the recovery From and Reply-To only after the gates pass", async () => {
    const { result, send, record } = await run({});
    expect(result.accepted).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      from: "Tyler Summitt <tyler@summittmindset.com>",
      replyTo: "tyler@summittmindset.com",
      idempotencyKey: "recovery:enr:1",
    }));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "accepted" }));
  });

  it("does not send when membership or suppression changes before the provider call", async () => {
    const member = await run({ reread: { candidate: candidate({ membership: "member" }) } });
    const unsubscribed = await run({ reread: { candidate: candidate({ suppressed: true }) } });
    expect(member.send).not.toHaveBeenCalled();
    expect(unsubscribed.send).not.toHaveBeenCalled();
    expect(member.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "stop" }));
    expect(unsubscribed.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "stop" }));
  });

  it("emails unknown geography and excludes a known restricted country", async () => {
    const missing = await run({ reread: { candidate: candidate({ countryCode: null }) } });
    expect(missing.send).toHaveBeenCalledTimes(1);
    const canada = await run({ reread: { candidate: candidate({ countryCode: "CA" }) } });
    expect(canada.send).not.toHaveBeenCalled();
    expect(canada.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "stop" }));
    expect(recoveryGeography(null)).toEqual({ eligible: true, basis: "unknown" });
    expect(recoveryGeography("US").basis).toBe("explicit_us");
    expect(explicitCountryCode(null)).toBe(null);
    expect(explicitCountryCode({})).toBe(null);
    expect(explicitCountryCode({ country: "us" })).toBe("US");
  });

  it("keeps a timeout after a possible acceptance from being retried", async () => {
    const first = await run({ send: async () => { throw new Error("timeout"); } });
    expect(first.result.uncertain).toBe(1);
    expect(first.send).toHaveBeenCalledTimes(1);
    const second = await run({
      reread: { message: message({ status: "uncertain" }) },
    });
    expect(second.send).not.toHaveBeenCalled();
    expect(second.record).toHaveBeenCalledWith(expect.objectContaining({
      reason: expect.stringContaining("not retried"),
    }));
  });

  it("lets the first scheduled job win and does not send the duplicate", async () => {
    const claimed = new Set<string>();
    const send = vi.fn(async () => ({ data: { id: "email_1" }, error: null }));
    const shared = {
      nowMs: NOW,
      settings: settings(),
      jobs: [job()],
      claim: async (key: string) => {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
      reread: async () => ({
        settings: settings(),
        candidate: candidate(),
        assignment: "recovery" as const,
        message: message(),
        priorAcceptedAtMs: null,
        alreadySentToday: 0,
      }),
      buildPayload: async () => payload(),
      send,
      record: async () => {},
    };
    await executeRecoveryBatch(shared);
    await executeRecoveryBatch(shared);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not send to the holdout, a human reply, or a paused switch", async () => {
    const holdout = await run({ reread: { assignment: "control" } });
    const reply = await run({ reread: { candidate: candidate({ humanReplyOpen: true }) } });
    const paused = await run({
      settings: settings({ status: "paused" }),
      reread: { settings: settings({ status: "paused" }) },
    });
    expect(holdout.send).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
    expect(paused.send).not.toHaveBeenCalled();
  });

  it("records a provider suppression and does not treat an empty check as clear", () => {
    expect(combineSuppression(false, "clear")).toBe(false);
    expect(combineSuppression(null, "clear")).toBe(null);
    expect(combineSuppression(false, "suppressed")).toBe(true);
    expect(interpretContactLookup({ unsubscribed: true })).toBe("suppressed");
    expect(interpretContactLookup({ statusCode: 404 })).toBe("clear");
    expect(interpretContactLookup({ threw: true })).toBe("unknown");
    expect(explicitCountryCode({ country: "person@example.com" })).toBe(null);
    const unknownPlan = planRecoveryEnrollment({
      createdAtMs: NOW,
      enrollmentStartsAtMs: START,
      membership: "verified_nonmember",
      countryCode: null,
      email: "person@example.com",
      alreadyEnrolled: false,
      locallySuppressed: false,
      suppressionReadOk: true,
      clerkUserId: "user_example",
    });
    expect(unknownPlan.enroll).toBe(true);
    expect(planRecoveryEnrollment({
      createdAtMs: NOW,
      enrollmentStartsAtMs: START,
      membership: "verified_nonmember",
      countryCode: "GB",
      email: "person@example.com",
      alreadyEnrolled: false,
      locallySuppressed: false,
      suppressionReadOk: true,
      clerkUserId: "user_example",
    }).enroll).toBe(false);
    expect(recoveryStepsForAssignment("control")).toEqual([]);
    expect(recoveryReplyTo({ token: "abc12345678901234567890", inboundDomain: "summittmindset.com" })).toBe(RECOVERY_REPLY_TO);
    expect(recoveryReplyTo({ token: "abc12345678901234567890", inboundDomain: "inbound.summittmindset.com" })).toBe(
      "r+abc12345678901234567890@inbound.summittmindset.com"
    );
  });

  it("reads provider bounce, complaint, and received events without guessing a person", () => {
    expect(interpretResendRecoveryEvent({
      type: "email.bounced",
      data: { email_id: "em_1", to: ["person@example.com"], bounce: { type: "Permanent" } },
    })).toMatchObject({ kind: "suppress", reason: "bounce" });
    expect(interpretResendRecoveryEvent({
      type: "email.bounced",
      data: { email_id: "em_1", to: ["person@example.com"], bounce: { type: "Transient" } },
    }).kind).toBe("soft_bounce");
    expect(interpretResendRecoveryEvent({
      type: "email.complained",
      data: { email_id: "em_1", to: ["person@example.com"] },
    })).toMatchObject({ kind: "suppress", reason: "complaint" });
    expect(interpretResendRecoveryEvent({
      type: "email.received",
      data: { email_id: "in_1", from: "person@example.com", to: ["r+abc@inbound.summittmindset.com"], subject: "Hello" },
    })).toMatchObject({ kind: "received", emailId: "in_1" });
  });
});
