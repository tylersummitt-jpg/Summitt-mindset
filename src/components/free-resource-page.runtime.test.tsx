import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FreeResourcePage } from "@/components/free-resource-page";

afterEach(() => {
  cleanup();
});

describe("free resource page", () => {
  it("shows only the playbook title and one download", () => {
    render(
      <FreeResourcePage
        title="Free Pat Summitt Playbook"
        download={{
          href: "/free/basketball-playbook/download",
          filename: "pat-summitt-basketball-special-situations-playbook.pdf",
          actionLabel: "Download the free basketball playbook PDF",
        }}
      />
    );

    expect(screen.getByText("A gift from Summitt Mindset")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Free Pat Summitt Playbook" })).toBeTruthy();
    expect(screen.getByText("Yours to keep. No signup required.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Want to take it a step further?" })).toBeTruthy();
    expect(screen.getByText(/They were meant to be lived/)).toBeTruthy();
    expect(screen.queryByText(/free resource/i)).toBeNull();
    expect(screen.queryByText(/pat-summitt-basketball/i)).toBeNull();
    const download = screen.getByRole("link", { name: "Download the free basketball playbook PDF" });
    expect(download.getAttribute("href")).toBe("/free/basketball-playbook/download");
    expect(download.textContent).toBe("Download Free PDF");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows only the team guide title and one download", () => {
    render(
      <FreeResourcePage
        title="Free Definite Dozen Discussion Guide"
        download={{
          href: "/free/definite-dozen/team/download",
          filename: "pat-summitt-definite-dozen-team-discussion-guide.pdf",
          actionLabel: "Download the free Definite Dozen discussion guide PDF",
        }}
      />
    );

    expect(screen.getByText("A gift from Summitt Mindset")).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 1, name: "Free Definite Dozen Discussion Guide" })
    ).toBeTruthy();
    expect(screen.getByText("Yours to keep. No signup required.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Want to take it a step further?" })).toBeTruthy();
    expect(screen.queryByText(/athletic director discussion guide/i)).toBeNull();
    const download = screen.getByRole("link", {
      name: "Download the free Definite Dozen discussion guide PDF",
    });
    expect(download.getAttribute("href")).toBe("/free/definite-dozen/team/download");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
