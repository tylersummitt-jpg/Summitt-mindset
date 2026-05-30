/** Victory Room — shared presentational tokens (Tailwind class fragments). */

/** Route layout: opaque Victory Room canvas (parent dashboard frame also solid dark). */
export const vrRouteShell =
  "relative isolate w-full min-h-[calc(100dvh-8rem)] bg-[#04060c] text-stone-100";

export const vrPageOuter = "relative w-full";

export const vrPageGlow =
  "pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_55%_at_50%_-5%,rgba(251,191,36,0.14),transparent_58%),radial-gradient(ellipse_70%_45%_at_100%_0%,rgba(249,115,22,0.08),transparent_52%),radial-gradient(ellipse_55%_35%_at_0%_100%,rgba(30,58,95,0.35),transparent_48%)]";

export const vrPageInner =
  "relative mx-auto w-full max-w-3xl px-5 py-12 sm:px-8 sm:py-16 lg:max-w-4xl lg:px-10";

export const vrHeroFrame =
  "relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-b from-[#0d121c] via-[#080c14] to-[#060a11] px-6 py-12 shadow-[0_0_0_1px_rgba(255,255,255,0.06)_inset,0_24px_80px_-24px_rgba(0,0,0,0.85),0_0_60px_-20px_rgba(251,191,36,0.18)] sm:px-10 sm:py-14 lg:py-16";

export const vrHeroFrameGlow =
  "pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,rgba(251,191,36,0.1),transparent_60%),radial-gradient(ellipse_40%_30%_at_80%_20%,rgba(249,115,22,0.07),transparent_50%)]";

export const vrHeroArtSlot =
  "pointer-events-none absolute inset-x-8 top-6 bottom-6 rounded-2xl border border-dashed border-amber-500/15 bg-[radial-gradient(ellipse_at_center,rgba(251,191,36,0.06),transparent_70%)] sm:inset-x-12";

export const vrHeroEyebrow =
  "text-xs font-semibold uppercase tracking-[0.28em] text-amber-400";

export const vrHeroTitle =
  "font-serif text-[2.75rem] font-semibold leading-[1.05] tracking-tight text-stone-50 sm:text-6xl lg:text-7xl";

export const vrHeroSubtitle =
  "mt-5 max-w-2xl text-lg leading-relaxed text-stone-200 sm:text-xl sm:leading-relaxed";

export const vrHeroAccentLine =
  "mx-auto mt-8 h-px w-24 bg-gradient-to-r from-transparent via-amber-400/80 to-transparent sm:w-32";

export const vrSectionCard =
  "relative mb-12 overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-b from-[#0e131d] to-[#0a0e16] p-7 shadow-[0_0_0_1px_rgba(255,255,255,0.06)_inset,0_0_48px_-16px_rgba(251,191,36,0.14),0_20px_60px_-20px_rgba(0,0,0,0.75)] sm:p-8 lg:p-9";

export const vrSectionCardFoundation =
  "border-amber-400/40 shadow-[0_0_0_1px_rgba(251,191,36,0.1)_inset,0_0_64px_-12px_rgba(251,191,36,0.22),0_24px_80px_-24px_rgba(0,0,0,0.85)]";

export const vrSectionTitle =
  "font-serif text-2xl font-semibold tracking-tight text-stone-50 sm:text-[1.75rem] lg:text-3xl";

export const vrSectionSubtitle = "mt-2.5 text-base leading-relaxed text-stone-300 sm:text-[17px]";

export const vrSectionBadge =
  "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-amber-400/60 bg-gradient-to-br from-amber-500/30 to-amber-600/15 text-lg font-bold tabular-nums text-amber-50 shadow-[0_0_32px_-4px_rgba(251,191,36,0.5),inset_0_1px_0_rgba(255,255,255,0.14)]";

export const vrLabel =
  "text-xs font-semibold uppercase tracking-[0.18em] text-amber-300";

export const vrBlockTitle = "text-base font-semibold text-stone-100 sm:text-lg";

export const vrBody = "text-base leading-relaxed text-stone-200 sm:text-[17px] sm:leading-relaxed";

export const vrBodyLarge = "text-lg leading-relaxed text-stone-100 sm:text-xl sm:leading-relaxed";

