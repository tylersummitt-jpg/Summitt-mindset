/** @vitest-environment jsdom */

import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DistributionCommandCenter } from "@/app/admin/distribution-command-center";
import {
  buildDistributionCommand,
  emptyInstantlyRead,
  type LedgerEvent,
} from "@/lib/acquisition/distribution-command";

const report = buildDistributionCommand({
  readable: true,
  truncated: false,
  rangeLabel: "Last 7 days",
  startMs: Date.parse("2026-10-26T04:00:00.000Z"),
  endMs: Date.parse("2026-10-28T04:00:00.000Z"),
  nowMs: Date.parse("2026-10-27T16:00:00.000Z"),
  people: [{
    id: "p1",
    lifecycle: "cold_active",
    sourceCampaign: "camp-a",
    sport: null,
    role: null,
    geography: "Tennessee",
    offerKey: null,
  }],
  events: [{
    personId: "p1",
    provider: "instantly",
    providerEventId: "sent-1",
    eventType: "email_sent",
    occurredAt: "2026-10-26T12:00:00.000Z",
    campaignId: "camp-a",
    sender: "one@trysummittmindset.com",
    rawInstantlyType: null,
    step: 1,
  } satisfies LedgerEvent],
  actions: [{
    personId: "p1",
    campaignId: "camp-a",
    actionType: "send_asset",
    status: "scheduled",
    attemptCount: 0,
    delivered: false,
    claimed: false,
  }],
  messages: [],
  openJourneys: 1,
  closedJourneys: 0,
  peopleWithJourney: 1,
  instantly: emptyInstantlyRead("missing", "missing_api_key"),
});

describe("distribution command center layout", () => {
  it("shows trust labels and does not rank a campaign or invent a trial", () => {
    const view = render(<DistributionCommandCenter report={report} range="last_7" selectedCampaignId={null} />);
    const text = view.container.textContent ?? "";
    expect(text).toContain("Cold email");
    expect(text).toContain("PARTIAL");
    expect(text).toContain("UNAVAILABLE");
    expect(text).toContain("NOT YET TRUSTWORTHY");
    expect(text).toContain("None are ranked");
    expect(text).toContain("1 person");
    expect(text).toContain("Email-attributed trials");
    expect(text).toContain("Sorting by trials");
    expect(text).not.toContain("open_count");
  });
});
