/** @vitest-environment jsdom */

import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DistributionIntelligencePanel } from "@/app/admin/distribution-intelligence-panel";
import { buildDistributionIntelligence } from "@/lib/distribution-intelligence";

describe("distribution explanations", () => {
  it("keeps How this works collapsed", () => {
    const intel = buildDistributionIntelligence({
      trackingReadable: true,
      spendReadable: true,
      retentionReady: false,
      rangeTrials: null,
      rangePaid: null,
      trafficRows: [],
      cohorts: [],
    });
    const view = render(<DistributionIntelligencePanel intel={intel} />);
    const details = view.container.querySelector("details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe("How this works");
    expect(view.container.textContent).toContain("Channel performance");
    expect(view.container.textContent).toContain("Content performance");
    expect(view.container.textContent).toContain("Tracking link");
    expect(details?.textContent).toContain("First-touch");
    expect(details?.textContent).toContain("not zero");
  });
});
