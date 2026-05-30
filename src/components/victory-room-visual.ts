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
