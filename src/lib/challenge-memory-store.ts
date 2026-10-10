import {
  keepLiveSuppression,
  planClaim,
  planReenroll,
  planSuppress,
  type ClaimArgs,
} from "@/lib/challenge-send-outcome";
import type { ChallengeStore } from "@/lib/challenge-store";
import type { ChallengeParticipant } from "@/lib/challenge-types";

function copy(row: ChallengeParticipant): ChallengeParticipant {
  return { ...row };
}

function prefer(rows: ChallengeParticipant[]): ChallengeParticipant | null {
  if (rows.length === 0) return null;
  return rows.find((row) => !row.completed) ?? rows[0];
}

/**
 * In-memory compare-and-swap store. Claim and commit mutate synchronously
 * before returning, so overlapping cron runs cannot both send one lesson.
 */
export function createMemoryChallengeStore(
  seed: ChallengeParticipant[] = []
): ChallengeStore & { all(): ChallengeParticipant[] } {
  const rows = seed.map(copy);

  function indexOf(id: string): number {
    return rows.findIndex((row) => row.id === id);
  }

  function live(id: string): ChallengeParticipant | null {
    const index = indexOf(id);
    return index < 0 ? null : rows[index];
  }

  return {
    all() {
      return rows.map(copy);
    },
    async findByEmail(normalizedEmail) {
      const matches = rows.filter(
        (row) => row.email.trim().toLowerCase() === normalizedEmail.trim().toLowerCase()
      );
      const found = prefer(matches);
      return found ? copy(found) : null;
    },
    async findByToken(token) {
      const found = rows.find((row) => row.unsubscribeToken === token);
      return found ? copy(found) : null;
    },
    async getById(id) {
      const row = live(id);
      return row ? copy(row) : null;
    },
    async insert(row) {
      if (
        rows.some(
          (existing) => existing.email.trim().toLowerCase() === row.email.trim().toLowerCase()
        )
      ) {
        return "duplicate";
      }
      rows.push(copy(row));
      return "inserted";
    },
    async listCandidates() {
      return rows
        .filter((row) => !row.completed && row.challengeDay >= 1 && row.challengeDay <= 7)
        .map(copy);
    },
    async countLegacyDay1Held() {
      return rows.filter(
        (row) =>
          !row.completed &&
          !row.suppressedAt &&
          row.challengeDay === 1 &&
          row.reliableSendTracking !== true
      ).length;
    },
    async countNeedsAttention() {
      return rows.filter((row) => !row.completed && row.sendAttention != null).length;
    },
    async claim(previous, args: ClaimArgs) {
      const index = indexOf(previous.id);
      if (index < 0) return null;
      const current = rows[index];
      if (current.challengeDay !== previous.challengeDay) return null;
      if (current.attemptCount !== previous.attemptCount) return null;
      if (current.sendClaimToken !== previous.sendClaimToken) return null;
      if (current.suppressedAt || current.completed || current.sendAttention) return null;
      const next = planClaim(current, args);
      if (!next) return null;
      rows[index] = next;
      return copy(next);
    },
    async commitSendResult(claimed, next) {
      const index = indexOf(claimed.id);
      if (index < 0) return null;
      const current = rows[index];
      if (current.challengeDay !== claimed.challengeDay) return null;
      if (current.attemptCount !== claimed.attemptCount) return null;
      if (current.sendClaimToken !== claimed.sendClaimToken) return null;
      const merged = keepLiveSuppression(current, next);
      rows[index] = merged;
      return copy(merged);
    },
    async commitBookkeeping(previous, next) {
      const index = indexOf(previous.id);
      if (index < 0) return null;
      const current = rows[index];
      if (current.challengeDay !== previous.challengeDay) return null;
      if (current.attemptCount !== previous.attemptCount) return null;
      if (current.sendClaimToken !== previous.sendClaimToken) return null;
      const merged = keepLiveSuppression(current, next);
      rows[index] = merged;
      return copy(merged);
    },
    async suppressByToken(token, now) {
      const index = rows.findIndex((row) => row.unsubscribeToken === token);
      if (index < 0) return "missing";
      if (rows[index].suppressedAt) return "already";
      rows[index] = planSuppress(rows[index], now);
      return "suppressed";
    },
    async reenrollByToken(token, now, nextSendAt) {
      const index = rows.findIndex((row) => row.unsubscribeToken === token);
      if (index < 0) return "missing";
      const plan = planReenroll(rows[index], now, nextSendAt);
      if (plan.kind === "resume_day1" || plan.kind === "resume_later") {
        rows[index] = plan.row;
      }
      return { ...plan, row: copy(plan.kind === "resume_day1" || plan.kind === "resume_later" ? rows[index] : plan.row) };
    },
    async markAttentionNotified(id, attention) {
      const index = indexOf(id);
      if (index < 0) return false;
      const current = rows[index];
      if (current.sendAttention !== attention || current.attentionNotifiedAt) return false;
      rows[index] = {
        ...current,
        attentionNotifiedAt: new Date().toISOString(),
      };
      return true;
    },
  };
}
