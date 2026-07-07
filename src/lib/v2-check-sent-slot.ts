import {
  SMS_DAILY_PRODUCTION_SEND_SLOT,
  type SmsDailySendSlot,
} from "@/lib/tyler-text-overview-types";

/** Slot-scoped check_sent idempotency (Phase 2C-1). */
export function checkSentIdempotencyKey(
  commitmentId: string,
  dayKey: string,
  sendSlot: SmsDailySendSlot = SMS_DAILY_PRODUCTION_SEND_SLOT
): string {
  return `v2_check_sent:${commitmentId}:${dayKey}:${sendSlot}`;
}

/** Pre–Phase 2C-1 day-only key; morning dedup still honors this. */
export function legacyCheckSentIdempotencyKey(commitmentId: string, dayKey: string): string {
  return `v2_check_sent:${commitmentId}:${dayKey}`;
}

export function normalizeCheckSentSendSlot(
  value: string | null | undefined
): SmsDailySendSlot {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "evening_checkin") return "evening_checkin";
  return SMS_DAILY_PRODUCTION_SEND_SLOT;
}

export function parseCheckSentSendSlotFromIdempotencyKey(
  idempotencyKey: string | null | undefined
): SmsDailySendSlot | null {
  const key = typeof idempotencyKey === "string" ? idempotencyKey.trim() : "";
  if (!key) return null;
  const suffix = key.split(":").pop()?.toLowerCase();
  if (suffix === "evening_checkin" || suffix === "morning") {
    return suffix;
  }
  return null;
}

export function parseCheckSentSendSlot(
  payload: Record<string, unknown> | null | undefined,
  idempotencyKey?: string | null
): SmsDailySendSlot {
  const raw = payload?.send_slot;
  if (raw === "morning" || raw === "evening_checkin") return raw;
  const fromKey = parseCheckSentSendSlotFromIdempotencyKey(idempotencyKey);
  if (fromKey) return fromKey;
  return SMS_DAILY_PRODUCTION_SEND_SLOT;
}
