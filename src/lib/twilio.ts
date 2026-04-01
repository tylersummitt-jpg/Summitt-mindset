// src/lib/twilio.ts

import Twilio from "twilio";
import { supabaseServer } from "@/lib/supabase-server";

/**
 * ======================================================
 * Twilio Send Helper (CANONICAL - MESSAGING SERVICE)
 * ======================================================
 *
 * - Prefer Messaging Service (A2P compliant)
 * - Fallback to TWILIO_PHONE_NUMBER only if needed
 */

/**
 * Conservative SMS chunk size. Favor reliability over squeezing more text.
 * GSM-7 single segment = 160; we use 280 to stay under 2 segments with buffer.
 */
export const SMS_CHUNK_MAX_LENGTH = 280;

/**
 * Splits long SMS body into chunks. Prefers breaks at:
 * 1) double newline, 2) newline, 3) sentence boundary, 4) space, 5) hard cut.
 */
export function splitIntoChunks(body: string, maxChunk = SMS_CHUNK_MAX_LENGTH): string[] {
  const chunks: string[] = [];
  let remaining = (body || "").trim();
  if (!remaining) return [];

  while (remaining.length > 0) {
    if (remaining.length <= maxChunk) {
      chunks.push(remaining);
      break;
    }

    const piece = remaining.slice(0, maxChunk);
    let breakPoint = -1;

    const lastDoubleNewline = piece.lastIndexOf("\n\n");
    if (lastDoubleNewline > 0) {
      breakPoint = lastDoubleNewline + 2;
    } else {
      const lastNewline = piece.lastIndexOf("\n");
      if (lastNewline > 0) {
        breakPoint = lastNewline + 1;
      } else {
        const lastSentence = Math.max(
          piece.lastIndexOf(". "),
          piece.lastIndexOf("! "),
          piece.lastIndexOf("? ")
        );
        if (lastSentence > 0) {
          breakPoint = lastSentence + 2;
        } else {
          const lastSpace = piece.lastIndexOf(" ");
          breakPoint = lastSpace > 0 ? lastSpace + 1 : maxChunk;
        }
      }
    }

    const chunk = remaining.slice(0, breakPoint).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(breakPoint).trim();
  }

  return chunks.filter(Boolean);
}

/**
 * XML-escapes text for safe use inside TwiML <Message> body.
 */
export function escapeXmlForTwiml(text: string): string {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Builds a TwiML <Response> with multiple <Message> nodes.
 * Each chunk becomes a separate SMS.
 */
export function buildTwimlResponse(chunks: string[]): string {
  const messages = chunks
    .filter(Boolean)
    .map((c) => `<Message>${escapeXmlForTwiml(c)}</Message>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${messages}</Response>`;
}

export type SendSMSChunkedResult = {
  chunkCount: number;
  chunkLengths: number[];
  messageSids: string[];
  firstStatus: string;
  firstSid: string;
};

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error("Twilio env missing (ACCOUNT_SID / AUTH_TOKEN)");
  }

  return Twilio(accountSid, authToken);
}

function getMessagingServiceSid() {
  return process.env.TWILIO_MESSAGING_SERVICE_SID || null;
}

function getFallbackFromNumber() {
  return process.env.TWILIO_PHONE_NUMBER || null;
}

export type LastOutboundSmsMeta = {
  clerkUserId: string;
  messageKind?:
    | "question"
    | "quote"
    | "coach"
    | "nudge"
    | "weekly"
    | "transactional";
  timeOfDay?: "morning" | "evening" | null;
  /** Full logical message when `body` is a single chunk of a longer send. */
  fullBodyForContext?: string;
  questionPosition?: number | null;
  deliverySnapshot?: Record<string, unknown> | null;
  chunkIndex?: number;
  chunkTotal?: number;
};

function inferLastOutboundMessageKind(
  body: string
): NonNullable<LastOutboundSmsMeta["messageKind"]> {
  const b = (body || "").trim();
  if (!b) return "transactional";
  if (/reply\s+with/i.test(b) && /[a-d]/i.test(b)) return "question";
  if (
    /^[A-D]\)\s/m.test(b) ||
    /\n[A-D]\)\s/.test(b)
  ) {
    return "question";
  }
  if (b.includes("\n\n") && !/reply\s+with/i.test(b) && b.length < 1200) {
    return "quote";
  }
  return "transactional";
}