export const vrBodyMuted = "text-base leading-relaxed text-stone-400";

export const vrEmptyState =
  "mt-8 rounded-2xl border border-amber-500/25 bg-[#0a0e16] px-6 py-6 text-center text-base leading-relaxed text-stone-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:px-8 sm:py-8 sm:text-left";

export const vrInnerPanel =
  "rounded-xl border border-white/12 bg-[#070b12] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:p-6";

export const vrDivider = "border-t border-amber-500/20";

export const vrIconCircle =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-amber-500/40 bg-gradient-to-br from-amber-500/20 to-amber-600/10 text-amber-100 shadow-[0_0_24px_-8px_rgba(251,191,36,0.4),inset_0_1px_0_rgba(255,255,255,0.1)]";

export const vrIconCircleGreen =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-emerald-500/40 bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 text-emerald-100 shadow-[0_0_24px_-8px_rgba(52,211,153,0.3),inset_0_1px_0_rgba(255,255,255,0.1)]";

export const vrAccentLink =
  "inline-block text-base font-medium text-amber-300 underline decoration-amber-500/50 underline-offset-[4px] transition hover:text-amber-200 hover:decoration-amber-400/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#060a11]";

export const vrFoundationBtn =
  "inline-flex min-h-[3rem] min-w-[9rem] items-center justify-center rounded-xl border-2 border-amber-500/55 bg-amber-500/10 px-5 py-3 text-base font-semibold text-amber-50 shadow-[0_0_32px_-8px_rgba(251,191,36,0.45),inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:border-amber-400/80 hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c1018]";

export const vrCategoryPill =
  "inline-block rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-amber-50";

export const vrEvidenceTile =
  "flex flex-col items-center justify-center rounded-2xl border border-amber-500/30 bg-gradient-to-b from-[#0c1018] to-[#070b12] px-4 py-6 text-center shadow-[0_0_32px_-16px_rgba(251,191,36,0.22),inset_0_1px_0_rgba(255,255,255,0.06)] sm:py-7";

export const vrEvidenceCount =
  "font-serif text-4xl font-semibold tabular-nums leading-none text-amber-50 sm:text-5xl";

export const vrMomentCard =
  "relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-[#0c1018] to-[#070b12] px-5 py-5 shadow-[0_8px_40px_-16px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.06)] sm:px-6 sm:py-6";

export const vrSeasonActive =
  "relative overflow-hidden rounded-2xl border-2 border-amber-500/45 bg-gradient-to-br from-[#121820] via-[#0c1018] to-[#080c14] p-5 shadow-[0_0_48px_-12px_rgba(251,191,36,0.32),inset_0_1px_0_rgba(255,255,255,0.08)] sm:p-6";

export const vrSeasonPast =
  "rounded-2xl border border-white/12 bg-[#070b12] px-5 py-4 transition hover:border-amber-500/30 hover:bg-[#0a0e16] sm:px-6 sm:py-5";

export const vrPrincipleHighlight =
  "rounded-2xl border border-emerald-500/35 bg-gradient-to-br from-[#0a1410] via-[#0a0e16] to-[#070b12] p-6 shadow-[0_0_40px_-16px_rgba(52,211,153,0.22),inset_0_1px_0_rgba(255,255,255,0.06)]";

export const vrPrincipleDefault =
  "rounded-2xl border border-amber-500/30 bg-gradient-to-br from-[#121820] via-[#0a0e16] to-[#070b12] p-6 shadow-[0_0_32px_-16px_rgba(251,191,36,0.18),inset_0_1px_0_rgba(255,255,255,0.06)]";

export const vrEvolutionNudge =
  "mb-10 rounded-2xl border border-amber-500/35 bg-gradient-to-br from-[#101622] to-[#0a0e16] p-6 shadow-[0_0_40px_-12px_rgba(251,191,36,0.24)] sm:p-7";

export type VictoryProofCategoryToneKey =
  | "kept_the_goal"
  | "told_the_truth"
  | "got_back_on_track"
  | "adjusted_wisely"
  | "raised_the_bar"
  | "completed_season";

