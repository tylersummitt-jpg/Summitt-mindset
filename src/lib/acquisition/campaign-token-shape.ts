const CAMPAIGN_ID = /^[A-Za-z0-9_-]{1,80}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/;

export function parseAcquisitionCampaignId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return CAMPAIGN_ID.test(id) ? id : null;
}

/** Signed-token shape only. This does not verify the signature. */
export function acquisitionCampaignTokenShape(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = parseAcquisitionCampaignId(token.slice(0, dot));
  const mac = token.slice(dot + 1);
  if (!id || !SIGNATURE.test(mac)) return null;
  return `${id}.${mac}`;
}
