import { utBody, utBodyMuted } from "@/components/utility-page-visual";
import { programsQuote, programsSectionCard } from "@/components/programs/programs-visual";
import type {
  LearningCalloutBlock,
  LearningHeadingBlock,
  LearningListBlock,
  LearningProcessBlock,
  LearningTableBlock,
} from "@/lib/learning/curriculum-types";

export function ProgramsHeading({ block }: { block: LearningHeadingBlock }) {
  const className =
    block.level === 2
      ? "text-2xl font-semibold tracking-tight text-balance text-stone-50"
      : "text-xl font-semibold tracking-tight text-balance text-stone-100";
  if (block.level === 2) {
    return <h2 className={className}>{block.text}</h2>;
  }
  return <h3 className={className}>{block.text}</h3>;
}

export function ProgramsList({ block }: { block: LearningListBlock }) {
  const items = block.items.map((item) => (
    <li key={item} className={`${utBody} break-words text-stone-100`}>
      {item}
    </li>
  ));
  const className = "list-outside space-y-2 pl-6";
  if (block.ordered) {
    return <ol className={`${className} list-decimal`}>{items}</ol>;
  }
  return <ul className={`${className} list-disc`}>{items}</ul>;
}

export function ProgramsTable({ block }: { block: LearningTableBlock }) {
  return (
    <figure className="min-w-0">
      {block.caption ? <figcaption className={`mb-3 ${utBodyMuted}`}>{block.caption}</figcaption> : null}
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-left text-sm text-stone-100">
          <thead>
            <tr>
              {block.headers.map((header) => (
                <th key={header} className="border-b border-white/15 px-3 py-2 font-semibold">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.join("|")}>
                {row.map((cell, index) => (
                  <td key={`${block.headers[index]}-${cell}`} className="border-b border-white/10 px-3 py-2 align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

export function ProgramsCallout({ block }: { block: LearningCalloutBlock }) {
  return <p className={programsQuote}>{block.text}</p>;
}

export function ProgramsProcess({ block }: { block: LearningProcessBlock }) {
  return (
    <ol className="space-y-4">
      {block.steps.map((step, index) => (
        <li key={step.title} className={`${programsSectionCard} min-w-0`}>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--brand)]">
            {index + 1}. {step.title}
          </p>
          <p className={`mt-3 ${utBody} break-words text-stone-100`}>{step.body}</p>
        </li>
      ))}
    </ol>
  );
}