export type VictoryProofCategoryTone = {
  key: VictoryProofCategoryToneKey;
  pill: string;
  cardBorder: string;
  cardGlow: string;
  /** Subtle left-edge category accent on proof cards. */
  cardAccent: string;
  cardDivider: string;
  cardShadow: string;
  evidenceTile: string;
  evidenceCount: string;
  evidenceLabel: string;
};

/** Dark proof-card shell — category border/glow applied via tone tokens. */
export const vrMomentCardBase =
  "relative overflow-hidden rounded-2xl border bg-gradient-to-br from-[#0c1018] to-[#070b12] px-5 py-5 sm:px-6 sm:py-6";

/** Dark evidence tile shell — category tint applied via tone tokens. */
export const vrEvidenceTileBase =
  "flex flex-col items-center justify-center rounded-2xl px-4 py-6 text-center sm:py-7";

const VICTORY_PROOF_CATEGORY_TONES: Record<VictoryProofCategoryToneKey, VictoryProofCategoryTone> = {
  kept_the_goal: {
    key: "kept_the_goal",
    pill: "inline-block rounded-full border border-emerald-500/60 bg-emerald-950/35 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-300",
    cardBorder: "border-emerald-500/55",
    cardGlow: "bg-emerald-500/20",
    cardAccent: "bg-gradient-to-b from-emerald-400/55 via-emerald-500/25 to-transparent",
    cardDivider: "border-emerald-500/28",
    cardShadow:
      "shadow-[0_8px_40px_-16px_rgba(0,0,0,0.85),0_0_52px_-20px_rgba(52,211,153,0.28),inset_0_1px_0_rgba(255,255,255,0.06)]",
    evidenceTile:
      "border-emerald-500/60 bg-gradient-to-b from-[#0c1018] to-[#070b12] shadow-[0_0_40px_-16px_rgba(52,211,153,0.28),inset_0_1px_0_rgba(255,255,255,0.06)]",
    evidenceCount: "text-emerald-300",
    evidenceLabel: "text-emerald-300",
  },
  told_the_truth: {
    key: "told_the_truth",
    pill: "inline-block rounded-full border border-sky-500/60 bg-sky-950/35 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-sky-300",
    cardBorder: "border-sky-500/55",
    cardGlow: "bg-sky-500/20",
    cardAccent: "bg-gradient-to-b from-sky-400/55 via-sky-500/25 to-transparent",
    cardDivider: "border-sky-500/28",
    cardShadow:
      "shadow-[0_8px_40px_-16px_rgba(0,0,0,0.85),0_0_52px_-20px_rgba(56,189,248,0.26),inset_0_1px_0_rgba(255,255,255,0.06)]",
    evidenceTile:
      "border-sky-500/60 bg-gradient-to-b from-[#0c1018] to-[#070b12] shadow-[0_0_40px_-16px_rgba(56,189,248,0.26),inset_0_1px_0_rgba(255,255,255,0.06)]",
    evidenceCount: "text-sky-300",
    evidenceLabel: "text-sky-300",
  },
  got_back_on_track: {
    key: "got_back_on_track",
    pill: "inline-block rounded-full border border-orange-500/60 bg-orange-950/35 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-orange-300",
    cardBorder: "border-orange-500/55",
    cardGlow: "bg-orange-500/20",
    cardAccent: "bg-gradient-to-b from-orange-400/55 via-orange-500/25 to-transparent",
    cardDivider: "border-orange-500/28",
    cardShadow:
      "shadow-[0_8px_40px_-16px_rgba(0,0,0,0.85),0_0_52px_-20px_rgba(249,115,22,0.28),inset_0_1px_0_rgba(255,255,255,0.06)]",
    evidenceTile:
      "border-orange-500/60 bg-gradient-to-b from-[#0c1018] to-[#070b12] shadow-[0_0_40px_-16px_rgba(249,115,22,0.28),inset_0_1px_0_rgba(255,255,255,0.06)]",
    evidenceCount: "text-orange-300",
    evidenceLabel: "text-orange-300",
  },
  adjusted_wisely: {
    key: "adjusted_wisely",
    pill: "inline-block rounded-full border border-violet-500/60 bg-violet-950/35 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-violet-300",
    cardBorder: "border-violet-500/55",
    cardGlow: "bg-violet-500/20",
    cardAccent: "bg-gradient-to-b from-violet-400/55 via-violet-500/25 to-transparent",
    cardDivider: "border-violet-500/28",
    cardShadow:
      "shadow-[0_8px_40px_-16px_rgba(0,0,0,0.85),0_0_52px_-20px_rgba(167,139,250,0.26),inset_0_1px_0_rgba(255,255,255,0.06)]",
    evidenceTile:
      "border-violet-500/60 bg-gradient-to-b from-[#0c1018] to-[#070b12] shadow-[0_0_40px_-16px_rgba(167,139,250,0.26),inset_0_1px_0_rgba(255,255,255,0.06)]",
    evidenceCount: "text-violet-300",
    evidenceLabel: "text-violet-300",
  },
  raised_the_bar: {
    key: "raised_the_bar",
    pill: "inline-block rounded-full border border-amber-500/65 bg-amber-950/35 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-amber-300",
    cardBorder: "border-amber-500/60",
    cardGlow: "bg-amber-500/25",
    cardAccent: "bg-gradient-to-b from-amber-400/55 via-amber-500/25 to-transparent",
    cardDivider: "border-amber-500/30",
    cardShadow:
      "shadow-[0_8px_40px_-16px_rgba(0,0,0,0.85),0_0_52px_-20px_rgba(251,191,36,0.32),inset_0_1px_0_rgba(255,255,255,0.06)]",
    evidenceTile:
      "border-amber-500/65 bg-gradient-to-b from-[#0c1018] to-[#070b12] shadow-[0_0_40px_-16px_rgba(251,191,36,0.32),inset_0_1px_0_rgba(255,255,255,0.06)]",
    evidenceCount: "text-amber-300",
    evidenceLabel: "text-amber-300",
  },
  completed_season: {
    key: "completed_season",
    pill: "inline-block rounded-full border border-stone-300/50 bg-stone-900/35 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-stone-100",
    cardBorder: "border-stone-300/45",
    cardGlow: "bg-stone-200/15",
    cardAccent: "bg-gradient-to-b from-stone-300/45 via-stone-400/20 to-transparent",
    cardDivider: "border-stone-300/25",
    cardShadow:
      "shadow-[0_8px_40px_-16px_rgba(0,0,0,0.85),0_0_52px_-20px_rgba(214,211,209,0.18),inset_0_1px_0_rgba(255,255,255,0.06)]",
    evidenceTile:
      "border-stone-300/50 bg-gradient-to-b from-[#0c1018] to-[#070b12] shadow-[0_0_40px_-16px_rgba(214,211,209,0.18),inset_0_1px_0_rgba(255,255,255,0.06)]",
    evidenceCount: "text-stone-100",
    evidenceLabel: "text-stone-100",
  },
};

