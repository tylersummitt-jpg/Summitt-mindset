function normalizeLine(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/g, "");
}

/**
 * Drop a list that only repeats the titles of an adjacent reveal.
 * Introductory and summary sentences stay.
 */
export function proseBesideReveal(markdown: string, sectionTitles: readonly string[]): string {
  const titles = new Set(sectionTitles.map(normalizeLine).filter(Boolean));
  if (titles.size === 0) return markdown.trim();
  const kept = markdown
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !titles.has(normalizeLine(part)));
  return kept.join("\n\n").trim();
}

const STACK_INSTRUCTION = /stack of cards|sort the cards|\bdrag\b/i;

/**
 * Source sort instructions sometimes describe a card stack or drag interaction.
 * The native activity shows one item and category buttons, so those mechanics
 * are rewritten and the category meaning is kept.
 */
export function nativeSortDirections(prompt: string, categories: readonly string[]): string {
  const text = prompt.trim();
  if (!STACK_INSTRUCTION.test(text)) return text;
  const [first, second] = categories;
  if (first && second && categories.length === 2) {
    return `You'll see one item at a time. Decide whether it belongs with “${first}” or “${second}.”`;
  }
  return "You'll see one item at a time. Choose the category it belongs in.";
}
