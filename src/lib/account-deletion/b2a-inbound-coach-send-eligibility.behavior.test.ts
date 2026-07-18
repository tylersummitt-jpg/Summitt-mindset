import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behavioral coverage for APP-041B2a pre-Twilio gates on both inbound-coach
 * sendSMSChunked call sites. Uses the shared eligibility helper (same contract
 * both paths must call) plus route wiring assertions that both sites gate.
 */

const fromMock = vi.fn();
const hasUnresolvedMock = vi.fn();
const sendSMSChunkedMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));
vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  hasUnresolvedAccountDeletionRequest: (...args: unknown[]) =>
    hasUnresolvedMock(...args),
}));

import { checkInboundCoachSmsEligibility } from "./inbound-coach-send-eligibility";

const COACH = path.join(
  process.cwd(),
  "src/app/api/cron/sms-inbound-coach/route.ts"
);

function mockTables(opts: {
  jobStatus: string;
  identity: Record<string, unknown> | null;
  jobUpdates?: Array<Record<string, unknown>>;
}) {
  const updates = opts.jobUpdates ?? [];
  fromMock.mockImplementation((table: string) => {
    if (table === "sms_inbound_coach_jobs") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                message_sid: "SM_safety_1",
                status: opts.jobStatus,
                clerk_user_id: "user_safety",
              },
              error: null,
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          updates.push(patch);
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          };
        },
      };
    }
    if (table === "sms_identities") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: opts.identity,
              error: null,
            }),
          }),
        }),
      };
    }
    return {};
  });
  return updates;
}

async function runEligibilityThenMaybeSend(args: {
  expectedJobStatuses: readonly string[];
  destinationPhone: string;
  body: string;
}): Promise<{
  eligibility: Awaited<ReturnType<typeof checkInboundCoachSmsEligibility>>;
  twilioCalled: boolean;
  terminalPatch: Record<string, unknown> | null;
}> {
  const updates: Record<string, unknown>[] = [];
  // caller sets fromMock via mockTables before this
  void updates;
  const eligibility = await checkInboundCoachSmsEligibility({
    clerkUserId: "user_safety",
    destinationPhone: args.destinationPhone,
    messageSid: "SM_safety_1",
    expectedJobStatuses: args.expectedJobStatuses,
  });

  let twilioCalled = false;
  if (eligibility.ok) {
    await sendSMSChunkedMock({
      to: args.destinationPhone,
      body: args.body,
      lastOutbound: { clerkUserId: "user_safety", messageKind: "coach" },
    });
    twilioCalled = true;
  } else {
    // Mirror coach route: terminal cancel, no throw.
    fromMock("sms_inbound_coach_jobs").update({
      status: "cancelled",
      last_error: eligibility.lastErrorCode,
    });
  }

  return {
    eligibility,
    twilioCalled,
    terminalPatch: eligibility.ok
      ? null
      : { status: "cancelled", last_error: eligibility.lastErrorCode },
  };
}

