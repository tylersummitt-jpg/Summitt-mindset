/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { AdLabMetaRefresh } from "./ad-lab-refresh";

afterEach(() => {
  cleanup();
  refresh.mockReset();
  vi.unstubAllGlobals();
});

describe("AdLabMetaRefresh", () => {
  it("shows the last successful import and ignores a second click", async () => {
    let release: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AdLabMetaRefresh
        lastImportedAt="2026-11-13T15:00:00.000Z"
        timezone="America/New_York"
        stale={false}
      />
    );
    expect(screen.getByText(/Last successful import:/)).toBeTruthy();
    const button = screen.getByRole("button", { name: "Refresh Meta Data" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Refreshing Meta data…" })).toBeTruthy();
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    release({
      ok: true,
      json: async () => ({ ok: true, since: "2026-11-12", until: "2026-11-13" }),
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("keeps the stored timestamp on screen when Meta fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          ok: false,
          error: "Meta is temporarily unavailable. The stored results are unchanged.",
        }),
      })
    );
    render(
      <AdLabMetaRefresh lastImportedAt="2026-11-13T15:00:00.000Z" timezone="America/New_York" />
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh Meta Data" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Meta is temporarily unavailable. The stored results are unchanged."
    );
    expect(screen.getByText(/Last successful import:/)).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
