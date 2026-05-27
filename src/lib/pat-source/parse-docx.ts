import mammoth from "mammoth";

import { cleanParagraphText } from "@/lib/pat-source/clean";

export type DocxBlock = {
  type: "heading" | "paragraph";
  text: string;
  level?: number;
};

/** Parse mammoth HTML output into ordered heading/paragraph blocks. */
export function parseHtmlToBlocks(html: string): DocxBlock[] {
  const blocks: DocxBlock[] = [];
  const tagRe = /<(h[1-6]|p)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(html)) !== null) {
    const tag = match[1]!.toLowerCase();
    const inner = decodeHtmlEntities(stripHtmlTags(match[2] ?? ""));
    const text = cleanParagraphText(inner);
    if (!text) continue;

    if (tag.startsWith("h")) {
      const level = parseInt(tag.slice(1), 10);
      blocks.push({ type: "heading", text, level });
    } else {
      blocks.push({ type: "paragraph", text });
    }
  }

  if (blocks.length === 0) {
    const plain = cleanParagraphText(stripHtmlTags(html));
    if (plain) {
      for (const para of plain.split(/\n\n+/)) {
        const t = cleanParagraphText(para);
        if (t) blocks.push({ type: "paragraph", text: t });
      }
    }
  }

  return blocks;
}

function stripHtmlTags(html: string): string {
  return html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export async function parseDocxFileToBlocks(filePath: string): Promise<DocxBlock[]> {
  const result = await mammoth.convertToHtml({ path: filePath });
  return parseHtmlToBlocks(result.value);
}

/** Best-effort parser version label for manifest (not used at runtime in app). */
export function getMammothVersionLabel(): string {
  return "1.9.0";
}
