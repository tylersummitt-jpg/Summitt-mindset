import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { challengeLessons } from "@/lib/challenge-lessons";
import { createMemoryChallengeStore } from "@/lib/challenge-memory-store";
import {
  classifyResendSend,
  sanitizeProviderError,
} from "@/lib/challenge-send-outcome";
import {
  enrollChallenge,
  newChallengeEnrollment,
  processDueChallengeLessons,
  reenrollChallenge,
  unsubscribeChallenge,
  type ChallengeDeps,
} from "@/lib/challenge-sequence";
import { sendChallengeEmail } from "@/lib/send-challenge-email";
import {
  CHALLENGE_PUBLIC_ALREADY,
  CHALLENGE_PUBLIC_FAILED,
  CHALLENGE_PUBLIC_STARTED,
  CHALLENGE_SEND_TRACKING_CUTOVER_ISO,
  type ChallengeParticipant,
  type ChallengeProviderResult,
  type ChallengeSender,
} from "@/lib/challenge-types";

const NOW = new Date("2026-10-11T15:00:00.000Z");
const DUE = "2026-10-11T14:00:00.000Z";
const LATER = "2026-10-12T15:00:00.000Z";

function accepted(id = "msg_accepted"): ChallengeProviderResult {
  return {
    outcome: "accepted",
    providerMessageId: id,
    errorName: null,
    statusCode: null,
    errorMessage: null,
  };
}

function providerError(): ChallengeProviderResult {
  return {
    outcome: "temporary_failure",
    providerMessageId: null,
    errorName: "internal_server_error",
    statusCode: 500,
    errorMessage: "temporarily unavailable",
  };
}

function harness(send: ChallengeSender, seed: ChallengeParticipant[] = []) {
  const store = createMemoryChallengeStore(seed);
  let slot = DUE;
  const deps: ChallengeDeps = {
    store,
    send,
    now: new Date(NOW),
    nextSendAt: () => slot,
  };
  return {
    store,
    deps,
    setNow(value: Date) {
      deps.now = value;
    },
    setSlot(value: string) {
      slot = value;
    },
  };
}

function callsOf(send: ReturnType<typeof vi.fn>) {
  return send.mock.calls.map((call) => call[0] as {
    to: string;
    day: number;
    idempotencyKey: string;
    unsubscribeToken: string;
  });
}

describe("challenge provider classification", () => {
  it("accepts only a non-empty message id", () => {
    expect(classifyResendSend({ result: { data: { id: "re_123" }, error: null } }).outcome).toBe(
      "accepted"
    );
    expect(
      classifyResendSend({ result: { data: { id: "  " }, error: null } }).outcome
    ).toBe("unknown");
    expect(classifyResendSend({ result: { data: null, error: null } }).outcome).toBe("unknown");
  });

  it("classifies provider errors, exceptions, and idempotency conflicts", () => {
    expect(
      classifyResendSend({
        result: {
          data: null,
          error: { name: "internal_server_error", statusCode: 500, message: "down" },
        },
      }).outcome
    ).toBe("temporary_failure");
    expect(
      classifyResendSend({
        result: {
          data: null,
          error: { name: "validation_error", statusCode: 422, message: "bad address user@example.com" },
        },
      }).outcome
    ).toBe("provider_rejected");
    expect(
      classifyResendSend({
        result: {
          data: null,
          error: { name: "invalid_idempotent_request", statusCode: 409, message: "mismatch" },
        },
      }).outcome
    ).toBe("permanent_failure");
    expect(classifyResendSend({ threw: new Error("socket timeout user@example.com") }).outcome).toBe(
      "unknown"
    );
    expect(sanitizeProviderError("failed for user@example.com")).toBe("failed for [email]");
  });
});

