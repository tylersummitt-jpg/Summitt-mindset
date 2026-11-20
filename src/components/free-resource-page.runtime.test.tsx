import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FreeResourcePage } from "@/components/free-resource-page";
import { BASKETBALL_PLAYBOOK_PAGE, DEFINITE_DOZEN_PAGE } from "@/lib/free-pdf";

afterEach(() => {
  cleanup();
});

describe("free resource page", () => {
  it("offers one basketball download and a secondary trial link", () => {
    render(<FreeResourcePage page={BASKETBALL_PLAYBOOK_PAGE} trialHref="/checkout/start" />);

    expect(screen.getByRole("heading", { level: 1, name: "Pat Summitt basketball playbook" })).toBeTruthy();
    expect(screen.getByText(/Mastering Special Situations/)).toBeTruthy();
    expect(screen.getByText(/full-court pressure/)).toBeTruthy();
    const download = screen.getByRole("link", { name: "Download the free basketball playbook PDF" });
    expect(download.getAttribute("href")).toBe("/free/basketball-playbook/download");
    expect(download.textContent).toBe("Download Free PDF");
    expect(screen.getByRole("link", { name: "Start a 7-day free trial" }).getAttribute("href")).toBe(
      "/checkout/start"
    );
    expect(screen.getByText(/payment card/)).toBeTruthy();
    expect(screen.getByText(/\$29\/month/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("offers one Definite Dozen team guide download", () => {
    render(
      <FreeResourcePage
        page={DEFINITE_DOZEN_PAGE}
        trialHref="/checkout/start?ac=camp_1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      />
    );

    expect(screen.getByRole("heading", { level: 1, name: "Definite Dozen discussion guide" })).toBeTruthy();
    expect(screen.getByText(/team discussion guide/)).toBeTruthy();
    expect(screen.queryByText(/athletic director discussion guide/i)).toBeNull();
    const download = screen.getByRole("link", { name: "Download the free Definite Dozen discussion guide PDF" });
    expect(download.getAttribute("href")).toBe("/free/definite-dozen/team/download");
    expect(download.textContent).toBe("Download Free PDF");
    expect(screen.getAllByRole("link", { name: /Download the free/ })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Start a 7-day free trial" }).getAttribute("href")).toContain(
      "/checkout/start?ac="
    );
  });
});
