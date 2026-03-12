// src/lib/twilio.ts

import Twilio from "twilio";

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

export async function sendSMS({
  to,
  body,
}: {
  to: string;
  body: string;
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

  return message;
}

/**
 * Canonical outbound sender. Splits long bodies into chunks and sends sequentially.
 * Returns metadata for logging.
 */
export async function sendSMSChunked({
  to,
  body,
}: {
  to: string;
  body: string;
}): Promise<SendSMSChunkedResult> {
  const chunks = splitIntoChunks(body);
  const chunkLengths = chunks.map((c) => c.length);
  const messageSids: string[] = [];
  let firstStatus = "unknown";

  for (const chunk of chunks) {
    const msg = await sendSMS({ to, body: chunk });
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
