import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toPngMock = vi.fn();

vi.mock("html-to-image", () => ({
  toPng: (...args: unknown[]) => toPngMock(...args),
}));

import {
  downloadVictoryProofPng,
  VICTORY_PROOF_EXPORT_HEIGHT,
  VICTORY_PROOF_EXPORT_WIDTH,
} from "@/lib/victory-proof-export-image";

describe("downloadVictoryProofPng", () => {
  beforeEach(() => {
    toPngMock.mockReset();
    toPngMock.mockResolvedValue("data:image/png;base64,AAAA");

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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        blob: () => Promise.resolve(new Blob(["x"], { type: "image/png" })),
      })
    );
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("window", {
      setTimeout: (fn: () => void) => {
        fn();
        return 0;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes opacity 1 on the cloned export root to html-to-image toPng", async () => {
    const node = {} as HTMLElement;

    const result = await downloadVictoryProofPng(node, "victory-card.png");

    expect(result).toEqual({ ok: true });
    expect(toPngMock).toHaveBeenCalledTimes(1);

    const [, options] = toPngMock.mock.calls[0] as [HTMLElement, Record<string, unknown>];
    expect(options.width).toBe(VICTORY_PROOF_EXPORT_WIDTH);
    expect(options.height).toBe(VICTORY_PROOF_EXPORT_HEIGHT);
    expect(options.pixelRatio).toBe(2);
    expect(options.cacheBust).toBe(true);
    expect(options.backgroundColor).toBe("#0a0e16");
    expect(options.style).toEqual({
      transform: "none",
      opacity: "1",
    });
  });
});
