/** @vitest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

import { SubscriberGrowthAdLab } from "./subscriber-growth-ad-lab";

describe("SubscriberGrowthAdLab", () => {
  it("lists more than three ads and does not invent subscriber costs", () => {
    render(
      <SubscriberGrowthAdLab
        view={{
          status: "ready",
          summary: {
            timezone: "America/New_York",
            currency: "USD",
            todayKey: "2026-11-11",
            weekStart: "2026-11-09",
            rangeSince: "2026-11-05",
            rangeUntil: "2026-11-11",
            todaySpendCents: 300,
            weekSpendCents: 900,
            activeCount: null,
            lastImportedAt: "2026-11-11T15:00:00.000Z",
            stale: false,
            ads: [1, 2, 3, 4].map((n) => ({
              metaAdId: `111111111${n}`,
              adName: `Ad ${n}`,
              status: "ACTIVE",
              campaignName: null,
              adsetName: null,
              spendCents: n * 100,
              impressions: 100,
              outboundClicks: n === 1 ? 0 : 5,
              landingPageViews: null,
              outboundCtr: n === 1 ? 0 : 0.05,
            })),
          },
        }}
      />
    );
    expect(screen.getByText("Summitt Ad Lab")).toBeTruthy();
    expect(screen.getByText("Ad 4")).toBeTruthy();
    expect(screen.getByText(/not connected to individual ads yet/)).toBeTruthy();
    expect(screen.queryByText(/cost per trial/i)).toBeNull();
    expect(screen.getAllByText("$3.00").length).toBeGreaterThan(0);
  });

  it("labels a stale import and an empty store without throwing", () => {
    const { rerender } = render(
      <SubscriberGrowthAdLab
        view={{ status: "empty", message: "No Meta delivery has been stored yet." }}
      />
    );
    expect(screen.getByText(/No Meta delivery has been stored yet/)).toBeTruthy();
    rerender(
      <SubscriberGrowthAdLab
        view={{
          status: "ready",
          summary: {
            timezone: "America/New_York",
            currency: "USD",
            todayKey: "2026-11-11",
            weekStart: "2026-11-09",
            rangeSince: "2026-11-11",
            rangeUntil: "2026-11-11",
            todaySpendCents: null,
            weekSpendCents: null,
            activeCount: null,
            lastImportedAt: "2026-11-09T12:00:00.000Z",
            stale: true,
            ads: [],
          },
        }}
      />
    );
    expect(screen.getByText(/A newer import has not succeeded/)).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
