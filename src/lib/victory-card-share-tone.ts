import {
  getVictoryProofCategoryTone,
  type VictoryProofCategoryToneKey,
} from "@/components/victory-room-visual";

/** Portrait 4:5 share card — base width; export scales to VICTORY_PROOF_EXPORT_WIDTH. */
export const VICTORY_CARD_BASE_WIDTH_PX = 360;
export const VICTORY_CARD_ASPECT_RATIO = 4 / 5;

/** html2canvas-safe colors only (hex / rgb / rgba). */
export type VictoryCardShareTone = {
  pillText: string;
  pillBorder: string;
  pillBackground: string;
  cardBorder: string;
  cardBackground: string;
  cardInnerGlow: string;
  cornerHalo: string;
  accentLine: string;
};

const CARD_BG =
  "linear-gradient(165deg, #0a0e16 0%, #060a11 42%, #04060c 100%)";

const VICTORY_CARD_SHARE_TONES: Record<VictoryProofCategoryToneKey, VictoryCardShareTone> = {
  kept_the_goal: {
    pillText: "#6ee7b7",
    pillBorder: "rgba(16, 185, 129, 0.45)",
    pillBackground: "rgba(2, 44, 34, 0.4)",
    cardBorder: "rgba(16, 185, 129, 0.32)",
    cardBackground: CARD_BG,
    cardInnerGlow: "inset 0 1px 0 rgba(255, 255, 255, 0.07), inset 0 0 80px rgba(52, 211, 153, 0.08)",
    cornerHalo: "rgba(52, 211, 153, 0.22)",
    accentLine: "rgba(16, 185, 129, 0.45)",
  },
  told_the_truth: {
    pillText: "#7dd3fc",
    pillBorder: "rgba(14, 165, 233, 0.45)",
    pillBackground: "rgba(8, 47, 73, 0.4)",
    cardBorder: "rgba(14, 165, 233, 0.32)",
    cardBackground: CARD_BG,
    cardInnerGlow: "inset 0 1px 0 rgba(255, 255, 255, 0.07), inset 0 0 80px rgba(56, 189, 248, 0.08)",
    cornerHalo: "rgba(56, 189, 248, 0.2)",
    accentLine: "rgba(14, 165, 233, 0.45)",
  },
  got_back_on_track: {
    pillText: "#fdba74",
    pillBorder: "rgba(249, 115, 22, 0.45)",
    pillBackground: "rgba(67, 20, 7, 0.4)",
    cardBorder: "rgba(249, 115, 22, 0.32)",
    cardBackground: CARD_BG,
    cardInnerGlow: "inset 0 1px 0 rgba(255, 255, 255, 0.07), inset 0 0 80px rgba(249, 115, 22, 0.08)",
    cornerHalo: "rgba(249, 115, 22, 0.2)",
    accentLine: "rgba(249, 115, 22, 0.45)",
  },
  adjusted_wisely: {
    pillText: "#c4b5fd",
    pillBorder: "rgba(139, 92, 246, 0.45)",
    pillBackground: "rgba(46, 16, 101, 0.4)",
    cardBorder: "rgba(139, 92, 246, 0.32)",
    cardBackground: CARD_BG,
    cardInnerGlow: "inset 0 1px 0 rgba(255, 255, 255, 0.07), inset 0 0 80px rgba(167, 139, 250, 0.08)",
    cornerHalo: "rgba(167, 139, 250, 0.2)",
    accentLine: "rgba(139, 92, 246, 0.45)",
  },
  raised_the_bar: {
    pillText: "#fcd34d",
    pillBorder: "rgba(245, 158, 11, 0.5)",
    pillBackground: "rgba(69, 26, 3, 0.42)",
    cardBorder: "rgba(245, 158, 11, 0.35)",
    cardBackground: CARD_BG,
    cardInnerGlow: "inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 0 80px rgba(251, 191, 36, 0.1)",
    cornerHalo: "rgba(251, 191, 36, 0.24)",
    accentLine: "rgba(245, 158, 11, 0.5)",
  },
  completed_season: {
    pillText: "#f5f5f4",
    pillBorder: "rgba(214, 211, 209, 0.4)",
    pillBackground: "rgba(28, 25, 23, 0.42)",
    cardBorder: "rgba(214, 211, 209, 0.28)",
    cardBackground: CARD_BG,
    cardInnerGlow: "inset 0 1px 0 rgba(255, 255, 255, 0.07), inset 0 0 80px rgba(214, 211, 209, 0.06)",
    cornerHalo: "rgba(214, 211, 209, 0.16)",
    accentLine: "rgba(214, 211, 209, 0.4)",
  },
};

/** Shared typography colors — export-safe cream/gold palette. */
export const VICTORY_CARD_SHARE_TEXT = {
  eyebrow: "#78716c",
  date: "#a8a29e",
  hero: "#fafaf9",
  meaning: "#a8a29e",
  brand: "#fcd34d",
  brandMuted: "#d6d3d1",
  tagline: "#57534e",
} as const;

const UNSAFE_COLOR_PATTERN = /oklab|oklch|color-mix|lab\(|lch\(/i;

const FONT_SERIF =
  'ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const FONT_SANS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const VICTORY_CARD_SHARE_FONTS = {
  serif: FONT_SERIF,
  sans: FONT_SANS,
} as const;

/** True when a CSS color string is safe for html2canvas export. */
export function isExportSafeCssColor(value: string): boolean {
  if (!value.trim()) return false;
  if (UNSAFE_COLOR_PATTERN.test(value)) return false;
  return /^(#[0-9a-f]{3,8}|rgba?\(|linear-gradient\()/i.test(value.trim());
}

/** Collect paint/color strings from a share tone (excludes box-shadow strings). */
export function listVictoryCardShareToneColorValues(tone: VictoryCardShareTone): string[] {
  return [
    tone.pillText,
    tone.pillBorder,
    tone.pillBackground,
    tone.cardBorder,
    tone.cardBackground,
    tone.cornerHalo,
    tone.accentLine,
    ...Object.values(VICTORY_CARD_SHARE_TEXT),
  ];
}

/** box-shadow / inset glow strings must use rgba/hex only. */
export function isExportSafeBoxShadow(value: string): boolean {
  if (UNSAFE_COLOR_PATTERN.test(value)) return false;
  return /rgba?\(|#[0-9a-f]/i.test(value);
}

export function getVictoryCardShareTone(categoryLabel: string): VictoryCardShareTone {
  const key = getVictoryProofCategoryTone(categoryLabel).key;
  return VICTORY_CARD_SHARE_TONES[key];
}

/** Normalize for duplicate quote/meaning detection. */
export function normalizeVictoryCardLine(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}
