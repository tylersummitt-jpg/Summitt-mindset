import type { CSSProperties } from "react";
import { getVictoryCardPatQuote } from "@/lib/victory-card-pat-quote";
import {
  getVictoryCardShareTone,
  normalizeVictoryCardLine,
  VICTORY_CARD_ASPECT_RATIO,
  VICTORY_CARD_BASE_WIDTH_PX,
  VICTORY_CARD_SHARE_FONTS,
  VICTORY_CARD_SHARE_TEXT,
} from "@/lib/victory-card-share-tone";
import type { VictoryShareSnippet } from "@/lib/v2-victory-share-snippet";

type VictoryCardShareLayoutProps = {
  snippet: VictoryShareSnippet;
};

const pillBase: CSSProperties = {
  display: "inline-block",
  borderRadius: 9999,
  padding: "6px 14px",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  fontFamily: VICTORY_CARD_SHARE_FONTS.sans,
};

/** Portrait 4:5 Victory Card — modal preview and html2canvas capture (export-safe colors only). */
export function VictoryCardShareLayout({ snippet }: VictoryCardShareLayoutProps) {
  const tone = getVictoryCardShareTone(snippet.categoryLabel);
  const patQuote = getVictoryCardPatQuote(snippet.categoryLabel);
  const quoteLine = snippet.quote?.trim() || null;
  const meaningLine = snippet.meaning.trim();
  const meaningDiffersFromQuote =
    !quoteLine || normalizeVictoryCardLine(quoteLine) !== normalizeVictoryCardLine(meaningLine);
  const showMeaningBelow = quoteLine ? meaningDiffersFromQuote : false;
  const heroText = quoteLine || meaningLine;

  const cardHeight = Math.round(VICTORY_CARD_BASE_WIDTH_PX / VICTORY_CARD_ASPECT_RATIO);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        maxWidth: VICTORY_CARD_BASE_WIDTH_PX,
        margin: "0 auto",
        aspectRatio: `${4} / ${5}`,
        minHeight: cardHeight,
        boxSizing: "border-box",
        overflow: "hidden",
        borderRadius: 20,
        border: `1px solid ${tone.cardBorder}`,
        background: tone.cardBackground,
        boxShadow: tone.cardInnerGlow,
        display: "flex",
        flexDirection: "column",
        padding: "32px 28px 28px",
        fontFamily: VICTORY_CARD_SHARE_FONTS.sans,
      }}
    >
      <div
        aria-hidden
        style={{
          pointerEvents: "none",
          position: "absolute",
          top: -48,
          right: -48,
          width: 180,
          height: 180,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${tone.cornerHalo} 0%, transparent 68%)`,
        }}
      />
      <div
        aria-hidden
        style={{
          pointerEvents: "none",
          position: "absolute",
          bottom: 0,
          left: 28,
          right: 28,
          height: 1,
          background: `linear-gradient(90deg, transparent 0%, ${tone.accentLine} 18%, ${tone.accentLine} 82%, transparent 100%)`,
        }}
      />

      <header style={{ position: "relative", flexShrink: 0 }}>
        <p
          style={{
            margin: 0,
            fontFamily: VICTORY_CARD_SHARE_FONTS.serif,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: VICTORY_CARD_SHARE_TEXT.title,
          }}
        >
          Victory Card
        </p>
        <div
          style={{
            marginTop: 18,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span
            style={{
              ...pillBase,
              color: tone.pillText,
              border: `1px solid ${tone.pillBorder}`,
              backgroundColor: tone.pillBackground,
            }}
          >
            {snippet.categoryLabel}
          </span>
          {snippet.dateLabel ? (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: VICTORY_CARD_SHARE_TEXT.date,
              }}
            >
              {snippet.dateLabel}
            </span>
          ) : null}
        </div>
      </header>

      <section
        style={{
          position: "relative",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          paddingTop: 24,
          paddingBottom: 24,
          minHeight: 0,
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: VICTORY_CARD_SHARE_FONTS.serif,
            fontSize: quoteLine ? 26 : 28,
            fontWeight: 500,
            lineHeight: 1.32,
            letterSpacing: "-0.02em",
            color: VICTORY_CARD_SHARE_TEXT.hero,
          }}
        >
          {quoteLine ? (
            <>
              <span style={{ color: "rgba(252, 211, 77, 0.75)" }}>&ldquo;</span>
              {heroText}
              <span style={{ color: "rgba(252, 211, 77, 0.75)" }}>&rdquo;</span>
            </>
          ) : (
            heroText
          )}
        </p>
        {showMeaningBelow ? (
          <p
            style={{
              margin: "20px 0 0",
              fontSize: 15,
              lineHeight: 1.5,
              color: VICTORY_CARD_SHARE_TEXT.meaning,
            }}
          >
            {meaningLine}
          </p>
        ) : null}
      </section>

      <footer style={{ position: "relative", flexShrink: 0, paddingTop: 4 }}>
        <div
          aria-hidden
          style={{
            height: 1,
            marginBottom: 18,
            background: `linear-gradient(90deg, transparent, ${tone.accentLine}, transparent)`,
          }}
        />
        <p
          style={{
            margin: 0,
            fontFamily: VICTORY_CARD_SHARE_FONTS.serif,
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: VICTORY_CARD_SHARE_TEXT.brand,
          }}
        >
          Summitt Mindset
        </p>
        <p
          style={{
            margin: "16px 0 0",
            fontFamily: VICTORY_CARD_SHARE_FONTS.serif,
            fontSize: 13,
            fontStyle: "italic",
            fontWeight: 400,
            lineHeight: 1.45,
            color: VICTORY_CARD_SHARE_TEXT.patQuote,
          }}
        >
          &ldquo;{patQuote}&rdquo;
        </p>
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: VICTORY_CARD_SHARE_TEXT.patAttribution,
          }}
        >
          — Pat Summitt
        </p>
      </footer>
    </div>
  );
}
