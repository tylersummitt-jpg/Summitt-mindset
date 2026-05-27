const HEADER_FOOTER_PATTERNS: RegExp[] = [
  /^\d+$/,
  /^page\s+\d+\s+of\s+\d+$/i,
  /^-\s*\d+\s*-$/,
  /^(reach for the summit|sum it up)$/i,
];

const MIN_PARAGRAPH_CHARS = 20;
const MIN_ALNUM_RATIO = 0.5;

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Normalize curly quotes and dashes for consistent matching; keep readable prose. */
export function normalizeTypography(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00A0/g, " ");
}

export function fixHyphenatedLineBreaks(text: string): string {
  return text.replace(/(\w)-\s+(\w)/g, "$1$2");
}

export function cleanParagraphText(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  t = fixHyphenatedLineBreaks(t);
  t = t
    .split("\n")
    .map((line) => collapseWhitespace(line))
    .filter(Boolean)
    .join(" ");
  t = normalizeTypography(t);
  return collapseWhitespace(t);
}

function alnumRatio(text: string): number {
  if (!text.length) return 0;
  const alnum = text.replace(/[^a-zA-Z0-9]/g, "").length;
  return alnum / text.length;
}

export function isNoiseParagraph(text: string): boolean {
  const t = text.trim();
  if (t.length < MIN_PARAGRAPH_CHARS) return true;
  if (alnumRatio(t) < MIN_ALNUM_RATIO) return true;
  for (const re of HEADER_FOOTER_PATTERNS) {
    if (re.test(t)) return true;
  }
  return false;
}

export function countWords(text: string): number {
  const t = collapseWhitespace(text);
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

export function excerptText(text: string, max = 200): string {
  const t = collapseWhitespace(text);
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Split long text on sentence boundaries for chunking. */
export function splitOnSentences(text: string, maxWords = 450): string[] {
  const words = countWords(text);
  if (words <= maxWords) return [text];

  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) {
    const parts: string[] = [];
    const tokens = text.split(/\s+/);
    let buf: string[] = [];
    for (const tok of tokens) {
      buf.push(tok);
      if (buf.length >= maxWords) {
        parts.push(buf.join(" "));
        buf = [];
      }
    }
    if (buf.length) parts.push(buf.join(" "));
    return parts;
  }

  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    const candidate = buf ? `${buf} ${s}` : s;
    if (countWords(candidate) > maxWords && buf) {
      out.push(buf);
      buf = s;
    } else {
      buf = candidate;
    }
  }
  if (buf) out.push(buf);
  return out;
}
