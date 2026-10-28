import { acceptedSendSignalIds, type RetentionHit } from "@/lib/retention-intelligence";
import {
  attributeMorningEveningReplies,
  normalizeInboundForReplyReport,
  normalizeMorningEveningOutbound,
  normalizeWeeklyBoundary,
  resolveSendEventSentAtMs,
} from "@/lib/tyler-text-overview-reply-report";
import { SMS_DAILY_PRODUCTION_SEND_SLOT } from "@/lib/tyler-text-overview-types";

export const SMS_COACHING_GAP =
  "Coaching texts could not be fully read. They are not shown as zero.";
export const SMS_COACHING_REPLY_GAP =
  "Replies to morning or evening coaching texts could not be fully read. They are not shown as zero.";
export const SMS_INBOUND_GAP =
  "Inbound SMS could not be fully read. It is not shown as zero.";

export const COACHING_REPLY_SIGNAL = "coaching_reply";
export const COACHING_REPLY_LABEL = "Reply to a morning or evening coaching text";
export const ANY_INBOUND_LABEL =
  "Any inbound SMS, including messages that are not a reply to a coaching text";

const COACHING_LABEL = "Coaching text accepted by the provider";
const MORNING_LABEL = "Morning coaching text accepted by the provider";

/**
 * A null table means that read failed or stopped early.
 * An empty array means the read finished and found no rows.
 */
export function smsBehaviorFromRows(args: {
  sends: Array<Record<string, unknown>> | null;
  inbound: Array<Record<string, unknown>> | null;
  weekly: Array<Record<string, unknown>> | null;
}): {
  hits: RetentionHit[];
  signals: Array<{ id: string; label: string }>;
  gaps: string[];
} {
  const hits: RetentionHit[] = [];
  const signals: Array<{ id: string; label: string }> = [];
  const gaps: string[] = [];
  const acceptedSends = args.sends?.filter(isAcceptedSend) ?? [];

  if (args.sends == null) {
    gaps.push(SMS_COACHING_GAP);
  } else {
    signals.push(
      { id: "coaching", label: COACHING_LABEL },
      { id: "morning", label: MORNING_LABEL }
    );
    for (const row of acceptedSends) {
      const clerkUserId = text(row.clerk_user_id);
      const atMs = resolveSendEventSentAtMs(row);
      if (!clerkUserId || atMs == null) continue;
      for (const signal of acceptedSendSignalIds(text(row.send_slot))) {
        hits.push({ clerkUserId, atMs, signal });
      }
    }
  }

  if (args.inbound == null) {
    gaps.push(SMS_INBOUND_GAP);
  } else {
    signals.push({ id: "reply", label: ANY_INBOUND_LABEL });
    for (const row of args.inbound) {
      const clerkUserId = text(row.clerk_user_id);
      const atMs = isoMs(row.received_at);
      if (!clerkUserId || atMs == null) continue;
      hits.push({ clerkUserId, atMs, signal: "reply" });
    }
  }

  if (args.sends == null || args.inbound == null || args.weekly == null) {
    gaps.push(SMS_COACHING_REPLY_GAP);
  } else {
    signals.push({ id: COACHING_REPLY_SIGNAL, label: COACHING_REPLY_LABEL });
    const outbounds = acceptedSends
      .map((row) => normalizeMorningEveningOutbound(row))
      .filter((row) => row != null);
    const boundaries = [
      ...outbounds.map((outbound) => ({
        clerkUserId: outbound.clerkUserId,
        sentAtMs: outbound.sentAtMs,
        kind:
          outbound.slot === SMS_DAILY_PRODUCTION_SEND_SLOT
            ? ("morning" as const)
            : ("evening" as const),
      })),
      ...args.weekly.map((row) => normalizeWeeklyBoundary(row)).filter((row) => row != null),
    ];
    const inbounds = args.inbound
      .map((row) => normalizeInboundForReplyReport(row))
      .filter((row) => row != null);
    const seen = new Set<string>();
    for (const row of attributeMorningEveningReplies({ outbounds, boundaries, inbounds })) {
      if (!row.replied || row.replyAtIso == null) continue;
      const atMs = Date.parse(row.replyAtIso);
      if (!Number.isFinite(atMs)) continue;
      const key = `${row.clerkUserId}:${atMs}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ clerkUserId: row.clerkUserId, atMs, signal: COACHING_REPLY_SIGNAL });
    }
  }

  return { hits, signals, gaps };
}

function isAcceptedSend(row: Record<string, unknown>): boolean {
  const status = text(row.status);
  return text(row.message_sid) != null && status !== "failed" && status !== "undelivered";
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isoMs(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}
