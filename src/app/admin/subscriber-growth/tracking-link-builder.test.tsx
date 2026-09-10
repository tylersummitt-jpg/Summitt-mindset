/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TrackingLinkBuilder } from "./tracking-link-builder";

describe("TrackingLinkBuilder", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("copies the generated URL through the clipboard API", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<TrackingLinkBuilder />);
    expect(
      screen.getByText(
        "Use the same Campaign name later in Add Ad Spend. Copy utm_campaign exactly."
      )
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(
      screen.getByText(
        "https://summittmindset.com/?utm_source=instagram&utm_medium=organic_social&utm_campaign=organic&utm_content=bio"
      )
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy Link" }));
    expect(writeText).toHaveBeenCalledWith(
      "https://summittmindset.com/?utm_source=instagram&utm_medium=organic_social&utm_campaign=organic&utm_content=bio"
    );
    expect(await screen.findByText("Copied")).toBeTruthy();
  });
});