describe("challenge sequence", () => {
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    send = vi.fn(async () => accepted(`msg_${send.mock.calls.length + 1}`));
  });

  it("1. enrolls and accepts day 1 without claiming inbox delivery", async () => {
    const { store, deps } = harness(send);
    const result = await enrollChallenge(deps, "Pat@Example.com");
    expect(result).toEqual({ ok: true, status: 200, message: CHALLENGE_PUBLIC_STARTED });
    expect(result.message.toLowerCase()).not.toContain("delivered");
    const row = await store.findByEmail("pat@example.com");
    expect(row?.challengeDay).toBe(2);
    expect(row?.lastAcceptedDay).toBe(1);
    expect(row?.lastProviderMessageId).toMatch(/^msg_/);
    expect(row?.reliableSendTracking).toBe(true);
    expect(row?.sendTrackingCutoverAt).toBe(CHALLENGE_SEND_TRACKING_CUTOVER_ISO);
    expect(row?.completed).toBe(false);
    expect(callsOf(send)).toHaveLength(1);
    expect(callsOf(send)[0].day).toBe(1);
    expect(callsOf(send)[0].to).toBe("pat@example.com");
  });

  it("2. provider error on day 1 does not advance or report success", async () => {
    send.mockResolvedValue(providerError());
    const { store, deps } = harness(send);
    const result = await enrollChallenge(deps, "pat@example.com");
    expect(result).toEqual({ ok: false, status: 503, message: CHALLENGE_PUBLIC_FAILED });
    const row = await store.findByEmail("pat@example.com");
    expect(row?.challengeDay).toBe(1);
    expect(row?.lastAcceptedDay).toBeNull();
    expect(row?.lastProviderMessageId).toBeNull();
    expect(row?.sendState).toBe("temporary_failure");
    expect(row?.nextRetryAt).toBeTruthy();
  });

  it("3. provider exception on day 1 is unknown and does not advance", async () => {
    send.mockRejectedValue(new Error("network reset for pat@example.com"));
    const { store, deps } = harness(send);
    const result = await enrollChallenge(deps, "pat@example.com");
    expect(result.ok).toBe(false);
    const row = await store.findByEmail("pat@example.com");
    expect(row?.challengeDay).toBe(1);
    expect(row?.sendState).toBe("unknown");
    expect(row?.attemptIdempotencyKey).toBeTruthy();
    expect(row?.lastSendError ?? "").not.toContain("pat@example.com");
    expect(row?.lastAcceptedDay).toBeNull();
  });

  it("4. provider error on a later day does not advance", async () => {
    const { store, deps, setSlot } = harness(send);
    await enrollChallenge(deps, "pat@example.com");
    setSlot(DUE);
    send.mockResolvedValueOnce(providerError());
    await processDueChallengeLessons(deps);
    const row = await store.findByEmail("pat@example.com");
    expect(row?.challengeDay).toBe(2);
    expect(row?.lastAcceptedDay).toBe(1);
    expect(row?.sendState).toBe("temporary_failure");
  });

  it("5. retries a confirmed failure later without skipping the lesson", async () => {
    send.mockResolvedValueOnce(providerError());
    const { store, deps, setNow } = harness(send);
    await enrollChallenge(deps, "pat@example.com");
    const failed = await store.findByEmail("pat@example.com");
    expect(failed?.challengeDay).toBe(1);
    const firstKey = callsOf(send)[0].idempotencyKey;
    setNow(new Date(Date.parse(failed!.nextRetryAt!) + 1000));
    send.mockResolvedValueOnce(accepted("msg_retry"));
    await processDueChallengeLessons(deps);
    const row = await store.findByEmail("pat@example.com");
    expect(row?.challengeDay).toBe(2);
    expect(row?.lastAcceptedDay).toBe(1);
    expect(callsOf(send)).toHaveLength(2);
    expect(callsOf(send)[1].day).toBe(1);
    expect(callsOf(send)[1].idempotencyKey).not.toBe(firstKey);
  });

  it("6. duplicate signup does not send another day 1", async () => {
    const { deps } = harness(send);
    const first = await enrollChallenge(deps, "pat@example.com");
    const second = await enrollChallenge(deps, "PAT@example.com");
    expect(first.message).toBe(CHALLENGE_PUBLIC_STARTED);
    expect(second).toEqual({ ok: true, status: 200, message: CHALLENGE_PUBLIC_ALREADY });
    expect(callsOf(send)).toHaveLength(1);
  });

  it("7. concurrent cron runs send a due lesson once", async () => {
    const started = newChallengeEnrollment({
      email: "pat@example.com",
      now: NOW,
      id: "person-1",
      token: "token_person_1_unsubscribe_ok",
    });
    started.challengeDay = 2;
    started.nextSendAt = DUE;
    started.lastAcceptedDay = 1;
    const { deps } = harness(send, [started]);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    send.mockImplementation(async () => {
      await gate;
      return accepted("msg_once");
    });
    const first = processDueChallengeLessons(deps);
    const second = processDueChallengeLessons(deps);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(1);
    const row = await deps.store.findByEmail("pat@example.com");
    expect(row?.challengeDay).toBe(3);
    expect(row?.lastAcceptedDay).toBe(2);
  });

  it("8 and 9 and 18. sends days 1 through 7 in order and does not repeat an accepted lesson", async () => {
    const { store, deps } = harness(send);
    await enrollChallenge(deps, "pat@example.com");
    for (let n = 0; n < 8; n += 1) {
      await processDueChallengeLessons(deps);
    }
    const days = callsOf(send).map((call) => call.day);
    expect(days).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(callsOf(send).map((call) => call.idempotencyKey)).size).toBe(7);
    const row = await store.findByEmail("pat@example.com");
    expect(row?.completed).toBe(true);
    expect(row?.challengeDay).toBe(8);
    expect(challengeLessons.map((lesson) => lesson.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("10. unsubscribe before the next lesson sends nothing further", async () => {
    const { store, deps } = harness(send);
    await enrollChallenge(deps, "pat@example.com");
    const enrolled = await store.findByEmail("pat@example.com");
    const result = await unsubscribeChallenge(deps, enrolled!.unsubscribeToken!);
    expect(result).toBe("suppressed");
    await processDueChallengeLessons(deps);
    expect(callsOf(send)).toHaveLength(1);
    const row = await store.findByEmail("pat@example.com");
    expect(row?.challengeDay).toBe(2);
    expect(row?.suppressedAt).toBeTruthy();
    expect(row?.nextSendAt).toBeNull();
  });

  it("11. unsubscribe during an in-flight send does not schedule the next lesson", async () => {
    const started = newChallengeEnrollment({
      email: "pat@example.com",
      now: NOW,
      id: "person-inflight",
      token: "token_inflight_unsubscribe_ok",
    });
    started.challengeDay = 2;
    started.nextSendAt = DUE;
    started.lastAcceptedDay = 1;
    const { store, deps } = harness(send, [started]);
    send.mockImplementation(async () => {
      await store.suppressByToken(started.unsubscribeToken!, NOW);
      return accepted("msg_inflight");
    });
    await processDueChallengeLessons(deps);
    expect(send).toHaveBeenCalledTimes(1);
    const row = await store.findByEmail("pat@example.com");
    expect(row?.lastAcceptedDay).toBe(2);
    expect(row?.challengeDay).toBe(3);
    expect(row?.suppressedAt).toBeTruthy();
    expect(row?.nextSendAt).toBeNull();
    await processDueChallengeLessons(deps);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stops before the provider call when suppression wins the claim", async () => {
    const started = newChallengeEnrollment({
      email: "pat@example.com",
      now: NOW,
      id: "person-before-send",
      token: "token_before_send_unsub_ok",
    });
    started.challengeDay = 2;
    started.nextSendAt = DUE;
    const { store, deps } = harness(send, [started]);
    const original = store.claim.bind(store);
    store.claim = async (previous, args) => {
      const claimed = await original(previous, args);
      if (claimed?.unsubscribeToken) {
        await store.suppressByToken(claimed.unsubscribeToken, NOW);
      }
      return claimed;
    };
    await processDueChallengeLessons(deps);
    expect(send).not.toHaveBeenCalled();
    const row = await store.findByEmail("pat@example.com");
    expect(row?.suppressedAt).toBeTruthy();
    expect(row?.challengeDay).toBe(2);
    expect(row?.lastAcceptedDay).toBeNull();
  });

  it("12. repeated unsubscribe stays suppressed", async () => {
    const { store, deps } = harness(send);
    await enrollChallenge(deps, "pat@example.com");
    const token = (await store.findByEmail("pat@example.com"))!.unsubscribeToken!;
    expect(await unsubscribeChallenge(deps, token)).toBe("suppressed");
    expect(await unsubscribeChallenge(deps, token)).toBe("already");
    const row = await store.findByEmail("pat@example.com");
    expect(row?.suppressedAt).toBeTruthy();
    await processDueChallengeLessons(deps);
    expect(callsOf(send)).toHaveLength(1);
  });

  it("13 and 17. suppressed, active, and completed signups share one public response", async () => {
    const { store, deps } = harness(send);
    await enrollChallenge(deps, "active@example.com");
    await enrollChallenge(deps, "done@example.com");
    await enrollChallenge(deps, "stopped@example.com");
    const done = await store.findByEmail("done@example.com");
    await store.commitBookkeeping(done!, { ...done!, completed: true, challengeDay: 8 });
    const stopped = await store.findByEmail("stopped@example.com");
    await unsubscribeChallenge(deps, stopped!.unsubscribeToken!);

    const active = await enrollChallenge(deps, "active@example.com");
    const completed = await enrollChallenge(deps, "done@example.com");
    const suppressed = await enrollChallenge(deps, "stopped@example.com");
    expect(active).toEqual(completed);
    expect(completed).toEqual(suppressed);
    expect(suppressed.message).toBe(CHALLENGE_PUBLIC_ALREADY);
    const serialized = JSON.stringify(suppressed);
    expect(serialized).not.toContain("stopped@example.com");
    expect(serialized).not.toContain("suppressed");
    expect(serialized).not.toContain("challengeDay");
    expect(Object.keys(suppressed).sort()).toEqual(["message", "ok", "status"]);
    expect(callsOf(send)).toHaveLength(3);
    const stoppedRow = await store.findByEmail("stopped@example.com");
    expect(stoppedRow?.suppressedAt).toBeTruthy();
    expect(stoppedRow?.challengeDay).toBe(2);
  });

  it("14. explicit re-enrollment resumes the remaining lesson and does not repeat day 1", async () => {
    const { store, deps, setSlot } = harness(send);
    await enrollChallenge(deps, "pat@example.com");
    const enrolled = await store.findByEmail("pat@example.com");
    await unsubscribeChallenge(deps, enrolled!.unsubscribeToken!);
    setSlot(LATER);
    const resumed = await reenrollChallenge(deps, enrolled!.unsubscribeToken!);
    expect(resumed.ok).toBe(true);
    expect(resumed.message).toMatch(/Remaining lessons will resume/);
    const row = await store.findByEmail("pat@example.com");
    expect(row?.suppressedAt).toBeNull();
    expect(row?.challengeDay).toBe(2);
    expect(row?.lastAcceptedDay).toBe(1);
    expect(callsOf(send)).toHaveLength(1);
    setSlot(DUE);
    const stored = await store.findByEmail("pat@example.com");
    await store.commitBookkeeping(stored!, { ...stored!, nextSendAt: DUE });
    await processDueChallengeLessons(deps);
    expect(callsOf(send).map((call) => call.day)).toEqual([1, 2]);
  });

  it("15. a completed participant cannot restart from signup or re-enrollment", async () => {
    const { store, deps } = harness(send);
    await enrollChallenge(deps, "pat@example.com");
    for (let n = 0; n < 6; n += 1) await processDueChallengeLessons(deps);
    const done = await store.findByEmail("pat@example.com");
    expect(done?.completed).toBe(true);
    const again = await enrollChallenge(deps, "pat@example.com");
    expect(again.message).toBe(CHALLENGE_PUBLIC_ALREADY);
    const reenroll = await reenrollChallenge(deps, done!.unsubscribeToken!);
    expect(reenroll.message).toMatch(/already complete/);
    const row = await store.findByEmail("pat@example.com");
    expect(row?.completed).toBe(true);
    expect(row?.challengeDay).toBe(8);
    expect(callsOf(send)).toHaveLength(7);
  });

  it("16. unknown provider outcome retries the same idempotency key and then stops", async () => {
    send.mockResolvedValue({
      outcome: "unknown",
      providerMessageId: null,
      errorName: "exception",
      statusCode: null,
      errorMessage: "timeout",
    });
    const { store, deps, setNow } = harness(send);
    await enrollChallenge(deps, "pat@example.com");
    const first = await store.findByEmail("pat@example.com");
    const key = first?.attemptIdempotencyKey;
    expect(first?.challengeDay).toBe(1);
    expect(key).toBeTruthy();
    setNow(new Date(Date.parse(first!.nextRetryAt!) + 1000));
    await processDueChallengeLessons(deps);
    const second = await store.findByEmail("pat@example.com");
    expect(second?.attemptIdempotencyKey).toBe(key);
    expect(second?.challengeDay).toBe(1);
    expect(callsOf(send).map((call) => call.idempotencyKey)).toEqual([key, key]);
    setNow(new Date(Date.parse(first!.attemptKeyCreatedAt!) + 23 * 60 * 60 * 1000));
    await processDueChallengeLessons(deps);
    expect(send).toHaveBeenCalledTimes(2);
    const held = await store.findByEmail("pat@example.com");
    expect(held?.sendAttention).toBe("unknown_expired");
    expect(held?.challengeDay).toBe(1);
    expect(held?.lastProviderMessageId).toBeNull();
  });

  it("does not auto-send a historical day 1 and does not replay earlier legacy days", async () => {
    const legacyDay1 = newChallengeEnrollment({
      email: "old-day1@example.com",
      now: NOW,
      id: "legacy-day1",
      token: "token_legacy_day1_historical",
    });
    legacyDay1.reliableSendTracking = false;
    legacyDay1.sendTrackingCutoverAt = null;
    legacyDay1.sendState = "legacy";
    const legacyDay4 = newChallengeEnrollment({
      email: "old-day4@example.com",
      now: NOW,
      id: "legacy-day4",
      token: "token_legacy_day4_historical",
    });
    legacyDay4.reliableSendTracking = false;
    legacyDay4.sendTrackingCutoverAt = null;
    legacyDay4.sendState = "legacy";
    legacyDay4.challengeDay = 4;
    legacyDay4.nextSendAt = DUE;
    const { store, deps } = harness(send, [legacyDay1, legacyDay4]);
    const result = await processDueChallengeLessons(deps);
    expect(result.legacyDay1Held).toBe(1);
    expect(callsOf(send).map((call) => call.day)).toEqual([4]);
    const day1 = await store.findByEmail("old-day1@example.com");
    const day4 = await store.findByEmail("old-day4@example.com");
    expect(day1?.challengeDay).toBe(1);
    expect(day1?.lastAcceptedDay).toBeNull();
    expect(day4?.challengeDay).toBe(5);
    expect(day4?.lastAcceptedDay).toBe(4);
  });

  it("stops retrying a known failure after the attempt cap", async () => {
    send.mockResolvedValue(providerError());
    const { store, deps, setNow } = harness(send);
    await enrollChallenge(deps, "pat@example.com");
    for (let n = 0; n < 6; n += 1) {
      const row = await store.findByEmail("pat@example.com");
      setNow(new Date(Date.parse(row?.nextRetryAt ?? NOW.toISOString()) + 1000));
      await processDueChallengeLessons(deps);
    }
    expect(send.mock.calls.length).toBeLessThanOrEqual(5);
    const row = await store.findByEmail("pat@example.com");
    expect(row?.challengeDay).toBe(1);
    expect(row?.sendAttention).toBe("retry_exhausted");
    const callsBefore = send.mock.calls.length;
    setNow(new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000));
    await processDueChallengeLessons(deps);
    expect(send).toHaveBeenCalledTimes(callsBefore);
  });

  it("keeps an unsubscribe that lands between the send-result read and the update", async () => {
    const send = vi.fn(async () => accepted("msg_race"));
    const { store, deps, setNow } = harness(send);
    const original = store.commitSendResult.bind(store);
    store.commitSendResult = async (claimed, next) => {
      expect(next.suppressedAt).toBeNull();
      expect(next.nextSendAt).toBeTruthy();
      const token = (await store.findByEmail("pat@example.com"))?.unsubscribeToken ?? "";
      await store.suppressByToken(token, NOW);
      return original(claimed, next);
    };

    await enrollChallenge(deps, "pat@example.com");
    const saved = await store.findByEmail("pat@example.com");

    expect(saved?.suppressedAt).toBe(NOW.toISOString());
    expect(saved?.nextSendAt).toBeNull();
    expect(saved?.nextRetryAt).toBeNull();
    expect(saved?.sendState).toBe("suppressed");
    expect(saved?.lastProviderMessageId).toBe("msg_race");
    expect(saved?.lastAcceptedDay).toBe(1);
    expect(saved?.challengeDay).toBe(2);
    expect(send).toHaveBeenCalledTimes(1);

    setNow(new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000));
    await processDueChallengeLessons(deps);
    expect(send).toHaveBeenCalledTimes(1);

    const resumed = await reenrollChallenge(deps, saved?.unsubscribeToken ?? "");
    expect(resumed.ok).toBe(true);
    expect(resumed.message).toContain("Remaining lessons");
    const after = await store.findByEmail("pat@example.com");
    expect(after?.suppressedAt).toBeNull();
    expect(after?.challengeDay).toBe(2);
    expect(after?.lastAcceptedDay).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not let later bookkeeping clear suppression or the accepted message", async () => {
    const send = vi.fn(async () => accepted("msg_keep"));
    const { store, deps, setSlot } = harness(send);
    setSlot(LATER);
    await enrollChallenge(deps, "pat@example.com");
    const token = (await store.findByEmail("pat@example.com"))?.unsubscribeToken ?? "";
    await unsubscribeChallenge(deps, token);
    const row = await store.findByEmail("pat@example.com");
    expect(row?.challengeDay).toBe(2);
    expect(row?.lastProviderMessageId).toBe("msg_keep");

    const saved = await store.commitBookkeeping(row!, {
      ...row!,
      suppressedAt: null,
      nextSendAt: LATER,
      nextRetryAt: LATER,
      sendState: "pending",
      lastProviderMessageId: null,
    });

    expect(saved?.suppressedAt).toBe(row?.suppressedAt);
    expect(saved?.nextSendAt).toBeNull();
    expect(saved?.nextRetryAt).toBeNull();
    expect(saved?.sendState).toBe("suppressed");
    expect(saved?.lastProviderMessageId).toBe("msg_keep");
    expect(saved?.lastAcceptedDay).toBe(1);
  });
});

