import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseAcquisitionAsset, type AcquisitionAsset } from "@/lib/acquisition/model";

/** File keys. `definite_dozen_ad` is not a legacy `requested_asset` value. */
export const ACQUISITION_FILE_KEYS = ["definite_dozen", "playbook", "definite_dozen_ad"] as const;
export type AcquisitionFileKey = (typeof ACQUISITION_FILE_KEYS)[number];

export const ACQUISITION_ASSET_FILES: Record<
  AcquisitionFileKey,
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
  definite_dozen_ad: {
    filename: "pat-summitt-definite-dozen-athletic-director-discussion-guide.pdf",
    relativePath: "data/acquisition-assets/pat-summitt-definite-dozen-athletic-director-discussion-guide.pdf",
    label: "Pat Summitt Definite Dozen athletic director discussion guide",
  },
};

export type AcquisitionAssetRead = {
  asset: AcquisitionFileKey;
  readable: boolean;
  byteLength: number;
  pdfHeaderValid: boolean;
};

export function acquisitionAssetPath(asset: AcquisitionFileKey, root = process.cwd()): string {
  return path.join(root, ACQUISITION_ASSET_FILES[asset].relativePath);
}

export function pdfHeaderValid(bytes: Buffer): boolean {
  return bytes.length >= 5 && bytes.subarray(0, 4).toString("utf8") === "%PDF";
}

async function readAssetBytes(asset: AcquisitionFileKey, root: string): Promise<Buffer | null> {
  try {
    return await readFile(acquisitionAssetPath(asset, root));
  } catch {
    return null;
  }
}

export async function readAcquisitionAsset(
  asset: AcquisitionFileKey,
  root = process.cwd()
): Promise<Buffer | null> {
  const bytes = await readAssetBytes(asset, root);
  if (!bytes || !pdfHeaderValid(bytes)) return null;
  return bytes;
}

export async function readAcquisitionAssetReport(
  root = process.cwd()
): Promise<Record<AcquisitionFileKey, AcquisitionAssetRead>> {
  const report = {} as Record<AcquisitionFileKey, AcquisitionAssetRead>;
  for (const asset of ACQUISITION_FILE_KEYS) {
    const bytes = await readAssetBytes(asset, root);
    report[asset] = {
      asset,
      readable: bytes !== null,
      byteLength: bytes?.length ?? 0,
      pdfHeaderValid: bytes ? pdfHeaderValid(bytes) : false,
    };
  }
  return report;
}

export function knownAssetOrNull(value: unknown): AcquisitionAsset | null {
  return parseAcquisitionAsset(value);
}
