"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
        requestAnimationFrame(() => resolve());
      });
      const result = await downloadVictoryProofPng(el, "victory-proof.png");
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="victory-share-title"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <h2 id="victory-share-title" className="text-sm font-semibold text-gray-900">
            Proof to share
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          >
            Close
          </button>
        </div>

        <div className="border-l-4 border-l-stone-500 bg-stone-50/90 px-4 py-4">
          <p className="text-base font-medium text-gray-900">{snippet.title}</p>
          {snippet.identityLine ? (
            <p className="mt-1 text-sm leading-relaxed text-gray-700">{snippet.identityLine}</p>
          ) : null}
          <p className="mt-4 text-base leading-relaxed text-gray-900">{snippet.body}</p>
          {snippet.barLine ? (
            <p className="mt-4 text-sm leading-relaxed text-gray-600">{snippet.barLine}</p>
          ) : null}
          <p className="mt-4 text-xs text-gray-500">{snippet.attribution}</p>
        </div>

        <p className="px-4 pb-2 text-[11px] leading-snug text-gray-500">
          You&apos;re copying what you chose from your private Victory Room. Nothing posts automatically.
        </p>

        <div className="flex flex-col gap-2 border-t border-gray-100 px-4 py-3 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            onClick={handleCopy}
            disabled={exportLoading}
            className="rounded-lg bg-[var(--brand)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:bg-gray-400 disabled:opacity-100 disabled:hover:opacity-100"
          >
            Copy to clipboard
          </button>
          <button
            type="button"
            onClick={handleDownloadImage}
            disabled={exportLoading}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50"
          >
            {exportLoading ? "Preparing image…" : "Download image"}
          </button>
          {copyState === "copied" ? (
            <p className="self-center text-sm text-green-700">Copied.</p>
          ) : null}
          {copyState === "error" ? (
            <p className="self-center text-sm text-amber-800">
              Couldn&apos;t copy automatically — select the text in the card above and copy manually.
            </p>
          ) : null}
          {exportError ? <p className="w-full text-sm text-amber-800">{exportError}</p> : null}
        </div>

        <VictoryProofExportFrame ref={exportRef} snippet={snippet} />
      </div>
    </div>
  );
}
