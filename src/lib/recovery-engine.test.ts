import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildOperatingSnapshot, formatOperatingReport } from "@/lib/admin-operating-snapshot";
import { emptyHomepageVideoReport } from "@/lib/admin-homepage-video";
import {
  emptyCurrentFreeTrials,
  emptyStripeWeekMovement,
  emptyUnknownSnapshot,
  emptyUnknownTrialOnboardingFunnel,
  emptyVisitorCohortTable,
} from "@/lib/admin-subscriber-growth-pure";
import {
  assignRecoveryGroup,
  classifyRecoveryInbound,
  decideRecoverySend,
  evaluateAutomation,
  recoveryGreeting,
  recoveryMessageCopy,
  verifyResendWebhook,
  type RecoveryCandidate,
  type RecoveryMessageState,
  type RecoverySettings,
} from "@/lib/recovery-engine";
import { formatRecoveryOperations } from "@/lib/recovery-report";

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

function decide(patch: {
  settings?: Partial<RecoverySettings>;
  candidate?: Partial<RecoveryCandidate>;
  assignment?: "control" | "recovery" | null;
  message?: RecoveryMessageState | null;
  priorAcceptedAtMs?: number | null;
  alreadySentToday?: number;
  nowMs?: number;
} = {}) {
  return decideRecoverySend({
    nowMs: patch.nowMs ?? NOW,
    settings: settings(patch.settings),
    candidate: candidate(patch.candidate),
    assignment: patch.assignment === undefined ? "recovery" : patch.assignment,
    message: patch.message === undefined ? message() : patch.message,
    priorAcceptedAtMs: patch.priorAcceptedAtMs ?? null,
    alreadySentToday: patch.alreadySentToday ?? 0,
  });
}