describe("challenge attention alerts", () => {
  function held(email: string, id: string, token: string, attention: ChallengeParticipant["sendAttention"], day: number) {
    const row = newChallengeEnrollment({ email, now: NOW, id, token });
    row.challengeDay = day;
    row.sendAttention = attention;
    row.sendState = attention === "unknown_expired" ? "unknown" : "permanent_failure";
    row.lastSendError = `held ${attention} user@example.com`;
    row.attentionNotifiedAt = null;
    return row;
  }

  it("alerts once for every terminal attention state and does not repeat on the next cron", async () => {
    const alerts: Array<Record<string, unknown>> = [];
    const rejected = newChallengeEnrollment({
      email: "rejected@example.com",
      now: NOW,
      id: "alert-rejected",
      token: "token_alert_rejected_0001",
    });
    const permanent = newChallengeEnrollment({
      email: "permanent@example.com",
      now: NOW,
      id: "alert-permanent",
      token: "token_alert_permanent_001",
    });
    const conflict = newChallengeEnrollment({
      email: "conflict@example.com",
      now: NOW,
      id: "alert-conflict",
      token: "token_alert_conflict_0001",
    });
    const unknown = held("unknown@example.com", "alert-unknown", "token_alert_unknown_00001", "unknown_expired", 3);
    const exhausted = held("exhausted@example.com", "alert-exhausted", "token_alert_exhausted_001", "retry_exhausted", 4);
    const inconsistent = held(
      "inconsistent@example.com",
      "alert-inconsistent",
      "token_alert_inconsistent_1",
      "sequence_inconsistent",
      5
    );

    const send = vi.fn(async (input: { to: string }): Promise<ChallengeProviderResult> => {
      if (input.to === "permanent@example.com") {
        return {
          outcome: "permanent_failure",
          providerMessageId: null,
          errorName: "missing_lesson",
          statusCode: 422,
          errorMessage: "missing lesson user@example.com",
        };
      }
      if (input.to === "conflict@example.com") {
        return {
          outcome: "permanent_failure",
          providerMessageId: null,
          errorName: "invalid_idempotent_request",
          statusCode: 409,
          errorMessage: "key mismatch user@example.com",
        };
      }
      return {
        outcome: "provider_rejected",
        providerMessageId: null,
        errorName: "validation_error",
        statusCode: 422,
        errorMessage: "rejected user@example.com",
      };
    });
    const { store, deps } = harness(send, [rejected, permanent, conflict, unknown, exhausted, inconsistent]);
    deps.notifyAttention = async (alert) => {
      alerts.push({ ...alert });
    };

    await processDueChallengeLessons(deps);
    expect(alerts.map((alert) => alert.failureType).sort()).toEqual([
      "idempotency_conflict",
      "permanent_failure",
      "provider_rejected",
      "retry_exhausted",
      "sequence_inconsistent",
      "unknown_expired",
    ]);
    for (const alert of alerts) {
      expect(alert.retrySafe).toBe(false);
      expect(String(alert.retryReason)).toContain("No.");
      expect(String(alert.error)).toContain("[email]");
      expect(JSON.stringify(alert)).not.toContain("@");
      expect(alert).not.toHaveProperty("email");
    }
    const heldRow = await store.findByEmail("rejected@example.com");
    expect(heldRow?.sendAttention).toBe("provider_rejected");
    expect(heldRow?.attentionNotifiedAt).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(3);

    await processDueChallengeLessons(deps);
    expect(alerts).toHaveLength(6);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("retries a failed alert on the next cron without clearing suppression", async () => {
    const alerts: Array<Record<string, unknown>> = [];
    let attempts = 0;
    const send = vi.fn(
      async (): Promise<ChallengeProviderResult> => ({
        outcome: "provider_rejected",
        providerMessageId: null,
        errorName: "validation_error",
        statusCode: 422,
        errorMessage: "rejected user@example.com",
      })
    );
    const row = newChallengeEnrollment({
      email: "pat@example.com",
      now: NOW,
      id: "notify-fail",
      token: "token_notify_fail_0000001",
    });
    const { store, deps } = harness(send, [row]);
    deps.notifyAttention = async (alert) => {
      attempts += 1;
      if (attempts === 1) throw new Error("notify down user@example.com");
      alerts.push({ ...alert });
    };
    const original = store.commitSendResult.bind(store);
    store.commitSendResult = async (claimed, next) => {
      await store.suppressByToken(row.unsubscribeToken ?? "", NOW);
      return original(claimed, next);
    };

    const first = await processDueChallengeLessons(deps);
    const afterFailure = await store.findByEmail("pat@example.com");
    expect(first.success).toBe(true);
    expect(afterFailure?.suppressedAt).toBe(NOW.toISOString());
    expect(afterFailure?.nextSendAt).toBeNull();
    expect(afterFailure?.sendAttention).toBe("provider_rejected");
    expect(afterFailure?.sendState).toBe("suppressed");
    expect(afterFailure?.attentionNotifiedAt).toBeNull();
    expect(alerts).toHaveLength(0);

    const second = await processDueChallengeLessons(deps);
    const afterRetry = await store.findByEmail("pat@example.com");
    expect(second.success).toBe(true);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      participantId: "notify-fail",
      challengeDay: 1,
      failureType: "provider_rejected",
      retrySafe: false,
    });
    expect(JSON.stringify(alerts[0])).not.toContain("@");
    expect(afterRetry?.suppressedAt).toBe(NOW.toISOString());
    expect(afterRetry?.attentionNotifiedAt).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);

    await processDueChallengeLessons(deps);
    expect(alerts).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("challenge email content", () => {
  it("keeps lesson order and adds unsubscribe without calling Resend for a missing day", async () => {
    const seen: Array<{ payload: Record<string, unknown>; options?: { idempotencyKey?: string } }> = [];
    const resend = {
      emails: {
        send: async (
          payload: Record<string, unknown>,
          options?: { idempotencyKey?: string }
        ) => {
          seen.push({ payload, options });
          return { data: { id: "re_lesson" }, error: null };
        },
      },
    };
    const result = await sendChallengeEmail({
      to: "pat@example.com",
      day: 3,
      idempotencyKey: "ch_test_d3_once",
      unsubscribeToken: "unsubscribe_token_value_123456",
      resend,
    });
    expect(result).toMatchObject({ outcome: "accepted", providerMessageId: "re_lesson" });
    expect(seen[0].options?.idempotencyKey).toBe("ch_test_d3_once");
    expect(String(seen[0].payload.subject)).toContain("Day 3");
    expect(String(seen[0].payload.subject)).toContain(challengeLessons[2].title);
    expect(String(seen[0].payload.text)).toContain(challengeLessons[2].challenge);
    expect(String(seen[0].payload.text)).toContain("/challenge/unsubscribe?token=");
    expect(String(seen[0].payload.text)).toContain("/privacy");
    expect(String(seen[0].payload.text).toLowerCase()).not.toContain("delivered");
    const headers = seen[0].payload.headers as Record<string, string>;
    expect(headers["List-Unsubscribe"]).toContain("/api/challenge/unsubscribe?token=");
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const missing = await sendChallengeEmail({
      to: "pat@example.com",
      day: 8,
      idempotencyKey: "nope",
      unsubscribeToken: "unsubscribe_token_value_123456",
      resend,
    });
    expect(missing.outcome).toBe("permanent_failure");
    expect(seen).toHaveLength(1);
  });
});

describe("challenge migration", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20261010010000_challenge_send_reliability.sql"),
    "utf8"
  );

  it("adds tracking columns without rewriting historical rows", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS reliable_send_tracking boolean NOT NULL DEFAULT false");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS suppressed_at");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS attempt_idempotency_key");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS last_provider_message_id");
    expect(sql).not.toMatch(/UPDATE\s+public\.challenge_participants/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.challenge_participants/i);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.find_challenge_participants_by_email(text) FROM anon");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.find_challenge_participants_by_email(text) TO service_role");
  });
});

