/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emptyUnknownSnapshot,
  SUBSCRIBER_GROWTH_TZ,
  type SubscriberGrowthDashboardData,
  type TrafficSourceRow,
} from "@/lib/admin-subscriber-growth-pure";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => React.createElement("a", { href, ...rest }, children),
}));

import SubscriberGrowthDashboard from "./subscriber-growth-dashboard";

function organicRow(
  partial: Partial<TrafficSourceRow> & { platform: string; utmContent: string }
): TrafficSourceRow {
  return {
    sourceNormalized: "organic_social",
    utmCampaign: "organic",
    visitors: 84,
    accounts: 11,
    trialsStarted: 4,
    activated: 3,
    paidConversions: 2,
    advertisingSpendCents: 0,
    costPerPaidCents: null,
    ...partial,
  };
}

function dashboardData(
  trafficRows: TrafficSourceRow[]
): SubscriberGrowthDashboardData {
  const snapshot = emptyUnknownSnapshot();
  return {
    range: "last_7",
    source: "organic_social",
    timezone: SUBSCRIBER_GROWTH_TZ,
    asOfNowLabel: "Sep 9, 2026",
    snapshot: {
      ...snapshot,
      trafficRows,
      notes: {
        ...snapshot.notes,
        sourceTrackingUnavailable: false,
      },
    },
    warnings: [],
    adSpendEntries: [],
  };
}

describe("subscriber growth organic platform table", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders desktop columns including Platform and Accounts", () => {
    render(
      <SubscriberGrowthDashboard
        data={dashboardData([
          organicRow({ platform: "Instagram", utmContent: "story_psm047" }),
          organicRow({
            platform: "Facebook",
            utmContent: "bio",
            visitors: 10,
            accounts: 2,
            trialsStarted: 1,
            activated: 1,
            paidConversions: 0,
          }),
        ])}
      />
    );

    expect(screen.getByText("Platform")).toBeTruthy();
    expect(screen.getByText("Post / Link")).toBeTruthy();
    expect(screen.getAllByText("Accounts").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Instagram").length).toBeGreaterThan(0);
    expect(screen.getAllByText("story_psm047").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Facebook").length).toBeGreaterThan(0);
    expect(screen.queryByText("Specific advertisement")).toBeNull();
  });

  it("keeps mobile cards compact instead of a wide table", () => {
    render(
      <SubscriberGrowthDashboard
        data={dashboardData([
          organicRow({ platform: "Instagram", utmContent: "story_psm047" }),
        ])}
      />
    );

    const mobile = document.querySelector(".md\\:hidden");
    expect(mobile).toBeTruthy();
    expect(mobile?.querySelector("table")).toBeNull();
    const card = within(mobile as HTMLElement);
    expect(card.getByText("Instagram")).toBeTruthy();
    expect(card.getByText("story_psm047")).toBeTruthy();
    expect(card.getByText("Visitors")).toBeTruthy();
    expect(card.getByText("Accounts")).toBeTruthy();
    expect(card.getByText("Trials")).toBeTruthy();
    expect(card.getByText("Campaign: organic")).toBeTruthy();
  });

  it("shows — for non-organic and missing organic platforms", () => {
    render(
      <SubscriberGrowthDashboard
        data={dashboardData([
          {
            sourceNormalized: "meta",
            platform: "",
            utmCampaign: "spring",
            utmContent: "ad1",
            visitors: 3,
            accounts: 1,
            trialsStarted: 1,
            activated: 1,
            paidConversions: 1,
            advertisingSpendCents: null,
            costPerPaidCents: null,
          },
          organicRow({ platform: "", utmContent: "bio", visitors: 5, accounts: 0 }),
        ])}
      />
    );

    expect(screen.getAllByText("Meta ads").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Organic social").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
