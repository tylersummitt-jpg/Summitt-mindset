/**
 * Hard Twilio SMS Body transport ceiling (JS string `.length`).
 *
 * This is the true send/save boundary for Morning TTO and Evening TTO callers.
 * It is not a writer quality target and must not be used as a 300/320 house-style cap.
 *
 * `sendSMS` stays pass-through and never truncates. Callers must refuse before
 * reservation if the saved authoritative body exceeds this length.
 */
export const TWILIO_SMS_BODY_MAX_CHARS = 1600;

export function smsBodyExceedsTwilioTransportMax(body: string): boolean {
  return body.length > TWILIO_SMS_BODY_MAX_CHARS;
}
