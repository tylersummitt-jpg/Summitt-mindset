/**
 * Evening TTO preview — morning anchor resolution for slot_coaching_context.
 * Preview-only; no send, no inbound mutation, no completion writes.
 */

import {
  extractPreviousOutboundFromThread,
  parseSlotCoachingContextFromMetadata,
  type SlotCoachingContextV1,
  type SlotCoachingThreadMessage,
} from "@/lib/slot-coaching-context-v1";
import {
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type EveningPreviewMorningAnchorSource =
  | "send_event"
  | "tto_draft_final_body_sent"
  | "tto_draft_current_body"
  | "tto_generation"
  | "recent_thread"
  | "none";

export type EveningPreviewMorningAnchor = {
  source: EveningPreviewMorningAnchorSource;
  body: string | null;
  sent: boolean;
  machineShouldSend: boolean | null;
  sentAt: string | null;
  slotCoachingContext: SlotCoachingContextV1 | null;
};

function readSendEventBody(row: {
  sms_body?: unknown;
  metadata?: unknown;
  status?: unknown;
}): { body: string | null; sent: boolean; sentAt: string | null } {
  const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
  const topBody = typeof row.sms_body === "string" ? row.sms_body.trim() : "";
  const meta =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null;
  const metaBody =
    (typeof meta?.final_sms_body === "string" ? meta.final_sms_body.trim() : "") ||
    (typeof meta?.sms_body === "string" ? meta.sms_body.trim() : "");
  const body = topBody || metaBody || null;
  const sent =
    Boolean(body) &&
    status !== "reserved" &&
    status !== "" &&
    !status.startsWith("skipped");
  const sentAt =
    (typeof meta?.sent_at === "string" ? meta.sent_at.trim() : null) ||
    (typeof meta?.twilio_sent_at === "string" ? meta.twilio_sent_at.trim() : null) ||
    null;
  return { body, sent, sentAt };
}

export function extractUserRepliesSinceMorningAnchor(args: {
  threadMessages: SlotCoachingThreadMessage[];
  morningBody: string | null | undefined;
  sentAt: string | null | undefined;
}): string[] {
  const fromBody = args.morningBody?.trim()
    ? (() => {
        const replies: string[] = [];
        const needle = args.morningBody!.trim().slice(0, 80).toLowerCase();
        let startIdx = 0;
        for (let i = args.threadMessages.length - 1; i >= 0; i -= 1) {
          const m = args.threadMessages[i]!;
          if (m.role === "coach" && m.body.trim().toLowerCase().includes(needle.slice(0, 40))) {
            startIdx = i + 1;
            break;
          }
        }
        for (let i = startIdx; i < args.threadMessages.length; i += 1) {
          const m = args.threadMessages[i]!;
          if (m.role === "user" && m.body.trim()) replies.push(m.body.trim());
        }
        return replies;
      })()
    : [];

  if (fromBody.length) return fromBody;

  if (args.sentAt?.trim()) {
    const sentMs = Date.parse(args.sentAt);
    if (Number.isFinite(sentMs)) {
      const filtered: string[] = [];
      for (const m of args.threadMessages) {
        if (m.role !== "user" || !m.body.trim()) continue;
        const atMs = Date.parse(m.at_local);
        if (Number.isFinite(atMs) && atMs >= sentMs) filtered.push(m.body.trim());
      }
      if (filtered.length) return filtered;
    }
  }

  return fromBody;
}

export async function resolveEveningPreviewMorningAnchor(args: {
  clerkUserId: string;
  draftForDayKey: string;
  supabase: SupabaseClient;
  recentExactThread?: SlotCoachingThreadMessage[];
}): Promise<EveningPreviewMorningAnchor> {
  const empty: EveningPreviewMorningAnchor = {
    source: "none",
    body: null,
    sent: false,
    machineShouldSend: null,
    sentAt: null,
    slotCoachingContext: null,
  };

  const { data: sendEvent, error: sendErr } = await args.supabase
    .from("sms_send_events")
    .select("sms_body, status, metadata, created_at")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("day_key", args.draftForDayKey)
    .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT)
    .maybeSingle();

  if (sendErr) {
    throw new Error(`evening_preview_morning_send_event_lookup_failed:${sendErr.message}`);
  }

  if (sendEvent) {
    const parsed = readSendEventBody(sendEvent);
    if (parsed.body && parsed.sent) {
      return {
        source: "send_event",
        body: parsed.body,
        sent: true,
        machineShouldSend: true,
        sentAt: parsed.sentAt ?? (typeof sendEvent.created_at === "string" ? sendEvent.created_at : null),
        slotCoachingContext: null,
      };
    }
  }

  const { data: morningDraft, error: draftErr } = await args.supabase
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select(
      "final_body_sent, current_body_to_send, status, sent_at, current_generation_id"
    )
    .eq("clerk_user_id", args.clerkUserId)
    .eq("draft_for_day_key", args.draftForDayKey)
    .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT)
    .maybeSingle();

  if (draftErr) {
    throw new Error(`evening_preview_morning_draft_lookup_failed:${draftErr.message}`);
  }

  let morningSlotContext: SlotCoachingContextV1 | null = null;
  let morningMachineShouldSend: boolean | null = null;

  if (morningDraft?.current_generation_id) {
    const { data: genRow } = await args.supabase
      .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
      .select("machine_draft_body, machine_should_send, generation_metadata")
      .eq("id", morningDraft.current_generation_id)
      .maybeSingle();

    if (genRow) {
      morningMachineShouldSend =
        typeof genRow.machine_should_send === "boolean" ? genRow.machine_should_send : null;
      const meta =
        genRow.generation_metadata &&
        typeof genRow.generation_metadata === "object" &&
        !Array.isArray(genRow.generation_metadata)
          ? (genRow.generation_metadata as Record<string, unknown>)
          : null;
      morningSlotContext = parseSlotCoachingContextFromMetadata(meta?.slot_coaching_context);
    }
  }

  if (morningDraft) {
    const draftSent = morningDraft.status === "sent";
    const finalBody =
      typeof morningDraft.final_body_sent === "string"
        ? morningDraft.final_body_sent.trim()
        : "";
    if (finalBody) {
      return {
        source: "tto_draft_final_body_sent",
        body: finalBody,
        sent: draftSent,
        machineShouldSend: morningMachineShouldSend,
        sentAt:
          typeof morningDraft.sent_at === "string" ? morningDraft.sent_at : null,
        slotCoachingContext: morningSlotContext,
      };
    }

    const currentBody =
      typeof morningDraft.current_body_to_send === "string"
        ? morningDraft.current_body_to_send.trim()
        : "";
    if (currentBody) {
      return {
        source: "tto_draft_current_body",
        body: currentBody,
        sent: draftSent,
        machineShouldSend: morningMachineShouldSend,
        sentAt:
          typeof morningDraft.sent_at === "string" ? morningDraft.sent_at : null,
        slotCoachingContext: morningSlotContext,
      };
    }
  }

  if (morningDraft?.current_generation_id) {
    const { data: genRow } = await args.supabase
      .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
      .select("machine_draft_body, machine_should_send, generation_metadata")
      .eq("id", morningDraft.current_generation_id)
      .maybeSingle();

    const machineBody =
      typeof genRow?.machine_draft_body === "string"
        ? genRow.machine_draft_body.trim()
        : "";
    if (machineBody) {
      const meta =
        genRow?.generation_metadata &&
        typeof genRow.generation_metadata === "object" &&
        !Array.isArray(genRow.generation_metadata)
          ? (genRow.generation_metadata as Record<string, unknown>)
          : null;
      return {
        source: "tto_generation",
        body: machineBody,
        sent: false,
        machineShouldSend:
          typeof genRow?.machine_should_send === "boolean"
            ? genRow.machine_should_send
            : null,
        sentAt: null,
        slotCoachingContext: parseSlotCoachingContextFromMetadata(meta?.slot_coaching_context),
      };
    }
  }

  const thread = args.recentExactThread ?? [];
  const fromThread = extractPreviousOutboundFromThread(thread);
  if (fromThread?.body?.trim()) {
    return {
      source: "recent_thread",
      body: fromThread.body.trim(),
      sent: false,
      machineShouldSend: morningMachineShouldSend,
      sentAt: null,
      slotCoachingContext: morningSlotContext,
    };
  }

  return empty;
}

export function morningAnchorToPreviousOutbound(
  anchor: EveningPreviewMorningAnchor
): { body: string; inferred_slot: typeof SMS_DAILY_PRODUCTION_SEND_SLOT } | null {
  const body = anchor.body?.trim();
  if (!body) return null;
  return { body, inferred_slot: SMS_DAILY_PRODUCTION_SEND_SLOT };
}
