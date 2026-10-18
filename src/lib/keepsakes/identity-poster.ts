/**
 * Provisional Identity Poster.
 * 18 × 24 inch trim at 72 PDF points per inch. No bleed, crop marks, or color profile.
 * Vendor print specifications are not applied.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export const IDENTITY_POSTER_TEMPLATES = ["classic", "bold", "minimal"] as const;

export type IdentityPosterTemplateId = (typeof IDENTITY_POSTER_TEMPLATES)[number];

export const IDENTITY_POSTER_PROVISIONAL_TRIM = {
  label: "Provisional 18 × 24 inch trim",
  widthInches: 18,
  heightInches: 24,
} as const;

const PT_PER_INCH = 72;

export const IDENTITY_POSTER_PAGE = {
  width: IDENTITY_POSTER_PROVISIONAL_TRIM.widthInches * PT_PER_INCH,
  height: IDENTITY_POSTER_PROVISIONAL_TRIM.heightInches * PT_PER_INCH,
} as const;

const BRAND = "Summitt Mindset";

export class IdentityPosterUnsupportedCharacterError extends Error {
  readonly code = "unsupported_character" as const;

  constructor() {
    super("unsupported_character");
    this.name = "IdentityPosterUnsupportedCharacterError";
  }
}

export function parseIdentityPosterTemplate(
  value: string | null | undefined
): IdentityPosterTemplateId | null {
  if (value === "classic" || value === "bold" || value === "minimal") return value;
  return null;
}

/** Line breaks become poster lines. Every other character is drawn. */
export function identityPosterParagraphs(identity: string): string[] {
  return identity.split(/\r\n|\n|\r/);
}

function hexColor(hex: string) {
  const n = hex.replace("#", "");
  return rgb(
    parseInt(n.slice(0, 2), 16) / 255,
    parseInt(n.slice(2, 4), 16) / 255,
    parseInt(n.slice(4, 6), 16) / 255
  );
}

type PosterPaint = {
  background: ReturnType<typeof hexColor>;
  ink: ReturnType<typeof hexColor>;
  accent: ReturnType<typeof hexColor>;
  brand: ReturnType<typeof hexColor>;
  font: "times" | "helvetica" | "helvetica-bold";
  align: "center" | "left";
  preferredSize: number;
  leading: number;
  marginX: number;
  marginTop: number;
  marginBottom: number;
  label: string | null;
};

const PAINT: Record<IdentityPosterTemplateId, PosterPaint> = {
  classic: {
    background: hexColor("#F7F3EA"),
    ink: hexColor("#1C1917"),
    accent: hexColor("#A16207"),
    brand: hexColor("#78716C"),
    font: "times",
    align: "center",
    preferredSize: 54,
    leading: 1.32,
    marginX: 1.35 * PT_PER_INCH,
    marginTop: 1.7 * PT_PER_INCH,
    marginBottom: 1.35 * PT_PER_INCH,
    label: "Identity",
  },
  bold: {
    background: hexColor("#0A0E16"),
    ink: hexColor("#FAFAF9"),
    accent: hexColor("#FCD34D"),
    brand: hexColor("#D6D3D1"),
    font: "helvetica-bold",
    align: "left",
    preferredSize: 68,
    leading: 1.12,
    marginX: 1.15 * PT_PER_INCH,
    marginTop: 1.45 * PT_PER_INCH,
    marginBottom: 1.2 * PT_PER_INCH,
    label: "Identity",
  },
  minimal: {
    background: hexColor("#FFFEFB"),
    ink: hexColor("#292524"),
    accent: hexColor("#D6D3D1"),
    brand: hexColor("#A8A29E"),
    font: "helvetica",
    align: "left",
    preferredSize: 36,
    leading: 1.4,
    marginX: 1.55 * PT_PER_INCH,
    marginTop: 2.4 * PT_PER_INCH,
    marginBottom: 1.2 * PT_PER_INCH,
    label: null,
  },
};

function wrapParagraph(font: PDFFont, paragraph: string, size: number, maxWidth: number): string[] {
  if (paragraph === "") return [""];
  const lines: string[] = [];
  let rest = paragraph;
  while (rest.length > 0) {
    let fit = 0;
    for (let i = 1; i <= rest.length; i += 1) {
      if (font.widthOfTextAtSize(rest.slice(0, i), size) <= maxWidth) fit = i;
      else break;
    }
    if (fit === rest.length) {
      lines.push(rest);
      break;
    }
    if (fit <= 0) {
      lines.push(rest.slice(0, 1));
      rest = rest.slice(1);
      continue;
    }
    const spaceAt = rest.lastIndexOf(" ", fit - 1);
    const cut = spaceAt > 0 ? spaceAt + 1 : fit;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return lines;
}

export type IdentityPosterLayout = {
  lines: string[];
  fontSize: number;
  leading: number;
};

export async function layoutIdentityPoster(args: {
  identity: string;
  template: IdentityPosterTemplateId;
}): Promise<IdentityPosterLayout> {
  const pdf = await PDFDocument.create();
  const font = await embedPaintFont(pdf, PAINT[args.template].font);
  assertEncodable(font, args.identity);
  const paint = PAINT[args.template];
  const maxWidth = IDENTITY_POSTER_PAGE.width - paint.marginX * 2 - (args.template === "bold" ? 28 : 0);
  const maxHeight = IDENTITY_POSTER_PAGE.height - paint.marginTop - paint.marginBottom - 36;
  const paragraphs = identityPosterParagraphs(args.identity);

  let size = paint.preferredSize;
  let leading = paint.leading;
  let lines = layoutLines(font, paragraphs, size, maxWidth);
  while (!fits(font, lines, size, leading, maxWidth, maxHeight)) {
    if (size > 8) {
      size = Math.round((size - 0.5) * 10) / 10;
    } else if (leading > 1) {
      leading = Math.round((leading - 0.02) * 100) / 100;
    } else if (size > 2) {
      size = Math.round((size - 0.5) * 10) / 10;
    } else {
      break;
    }
    lines = layoutLines(font, paragraphs, size, maxWidth);
  }

  return { lines, fontSize: size, leading };
}

function layoutLines(font: PDFFont, paragraphs: string[], size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    lines.push(...wrapParagraph(font, paragraph, size, maxWidth));
  }
  return lines;
}

