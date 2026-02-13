/**
 * ======================================================
 * Onboarding Config (CANONICAL)
 * ======================================================
 *
 * This file is the single source of truth for:
 * - Arena options
 * - Outcome options (by arena)
 * - Miss plan options
 * - Training themes
 *
 * IMPORTANT:
 * These values are deterministic and safe.
 * We do NOT allow arbitrary user input here.
 *
 * NOTE TO SELF (ChatGPT):
 * TypeScript gets picky when indexing Record<Arena, ...> with a runtime string.
 * So we provide:
 * - isArena() type guard
 * - getOutcomesForArena() helper
 */

export const ARENAS = [
  "Family & Parenting",
  "Marriage & Relationships",
  "Faith & Spiritual Strength",
  "Health & Energy",
  "Career & Leadership",
  "Calm & Emotional Control",
  "Confidence & Identity",
  "Discipline & Consistency",
] as const;

export type Arena = (typeof ARENAS)[number];

export function isArena(value: unknown): value is Arena {
  return typeof value === "string" && (ARENAS as readonly string[]).includes(value);
}

export const OUTCOMES_BY_ARENA: Record<Arena, string[]> = {
  "Family & Parenting": [
    "Respond with patience instead of reacting emotionally",
    "Be more present (less phone, fewer distractions)",
    "Lead my home with clear standards and consistency",
    "Create more meaningful one-on-one moments",
  ],
  "Marriage & Relationships": [
    "Communicate without defensiveness",
    "Show consistent appreciation and gratitude",
    "Be calmer during conflict",
    "Initiate connection instead of waiting",
  ],
  "Faith & Spiritual Strength": [
    "Spend intentional daily time in prayer or reflection",
    "Trust God more when things feel uncertain",
    "Lead my family spiritually",
    "Replace worry with grounded faith",
  ],
  "Health & Energy": [
    "Build a consistent daily movement routine",
    "Improve sleep and recovery habits",
    "Fuel my body with discipline",
    "Have more steady energy throughout the day",
  ],
  "Career & Leadership": [
    "Lead with clarity and calm under pressure",
    "Communicate standards more directly",
    "Stop procrastinating hard decisions",
    "Show up with stronger executive presence",
  ],
  "Calm & Emotional Control": [
    "Pause before reacting",
    "Lower my daily stress baseline",
    "Respond instead of escalate",
    "Stay steady in tense situations",
  ],
  "Confidence & Identity": [
    "Speak up without second-guessing",
    "Stop shrinking in important rooms",
    "Trust my decisions faster",
    "Carry myself with stronger presence",
  ],
  "Discipline & Consistency": [
    "Follow through on what I say I’ll do",
    "Build a steady morning routine",
    "Reduce distractions and time-wasting",
    "Do hard things without delay",
  ],
};

export function getOutcomesForArena(arena: Arena): string[] {
  return OUTCOMES_BY_ARENA[arena] || [];
}

export const MISS_PLAN_OPTIONS = [
  "If I miss in the morning, I’ll do it at lunch.",
  "If I miss midday, I’ll do it before bed.",
  "If I miss today, I’ll do tomorrow’s practice tomorrow — no catching up.",
] as const;

export const TRAINING_THEMES = [
  { slug: "discipline", label: "Discipline & Standards" },
  { slug: "consistency", label: "Consistency" },
  { slug: "accountability", label: "Accountability" },
  { slug: "communication", label: "Communication" },
  { slug: "focus", label: "Focus & Execution" },
  { slug: "confidence", label: "Confidence" },
  { slug: "leadership", label: "Leadership" },
  { slug: "relationships", label: "Relationships" },
  { slug: "resilience", label: "Resilience" },
] as const;
