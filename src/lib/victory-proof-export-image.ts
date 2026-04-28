/**
 * Client-only PNG export for Victory proof share. Same content as `VictoryShareSnippet` — no AI.
 */

import { toPng } from "html-to-image";

export const VICTORY_PROOF_EXPORT_WIDTH = 1080;
export const VICTORY_PROOF_EXPORT_HEIGHT = 1350;

export type VictoryProofExportResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Renders the given DOM node (export frame) to PNG and triggers a download. Revokes object URL after click.
 */
export async function downloadVictoryProofPng(
  node: HTMLElement,
  filename: string = "victory-proof.png"
): Promise<VictoryProofExportResult> {
  let objectUrl: string | null = null;
  try {
    const dataUrl = await toPng(node, {
      width: VICTORY_PROOF_EXPORT_WIDTH,
      height: VICTORY_PROOF_EXPORT_HEIGHT,
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: "#fafaf9",
      style: {
        transform: "none",
      },
    });

    const res = await fetch(dataUrl);
    const blob = await res.blob();
    objectUrl = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not generate image.";
    return { ok: false, message };
  } finally {
    if (objectUrl) {
      window.setTimeout(() => URL.revokeObjectURL(objectUrl as string), 4000);
    }
  }
}