describe("recovery send gates", () => {
  it("does not send while automation is off or a required check is missing", () => {
    expect(decide({ settings: { status: "off" } }).send).toBe(false);
    expect(decide({ settings: { status: "paused" } }).send).toBe(false);
    expect(decide({ settings: { sendingAuthorized: false } }).send).toBe(false);
    expect(decide({ settings: { inboundReady: false } }).send).toBe(false);
    expect(decide({ settings: { suppressionCheckReady: false } }).send).toBe(false);
    expect(decide({ settings: { suppressionReadable: false } }).send).toBe(false);
    expect(decide({ settings: { postalAddress: null } }).send).toBe(false);
    expect(decide({ settings: { enrollmentStartsAtMs: null } }).send).toBe(false);
    expect(evaluateAutomation(settings({ status: "off" })).process).toBe(false);
  });

  it("fails closed for membership, restricted geography, address, suppression, and history", () => {
    expect(decide({ candidate: { membership: "member" } }).reason).toContain("member");
    expect(decide({ candidate: { membership: "former" } }).reason).toContain("former");
    expect(decide({ candidate: { membership: "unknown" } }).reason).toContain("unknown");
    expect(decide({ candidate: { countryCode: null } }).send).toBe(true);
    expect(decide({ candidate: { countryCode: "US" } }).send).toBe(true);
    expect(decide({ candidate: { countryCode: "CA" } }).reason).toContain("restricted");
    expect(decide({ candidate: { countryCode: "DE" } }).reason).toContain("restricted");
    expect(decide({ candidate: { countryCode: "MX" } }).reason).toContain("initial");
    expect(decide({ candidate: { email: "not-an-email" } }).reason).toContain("address");
    expect(decide({ candidate: { suppressed: true } }).reason).toContain("suppressed");
    expect(decide({ candidate: { providerSuppressed: null } }).reason).toContain("not checked");
    expect(decide({ candidate: { createdAtMs: START - 1000 } }).reason).toContain("before");
  });

  it("keeps the holdout, a reply, a claim, and an uncertain send from sending", () => {
    expect(decide({ assignment: "control" }).reason).toContain("holdout");
    expect(decide({ candidate: { humanReplyOpen: true } }).reason).toContain("reply");
    expect(decide({ message: message({ claimHeldByOther: true }) }).reason).toContain("Another worker");
    expect(decide({ message: message({ status: "uncertain" }) }).reason).toContain("not retried");
    expect(decide({ message: message({ status: "accepted" }) }).reason).toContain("not retried");
    expect(decide({ nowMs: candidate().createdAtMs }).reason).toContain("not due");
  });

  it("uses a real first name and does not guess from an address", () => {
    expect(recoveryGreeting("Avery")).toBe("Hi Avery,");
    expect(recoveryGreeting("  ")).toBe("Hey!");
    expect(recoveryGreeting("person@example.com")).toBe("Hey!");
    expect(recoveryGreeting(null)).toBe("Hey!");
    const groups = new Set([
      assignRecoveryGroup("user_a", "salt"),
      assignRecoveryGroup("user_a", "salt"),
    ]);
    expect(groups.size).toBe(1);
  });

  it("classifies inbound mail and verifies a webhook signature", () => {
    expect(classifyRecoveryInbound({
      from: "Mailer-Daemon@example.com",
      subject: "Delivery failed",
      autoSubmitted: null,
      inReplyTo: "<m1>",
      knownMessageIds: ["<m1>"],
    })).toBe("bounce");
    expect(classifyRecoveryInbound({
      from: "person@example.com",
      subject: "Automatic reply: away",
      autoSubmitted: "auto-replied",
      inReplyTo: "<m1>",
      knownMessageIds: ["<m1>"],
    })).toBe("auto");
    expect(classifyRecoveryInbound({
      from: "person@example.com",
      subject: "Can I start tomorrow?",
      autoSubmitted: "no",
      inReplyTo: "<other>",
      knownMessageIds: ["<m1>"],
    })).toBe("unmatched");
    expect(classifyRecoveryInbound({
      from: "person@example.com",
      subject: "Can I start tomorrow?",
      autoSubmitted: null,
      inReplyTo: "<m1>",
      knownMessageIds: ["<m1>"],
    })).toBe("human");

    const secret = Buffer.from("test-secret").toString("base64");
    const body = "{\"ok\":true}";
    const timestamp = String(Math.floor(NOW / 1000));
    const signature = createHmac("sha256", Buffer.from(secret, "base64"))
      .update(`msg_1.${timestamp}.${body}`)
      .digest("base64");
    expect(verifyResendWebhook({
      secret: `whsec_${secret}`,
      id: "msg_1",
      timestamp,
      signatureHeader: `v1,${signature}`,
      body,
      nowMs: NOW,
    })).toBe(true);
    expect(verifyResendWebhook({
      secret: `whsec_${secret}`,
      id: "msg_1",
      timestamp,
      signatureHeader: "v1,wrong",
      body,
      nowMs: NOW,
    })).toBe(false);
  });

  it("keeps the shared report free of reply text and leaves challenge mail alone", () => {
    const copy = recoveryMessageCopy({
      step: 1,
      firstName: null,
      unsubscribeUrl: "https://summittmindset.com/api/recovery/unsubscribe?token=example",
      postalAddress: "1 Example Street",
    });
    expect(copy.text).toContain("Hey!");
    expect(copy.text).not.toContain("abandoned");
    const snapshot = buildOperatingSnapshot({
      growth: {
        range: "last_30",
        source: "all",
        timezone: "America/New_York",
        asOfNowLabel: "Oct 10, 2026, 8:00 AM",
        snapshot: emptyUnknownSnapshot(),
        latestTrials: [],
        warnings: [],
        adSpendEntries: [],
        activationQueryComplete: true,
        latestTrialsActivationComplete: true,
        adSpendQueryComplete: true,
        todayDateKey: "2026-10-10",
        stripeWeek: emptyStripeWeekMovement(),
        currentFreeTrials: emptyCurrentFreeTrials(),
        recentActivity: null,
        recentActivityPaymentFailedIncluded: false,
        trialOnboardingFunnel: emptyUnknownTrialOnboardingFunnel(),
        visitorCohortTable: emptyVisitorCohortTable(),
        homepageVideo: emptyHomepageVideoReport(),
      },
      challengeAttention: 0,
      deletions: null,
      deletionsAvailable: true,
    });
    const { report, ...rest } = snapshot;
    expect(report).toBe(formatOperatingReport(rest));
    const block = formatRecoveryOperations(snapshot.recoveryAutomation).join("\n");
    expect(report).toContain(block);
    expect(report).toContain("Sending is off");
    expect(report).not.toContain("Can I start tomorrow");
    expect(report).not.toContain("person@example.com");
    expect(readFileSync("src/lib/send-challenge-email.ts", "utf8")).toContain(
      'from: "challenge@summittmindset.com"'
    );
    const recoveryServer = readFileSync("src/lib/recovery.server.ts", "utf8");
    expect(recoveryServer).not.toContain("send-challenge-email");
    expect(recoveryServer.indexOf("evaluateAutomation")).toBeLessThan(recoveryServer.indexOf("new Resend"));
    expect(recoveryServer).toContain("RECOVERY_FROM");
    expect(readFileSync("src/app/api/cron/recovery/route.ts", "utf8")).not.toContain("new Resend");
    expect(readFileSync("src/lib/send-challenge-email.ts", "utf8")).not.toContain("tyler@summittmindset.com");
  });
});
