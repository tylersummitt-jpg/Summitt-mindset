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

export type AcquisitionOffer = {
  assets: AcquisitionFileKey[];
  label: string | null;
};

const OFFER_KEY = /^[a-z0-9_]{1,64}$/;
const MAX_OFFERS = 20;
const MAX_OFFER_ASSETS = 4;
const MAX_OFFER_LABEL = 120;

export function parseAcquisitionOffers(value: unknown): Map<string, AcquisitionOffer> {
  const offers = new Map<string, AcquisitionOffer>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return offers;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, MAX_OFFERS)) {
    if (!OFFER_KEY.test(key) || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    if (!Array.isArray(record.assets) || record.assets.length === 0 || record.assets.length > MAX_OFFER_ASSETS) continue;
    const assets: AcquisitionFileKey[] = [];
    const seen = new Set<string>();
    let valid = true;
    for (const item of record.assets) {
      if (typeof item !== "string" || !ACQUISITION_FILE_KEYS.includes(item as AcquisitionFileKey) || seen.has(item)) {
        valid = false;
        break;
      }
      seen.add(item);
      assets.push(item as AcquisitionFileKey);
    }
    if (!valid) continue;
    let label: string | null = null;
    if (record.label != null) {
      if (typeof record.label !== "string") continue;
      const trimmed = record.label.trim();
      if (!trimmed || trimmed.length > MAX_OFFER_LABEL) continue;
      label = trimmed;
    }
    offers.set(key, { assets, label });
  }
  return offers;
}

export function assignInterestFulfillment(args: {
  currentOfferKey: string | null;
  currentAsset: AcquisitionAsset | null;
  campaignValue: unknown;
  offers: ReadonlyMap<string, AcquisitionOffer>;
}): { offerKeyToStore: string | null; assetToStore: AcquisitionAsset | null; hasFulfillment: boolean } {
  if (args.currentOfferKey || args.currentAsset) {
    return { offerKeyToStore: null, assetToStore: null, hasFulfillment: true };
  }
  const asset = parseAcquisitionAsset(args.campaignValue);
  if (asset) return { offerKeyToStore: null, assetToStore: asset, hasFulfillment: true };
  if (typeof args.campaignValue === "string" && args.offers.has(args.campaignValue)) {
    return { offerKeyToStore: args.campaignValue, assetToStore: null, hasFulfillment: true };
  }
  return { offerKeyToStore: null, assetToStore: null, hasFulfillment: false };
}

export function resolveSendAssets(args: {
  offerKey: string | null;
  requestedAsset: AcquisitionAsset | null;
  offers: ReadonlyMap<string, AcquisitionOffer>;
}): { assets: AcquisitionFileKey[]; label: string | null } | null {
  if (args.offerKey) {
    const offer = args.offers.get(args.offerKey);
    if (!offer || offer.assets.length === 0) return null;
    return { assets: [...offer.assets], label: offer.label };
  }
  if (args.requestedAsset) return { assets: [args.requestedAsset], label: null };
  return null;
}

/** Promise for this campaign only. A stored person offer does not replace it. */
export function resolveCampaignPromise(args: {
  campaignValue: unknown;
  offers: ReadonlyMap<string, AcquisitionOffer>;
}): { offerKey: string | null; assets: AcquisitionFileKey[]; label: string | null } | null {
  const asset = parseAcquisitionAsset(args.campaignValue);
  if (asset) return { offerKey: null, assets: [asset], label: null };
  if (typeof args.campaignValue !== "string" || !args.offers.has(args.campaignValue)) return null;
  const offer = args.offers.get(args.campaignValue);
  if (!offer || offer.assets.length === 0) return null;
  return { offerKey: args.campaignValue, assets: [...offer.assets], label: offer.label };
}

/** Application catalog check. The database stores the snapshot without naming the files. */
export function parsePromisedAssetKeys(value: unknown): AcquisitionFileKey[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return null;
  const keys: AcquisitionFileKey[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || seen.has(item) || !ACQUISITION_FILE_KEYS.includes(item as AcquisitionFileKey)) return null;
    seen.add(item);
    keys.push(item as AcquisitionFileKey);
  }
  return keys;
}

export async function loadBundleFiles(
  keys: readonly AcquisitionFileKey[],
  root = process.cwd()
): Promise<Array<{ filename: string; label: string; bytes: Buffer }> | null> {
  if (keys.length === 0) return null;
  const files: Array<{ filename: string; label: string; bytes: Buffer }> = [];
  for (const key of keys) {
    const bytes = await readAcquisitionAsset(key, root);
    if (!bytes) return null;
    const meta = ACQUISITION_ASSET_FILES[key];
    files.push({ filename: meta.filename, label: meta.label, bytes });
  }
  return files;
}