function normalizeVictoryProofCategoryToneKey(input: string): VictoryProofCategoryToneKey {
  const n = input.trim().toLowerCase();
  if (
    n.includes("kept the goal") ||
    n.includes("kept the thread") ||
    n.includes("followed_through") ||
    n.includes("user_yes") ||
    n === "showed_up"
  ) {
    return "kept_the_goal";
  }
  if (
    n.includes("told the truth") ||
    n.includes("honest_miss") ||
    n.includes("user_no") ||
    n.includes("blocker")
  ) {
    return "told_the_truth";
  }
  if (n.includes("got back on track") || n.includes("comeback") || n.includes("came_back")) {
    return "got_back_on_track";
  }
  if (
    n.includes("adjusted wisely") ||
    n.includes("user_partial") ||
    n.includes("coaching_refresh") ||
    n.includes("commitment_tightened")
  ) {
    return "adjusted_wisely";
  }
  if (
    n.includes("raised the bar") ||
    n.includes("named the next goal") ||
    n.includes("goal_change") ||
    n.includes("commitment_replaced")
  ) {
    return "raised_the_bar";
  }
  if (n.includes("completed a season") || n.includes("completed_season")) {
    return "completed_season";
  }
  return "kept_the_goal";
}

/** Accent tokens for Recent Proof pills and Evidence tiles (accents only — cards stay dark). */
export function getVictoryProofCategoryTone(labelOrKey: string): VictoryProofCategoryTone {
  const key = normalizeVictoryProofCategoryToneKey(labelOrKey);
  return VICTORY_PROOF_CATEGORY_TONES[key];
}