describe("APP-041B2a inbound coach send paths — behavioral eligibility", () => {
  beforeEach(() => {
    fromMock.mockReset();
    hasUnresolvedMock.mockReset();
    sendSMSChunkedMock.mockReset();
    hasUnresolvedMock.mockResolvedValue(false);
    sendSMSChunkedMock.mockResolvedValue({ firstSid: "SM_out", chunkCount: 1 });
  });

  const liveIdentity = {
    phone_number: "+15551234567",
    clerk_user_id: "user_safety",
    sms_enabled: true,
    stopped_at: null,
  };

  it("1. unresolved deletion blocks Twilio (safety statuses)", async () => {
    mockTables({ jobStatus: "processing", identity: liveIdentity });
    hasUnresolvedMock.mockResolvedValue(true);
    const r = await runEligibilityThenMaybeSend({
      expectedJobStatuses: ["processing"],
      destinationPhone: "+15551234567",
      body: "safety reply",
    });
    expect(r.twilioCalled).toBe(false);
    expect(sendSMSChunkedMock).not.toHaveBeenCalled();
    expect(r.eligibility.ok).toBe(false);
    if (r.eligibility.ok) return;
    expect(r.eligibility.lastErrorCode).toBe("account_deleting");
    expect(r.terminalPatch).toEqual({
      status: "cancelled",
      last_error: "account_deleting",
    });
  });

  it("2. missing identity blocks Twilio", async () => {
    mockTables({ jobStatus: "processing", identity: null });
    const r = await runEligibilityThenMaybeSend({
      expectedJobStatuses: ["processing"],
      destinationPhone: "+15551234567",
      body: "safety reply",
    });
    expect(r.twilioCalled).toBe(false);
    expect(sendSMSChunkedMock).not.toHaveBeenCalled();
    expect(r.terminalPatch?.last_error).toBe("sms_not_eligible");
  });

  it("3. disabled identity blocks Twilio", async () => {
    mockTables({
      jobStatus: "processing",
      identity: { ...liveIdentity, sms_enabled: false },
    });
    const r = await runEligibilityThenMaybeSend({
      expectedJobStatuses: ["processing"],
      destinationPhone: "+15551234567",
      body: "safety reply",
    });
    expect(r.twilioCalled).toBe(false);
    expect(sendSMSChunkedMock).not.toHaveBeenCalled();
  });

  it("4. stopped identity blocks Twilio", async () => {
    mockTables({
      jobStatus: "processing",
      identity: { ...liveIdentity, stopped_at: "2026-07-18T00:00:00.000Z" },
    });
    const r = await runEligibilityThenMaybeSend({
      expectedJobStatuses: ["processing"],
      destinationPhone: "+15551234567",
      body: "safety reply",
    });
    expect(r.twilioCalled).toBe(false);
    expect(sendSMSChunkedMock).not.toHaveBeenCalled();
  });

  it("5. phone mismatch blocks Twilio", async () => {
    mockTables({
      jobStatus: "processing",
      identity: { ...liveIdentity, phone_number: "+15550009999" },
    });
    const r = await runEligibilityThenMaybeSend({
      expectedJobStatuses: ["processing"],
      destinationPhone: "+15551234567",
      body: "safety reply",
    });
    expect(r.twilioCalled).toBe(false);
    expect(sendSMSChunkedMock).not.toHaveBeenCalled();
    expect(JSON.stringify(r.eligibility)).not.toMatch(/\+1555/);
  });

  it("6. eligible unrelated user still sends", async () => {
    mockTables({ jobStatus: "processing", identity: liveIdentity });
    const r = await runEligibilityThenMaybeSend({
      expectedJobStatuses: ["processing"],
      destinationPhone: "+15551234567",
      body: "safety reply unchanged",
    });
    expect(r.twilioCalled).toBe(true);
    expect(sendSMSChunkedMock).toHaveBeenCalledTimes(1);
    expect(sendSMSChunkedMock.mock.calls[0]![0]).toMatchObject({
      body: "safety reply unchanged",
    });
  });

  it("7–8. blocked path is terminal cancelled and does not throw retry", async () => {
    mockTables({ jobStatus: "sending", identity: null });
    await expect(
      runEligibilityThenMaybeSend({
        expectedJobStatuses: ["sending"],
        destinationPhone: "+15551234567",
        body: "x",
      })
    ).resolves.toMatchObject({
      twilioCalled: false,
      terminalPatch: { status: "cancelled", last_error: "sms_not_eligible" },
    });
  });

  it("9. main sending status and safety processing status share helper contract", async () => {
    mockTables({ jobStatus: "sending", identity: liveIdentity });
    hasUnresolvedMock.mockResolvedValue(true);
    const main = await checkInboundCoachSmsEligibility({
      clerkUserId: "user_safety",
      destinationPhone: "+15551234567",
      messageSid: "SM_safety_1",
      expectedJobStatuses: ["sending"],
    });
    mockTables({ jobStatus: "processing", identity: liveIdentity });
    hasUnresolvedMock.mockResolvedValue(true);
    const safety = await checkInboundCoachSmsEligibility({
      clerkUserId: "user_safety",
      destinationPhone: "+15551234567",
      messageSid: "SM_safety_1",
      expectedJobStatuses: ["processing"],
    });
    expect(main).toEqual(safety);
    expect(main.ok).toBe(false);
    if (!main.ok) expect(main.lastErrorCode).toBe("account_deleting");
  });

  it("10. no phone in eligibility result details", async () => {
    mockTables({
      jobStatus: "sending",
      identity: { ...liveIdentity, phone_number: "+15559876543" },
    });
    const result = await checkInboundCoachSmsEligibility({
      clerkUserId: "user_safety",
      destinationPhone: "+15551234567",
      messageSid: "SM_safety_1",
      expectedJobStatuses: ["sending"],
    });
    expect(JSON.stringify(result)).not.toMatch(/\+1\d{10}|phone_number/i);
  });
});

describe("APP-041B2a both sendSMSChunked sites use shared helper (wire)", () => {
  const src = fs.readFileSync(COACH, "utf8");

  it("22–23. safety and main paths call checkInboundCoachSmsEligibility before sendSMSChunked", () => {
    expect(src).toContain(
      'from "@/lib/account-deletion/inbound-coach-send-eligibility"'
    );
    expect(src).toContain("checkInboundCoachSmsEligibility");

    const safetyStart = src.indexOf(
      "async function processInboundSmsSafetyShortCircuit"
    );
    const safetyEnd = src.indexOf(
      "async function runBlockerPendingPreCaptureGate",
      safetyStart
    );
    const safety = src.slice(safetyStart, safetyEnd);
    const safetyElig = safety.indexOf("checkInboundCoachSmsEligibility");
    const safetySend = safety.indexOf("await sendSMSChunked");
    expect(safetyElig).toBeGreaterThan(0);
    expect(safetySend).toBeGreaterThan(safetyElig);
    expect(safety).toContain('lastError: eligibility.lastErrorCode');
    expect(safety).toContain("return true");

    const mainStart = src.indexOf(
      "async function commitAndSendInboundCoachReply"
    );
    const mainEnd = src.indexOf("\nasync function ", mainStart + 40);
    const main = src.slice(mainStart, mainEnd > mainStart ? mainEnd : mainStart + 9000);
    const mainElig = main.indexOf("checkInboundCoachSmsEligibility");
    const mainSend = main.indexOf("await sendSMSChunked");
    expect(mainElig).toBeGreaterThan(0);
    expect(mainSend).toBeGreaterThan(mainElig);
    expect(main).toContain('expectedJobStatuses: ["sending"]');
  });

  it("24. only two sendSMSChunked call sites in inbound coach route", () => {
    const matches = src.match(/await sendSMSChunked\s*\(/g) ?? [];
    expect(matches.length).toBe(2);
  });
});
