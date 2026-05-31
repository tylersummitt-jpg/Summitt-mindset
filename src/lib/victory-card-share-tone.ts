import {
  getVictoryProofCategoryTone,
  type VictoryProofCategoryToneKey,
} from "@/components/victory-room-visual";

/** html2canvas-safe colors only (hex / rgb / rgba). */
export type VictoryCardShareTone = {
  pillText: string;
  pillBorder: string;
  pillBackground: string;
  cardBorder: string;
  cardBackground: string;
  cardShadow: string;
  accentBar: string;
  divider: string;
};

const CARD_BG = "linear-gradient(135deg, #0c1018 0%, #070b12 100%)";
const BASE_SHADOW = "0 8px 40px -16px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.06)";

const VICTORY_CARD_SHARE_TONES: Record<VictoryProofCategoryToneKey, VictoryCardShareTone> = {
  kept_the_goal: {
    pillText: "#6ee7b7",
    pillBorder: "rgba(16, 185, 129, 0.6)",
    pillBackground: "rgba(2, 44, 34, 0.35)",
    cardBorder: "rgba(16, 185, 129, 0.55)",
    cardBackground: CARD_BG,
    cardShadow: `${BASE_SHADOW}, 0 0 52px -20px rgba(52, 211, 153, 0.28)`,
    accentBar: "#34d399",
    divider: "rgba(16, 185, 129, 0.28)",
  },
  told_the_truth: {
    pillText: "#7dd3fc",
    pillBorder: "rgba(14, 165, 233, 0.6)",
    pillBackground: "rgba(8, 47, 73, 0.35)",
    cardBorder: "rgba(14, 165, 233, 0.55)",
    cardBackground: CARD_BG,
    cardShadow: `${BASE_SHADOW}, 0 0 52px -20px rgba(56, 189, 248, 0.26)`,
    accentBar: "#38bdf8",
    divider: "rgba(14, 165, 233, 0.28)",
  },
  got_back_on_track: {
    pillText: "#fdba74",
    pillBorder: "rgba(249, 115, 22, 0.6)",
    pillBackground: "rgba(67, 20, 7, 0.35)",
    cardBorder: "rgba(249, 115, 22, 0.55)",
    cardBackground: CARD_BG,
    cardShadow: `${BASE_SHADOW}, 0 0 52px -20px rgba(249, 115, 22, 0.28)`,
    accentBar: "#fb923c",
    divider: "rgba(249, 115, 22, 0.28)",
  },
  adjusted_wisely: {
    pillText: "#c4b5fd",
    pillBorder: "rgba(139, 92, 246, 0.6)",
    pillBackground: "rgba(46, 16, 101, 0.35)",
    cardBorder: "rgba(139, 92, 246, 0.55)",
    cardBackground: CARD_BG,
    cardShadow: `${BASE_SHADOW}, 0 0 52px -20px rgba(167, 139, 250, 0.26)`,
    accentBar: "#a78bfa",
    divider: "rgba(139, 92, 246, 0.28)",
  },
  raised_the_bar: {
    pillText: "#fcd34d",
    pillBorder: "rgba(245, 158, 11, 0.65)",
    pillBackground: "rgba(69, 26, 3, 0.35)",
    cardBorder: "rgba(245, 158, 11, 0.6)",
    cardBackground: CARD_BG,
    cardShadow: `${BASE_SHADOW}, 0 0 52px -20px rgba(251, 191, 36, 0.32)`,
    accentBar: "#fbbf24",
    divider: "rgba(245, 158, 11, 0.3)",
  },
  completed_season: {
    pillText: "#f5f5f4",
    pillBorder: "rgba(214, 211, 209, 0.5)",
    pillBackground: "rgba(28, 25, 23, 0.35)",
    cardBorder: "rgba(214, 211, 209, 0.45)",
    cardBackground: CARD_BG,
    cardShadow: `${BASE_SHADOW}, 0 0 52px -20px rgba(214, 211, 209, 0.18)`,
    accentBar: "#d6d3d1",
    divider: "rgba(214, 211, 209, 0.25)",
  },
};

/** Shared text colors safe for html2canvas (no Tailwind tokens). */
export const VICTORY_CARD_SHARE_TEXT = {
  date: "#d6d3d1",
  quote: "#fafaf9",
  meaning: "#a8a29e",
  meaningPrimary: "#fafaf9",
  brand: "#fde68a",
  tagline: "#78716c",
} as const;

const UNSAFE_COLOR_PATTERN = /oklab|oklch|color-mix|lab\(|lch\(/i;

/** True when a CSS color string is safe for html2canvas export. */
export function isExportSafeCssColor(value: string): boolean {
  if (!value.trim()) return false;
  if (UNSAFE_COLOR_PATTERN.test(value)) return false;
  return /^(#[0-9a-f]{3,8}|rgba?\(|linear-gradient\()/i.test(value.trim());
}

/** Collect paint/color strings from a share tone (excludes box-shadow). */
export function listVictoryCardShareToneColorValues(tone: VictoryCardShareTone): string[] {
  return [
    tone.pillText,
    tone.pillBorder,
    tone.pillBackground,
    tone.cardBorder,
    tone.cardBackground,
    tone.accentBar,
    tone.divider,
    ...Object.values(VICTORY_CARD_SHARE_TEXT),
  ];
}

/** box-shadow values must use rgba/hex only — no oklab in shadow color functions. */
export function isExportSafeBoxShadow(value: string): boolean {
  if (UNSAFE_COLOR_PATTERN.test(value)) return false;
  return /rgba?\(|#[0-9a-f]/i.test(value);
}

export function getVictoryCardShareTone(categoryLabel: string): VictoryCardShareTone {
  const key = getVictoryProofCategoryTone(categoryLabel).key;
  return VICTORY_CARD_SHARE_TONES[key];
}
