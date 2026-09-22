import { utBody, utBodyMuted } from "@/components/utility-page-visual";
import { programsQuote } from "./programs-visual";

const ATTRIBUTION = /^[—–]\s+\S.{0,80}$/;

export type ProgramsProseBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string; attribution: string };

export function splitProgramsProse(text: string): ProgramsProseBlock[] {
  const parts = text
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const blocks: ProgramsProseBlock[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const next = parts[index + 1];
    if (!part) continue;
    if (next && ATTRIBUTION.test(next)) {
      blocks.push({
        kind: "quote",
        text: part,
        attribution: next.replace(/^[—–]\s+/, ""),
      });
      index += 1;
      continue;
    }
    blocks.push({ kind: "paragraph", text: part });
  }
  return blocks;
}

export function ProgramsProse({ text }: { text: string }) {
  const blocks = splitProgramsProse(text);
  return (
    <div className="space-y-5">
      {blocks.map((block, index) =>
        block.kind === "quote" ? (
          <blockquote key={`${index}-${block.attribution}`} className={programsQuote}>
            <p className={`${utBody} text-stone-100`}>{block.text}</p>
            <footer className={`mt-3 ${utBodyMuted}`}>— {block.attribution}</footer>
          </blockquote>
        ) : (
          <p
            key={`${index}-${block.text.slice(0, 24)}`}
            className={`${utBody} whitespace-pre-wrap break-words`}
          >
            {block.text}
          </p>
        )
      )}
    </div>
  );
}
