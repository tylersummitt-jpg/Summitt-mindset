import { utCard, utErrorPanel } from "@/components/utility-page-visual";

export const programsEyebrow =
  "text-xs font-semibold uppercase tracking-[0.16em] text-stone-400";

export const programsGroupLabel =
  "text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand)]";

export const programsLessonTitle =
  "text-3xl font-semibold tracking-tight text-stone-50 sm:text-4xl text-balance";

export const programsCatalogTitle =
  "text-4xl font-semibold tracking-tight text-stone-50 sm:text-5xl";

export const programsAccentRule = "h-1 w-14 rounded-full bg-[var(--brand)]";

export const programsTeaching =
  "rounded-2xl border border-white/10 bg-[#111827] px-5 py-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:px-7 sm:py-8";

export const programsCatalogCard =
  "group block overflow-hidden rounded-2xl border border-white/10 bg-[#111827] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:border-[var(--brand)]/70";

export const programsProgressTrack = "mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10";

export const programsProgressFill = "block h-full rounded-full bg-[var(--brand)]";

export const programsSectionCard = `${utCard} space-y-4 p-5 sm:p-6`;

export const programsQuote = `${utCard} border-l-2 border-l-[var(--brand)] px-5 py-4`;

export const programsSuccessPanel =
  "rounded-lg border border-emerald-500/30 bg-emerald-950/40 px-4 py-3 text-sm leading-relaxed text-emerald-100";

export const programsMissPanel = utErrorPanel;

export const programsStatusPill =
  "inline-flex rounded-full border border-white/15 bg-white/5 px-3 py-1 text-sm font-semibold text-stone-100";

export const programsStatusActive =
  "inline-flex rounded-full border border-[var(--brand)]/50 bg-[var(--brand)]/10 px-3 py-1 text-sm font-semibold text-[var(--brand)]";

export const programsChoiceIdle =
  "flex items-start gap-3 rounded-lg border border-white/10 bg-[#0f172a] px-4 py-3";

export const programsChoiceSelected =
  "flex items-start gap-3 rounded-lg border border-[var(--brand)] bg-white/5 px-4 py-3";
