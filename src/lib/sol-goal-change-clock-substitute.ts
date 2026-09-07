/**
 * Deterministic clock-fragment → canonical sentence substitute.
 * Used by Slice 2 pending-open, Sol-owned Turn 2 awaiting_candidate,
 * and leftover awaiting_candidate hallway (legacy / tighten).
 * Not an English brain: it only expands a clock into a sentence that already
 * has exactly one HH:MM clock.
 */

/** Clock-only fragment such as `10:30` or `10:30 pm`. */
export const SOL_GOAL_CHANGE_CLOCK_ONLY_RE =
  /^\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*$/i;
/** Time-of-day in a sentence: requires minutes so "10 pushups" is not a clock. */
const CLOCK_IN_TEXT_RE = /\b(\d{1,2}):(\d{2})(?:\s*(a\.?m\.?|p\.?m\.?))?\b/gi;

function formatClockParts(
  hour: string,
  fragmentMinute: string | undefined,
  fragmentAmPm: string | undefined,
  canonicalMinute: string | undefined,
  canonicalAmPm: string | undefined
): string {
  const mm = (fragmentMinute ?? canonicalMinute ?? "00").padStart(2, "0");
  const suffix = (fragmentAmPm ?? canonicalAmPm ?? "").replace(/\./g, "").toLowerCase();
  return suffix ? `${hour}:${mm} ${suffix}` : `${hour}:${mm}`;
}

function clockFragmentSource(text: string): string {
  return text.trim().replace(/[.!?]+$/g, "").trim();
}

export function isSolGoalChangeClockOnlyFragment(text: string): boolean {
  return SOL_GOAL_CHANGE_CLOCK_ONLY_RE.test(clockFragmentSource(text));
}

/**
 * If the fragment is only a clock and canonical has exactly one HH:MM
 * clock, substitute into the canonical sentence. Deterministic — not an LLM.
 */
export function trySubstituteClockFragmentIntoCanonical(
  canonical: string,
  fragment: string
): string | null {
  const frag = SOL_GOAL_CHANGE_CLOCK_ONLY_RE.exec(clockFragmentSource(fragment));
  if (!frag) return null;
  const matches = [...canonical.matchAll(new RegExp(CLOCK_IN_TEXT_RE.source, "gi"))];
  if (matches.length !== 1 || matches[0]!.index == null) return null;
  const old = matches[0]!;
  const next = formatClockParts(frag[1]!, frag[2], frag[3], old[2], old[3]);
  return canonical.slice(0, old.index) + next + canonical.slice(old.index + old[0].length);
}

export type ReplaceHallwayClockResolve =
  | { status: "unchanged" }
  | { status: "normalized"; candidate: string }
  | { status: "unnormalizable" };

/**
 * When leftover awaiting_candidate extract (or the inbound itself) is a raw
 * clock, expand it against canonical. Never persist a clock fragment.
 */
export function resolveReplaceHallwayClockCandidate(args: {
  canonicalBehaviorStatement: string;
  extracted: string | null;
  inboundRaw: string;
}): ReplaceHallwayClockResolve {
  const extracted = args.extracted?.trim() ?? "";
  const inbound = args.inboundRaw.trim();
  const clockSource = isSolGoalChangeClockOnlyFragment(extracted)
    ? extracted
    : isSolGoalChangeClockOnlyFragment(inbound)
      ? inbound
      : null;
  if (!clockSource) return { status: "unchanged" };
  const substituted = trySubstituteClockFragmentIntoCanonical(
    args.canonicalBehaviorStatement,
    clockSource
  );
  if (!substituted?.trim()) return { status: "unnormalizable" };
  const candidate = substituted.trim().replace(/\s+/g, " ");
  if (isSolGoalChangeClockOnlyFragment(candidate)) return { status: "unnormalizable" };
  return { status: "normalized", candidate };
}
