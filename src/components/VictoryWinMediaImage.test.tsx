/** @vitest-environment jsdom */

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VictoryWinCard } from "@/components/VictoryWinCard";
import { VictoryWinMediaImage } from "@/components/VictoryWinMediaImage";

describe("VictoryWinCard media display", () => {
  it("1. no media = existing rendering (no img)", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryWinCard, {
        displayTitle: "Owned the apology",
        displayBody: "You repaired the moment with honesty.",
        dateLabel: "Aug 1, 2026",
        supportingQuote: "I apologized today",
        celebrationAppropriate: true,
      })
    );

    expect(html).toContain("Owned the apology");
    expect(html).toContain("You repaired the moment with honesty.");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Photo attached to this win");
    expect(html).not.toContain("Replace");
    expect(html).not.toContain("Remove");
    expect(html).not.toContain("storage_card_path");
  });

  it("2–7. media renders before body with cardUrl, size, alt; text remains", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryWinCard, {
        displayTitle: "Smoke win",
        displayBody: "Body stays primary.",
        dateLabel: "Aug 10, 2026",
        media: {
          id: "media-1",
          cardUrl: "https://signed.example/card.jpg?token=abc",
          width: 1280,
          height: 960,
        },
      })
    );

    expect(html).toContain("<img");
    expect(html).toContain('src="https://signed.example/card.jpg?token=abc"');
    expect(html).toContain('width="1280"');
    expect(html).toContain('height="960"');
    expect(html).toContain('alt="Photo attached to this win"');
    expect(html).toContain("h-auto w-full");
    expect(html).toContain("rounded-xl");
    expect(html).toContain("Smoke win");
    expect(html).toContain("Body stays primary.");

    const imgIdx = html.indexOf("<img");
    const bodyIdx = html.indexOf("Body stays primary.");
    expect(imgIdx).toBeGreaterThan(-1);
    expect(bodyIdx).toBeGreaterThan(imgIdx);

    expect(html).not.toContain("storage_card_path");
    expect(html).not.toContain("storage_master_path");
    expect(html).not.toContain("Replace");
    expect(html).not.toContain("Remove");
    expect(html).not.toContain("proof photo");
  });
});

describe("VictoryWinMediaImage", () => {
  it("renders plain img with responsive classes and exact alt", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryWinMediaImage, {
        cardUrl: "https://signed.example/x.jpg",
        width: 800,
        height: 600,
      })
    );
    expect(html).toContain("<img");
    expect(html).toContain('src="https://signed.example/x.jpg"');
    expect(html).toContain('alt="Photo attached to this win"');
    expect(html).toContain("h-auto w-full");
    expect(html).toContain("rounded-xl");
  });

  it("8. onError hides image only", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(
          "div",
          null,
          React.createElement("p", null, "Win text"),
          React.createElement(VictoryWinMediaImage, {
            cardUrl: "https://signed.example/broken.jpg",
            width: 100,
            height: 80,
          })
        )
      );
    });

    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(container.textContent).toContain("Win text");

    await act(async () => {
      img!.dispatchEvent(new Event("error"));
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("Win text");

    root.unmount();
    container.remove();
  });

  it("source uses img not next/image import", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/VictoryWinMediaImage.tsx"),
      "utf8"
    );
    expect(src).toContain('"use client"');
    expect(src).toContain("<img");
    expect(src).toContain("onError");
    expect(src).not.toMatch(/from\s+["']next\/image["']/);
  });
});

describe("VictoryWinCard regression without media", () => {
  it("keeps title/body/date/quote behavior", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryWinCard, {
        displayTitle: "Owned the apology",
        displayBody: "You repaired the moment with honesty.",
        dateLabel: "Aug 1, 2026",
        supportingQuote: "I apologized today",
        celebrationAppropriate: true,
      })
    );
    expect(html).toContain("Owned the apology");
    expect(html).not.toContain("Kept the goal");
    expect(html).not.toContain("Share");
  });
});
