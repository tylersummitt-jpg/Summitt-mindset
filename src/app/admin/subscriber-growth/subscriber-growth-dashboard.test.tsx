/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  const firstTouchLabel =
    partial.firstTouchLabel ??
    (partial.platform ? partial.platform : "Organic social");
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
    isPaidAcquisition: false,
    sourceDetail: null,
    referrerHost: null,
    utmSource: null,
    firstTouchLabel,
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
    activationQueryComplete: true,
    latestTrialsActivationComplete: true,
    adSpendQueryComplete: true,
    todayDateKey: "2026-09-09",
    stripeWeek: {
      newPaid: null,
      ended: null,
      net: null,
    },
    currentFreeTrials: {
      onFreeWeekNow: null,
      startedToday: null,
      endsToday: null,
      endsNext7Days: null,
    },
    recentActivity: [],
    recentActivityPaymentFailedIncluded: true,
  };
}

describe("subscriber growth organic platform table", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders desktop columns including First touch and Accounts", () => {
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

    expect(screen.getAllByText("First touch").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Post / ad").length).toBeGreaterThan(0);
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

  it("shows Meta ads and Organic social first-touch labels", () => {
    render(
      <SubscriberGrowthDashboard
        data={dashboardData([
          {
            sourceNormalized: "meta",
            platform: "",
            firstTouchLabel: "Meta ads",
            isPaidAcquisition: true,
            sourceDetail: null,
            referrerHost: null,
            utmSource: "facebook",
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
    isPaidAcquisition: false,
    sourceDetail: null,
    referrerHost: null,
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
    isPaidAcquisition: false,
    sourceDetail: null,
    referrerHost: null,
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
    expect(table.getByText("First touch")).toBeTruthy();
    expect(table.getByText("Campaign")).toBeTruthy();
    expect(table.getByText("Post / ad")).toBeTruthy();
    expect(table.getByText("Answered morning check")).toBeTruthy();
    expect(table.getByText("Paid")).toBeTruthy();
    expect(table.queryByText("Account")).toBeNull();
    expect(table.queryByText("Trial", { exact: true })).toBeNull();
    expect(table.queryByText("Visitors")).toBeNull();

    expect(table.getByText("jane@example.com")).toBeTruthy();
    expect(table.getByText("Instagram")).toBeTruthy();
    expect(table.getByText("organic")).toBeTruthy();
    expect(table.getByText("story_psm047")).toBeTruthy();
    expect(table.getByText("Yes")).toBeTruthy();
    expect(table.getAllByText("No").length).toBeGreaterThan(0);
    expect(table.getByText("Unknown")).toBeTruthy();
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
    expect(cardRoot.getByText("Instagram")).toBeTruthy();
    expect(cardRoot.getByText("Campaign: organic")).toBeTruthy();
    expect(cardRoot.getByText("Post / ad story_psm047")).toBeTruthy();
    expect(cardRoot.getByText("Answered morning check Yes")).toBeTruthy();
    expect(cardRoot.getAllByText("Paid No").length).toBeGreaterThan(0);
    expect(cardRoot.getByText("Unknown")).toBeTruthy();
    expect(cardRoot.getByText("Post / ad —")).toBeTruthy();
  });
});

describe("subscriber growth slice 1 self-explanatory copy", () => {
  afterEach(() => {
    cleanup();
  });

  it("explains filters, company right now, this period, google, and referral", () => {
    render(<SubscriberGrowthDashboard data={dashboardData([])} />);
    expect(screen.getByText("How this page works")).toBeTruthy();
    expect(screen.getAllByText(/Right now/).length).toBeGreaterThan(0);
    expect(screen.getByText("Last 7 days includes today.")).toBeTruthy();
    expect(
      screen.getByText(
        "Google includes Google ads and Google search. Referral includes Coach links and other websites."
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        "These filters change the historical reports below. They do not change Company right now, growth goals, This week on Stripe, or Current free trials."
      )
    ).toBeTruthy();
    expect(screen.getByText("Company right now")).toBeTruthy();
    expect(screen.getAllByText("Paying members").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Also called: Active paid subscribers").length).toBeGreaterThan(0);
    expect(screen.getByText("This period")).toBeTruthy();
    expect(screen.getAllByText("Trial-to-paid conversion rate").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Paid subscriber churn rate").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cost per paid subscriber").length).toBeGreaterThan(0);
    expect(screen.getByText("From website visit to paid member")).toBeTruthy();
    expect(screen.getAllByText("Answered first morning check in 24 hours").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Also called: Activated within 24 hours").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Stripe cash collected").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Also called: Revenue collected").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Monthly value of current Stripe members").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Also called: Monthly recurring revenue equivalent").length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Spend not entered").length).toBeGreaterThan(0);
    expect(screen.getByText("Definitions & how this dashboard works")).toBeTruthy();
  });

  it("shows Not available for activation when the lookup failed", () => {
    const data = dashboardData([]);
    data.activationQueryComplete = false;
    data.snapshot.period.activatedWithin24h = 0;
    render(<SubscriberGrowthDashboard data={data} />);
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
  });

  it("shows ad spend dollars when rows exist", () => {
    const data = dashboardData([]);
    data.adSpendEntries = [
      {
        id: "spend_1",
        spend_date: "2026-09-09",
        source_normalized: "meta",
        utm_campaign: "fall_challenge",
        amount_cents: 1250,
      },
    ];
    data.snapshot.period.advertisingSpend = 1250;
    data.snapshot.period.costPerPaid = 1250;
    data.snapshot.period.newPaidAttributedToAds = 1;
    render(<SubscriberGrowthDashboard data={data} />);
    expect(screen.getAllByText("$12.50").length).toBeGreaterThan(0);
  });

  it("renders Add Ad Spend instructions when opened", () => {
    render(<SubscriberGrowthDashboard data={dashboardData([])} />);
    const openButtons = screen.getAllByRole("button", { name: "Open" });
    fireEvent.click(openButtons[0]);
    expect(screen.getByText("How to add ad spend")).toBeTruthy();
    expect(screen.getByText("Campaign names must match exactly.")).toBeTruthy();
    expect(
      screen.getByText(
        "This is entered by hand. We do not automatically import spend from Meta or Google."
      )
    ).toBeTruthy();
  });

  it("keeps every current major section on the page", () => {
    render(<SubscriberGrowthDashboard data={dashboardData([])} />);
    expect(screen.getByText("Subscriber Growth Dashboard")).toBeTruthy();
    expect(screen.getByText("Company right now")).toBeTruthy();
    expect(screen.getByText("This period")).toBeTruthy();
    expect(screen.getAllByText("Road to 500").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Road to 2,500").length).toBeGreaterThan(0);
    expect(screen.getByText("This week on Stripe")).toBeTruthy();
    expect(screen.getByText("Current free trials")).toBeTruthy();
    expect(screen.getByText("From website visit to paid member")).toBeTruthy();
    expect(screen.getByText("Subscribers & retention")).toBeTruthy();
    expect(screen.getByText("Money")).toBeTruthy();
    expect(screen.getByText("Advertising")).toBeTruthy();
    expect(screen.getByText("Where new members come from")).toBeTruthy();
    expect(screen.getByText("Tracking Link Builder")).toBeTruthy();
    expect(screen.getAllByText("Recent activity").length).toBeGreaterThan(0);
    expect(screen.getByText("Latest Trials")).toBeTruthy();
    expect(screen.getAllByText("Active monthly subscribers").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Active annual subscribers").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cancelled during the free trial").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Finished the trial without becoming paid").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Payment failed").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Paid cancellation requested but access is still active").length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Paid subscription fully ended").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Reactivated subscriber").length).toBeGreaterThan(0);
    expect(screen.getAllByText("New paid subscribers attributed to advertising").length).toBeGreaterThan(0);
    expect(screen.getByText("Add Ad Spend")).toBeTruthy();
    expect(screen.getByText("Tracking notes")).toBeTruthy();
    expect(screen.getAllByText("Cost per trial").length).toBeGreaterThan(0);
  });
});

describe("subscriber growth slice 2 goals and weekly stripe", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders both goal cards, progress bars, deadlines, and weekly stripe copy", () => {
    const data = dashboardData([]);
    data.snapshot.asOfNow.activePaid = 42;
    data.todayDateKey = "2026-09-10";
    data.stripeWeek = { newPaid: 4, ended: 2, net: 2 };
    render(<SubscriberGrowthDashboard data={data} />);

    expect(screen.getAllByText("Road to 500").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Road to 2,500").length).toBeGreaterThan(0);
    expect(screen.getByText("500 paying members by December 31, 2026.")).toBeTruthy();
    expect(screen.getByText("2,500 paying members by December 31, 2027.")).toBeTruthy();
    expect(screen.getByText("42 of 500 paying members")).toBeTruthy();
    expect(screen.getByText("42 of 2,500 paying members")).toBeTruthy();
    expect(screen.getAllByText("458 to go").length).toBe(1);
    expect(screen.getByText("2,458 to go")).toBeTruthy();
    expect(
      screen.getAllByText(/net new paid subscribers needed per week/).length
    ).toBeGreaterThan(0);
    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
    expect(screen.getByText("This week on Stripe")).toBeTruthy();
    expect(screen.getAllByText("New paid (Stripe)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ended (Stripe)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Stripe net this week").length).toBeGreaterThan(0);
    expect(screen.getByText("+2")).toBeTruthy();
    expect(
      screen.getByText(
        "Monday through today · Eastern Time. Apple is not included in this weekly change because we cannot reliably reconstruct past Apple membership."
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Apple paying members are included in the total Paying Members count and both growth goals/
      )
    ).toBeTruthy();
    expect(screen.getAllByText("Road to 500").length).toBeGreaterThan(1);
    expect(screen.getAllByText("Road to 2,500").length).toBeGreaterThan(1);
    expect(screen.getAllByText("New paid (Stripe)").length).toBeGreaterThan(1);
    expect(screen.getAllByText("Ended (Stripe)").length).toBeGreaterThan(1);
    expect(screen.getAllByText("Stripe net this week").length).toBeGreaterThan(1);
    expect(
      screen.getAllByText("Net new paid subscribers needed per week").length
    ).toBeGreaterThan(0);
  });

  it("shows Not available on goal cards when global paying members is missing", () => {
    const data = dashboardData([]);
    data.snapshot.asOfNow.activePaid = null;
    render(<SubscriberGrowthDashboard data={data} />);
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
    expect(screen.queryByText(/of 500 paying members/)).toBeNull();
    expect(screen.queryByText("Goal reached")).toBeNull();
  });

  it("shows Goal reached instead of weekly pace when the target is met", () => {
    const data = dashboardData([]);
    data.snapshot.asOfNow.activePaid = 500;
    data.todayDateKey = "2026-09-10";
    render(<SubscriberGrowthDashboard data={data} />);
    expect(screen.getByText("500 of 500 paying members")).toBeTruthy();
    expect(screen.getByText("0 to go")).toBeTruthy();
    expect(screen.getByText("Goal reached")).toBeTruthy();
  });

  it("shows Deadline passed when the 500 deadline is over and the goal is not met", () => {
    const data = dashboardData([]);
    data.snapshot.asOfNow.activePaid = 100;
    data.todayDateKey = "2027-01-01";
    render(<SubscriberGrowthDashboard data={data} />);
    expect(screen.getByText("Deadline passed · 400 to go")).toBeTruthy();
  });

  it("formats weekly net with sign, zero, and minus, and Not available when incomplete", () => {
    const positive = dashboardData([]);
    positive.stripeWeek = { newPaid: 4, ended: 0, net: 4 };
    const { unmount } = render(<SubscriberGrowthDashboard data={positive} />);
    expect(screen.getByText("+4")).toBeTruthy();
    unmount();

    const zero = dashboardData([]);
    zero.stripeWeek = { newPaid: 1, ended: 1, net: 0 };
    const second = render(<SubscriberGrowthDashboard data={zero} />);
    expect(second.getAllByText("Stripe net this week").length).toBeGreaterThan(0);
    expect(second.getByText("0")).toBeTruthy();
    second.unmount();

    const negative = dashboardData([]);
    negative.stripeWeek = { newPaid: 1, ended: 3, net: -2 };
    const third = render(<SubscriberGrowthDashboard data={negative} />);
    expect(screen.getByText("-2")).toBeTruthy();
    third.unmount();

    const missing = dashboardData([]);
    missing.stripeWeek = { newPaid: null, ended: null, net: null };
    render(<SubscriberGrowthDashboard data={missing} />);
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
  });
});

