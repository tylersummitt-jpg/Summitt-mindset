"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VictoryCardShareLayout } from "@/components/VictoryCardShareLayout";
import { VictoryProofExportFrame } from "@/components/VictoryProofExportFrame";
import { downloadVictoryProofPng } from "@/lib/victory-proof-export-image";
import type { VictoryShareSnippet } from "@/lib/v2-victory-share-snippet";

type VictoryShareCardPreviewProps = {
  snippet: VictoryShareSnippet;
  onClose: () => void;
};

export function VictoryShareCardPreview({ snippet, onClose }: VictoryShareCardPreviewProps) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    setExportError(null);
  }, [snippet.plainText]);

  useEffect(() => {
    if (copyState !== "copied") return;
    const t = setTimeout(() => setCopyState("idle"), 2500);
    return () => clearTimeout(t);
  }, [copyState]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleCopy = useCallback(async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        setCopyState("error");
        return;
      }
      await navigator.clipboard.writeText(snippet.plainText);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }, [snippet.plainText]);

  const handleDownloadImage = useCallback(async () => {
    const el = exportRef.current;
    if (!el) {
      setExportError("Export is not ready. Try again in a moment.");
      return;
    }
    setExportLoading(true);
    setExportError(null);
    try {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      const result = await downloadVictoryProofPng(el, "victory-card.png");
      if (!result.ok) {
        setExportError(result.message);
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Could not generate image.");
    } finally {
      setExportLoading(false);
    }
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="victory-share-title"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-amber-500/30 bg-gradient-to-b from-[#0e131d] to-[#0a0e16] shadow-[0_24px_80px_-24px_rgba(0,0,0,0.9)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-amber-500/20 px-4 py-3 sm:px-5">
          <h2 id="victory-share-title" className="font-serif text-base font-semibold text-stone-50 sm:text-lg">
            Share your Victory Card
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-stone-400 transition hover:bg-white/5 hover:text-stone-200"
          >
            Close
          </button>
        </div>

        <div className="px-4 py-4 sm:px-5">
          <VictoryCardShareLayout snippet={snippet} variant="preview" />
        </div>

        <p className="px-4 pb-2 text-[11px] leading-snug text-stone-400 sm:px-5">
          You choose what to copy or save. Nothing posts from Summitt.
        </p>

        <div className="flex flex-col gap-2 border-t border-amber-500/20 px-4 py-3 sm:flex-row sm:flex-wrap sm:justify-end sm:px-5">
          <button
            type="button"
            onClick={handleCopy}
            disabled={exportLoading}
            className="rounded-lg bg-[var(--brand)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2 focus:ring-offset-[#0a0e16] disabled:cursor-not-allowed disabled:bg-stone-600 disabled:opacity-100"
          >
            Copy caption
          </button>
          <button
            type="button"
            onClick={handleDownloadImage}
            disabled={exportLoading}
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm font-medium text-amber-50 hover:bg-amber-500/20 disabled:opacity-50"
          >
            {exportLoading ? "Preparing image…" : "Save image"}
          </button>
          {copyState === "copied" ? (
            <p className="self-center text-sm text-emerald-400">Copied.</p>
          ) : null}
          {copyState === "error" ? (
            <p className="self-center text-sm text-amber-200">
              Couldn&apos;t copy automatically — select the caption above and copy manually.
            </p>
          ) : null}
          {exportError ? <p className="w-full text-sm text-amber-200">{exportError}</p> : null}
        </div>

        <VictoryProofExportFrame ref={exportRef} snippet={snippet} />
      </div>
    </div>
  );
}
