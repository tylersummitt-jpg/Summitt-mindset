"use client";

import { useState } from "react";
import { utBodyMuted } from "@/components/utility-page-visual";
import {
  galleryImageStyle,
  galleryItemClassName,
  galleryLayout,
} from "@/components/programs/programs-image-frame";
import { ProgramsNaturalImage } from "@/components/programs/programs-natural-image";
import {
  programsAccentRule,
  programsBody,
  programsConceptListItem,
  programsInstructionHeading,
  programsQuote,
  programsQuoteAttribution,
  programsQuoteText,
  programsSectionCard,
  programsTableBody,
  programsTableHeader,
} from "@/components/programs/programs-visual";
import type {
  LearningCalloutBlock,
  LearningHeadingBlock,
  LearningListBlock,
  LearningProcessBlock,
  LearningTableBlock,
} from "@/lib/learning/curriculum-types";

export function ProgramsHeading({ block }: { block: LearningHeadingBlock }) {
  if (block.role === "instruction") {
    return <h2 className={programsInstructionHeading}>{block.text}</h2>;
  }
  const className =
    block.level === 2
      ? "text-2xl font-semibold tracking-tight text-balance text-stone-50"
      : "text-xl font-semibold tracking-tight text-balance text-stone-100";
  if (block.level === 2) {
    return (
      <div className="space-y-3">
        <div className={programsAccentRule} aria-hidden="true" />
        <h2 className={className}>{block.text}</h2>
      </div>
    );
  }
  return <h3 className={className}>{block.text}</h3>;
}

export function ProgramsList({ block }: { block: LearningListBlock }) {
  const itemClass =
    block.role === "concepts" ? programsConceptListItem : `${programsBody} break-words`;
  const items = block.items.map((item) => (
    <li key={item} className={itemClass}>
      {item}
    </li>
  ));
  const className = `list-outside space-y-2 pl-6${
    block.role === "concepts" ? " marker:text-[var(--brand)]" : ""
  }`;
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
        <table className={`w-full min-w-[36rem] border-collapse text-left ${programsTableBody}`}>
          <thead>
            <tr>
              {block.headers.map((header) => (
                <th key={header} className={programsTableHeader}>
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
  const parts = block.text
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const attribution = parts.length > 1 ? parts[parts.length - 1] : "";
  const quoted = /^[—–]\s+\S/.test(attribution);
  const text = quoted ? parts.slice(0, -1).join("\n\n") : block.text;
  return (
    <blockquote className={programsQuote}>
      <p className={`${programsQuoteText} whitespace-pre-wrap`}>{text}</p>
      {quoted ? (
        <footer className={programsQuoteAttribution}>{attribution.replace(/^[—–]\s+/, "— ")}</footer>
      ) : null}
    </blockquote>
  );
}

export function ProgramsFlashcards({
  cards,
}: {
  cards: Array<{ id: string; front: string; back: string }>;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="space-y-3">
      {cards.map((card) => {
        const expanded = Boolean(open[card.id]);
        return (
          <section key={card.id} className={programsSectionCard}>
            <h3>
              <button
                type="button"
                className="flex w-full items-start justify-between gap-4 text-left text-base font-semibold text-stone-50"
                aria-expanded={expanded}
                onClick={() =>
                  setOpen((current) => ({ ...current, [card.id]: !current[card.id] }))
                }
              >
                <span>{card.front}</span>
                <span className="text-sm font-medium text-[var(--brand)]">
                  {expanded ? "Hide definition" : "Show definition"}
                </span>
              </button>
            </h3>
            {expanded ? (
              <p className={`mt-4 border-t border-white/10 pt-4 ${programsBody} break-words`}>
                {card.back}
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

export function ProgramsAudio({
  src,
  label,
  transcript,
}: {
  src: string;
  label: string;
  transcript: string;
}) {
  return (
    <figure className={`${programsSectionCard} space-y-4`}>
      <div className={programsAccentRule} aria-hidden="true" />
      <figcaption className="text-base font-semibold text-stone-50">{label}</figcaption>
      <audio className="w-full" controls preload="none">
        <source src={src} type="audio/mpeg" />
      </audio>
      <blockquote className={`${programsBody} break-words`}>{transcript}</blockquote>
    </figure>
  );
}

export function ProgramsGallery({
  label,
  images,
}: {
  label: string;
  images: Array<{ src: string; alt: string; width: number; height: number }>;
}) {
  const layout = galleryLayout(images);
  return (
    <section aria-label={label} className="space-y-4">
      <div className="space-y-3">
        <div className={programsAccentRule} aria-hidden="true" />
        <h3 className="text-xl font-semibold tracking-tight text-stone-100">{label}</h3>
      </div>
      <ul className={layout.listClassName} data-gallery-layout={layout.kind}>
        {images.map((image, index) => (
          <li key={`${image.src}-${index}`} className={galleryItemClassName(image, images)}>
            <ProgramsNaturalImage
              src={image.src}
              alt={image.alt}
              width={image.width}
              height={image.height}
              sizes="(min-width: 640px) 22rem, 100vw"
              className="mx-auto block h-auto w-full rounded-md border border-white/10 object-contain"
              style={galleryImageStyle(image.width, image.height)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ProgramsProcess({ block }: { block: LearningProcessBlock }) {
  return (
    <ol className="space-y-4">
      {block.steps.map((step, index) => (
        <li key={step.title} className={`${programsSectionCard} min-w-0`}>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--brand)]">
            {index + 1}. {step.title}
          </p>
          <p className={`mt-3 ${programsBody} break-words`}>{step.body}</p>
        </li>
      ))}
    </ol>
  );
}