describe("subscriber growth slice 3 current free trials", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the section, four labels, Apple copy, and cancel clarification", () => {
    const data = dashboardData([]);
    data.currentFreeTrials = {
      onFreeWeekNow: 0,
      startedToday: 0,
      endsToday: 0,
      endsNext7Days: 0,
    };
    render(<SubscriberGrowthDashboard data={data} />);
    expect(screen.getByText("Current free trials")).toBeTruthy();
    expect(
      screen.getByText(
        "Stripe free weeks happening now. Apple has no free trial. Filters do not change these numbers."
      )
    ).toBeTruthy();
    expect(screen.getAllByText("On a free week right now").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Started a free week today").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Free week ends today").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Free week ends in the next 7 days").length
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Their 7-day trial finishes today. This does not mean they cancelled today."
      )
    ).toBeTruthy();
    expect(screen.getAllByText(/Apple has no free trial/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Active free trial").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("shows Not available on all four cards when the pipeline is incomplete", () => {
    const data = dashboardData([]);
    data.currentFreeTrials = {
      onFreeWeekNow: null,
      startedToday: null,
      endsToday: null,
      endsNext7Days: null,
    };
    render(<SubscriberGrowthDashboard data={data} />);
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(3);
  });
});

describe("subscriber growth slice 4 recent activity", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders Stripe-only subtitle, events, and definitions without Stripe IDs", () => {
    const data = dashboardData([]);
    data.todayDateKey = "2026-09-09";
    data.recentActivity = [
      {
        type: "trial_started",
        timestampUnix: Math.floor(Date.parse("2026-09-09T12:14:00.000Z") / 1000),
        clerkUserId: "user_hidden",
        personEmail: "jane@example.com",
        firstTouchLabel: "Meta ads",
        stableKey: "trial_started:hidden",
      },
    ];
    render(<SubscriberGrowthDashboard data={data} />);
    expect(screen.getAllByText("Recent activity").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "The newest Stripe membership events we can load. Trial, paid, cancellation and ended events are whole-company. Payment-failed events come from the selected invoice period. Apple is not included yet."
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Payment-failed history is limited to the invoice period currently loaded."
      )
    ).toBeTruthy();
    expect(screen.getAllByText("Started a free week").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Became a paying member").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cancelled during free week").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Paid membership ended").length).toBeGreaterThan(0);
    expect(screen.getAllByText("jane@example.com").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Today, 8:14 AM").length).toBeGreaterThan(0);
    expect(screen.getByText("Last 20 people who started a free trial")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/user_hidden/);
    expect(document.body.textContent).not.toMatch(/sub_/);
    expect(document.body.textContent).not.toMatch(/cus_/);
    expect(document.body.textContent).not.toMatch(/\+1\d{10}/);
    expect(document.body.textContent).not.toMatch(/SMS body/i);
  });

  it("shows Not available when the feed could not be loaded", () => {
    const data = dashboardData([]);
    data.recentActivity = null;
    render(<SubscriberGrowthDashboard data={data} />);
    expect(
      screen.getByText("We could not reliably load recent membership activity.")
    ).toBeTruthy();
  });
});

