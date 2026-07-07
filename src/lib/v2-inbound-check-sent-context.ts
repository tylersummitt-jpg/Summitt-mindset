import { parseCheckSentSendSlot } from "@/lib/v2-check-sent-slot";
import type { SmsDailySendSlot } from "@/lib/tyler-text-overview-types";
import type { V2EventRowForAi } from "@/lib/v2-commitment";

function parseEventMs(iso: string): number {
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export type ResolvedLatestCheckSent = {
  checkEvent: V2EventRowForAi | null;
  checkPayload: Record<string, unknown>;
  sendSlot: SmsDailySendSlot | null;
  bodyPreview: string | null;
  occurredAt: string | null;
};

/** Newest `check_sent` in the spine (events loaded newest-first). */
export function findLatestCheckSentEvent(
  eventsNewestFirst: V2EventRowForAi[]
): ResolvedLatestCheckSent {
  for (const e of eventsNewestFirst) {
    if (e.event_type !== "check_sent") continue;
    const checkPayload = asRecord(e.payload_json);
    const sendSlot = parseCheckSentSendSlot(checkPayload);
    const bodyPreview =
      typeof checkPayload.body_preview === "string" && checkPayload.body_preview.trim().length > 0
        ? checkPayload.body_preview.trim().slice(0, 260)
        : null;
    return {
      checkEvent: e,
      checkPayload,
      sendSlot,
      bodyPreview,
      occurredAt: e.occurred_at,
    };
  }
  return {
    checkEvent: null,
    checkPayload: {},
    sendSlot: null,
    bodyPreview: null,
    occurredAt: null,
  };
}

export type AccountabilityPromptLiveState = {
  latestCheckAt: string | null;
  latestCheckMs: number;
  latestOutcomeAt: string | null;
  latestOutcomeMs: number;
  hasLiveAccountabilityPrompt: boolean;
  latestOutboundSendSlot: SmsDailySendSlot | null;
  activeCheckSentSendSlot: SmsDailySendSlot | null;
};

/** Slot-aware live prompt: newest check_sent vs newest user_yes/no/partial. */
export function resolveAccountabilityPromptLiveState(
  eventsNewestFirst: V2EventRowForAi[]
): AccountabilityPromptLiveState {
  const latest = findLatestCheckSentEvent(eventsNewestFirst);

  let latestOutcomeAt: string | null = null;
  let latestOutcomeMs = 0;

  for (const e of eventsNewestFirst) {
    if (
      e.event_type === "user_yes" ||
      e.event_type === "user_no" ||
      e.event_type === "user_partial"
    ) {
      latestOutcomeAt = e.occurred_at;
      latestOutcomeMs = parseEventMs(e.occurred_at);
      break;
    }
  }

  const latestCheckAt = latest.occurredAt;
  const latestCheckMs = latestCheckAt ? parseEventMs(latestCheckAt) : 0;
  const hasLiveAccountabilityPrompt =
    Boolean(latestCheckAt && latestCheckMs > 0) &&
    (!latestOutcomeAt || latestOutcomeMs <= 0 || latestCheckMs > latestOutcomeMs);

  return {
    latestCheckAt,
    latestCheckMs,
    latestOutcomeAt,
    latestOutcomeMs,
    hasLiveAccountabilityPrompt,
    latestOutboundSendSlot: latest.sendSlot,
    activeCheckSentSendSlot: hasLiveAccountabilityPrompt ? latest.sendSlot : null,
  };
}

export type InboundCheckSentPrompt = ResolvedLatestCheckSent & {
  latestOutboundSendSlot: SmsDailySendSlot | null;
  activeCheckSentSendSlot: SmsDailySendSlot | null;
  hasLiveAccountabilityPrompt: boolean;
  lastOutboundSmsPreview: string | null;
};

/** Inbound-facing bundle for prompt body + slot fields. */
export function resolveInboundCheckSentPrompt(
  eventsNewestFirst: V2EventRowForAi[]
): InboundCheckSentPrompt {
  const latest = findLatestCheckSentEvent(eventsNewestFirst);
  const live = resolveAccountabilityPromptLiveState(eventsNewestFirst);
  return {
    ...latest,
    latestOutboundSendSlot: live.latestOutboundSendSlot,
    activeCheckSentSendSlot: live.activeCheckSentSendSlot,
    hasLiveAccountabilityPrompt: live.hasLiveAccountabilityPrompt,
    lastOutboundSmsPreview: latest.bodyPreview,
  };
}