async function tryUpsertLastOutboundAfterSend(args: {
  clerkUserId: string;
  fullBody: string;
  twilioMessageSid: string;
  messageKind: NonNullable<LastOutboundSmsMeta["messageKind"]>;
  timeOfDay?: "morning" | "evening" | null;
  questionPosition?: number | null;
  deliverySnapshot?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    if (args.messageKind === "coach") {
      const { data: existing } = await supabaseServer
        .from("sms_last_outbound_context")
        .select("message_kind")
        .eq("clerk_user_id", args.clerkUserId)
        .maybeSingle();

      if (existing?.message_kind === "question") {
        return;
      }
    }

    const { error } = await supabaseServer
      .from("sms_last_outbound_context")
      .upsert(
        {
          clerk_user_id: args.clerkUserId,
          sent_at: new Date().toISOString(),
          message_kind: args.messageKind,
          full_body: args.fullBody,
          question_position: args.questionPosition ?? null,
          time_of_day: args.timeOfDay ?? null,
          twilio_message_sid: args.twilioMessageSid,
          delivery_snapshot: args.deliverySnapshot ?? null,
        },
        { onConflict: "clerk_user_id" }
      );

    if (error) {
      console.error("[twilio] sms_last_outbound_context upsert failed", {
        clerk_user_id: args.clerkUserId,
        error: error.message,
      });
    }
  } catch (e) {
    console.error("[twilio] sms_last_outbound_context upsert threw", {
      clerk_user_id: args.clerkUserId,
      e,
    });
  }
}

export async function sendSMS({
  to,
  body,
  lastOutbound,
}: {
  to: string;
  body: string;
  lastOutbound?: LastOutboundSmsMeta;
}) {
  const client = getTwilioClient();

  const messagingServiceSid = getMessagingServiceSid();
  const fallbackFrom = getFallbackFromNumber();

  if (!messagingServiceSid && !fallbackFrom) {
    throw new Error(
      "Missing TWILIO_MESSAGING_SERVICE_SID and TWILIO_PHONE_NUMBER"
    );
  }

  const message = await client.messages.create(
    messagingServiceSid
      ? { messagingServiceSid, to, body }
      : { from: fallbackFrom!, to, body }
  );

  if (lastOutbound?.clerkUserId && message.sid) {
    const chunkTotal = lastOutbound.chunkTotal ?? 1;
    const chunkIndex = lastOutbound.chunkIndex ?? 0;
    if (chunkTotal <= 1 || chunkIndex === chunkTotal - 1) {
      const fullBody = lastOutbound.fullBodyForContext ?? body;
      const resolvedKind =
        lastOutbound.messageKind ?? inferLastOutboundMessageKind(fullBody);
      void tryUpsertLastOutboundAfterSend({
        clerkUserId: lastOutbound.clerkUserId,
        fullBody,
        twilioMessageSid: message.sid,
        messageKind: resolvedKind,
        timeOfDay: lastOutbound.timeOfDay,
        questionPosition: lastOutbound.questionPosition,
        deliverySnapshot: lastOutbound.deliverySnapshot,
      });
    }
  }

  return message;
}

/**
 * Canonical outbound sender. Splits long bodies into chunks and sends sequentially.
 * Returns metadata for logging.
 */
export async function sendSMSChunked({
  to,
  body,
  lastOutbound,
}: {
  to: string;
  body: string;
  lastOutbound?: Omit<LastOutboundSmsMeta, "chunkIndex" | "chunkTotal">;
}): Promise<SendSMSChunkedResult> {
  const chunks = splitIntoChunks(body);
  const chunkLengths = chunks.map((c) => c.length);
  const messageSids: string[] = [];
  let firstStatus = "unknown";

  for (let i = 0; i < chunks.length; i++) {
    const msg = await sendSMS({
      to,
      body: chunks[i],
      lastOutbound:
        lastOutbound && chunks.length > 0
          ? {
              ...lastOutbound,
              fullBodyForContext: lastOutbound.fullBodyForContext ?? body,
              chunkIndex: i,
              chunkTotal: chunks.length,
            }
          : undefined,
    });
    messageSids.push(msg.sid);
    if (messageSids.length === 1) firstStatus = msg.status ?? "unknown";
  }

  return {
    chunkCount: chunks.length,
    chunkLengths,
    messageSids,
    firstStatus,
    firstSid: messageSids[0] ?? "",
  };
}

export function isTwilioReady() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_PHONE_NUMBER)
  );
}