describe("challenge suppression write", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20261010020000_challenge_suppression_wins.sql"),
    "utf8"
  );
  const notifier = readFileSync(
    path.join(process.cwd(), "src/lib/notify-challenge-delivery-attention.ts"),
    "utf8"
  );

  it("keeps suppression inside the send-result write and alerts without a participant email", () => {
    expect(sql).toContain(
      "suppressed_at = COALESCE(c.suppressed_at, (p_patch->>'suppressed_at')::timestamptz)"
    );
    expect(sql).toContain("WHEN c.suppressed_at IS NOT NULL");
    expect(sql).toContain("WHERE c.id::text = p_id");
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.apply_challenge_send_bookkeeping(text, integer, integer, text, jsonb) TO service_role"
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.apply_challenge_send_bookkeeping(text, integer, integer, text, jsonb) FROM anon"
    );
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.challenge_participants/i);
    expect(sql).not.toContain("attention_notified_at");
    expect(sql).toContain("Do not clear suppressed_at");
    const notice = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20261010030000_challenge_attention_notified.sql"),
      "utf8"
    );
    expect(notice).toContain("ADD COLUMN IF NOT EXISTS attention_notified_at timestamptz");
    expect(notice).not.toMatch(/UPDATE\s+public\.challenge_participants/i);
    expect(notice).not.toMatch(/DELETE\s+FROM\s+public\.challenge_participants/i);
    expect(notifier).toContain("COACH_KIT_NOTIFY_EMAIL");
    expect(notifier).not.toContain("alert.email");
    expect(notifier).not.toContain("participant.email");
    expect(notifier).toContain("[challenge] attention_notification_failed");
  });
});

describe("challenge public copy", () => {
  it("tells the signup page what the seven emails are and does not claim delivery", () => {
    const page = readFileSync(
      path.join(process.cwd(), "src/app/pat-summitt-leadership-challenge/page.tsx"),
      "utf8"
    );
    expect(page).toContain("seven challenge lessons");
    expect(page).toContain('href="/privacy"');
    expect(page).toContain("not an ongoing newsletter");
    expect(page.toLowerCase()).not.toContain("was delivered");
    expect(page).not.toContain("Check your email for Day 1");
  });
});
