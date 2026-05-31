/**
 * Client-only PNG export for Victory Card share. Captures a visible DOM node via html2canvas.
 */

export const VICTORY_PROOF_EXPORT_WIDTH = 1080;
export const VICTORY_PROOF_EXPORT_HEIGHT = 1350;

export type VictoryProofExportResult =
  | { ok: true }
  | { ok: false; message: string };

/** Flags that make html-to-image / html2canvas likely to produce a blank capture. */
export type VictoryCardCaptureUnsafeFlag =
  | "missing-node"
  | "display-none"
  | "visibility-hidden"
  | "opacity-zero"
  | "negative-z-index";

/**
 * Returns unsafe style flags for a capture target. Empty array means the node is export-safe.
 */
export function getVictoryCardCaptureUnsafeFlags(
  node: HTMLElement | null,
  getComputedStyleFn: (el: Element) => CSSStyleDeclaration = (el) =>
    typeof window !== "undefined" ? window.getComputedStyle(el) : ({} as CSSStyleDeclaration)
): VictoryCardCaptureUnsafeFlag[] {
  if (!node) return ["missing-node"];
  const style = getComputedStyleFn(node);
  const flags: VictoryCardCaptureUnsafeFlag[] = [];
  if (style.display === "none") flags.push("display-none");
  if (style.visibility === "hidden") flags.push("visibility-hidden");
  const opacity = parseFloat(style.opacity);
  if (!Number.isNaN(opacity) && opacity === 0) flags.push("opacity-zero");
  const z = parseInt(style.zIndex, 10);
  if (!Number.isNaN(z) && z < 0) flags.push("negative-z-index");
  return flags;
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Renders the given visible Victory Card DOM node to PNG and triggers a download.
 */
export async function downloadVictoryProofPng(
  node: HTMLElement,
  filename: string = "victory-card.png"
): Promise<VictoryProofExportResult> {
  const unsafe = getVictoryCardCaptureUnsafeFlags(node);
  if (unsafe.length > 0) {
    return { ok: false, message: "Export is not ready. Try again in a moment." };
  }

  try {
    const html2canvas = (await import("html2canvas")).default;
    const width = node.offsetWidth || node.clientWidth;
    const scale =
      width > 0
        ? Math.min(4, Math.max(2, VICTORY_PROOF_EXPORT_WIDTH / width))
        : 2;

    const canvas = await html2canvas(node, {
      useCORS: true,
      scale,
      backgroundColor: "#0a0e16",
      logging: false,
    });

    downloadDataUrl(canvas.toDataURL("image/png"), filename);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not generate image.";
    return { ok: false, message };
  }
}
