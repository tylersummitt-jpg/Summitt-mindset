/**
 * Final SMS sentence-integrity guard — server seatbelt before Twilio.
 * Detects malformed trailing fragments; repairs by dropping bad tail sentence.
 */

export type FinalSmsSentenceIntegrityResult = {
  ok: boolean;
  reason?: string;
  repairedBody?: string;
  repairApplied?: boolean;
  fallbackUsed?: boolean;
};

const DANGLING_CONNECTORS = new Set([
  "the",
  "and",
  "or",
  "to",
  "for",
  "with",
  "because",
  "but",
  "so",
  "if",
  "when",
  "while",
  "about",
  "toward",
  "towards",
]);

const TERMINAL_FRAGMENTS = new Set(["good", "great", "more", "next", "strong", "better"]);

const KNOWN_MALFORMED_TAIL_RES: readonly RegExp[] = [
  /\bkeep up the good\s*$/i,
  /\bkeep up the\s*$/i,
];

function lastWord(body: string): string {
  const parts = body.trim().split(/\s+/);
  const raw = parts[parts.length - 1] ?? "";
  return raw.replace(/[^\w]/g, "").toLowerCase();
}

function hasTerminalPunctuation(body: string): boolean {
  return /[.!?]\s*$/.test(body.trim());
}

function looksLikeSentence(body: string): boolean {
  const t = body.trim();
  return t.length >= 12 && /\s/.test(t);
}

function detectMalformedReason(body: string): string | null {
  const t = body.trim();
  if (!t) return "empty_body";

  for (const re of KNOWN_MALFORMED_TAIL_RES) {
    if (re.test(t)) return "known_malformed_tail";
  }

  const lw = lastWord(t);
  if (DANGLING_CONNECTORS.has(lw)) return "dangling_connector";
  if (TERMINAL_FRAGMENTS.has(lw) && !hasTerminalPunctuation(t)) {
    return "terminal_fragment";
  }

  if (looksLikeSentence(t) && !hasTerminalPunctuation(t)) {
    return "missing_terminal_punctuation";
  }

  return null;
}

/** Drop trailing fragment after the last sentence-ending punctuation. */
export function dropMalformedTrailingSentence(body: string): string | null {
  const t = body.trim();
  if (!t) return null;

  const match = t.match(/^([\s\S]*[.!?])\s+\S(?:[\s\S]*)$/);
  if (match?.[1]) {
    const candidate = match[1].trim();
    if (candidate.length > 0) return candidate;
  }

  return null;
}

/** First complete sentence — safe acknowledgement fallback candidate. */
export function extractFirstCompleteSentence(body: string): string | null {
  const t = body.trim();
  const m = t.match(/^[^.!?]+[.!?]/);
  return m?.[0]?.trim() ?? null;
}

export type ValidateFinalSmsSentenceIntegrityOptions = {
  /** Optional truth-safe fallback when repair fails (e.g. inbound completion ack). */
  fallbackBody?: string | null;
};

export function validateFinalSmsSentenceIntegrity(
  body: string,
  options?: ValidateFinalSmsSentenceIntegrityOptions
): FinalSmsSentenceIntegrityResult {
  const trimmed = (body ?? "").trim();
  if (!trimmed) {
    return { ok: false, reason: "empty_body" };
  }

  const initialReason = detectMalformedReason(trimmed);
  if (!initialReason) {
    return { ok: true };
  }

  const repaired = dropMalformedTrailingSentence(trimmed);
  if (repaired && !detectMalformedReason(repaired)) {
    return {
      ok: true,
      reason: initialReason,
      repairedBody: repaired,
      repairApplied: true,
    };
  }

  const explicitFallback = options?.fallbackBody?.trim();
  if (explicitFallback && !detectMalformedReason(explicitFallback)) {
    return {
      ok: true,
      reason: initialReason,
      repairedBody: explicitFallback,
      repairApplied: true,
      fallbackUsed: true,
    };
  }

  const firstSentence = extractFirstCompleteSentence(trimmed);
  if (firstSentence && !detectMalformedReason(firstSentence)) {
    return {
      ok: true,
      reason: initialReason,
      repairedBody: firstSentence,
      repairApplied: true,
      fallbackUsed: true,
    };
  }

  return { ok: false, reason: initialReason };
}

export function compactFinalSentenceIntegrityTelemetry(
  result: FinalSmsSentenceIntegrityResult,
  preBodyPreview?: string
): Record<string, unknown> {
  return {
    final_sentence_integrity_checked: true,
    final_sentence_integrity_ok: result.ok,
    final_sentence_integrity_reason: result.reason ?? null,
    final_sentence_integrity_repair_applied: result.repairApplied === true,
    final_sentence_integrity_fallback_used: result.fallbackUsed === true,
    ...(preBodyPreview ? { final_sentence_integrity_pre_body_preview: preBodyPreview.slice(0, 120) } : {}),
    ...(result.repairedBody
      ? { final_sentence_integrity_post_body_preview: result.repairedBody.slice(0, 120) }
      : {}),
  };
}
