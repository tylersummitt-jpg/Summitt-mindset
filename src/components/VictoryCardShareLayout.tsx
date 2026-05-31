import { getVictoryProofCategoryTone } from "@/components/victory-room-visual";
import type { VictoryShareSnippet } from "@/lib/v2-victory-share-snippet";

export type VictoryCardShareLayoutVariant = "preview" | "export";

type VictoryCardShareLayoutProps = {
  snippet: VictoryShareSnippet;
  variant: VictoryCardShareLayoutVariant;
};

const exportFontSerif =
  'ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const exportFontSans =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Shared Victory Card layout for modal preview and PNG export. */
export function VictoryCardShareLayout({ snippet, variant }: VictoryCardShareLayoutProps) {
  const tone = getVictoryProofCategoryTone(snippet.categoryLabel);
  const quoteLine = snippet.quote?.trim() || null;

  if (variant === "export") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          padding: "72px 64px 56px",
          background: "linear-gradient(160deg, #0e131d 0%, #0a0e16 55%, #070b12 100%)",
          fontFamily: exportFontSans,
          color: "#e7e5e4",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
          <span
            style={{
              display: "inline-block",
              borderRadius: 9999,
              border: "1px solid rgba(251, 191, 36, 0.45)",
              backgroundColor: "rgba(245, 158, 11, 0.12)",
              padding: "8px 16px",
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#fef3c7",
            }}
          >
            {snippet.categoryLabel}
          </span>
          {snippet.dateLabel ? (
            <span
              style={{
                marginLeft: "auto",
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "#a8a29e",
              }}
            >
              {snippet.dateLabel}
            </span>
          ) : null}
        </div>

        <div
          style={{
            marginTop: 32,
            marginBottom: 32,
            height: 1,
            backgroundColor: "rgba(251, 191, 36, 0.22)",
          }}
        />

        <div style={{ flex: 1, minHeight: 24, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {quoteLine ? (
            <p
              style={{
                margin: 0,
                fontFamily: exportFontSerif,
                fontSize: 42,
                fontWeight: 500,
                lineHeight: 1.35,
                color: "#fafaf9",
                overflow: "hidden",
              }}
            >
              &ldquo;{quoteLine}&rdquo;
            </p>
          ) : null}
          <p
            style={{
              margin: quoteLine ? "28px 0 0" : 0,
              fontFamily: exportFontSerif,
              fontSize: quoteLine ? 32 : 42,
              fontWeight: 500,
              lineHeight: 1.4,
              color: quoteLine ? "#a8a29e" : "#fafaf9",
              overflow: "hidden",
            }}
          >
            {snippet.meaning}
          </p>
        </div>

        <div style={{ marginTop: "auto", paddingTop: 40 }}>
          <p
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "0.02em",
              color: "#fcd34d",
            }}
          >
            {snippet.brandLine} · {snippet.brandUrl}
          </p>
          <p
            style={{
              margin: "12px 0 0",
              fontSize: 18,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#78716c",
            }}
          >
            {snippet.tagline}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br from-[#0c1018] to-[#070b12] px-5 py-5 sm:px-6 sm:py-6 ${tone.cardBorder} ${tone.cardShadow}`}
    >
      <div
        className={`pointer-events-none absolute inset-y-3 left-0 w-[2px] rounded-full ${tone.cardAccent}`}
        aria-hidden
      />
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <p className={tone.pill}>{snippet.categoryLabel}</p>
        {snippet.dateLabel ? (
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-300">{snippet.dateLabel}</p>
        ) : null}
      </div>
      <div className={`my-4 border-t ${tone.cardDivider}`} />
      {quoteLine ? (
        <p className="text-lg leading-relaxed text-stone-50 sm:text-xl sm:leading-relaxed">
          &ldquo;{quoteLine}&rdquo;
        </p>
      ) : null}
      <p
        className={`text-base leading-relaxed sm:text-[17px] sm:leading-relaxed ${
          quoteLine ? "mt-3 text-stone-400" : "text-lg text-stone-50 sm:text-xl sm:leading-relaxed"
        }`}
      >
        {snippet.meaning}
      </p>
      <div className={`mt-6 border-t pt-4 ${tone.cardDivider}`}>
        <p className="text-sm font-semibold text-amber-200">
          {snippet.brandLine} · {snippet.brandUrl}
        </p>
        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
          {snippet.tagline}
        </p>
      </div>
    </div>
  );
}