describe("subscriber growth CMO completion copy", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows cost per trial empty and zero-trial states without Infinity", () => {
    const empty = dashboardData([]);
    render(<SubscriberGrowthDashboard data={empty} />);
    expect(screen.getAllByText("Cost per trial").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Ad spend in this period ÷ free trials that started from paid ads in this period."
      )
    ).toBeTruthy();
    expect(screen.getAllByText("Enter ad spend to calculate.").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Infinity|NaN/);
    cleanup();

    const noTrials = dashboardData([]);
    noTrials.adSpendEntries = [
      {
        id: "spend_1",
        spend_date: "2026-09-09",
        source_normalized: "meta",
        utm_campaign: "fall_challenge",
        amount_cents: 5000,
      },
    ];
    noTrials.snapshot.period.advertisingSpend = 5000;
    noTrials.snapshot.period.paidAdTrialsStarted = 0;
    noTrials.snapshot.period.costPerTrial = null;
    render(<SubscriberGrowthDashboard data={noTrials} />);
    expect(
      screen.getByText("No paid-ad trials started in this period.")
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Infinity|NaN/);
  });

  it("says cash vs spend is not profit or ROAS and first landing page is not tracked yet", () => {
    render(<SubscriberGrowthDashboard data={dashboardData([])} />);
    expect(
      screen.getByText(
        "Shown together for the same selected dates. This is not profit or ROAS. Stripe cash includes customers from all sources."
      )
    ).toBeTruthy();
    expect(document.body.textContent).toMatch(/First landing page is not tracked reliably yet/);
    expect(screen.getByText("Tracking notes")).toBeTruthy();
    expect(
      screen.getByText("This is NOT a general engagement score.", { exact: false })
    ).toBeTruthy();
  });
});

