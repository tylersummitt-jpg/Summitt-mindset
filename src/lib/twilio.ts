// src/lib/twilio.ts

import Twilio from "twilio";

/**
 * ======================================================
 * Twilio Send Helper (CANONICAL)
 * ======================================================
 *
 * - Centralized send
 * - Validates env
 * - Safe for cron + API usage
 */

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error("Twilio env missing (ACCOUNT_SID / AUTH_TOKEN)");
  }

  return Twilio(accountSid, authToken);
}

function getFromNumber() {
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) throw new Error("Missing TWILIO_PHONE_NUMBER");
  return from;
}

export async function sendSMS({ to, body }: { to: string; body: string }) {
  const client = getTwilioClient();
  const from = getFromNumber();

  const message = await client.messages.create({
    from,
    to,
    body,
  });

  return message;
}

export function isTwilioReady() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER
  );
}
