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

export function isTwilioReady() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_PHONE_NUMBER)
  );
}