/**
 * Unified SMS Meaning Interpreter Shadow Mode.
 * Defaults off — observe/log/compare only; never mutates product state.
 */

export function isSmsMeaningInterpreterShadowEnabled(): boolean {
  return process.env.SMS_MEANING_INTERPRETER_SHADOW_ENABLED === "true";
}

export function getSmsMeaningInterpreterSampleRate(): number {
  const raw = process.env.SMS_MEANING_INTERPRETER_SAMPLE_RATE?.trim();
  if (!raw) return 0.1;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return 0.1;
  return Math.min(1, Math.max(0, n));
}

export function isSmsMeaningInterpreterAmbiguousOnly(): boolean {
  return process.env.SMS_MEANING_INTERPRETER_AMBIGUOUS_ONLY === "true";
}

export function getSmsMeaningInterpreterModel(): string {
  const m = process.env.SMS_MEANING_INTERPRETER_MODEL?.trim();
  return m && m.length > 0 ? m : "gpt-4o-mini";
}

export function getSmsMeaningInterpreterPromptVersion(): string {
  const v = process.env.SMS_MEANING_INTERPRETER_PROMPT_VERSION?.trim();
  return v && v.length > 0 ? v : "v1";
}

export function shouldLogMeaningInterpreterBodyPreview(): boolean {
  return process.env.SMS_MEANING_INTERPRETER_LOG_BODY_PREVIEW === "true";
}

/** Log skipped/excluded shadow rows without OpenAI (coverage telemetry). Default off. */
export function shouldLogMeaningInterpreterSkipped(): boolean {
  return process.env.SMS_MEANING_INTERPRETER_LOG_SKIPPED === "true";
}

/** Deterministic sample from inbound message SID (stable across retries). */
export function shouldSampleMeaningInterpreter(inboundMessageSid: string, sampleRate: number): boolean {
  if (sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;
  let h = 0;
  for (let i = 0; i < inboundMessageSid.length; i++) {
    h = (Math.imul(31, h) + inboundMessageSid.charCodeAt(i)) | 0;
  }
  const bucket = (h >>> 0) / 0xffffffff;
  return bucket < sampleRate;
}
