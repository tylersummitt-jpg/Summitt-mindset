/**
 * Client-safe identity anchor validation — no Supabase, server-only, or secrets.
 * Used by onboarding UI and server routes that only need pure validation.
 */

/** Stored / prompted identity line max length after normalization. */
export const V2_IDENTITY_ANCHOR_MAX_CHARS = 220;

/** Stored when the user answers the Wave 8 onboarding “who are you becoming?” question. Quotably trusted. */
export const ONBOARDING_IDENTITY_ANCHOR_SOURCE = "onboarding_identity_anchor_v1";

/** SMS / AI may quote this line verbatim only when the source is user-trusted. */
export function isQuotableIdentitySource(source: string | null | undefined): boolean {
  if (source == null || typeof source !== "string") return false;
  const s = source.trim();
  if (!s) return false;
  if (s === "user_edited") return true;
  if (s === "guided_resolution_identity") return true;
  if (s === "explicitly_confirmed") return true;
  if (s === ONBOARDING_IDENTITY_ANCHOR_SOURCE) return true;
  if (s === "onboarding_people_summary_v2" || s === "onboarding_relationship_context_v1") {
    return false;
  }
  return false;
}

/** Legacy relationship-context sources — not quotable; may be replaced by a true onboarding anchor. */
export function isRelationshipDerivedIdentitySource(source: string | null | undefined): boolean {
  if (source == null || typeof source !== "string") return false;
  const s = source.trim();
  return s === "onboarding_people_summary_v2" || s === "onboarding_relationship_context_v1";
}

/**
 * Deterministic normalization for canonical `user_profiles.identity_anchor_text`.
 * Returns null when input is not usable.
 */
export function normalizeIdentityAnchorText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const collapsed = input.trim().replace(/\s+/g, " ");
  if (!collapsed) return null;
  if (collapsed.length > V2_IDENTITY_ANCHOR_MAX_CHARS) {
    return `${collapsed.slice(0, V2_IDENTITY_ANCHOR_MAX_CHARS - 1)}…`;
  }
  return collapsed;
}

/** Relationship-only stubs should not be saved as identity anchor (Wave 8 onboarding). */
export function isRelationshipOnlyIdentityAnchorStub(normalizedLower: string): boolean {
  const t = normalizedLower.replace(/\.$/, "").trim();
  if (t.length <= 3) return true;
  const exactBlocks = new Set([
    "me",
    "idk",
    "i dont know",
    "i don't know",
    "none",
    "n/a",
    "na",
    "my kids",
    "my kid",
    "my children",
    "my husband",
    "my wife",
    "my spouse",
    "my family",
    "my team",
    "the kids",
    "kids",
    "family",
    "team",
  ]);
  if (exactBlocks.has(t)) return true;
  return /^(my\s+)?(kids|children|husband|wife|spouse|family|team)s?\.?$/.test(t);
}

export type OnboardingIdentityAnchorValidation =
  | { ok: true; normalized: string }
  | { ok: false; error: string };

/**
 * Wave 8 onboarding: validate “who are you becoming?” — not relationship context (people_summary).
 */
export function validateOnboardingIdentityAnchorInput(raw: unknown): OnboardingIdentityAnchorValidation {
  const normalized = normalizeIdentityAnchorText(raw);
  if (!normalized) {
    return {
      ok: false,
      error: "Add who you’re trying to become when you follow through — one short line.",
    };
  }
  if (normalized.length < 12) {
    return {
      ok: false,
      error: "Add a bit more detail — at least a short phrase (not just one word).",
    };
  }
  if (isRelationshipOnlyIdentityAnchorStub(normalized.toLowerCase())) {
    return {
      ok: false,
      error:
        "That tells us who matters. This one is about who you are becoming — for example, ‘a steadier mom’ or ‘someone who follows through.’",
    };
  }
  return { ok: true, normalized };
}
