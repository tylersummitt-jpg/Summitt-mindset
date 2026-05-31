import type { CSSProperties } from "react";
import {
  getVictoryCardShareTone,
  VICTORY_CARD_SHARE_TEXT,
} from "@/lib/victory-card-share-tone";
import type { VictoryShareSnippet } from "@/lib/v2-victory-share-snippet";

type VictoryCardShareLayoutProps = {
  snippet: VictoryShareSnippet;
};

const pillBase: CSSProperties = {
  display: "inline-block",
  borderRadius: 9999,
  padding: "4px 12px",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

/** Victory Card layout for modal preview and PNG capture (html2canvas-safe colors only). */
export function VictoryCardShareLayout({ snippet }: VictoryCardShareLayoutProps) {
  const tone = getVictoryCardShareTone(snippet.categoryLabel);
  const quoteLine = snippet.quote?.trim() || null;

  return (
    <div
      className="relative overflow-hidden rounded-2xl px-5 py-5 sm:px-6 sm:py-6"
      style={{
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: tone.cardBorder,
        background: tone.cardBackground,
        boxShadow: tone.cardShadow,
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-3 left-0 w-[2px] rounded-full"
        style={{ backgroundColor: tone.accentBar }}
      />
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <p style={{ ...pillBase, color: tone.pillText, border: `1px solid ${tone.pillBorder}`, backgroundColor: tone.pillBackground }}>
          {snippet.categoryLabel}
        </p>
        {snippet.dateLabel ? (
          <p
            className="text-xs font-semibold uppercase"
            style={{ letterSpacing: "0.14em", color: VICTORY_CARD_SHARE_TEXT.date }}
          >
            {snippet.dateLabel}
          </p>
        ) : null}
      </div>
      <div className="my-4 border-t" style={{ borderColor: tone.divider }} />
      {quoteLine ? (
        <p className="text-lg leading-relaxed sm:text-xl sm:leading-relaxed" style={{ color: VICTORY_CARD_SHARE_TEXT.quote }}>
          &ldquo;{quoteLine}&rdquo;
        </p>
      ) : null}
      <p
        className={`text-base leading-relaxed sm:text-[17px] sm:leading-relaxed${quoteLine ? " mt-3" : " text-lg sm:text-xl sm:leading-relaxed"}`}
        style={{ color: quoteLine ? VICTORY_CARD_SHARE_TEXT.meaning : VICTORY_CARD_SHARE_TEXT.meaningPrimary }}
      >
        {snippet.meaning}
      </p>
      <div className="mt-6 border-t pt-4" style={{ borderColor: tone.divider }}>
        <p className="text-sm font-semibold" style={{ color: VICTORY_CARD_SHARE_TEXT.brand }}>
          {snippet.brandLine} · {snippet.brandUrl}
        </p>
        <p
          className="mt-1 text-xs font-semibold uppercase"
          style={{ letterSpacing: "0.12em", color: VICTORY_CARD_SHARE_TEXT.tagline }}
        >
          {snippet.tagline}
        </p>
      </div>
    </div>
  );
}
