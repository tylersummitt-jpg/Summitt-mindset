/**
 * ======================================================
 * Page Image Assignments (Scalable)
 * ======================================================
 *
 * Central config for hero/section images per page.
 * Add entries as new pages get images — no refactor needed.
 *
 * Paths are relative to /public (e.g. /brand/pat-hero.jpeg).
 */

export type PageImageEntry = {
  src: string;
  alt: string;
  grayscale?: boolean;
};

/** Key = pathname (e.g. "/about", "/daily-practice") */
export const PAGE_IMAGES: Record<string, PageImageEntry> = {
  "/about": {
    src: "/brand/about-leadership.jpg",
    alt: "Coach Pat Summitt leading from the bench",
  },
  "/daily-practice": {
    src: "/brand/daily-practice-intensity.jpg",
    alt: "Coach Pat Summitt focused during practice",
  },
  "/ask-pat-preview": {
    src: "/brand/ask-pat-coaching.jpg",
    alt: "Coach Pat Summitt coaching and guiding a player",
  },
  "/film-room-preview": {
    src: "/brand/pat-bench.jpeg",
    alt: "Coach Pat Summitt coaching",
  },
  "/pat-summitt-leadership-challenge": {
    src: "/brand/pat-bench.jpeg",
    alt: "Coach Pat Summitt",
  },
  "/subscribe": {
    src: "/brand/pat-bench.jpeg",
    alt: "Coach Pat Summitt on the bench",
  },
  "/coach-leadership-kit": {
    src: "/brand/pat-hero.jpeg",
    alt: "Coach Pat Summitt leadership",
  },
};

export function getPageImage(pathname: string): PageImageEntry | null {
  return PAGE_IMAGES[pathname] ?? null;
}
