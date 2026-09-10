/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emptyUnknownSnapshot,
  SUBSCRIBER_GROWTH_TZ,
  type LatestTrialRow,
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
  trafficRows: TrafficSourceRow[],
  latestTrials: LatestTrialRow[] = []
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
    latestTrials,
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

    expect(screen.getAllByText("Platform").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Post / Link").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Accounts").length).toBeGreaterThan(0);
    expect(screen.getByText("Tracking Link Builder")).toBeTruthy();
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

describe("latest trials person feed", () => {
  afterEach(() => {
    cleanup();
  });

  const signedUpUnix = Math.floor(Date.parse("2026-09-10T00:43:00.000Z") / 1000);

  const attributed: LatestTrialRow = {
    trialStartUnix: signedUpUnix,
    personEmail: "jane@example.com",
    sourceNormalized: "organic_social",
    utmSource: "instagram",
    utmCampaign: "organic",
    utmContent: "story_psm047",
    activated: true,
    paid: false,
  };

  const unattributed: LatestTrialRow = {
    trialStartUnix: signedUpUnix - 60,
    personEmail: null,
    sourceNormalized: null,
    utmSource: null,
    utmCampaign: null,
    utmContent: null,
    activated: false,
    paid: false,
  };

  it("renders desktop columns without Account or Trial and shows email", () => {
    render(
      <SubscriberGrowthDashboard data={dashboardData([], [attributed, unattributed])} />
    );

    const section = document.querySelector("[data-latest-trials]");
    expect(section).toBeTruthy();
    const desktop = section?.querySelector(".hidden.md\\:block") as HTMLElement;
    expect(desktop).toBeTruthy();
    const table = within(desktop);
    expect(table.getByText("Signed Up")).toBeTruthy();
    expect(table.getByText("Person")).toBeTruthy();
    expect(table.getByText("Source")).toBeTruthy();
    expect(table.getByText("Platform")).toBeTruthy();
    expect(table.getByText("Campaign")).toBeTruthy();
    expect(table.getByText("Post / Link")).toBeTruthy();
    expect(table.getByText("Activated")).toBeTruthy();
    expect(table.getByText("Paid")).toBeTruthy();
    expect(table.queryByText("Account")).toBeNull();
    expect(table.queryByText("Trial", { exact: true })).toBeNull();
    expect(table.queryByText("Visitors")).toBeNull();

    expect(table.getByText("jane@example.com")).toBeTruthy();
    expect(table.getByText("Organic social")).toBeTruthy();
    expect(table.getByText("Instagram")).toBeTruthy();
    expect(table.getByText("organic")).toBeTruthy();
    expect(table.getByText("story_psm047")).toBeTruthy();
    expect(table.getByText("✓")).toBeTruthy();
    expect(table.getAllByText("—").length).toBeGreaterThan(0);
    expect(section?.textContent).not.toMatch(/user_[a-z0-9]+/i);
    expect(section?.textContent).not.toMatch(/phoneNumber/);
  });

  it("keeps mobile cards compact and degrades missing identity/attribution", () => {
    render(
      <SubscriberGrowthDashboard data={dashboardData([], [attributed, unattributed])} />
    );

    const section = document.querySelector("[data-latest-trials]") as HTMLElement;
    expect(section).toBeTruthy();
    expect(within(section).getByText("Last 20 people who started a free trial")).toBeTruthy();
    const mobile = section.querySelector(".md\\:hidden") as HTMLElement;
    expect(mobile).toBeTruthy();
    expect(mobile.querySelector("table")).toBeNull();
    const cardRoot = within(mobile);
    expect(cardRoot.getByText("jane@example.com")).toBeTruthy();
    expect(cardRoot.getByText("Instagram · Organic social")).toBeTruthy();
    expect(cardRoot.getByText("Campaign: organic")).toBeTruthy();
    expect(cardRoot.getByText("Post: story_psm047")).toBeTruthy();
    expect(cardRoot.getByText("Activated ✓")).toBeTruthy();
    expect(cardRoot.getAllByText("Paid —").length).toBeGreaterThan(0);
    expect(cardRoot.getByText("Source —")).toBeTruthy();
    expect(cardRoot.getByText("Post / Link —")).toBeTruthy();
  });
});