function fits(
  font: PDFFont,
  lines: string[],
  size: number,
  leading: number,
  maxWidth: number,
  maxHeight: number
): boolean {
  const height = lines.length * size * leading;
  if (height > maxHeight) return false;
  return lines.every((line) => line.length === 0 || font.widthOfTextAtSize(line, size) <= maxWidth + 0.5);
}

function assertEncodable(font: PDFFont, identity: string) {
  const printable = identity.replace(/\r\n|\n|\r/g, "");
  if (!printable) return;
  try {
    font.encodeText(printable);
  } catch {
    throw new IdentityPosterUnsupportedCharacterError();
  }
}

async function embedPaintFont(pdf: PDFDocument, kind: PosterPaint["font"]) {
  if (kind === "times") return pdf.embedFont(StandardFonts.TimesRoman);
  if (kind === "helvetica-bold") return pdf.embedFont(StandardFonts.HelveticaBold);
  return pdf.embedFont(StandardFonts.Helvetica);
}

export async function buildIdentityPosterPdf(args: {
  identity: string;
  template: IdentityPosterTemplateId;
}): Promise<Uint8Array> {
  const paint = PAINT[args.template];
  const pdf = await PDFDocument.create();
  pdf.setTitle("Identity Poster");
  pdf.setCreator("Summitt Mindset Keepsake Studio");
  pdf.setProducer("Summitt Mindset");
  const page = pdf.addPage([IDENTITY_POSTER_PAGE.width, IDENTITY_POSTER_PAGE.height]);
  const font = await embedPaintFont(pdf, paint.font);
  const brandFont = await pdf.embedFont(StandardFonts.Helvetica);
  assertEncodable(font, args.identity);
  const layout = await layoutIdentityPoster(args);

  page.drawRectangle({
    x: 0,
    y: 0,
    width: IDENTITY_POSTER_PAGE.width,
    height: IDENTITY_POSTER_PAGE.height,
    color: paint.background,
  });

  const textX = paint.marginX + (args.template === "bold" ? 28 : 0);
  const blockHeight = layout.lines.length * layout.fontSize * layout.leading;
  const contentTop = IDENTITY_POSTER_PAGE.height - paint.marginTop;
  const contentBottom = paint.marginBottom + 28;
  const available = contentTop - contentBottom;
  const top =
    args.template === "minimal"
      ? contentBottom + available * 0.62 + blockHeight / 2
      : contentBottom + (available + blockHeight) / 2;

  if (args.template === "bold") {
    page.drawRectangle({
      x: paint.marginX,
      y: top - blockHeight,
      width: 8,
      height: Math.max(blockHeight, layout.fontSize),
      color: paint.accent,
    });
  }

  if (paint.label) {
    const labelSize = 11;
    const labelWidth = font.widthOfTextAtSize(paint.label.toUpperCase(), labelSize);
    const labelX = paint.align === "center" ? (IDENTITY_POSTER_PAGE.width - labelWidth) / 2 : textX;
    page.drawText(paint.label.toUpperCase(), {
      x: labelX,
      y: top + 28,
      size: labelSize,
      font,
      color: paint.accent,
    });
  }

  if (args.template === "classic") {
    drawRule(page, IDENTITY_POSTER_PAGE.width / 2 - 54, top + 16, 108, paint.accent);
  }

  layout.lines.forEach((line, index) => {
    const baseline = top - (index + 1) * layout.fontSize * layout.leading + layout.fontSize * 0.2;
    if (!line) return;
    const width = font.widthOfTextAtSize(line, layout.fontSize);
    const x = paint.align === "center" ? (IDENTITY_POSTER_PAGE.width - width) / 2 : textX;
    page.drawText(line, {
      x,
      y: baseline,
      size: layout.fontSize,
      font,
      color: paint.ink,
    });
  });

  if (args.template === "classic") {
    drawRule(page, IDENTITY_POSTER_PAGE.width / 2 - 54, top - blockHeight - 8, 108, paint.accent);
  }

  if (args.template === "minimal") {
    page.drawRectangle({
      x: textX,
      y: top - blockHeight - 18,
      width: 72,
      height: 0.75,
      color: paint.accent,
    });
  }

  const brandSize = 10;
  const brandWidth = brandFont.widthOfTextAtSize(BRAND, brandSize);
  const brandX = paint.align === "center" ? (IDENTITY_POSTER_PAGE.width - brandWidth) / 2 : textX;
  page.drawText(BRAND, {
    x: brandX,
    y: paint.marginBottom * 0.45,
    size: brandSize,
    font: brandFont,
    color: paint.brand,
  });

  const issuedAt = new Date("2026-01-01T00:00:00.000Z");
  pdf.setCreationDate(issuedAt);
  pdf.setModificationDate(issuedAt);
  return pdf.save();
}

function drawRule(page: PDFPage, x: number, y: number, width: number, color: ReturnType<typeof hexColor>) {
  page.drawRectangle({ x, y, width, height: 0.8, color });
}

export function posterLinesPreserveIdentity(identity: string, lines: string[]): boolean {
  return lines.join("") === identity.replace(/\r\n|\n|\r/g, "");
}
