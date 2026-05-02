import { findBannedHumanVisibleSubstring } from "@/lib/v2-human-visible-sms/banned-internal-terms";
import type {
  HumanVisibleSmsValidationResult,
  ValidateHumanVisibleSmsOptions,
} from "@/lib/v2-human-visible-sms/types";

const DEFAULT_MAX_CHARS = 320;
const MAX_NEWLINES = 1;

/** Claims that sound like the AI mutated DB without server authority (heuristic). */
const FAKE_STATE_RE =
  /\b(database|db|sql|rpc|mutation|supabase|committed\s+to\s+the\s+database|updated\s+your\s+record)\b/i;

/** Robotic double-openers like repeated “Got it.” */
function redundantAcknowledgmentCount(message: string): number {
  const m = message.match(/\bgot it\b/gi);
  return m?.length ?? 0;
}

function questionMarkCount(message: string): number {
  return (message.match(/\?/g) ?? []).length;
}

/**
 * Ugly accountability SMS menus (YES/NO/PARTIAL triads, keyword menus).
 * Allows normal coaching lines like “Reply yes or no.” or “Reply yes if that works.”
 */
export function isRoboticAccountabilityMenuLanguage(message: string): boolean {
  const s = message.trim().replace(/\s+/g, " ");
  if (!s) return false;

  // Slash triad: yes/no/partial (any casing)
  if (/\byes\s*\/\s*no\s*\/\s*partial\b/i.test(s)) return true;

  // Comma / “or” triad: yes, no, or partial
  if (/\byes\s*,\s*no\s*,\s*(?:or\s+)?partial\b/i.test(s)) return true;

  // Compact: yes/no/partial without spaces around slashes
  if (/\byes\/no\/partial\b/i.test(s)) return true;

  // “Reply with yes, no, or partial” style
  if (/\breply\s+with\s+yes/i.test(s) && /\bpartial\b/i.test(s)) return true;

  // Keyword menu: Text YES … NO … PARTIAL (case-insensitive words)
  const sl = s.toLowerCase();
  if (/\btext\s+yes\b/.test(sl) && /\bno\b/.test(sl) && /\bpartial\b/.test(sl)) return true;

  // Respond yes/no/partial (slash form)
  if (/\brespond\s+yes\s*\/\s*no\s*\/\s*partial\b/i.test(s)) return true;

  return false;
}

export function validateHumanVisibleSms(
  message: string,
  options?: Partial<ValidateHumanVisibleSmsOptions>
): HumanVisibleSmsValidationResult {
  const channel = options?.channel ?? "pending_resolution";
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;
  const allowVictoryRoom = options?.allowVictoryRoomPhrase === true;

  const trimmed = (message ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty_message" };

  if (trimmed.length > maxChars) return { ok: false, reason: "too_long" };

  const newlineCount = (trimmed.match(/\n/g) ?? []).length;
  if (newlineCount > MAX_NEWLINES) return { ok: false, reason: "too_many_newlines" };

  const lower = trimmed.toLowerCase();
  const banned = findBannedHumanVisibleSubstring(lower);
  if (banned) return { ok: false, reason: "banned_term", bannedTerm: banned };

  if (!allowVictoryRoom && lower.includes("victory room")) {
    return { ok: false, reason: "victory_room_not_allowed" };
  }

  const skipRoboticMenuTriads =
    channel === "adaptive_proposal_outbound" ||
    channel === "daily_outbound" ||
    channel === "reactivation_outbound" ||
    channel === "inbound_central_tether" ||
    channel === "inbound_arc_clarify" ||
    channel === "normal_inbound_stitched_final";

  if (!skipRoboticMenuTriads && isRoboticAccountabilityMenuLanguage(trimmed)) {
    return { ok: false, reason: "robotic_menu" };
  }

  if (
    channel === "inbound_central_tether" ||
    channel === "inbound_arc_clarify"
  ) {
    const qc = questionMarkCount(trimmed);
    if (qc < 1) return { ok: false, reason: "missing_question" };
    if (qc > 2) return { ok: false, reason: "too_many_questions" };
  }

  if (
    channel === "normal_inbound_stitched_final" ||
    channel === "inbound_central_tether" ||
    channel === "inbound_arc_clarify"
  ) {
    if (redundantAcknowledgmentCount(trimmed) >= 2) {
      return { ok: false, reason: "redundant_acknowledgment" };
    }
  }

  if (FAKE_STATE_RE.test(trimmed)) {
    return { ok: false, reason: "fake_state_or_system_language" };
  }

  return { ok: true };
}

export function hashSmsSnippet(text: string): string {
  let h = 0;
  const s = text.slice(0, 200);
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}
