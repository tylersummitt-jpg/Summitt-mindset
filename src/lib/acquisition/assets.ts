import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { parseAcquisitionAsset, type AcquisitionAsset } from "@/lib/acquisition/model";

export const ACQUISITION_ASSET_FILES: Record<
  AcquisitionAsset,
  { filename: string; relativePath: string; label: string }
> = {
  definite_dozen: {
    filename: "pat-summitt-definite-dozen-team-discussion-guide.pdf",
    relativePath: "data/acquisition-assets/pat-summitt-definite-dozen-team-discussion-guide.pdf",
    label: "Pat Summitt Definite Dozen team discussion guide",
  },
  playbook: {
    filename: "pat-summitt-basketball-special-situations-playbook.pdf",
    relativePath: "data/acquisition-assets/pat-summitt-basketball-special-situations-playbook.pdf",
    label: "Pat Summitt basketball special-situations playbook",
  },
};

export function acquisitionAssetPath(asset: AcquisitionAsset, root = process.cwd()): string {
  return path.join(root, ACQUISITION_ASSET_FILES[asset].relativePath);
}

export async function readAcquisitionAsset(
  asset: AcquisitionAsset,
  root = process.cwd()
): Promise<Buffer | null> {
  const file = acquisitionAssetPath(asset, root);
  try {
    await access(file);
  } catch {
    return null;
  }
  const bytes = await readFile(file);
  if (bytes.length < 5 || bytes.subarray(0, 4).toString("utf8") !== "%PDF") return null;
  return bytes;
}

export function knownAssetOrNull(value: unknown): AcquisitionAsset | null {
  return parseAcquisitionAsset(value);
}
