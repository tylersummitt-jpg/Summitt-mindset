/**
 * Ensures the user's name is used at most once across Coach Pat and Ask Pat outputs.
 * If the text already contains the name, returns it unchanged. Otherwise prepends it.
 */

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function finalizeWithName(text: string, displayName?: string): string {
  if (!displayName) return text;

  const trimmed = (text || "").trim();
  const name = displayName.trim();
  if (!name) return trimmed;

  const nameLower = name.toLowerCase();
  const nameRegex = new RegExp(`\\b${escapeRegExp(nameLower)}\\b`, "i");
  if (nameRegex.test(trimmed)) return trimmed;

  const shouldUseName = Math.random() < 0.4;
  if (!shouldUseName) return trimmed;

  // Avoid double comma if text starts with comma
  const cleanText = trimmed.replace(/^,\s*/, "").trim();

  return `${name}, ${cleanText}`;
}
