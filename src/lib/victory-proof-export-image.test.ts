import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const html2canvasMock = vi.fn();

vi.mock("html2canvas", () => ({
  default: (...args: unknown[]) => html2canvasMock(...args),
}));

import { VICTORY_CARD_BASE_WIDTH_PX } from "@/lib/victory-card-share-tone";
import {
  downloadVictoryProofPng,
  getVictoryCardCaptureUnsafeFlags,
  VICTORY_PROOF_EXPORT_WIDTH,
} from "@/lib/victory-proof-export-image";

describe("getVictoryCardCaptureUnsafeFlags", () => {
  it("flags opacity zero, visibility hidden, display none, and negative z-index", () => {
    expect(getVictoryCardCaptureUnsafeFlags(null)).toEqual(["missing-node"]);

    expect(
      getVictoryCardCaptureUnsafeFlags({} as HTMLElement, () => ({
        display: "none",
        visibility: "visible",
        opacity: "1",
        zIndex: "0",
      } as CSSStyleDeclaration))
    ).toContain("display-none");

    expect(
      getVictoryCardCaptureUnsafeFlags({} as HTMLElement, () => ({
        display: "block",
        visibility: "hidden",
        opacity: "1",
        zIndex: "0",
      } as CSSStyleDeclaration))
    ).toContain("visibility-hidden");

    expect(
      getVictoryCardCaptureUnsafeFlags({} as HTMLElement, () => ({
        display: "block",
        visibility: "visible",
        opacity: "0",
        zIndex: "0",
      } as CSSStyleDeclaration))
    ).toContain("opacity-zero");

    expect(
      getVictoryCardCaptureUnsafeFlags({} as HTMLElement, () => ({
        display: "block",
        visibility: "visible",
        opacity: "1",
        zIndex: "-1",
      } as CSSStyleDeclaration))
    ).toContain("negative-z-index");
  });

  it("returns no flags for an export-safe capture target", () => {
    expect(
      getVictoryCardCaptureUnsafeFlags({} as HTMLElement, () => ({
        display: "block",
        visibility: "visible",
        opacity: "1",
        zIndex: "auto",
      } as CSSStyleDeclaration))
    ).toEqual([]);
  });
});

describe("downloadVictoryProofPng", () => {
  beforeEach(() => {
    html2canvasMock.mockReset();
    html2canvasMock.mockResolvedValue({
      toDataURL: () => "data:image/png;base64,BBBB",
    });

    const anchor = {
      href: "",
      download: "",
      rel: "",
      click: vi.fn(),
      remove: vi.fn(),
    };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => anchor),
      body: { appendChild: vi.fn() },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses html2canvas on a visible capture node with dark background", async () => {
    const node = {
      offsetWidth: 360,
      clientWidth: 360,
    } as HTMLElement;

    const result = await downloadVictoryProofPng(node, "victory-card.png");

    expect(result).toEqual({ ok: true });
    expect(html2canvasMock).toHaveBeenCalledTimes(1);

    const [target, options] = html2canvasMock.mock.calls[0] as [HTMLElement, Record<string, unknown>];
    expect(target).toBe(node);
    expect(options.backgroundColor).toBe("#04060c");
    expect(options.scale).toBeGreaterThanOrEqual(VICTORY_PROOF_EXPORT_WIDTH / VICTORY_CARD_BASE_WIDTH_PX);
    expect(options.useCORS).toBe(true);
    expect(options.scale).toBeGreaterThanOrEqual(2);
    expect(options.scale).toBeLessThanOrEqual(4);
    expect(Math.round(360 * (options.scale as number))).toBeGreaterThanOrEqual(VICTORY_PROOF_EXPORT_WIDTH);
  });

});
