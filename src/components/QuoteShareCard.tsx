"use client";

import { useRef } from "react";

type QuoteShareCardProps = {
  quote: string;
  slug?: string;
};

export function QuoteShareCard({ quote, slug }: QuoteShareCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  async function handleDownload() {
    const card = cardRef.current;
    if (!card) return;

    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(card, {
      useCORS: true,
      scale: 2,
      backgroundColor: "#ffffff",
    });

    const link = document.createElement("a");
    link.download = slug
      ? `pat-summitt-${slug}.png`
      : "pat-summitt-quote.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <div className="space-y-4">
      <div
        ref={cardRef}
        className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center max-w-xl mx-auto"
      >
        <p className="text-2xl md:text-3xl leading-relaxed text-gray-900 mb-6">
          {quote}
        </p>
        <p className="text-lg text-gray-600 mb-4">— Pat Summitt</p>
        <p className="text-sm text-gray-400">SummittMindset.com</p>
      </div>
      <div className="flex justify-center">
        <button
          type="button"
          onClick={handleDownload}
          className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Download Quote Image
        </button>
      </div>
    </div>
  );
}
