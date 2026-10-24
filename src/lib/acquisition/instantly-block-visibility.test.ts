import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  formatInstantlyBlockVisibility,
  formatOutstandingAge,
  presentInstantlyBlockVisibility,
  type InstantlyBlockVisibility,
} from "@/lib/acquisition/instantly-block-visibility";

const NOW = new Date("2026-10-24T20:25:00.000Z");

function report(overrides: Partial<InstantlyBlockVisibility> = {}): InstantlyBlockVisibility {
  return {
    countsReadable: true,
    switchReadable: true,
    ageReadable: true,
    blocking: "off",
    pending: 0,
    confirmed: 0,
    failed: 0,
    uncertain: 0,
    oldestOutstandingAt: null,
    ...overrides,
  };
}

describe("subscriber stop visibility", () => {
  it("keeps five pending requests distinct from five confirmed provider blocks", () => {
    const pendingOnly = presentInstantlyBlockVisibility(report({
      pending: 5,
      oldestOutstandingAt: "2026-10-24T19:25:00.000Z",
    }), NOW);
    expect(pendingOnly.pending).toBe("5");
    expect(pendingOnly.confirmed).toBe("0");
    expect(pendingOnly.outstanding).toBe("5");
    expect(pendingOnly.localRequests).toBe("5");
    expect(pendingOnly.blocking).toBe("OFF");
    expect(pendingOnly.oldestAge).toBe("1 hour");
    expect(pendingOnly.note).toContain("pending count is not a confirmed provider block");

    const both = presentInstantlyBlockVisibility(report({
      pending: 5,
      confirmed: 5,
      oldestOutstandingAt: "2026-10-22T20:25:00.000Z",
    }), NOW);
    expect(both.pending).toBe("5");
    expect(both.confirmed).toBe("5");
    expect(both.outstanding).toBe("5");
    expect(both.localRequests).toBe("10");
    expect(both.oldestAge).toBe("2 days");
    const lines = formatInstantlyBlockVisibility(both);
    expect(lines.join("\n")).toContain("Pending local stop requests: 5");
    expect(lines.join("\n")).toContain("Confirmed Instantly blocks: 5");
    expect(lines.join("\n")).not.toMatch(/@/);
  });

  it("shows Not available when a count read fails and does not turn that into zero", () => {
    const hidden = presentInstantlyBlockVisibility(report({
      countsReadable: false,
      pending: null,
      confirmed: null,
      failed: null,
      uncertain: null,
      ageReadable: false,
      switchReadable: false,
      blocking: null,
    }), NOW);
    expect(hidden.pending).toBe("Not available");
    expect(hidden.confirmed).toBe("Not available");
    expect(hidden.outstanding).toBe("Not available");
    expect(hidden.localRequests).toBe("Not available");
    expect(hidden.oldestAge).toBe("Not available");
    expect(hidden.blocking).toBe("Not available");
    expect(Object.values(hidden).join(" ")).not.toContain("0");
  });

  it("shows None when every outstanding request is already confirmed", () => {
    const clear = presentInstantlyBlockVisibility(report({ confirmed: 5 }), NOW);
    expect(clear.outstanding).toBe("0");
    expect(clear.confirmed).toBe("5");
    expect(clear.oldestAge).toBe("None");
    expect(clear.blocking).toBe("OFF");
  });

  it("formats ages without inventing a time for an unreadable timestamp", () => {
    expect(formatOutstandingAge("2026-10-24T20:24:30.000Z", NOW)).toBe("under 1 minute");
    expect(formatOutstandingAge("2026-10-24T19:40:00.000Z", NOW)).toBe("45 minutes");
    expect(formatOutstandingAge("not-a-time", NOW)).toBeNull();
  });

  it("reads exact status totals and does not call Instantly from the dashboard", () => {
    const server = readFileSync("src/lib/acquisition/instantly-block.server.ts", "utf8");
    const visibility = server.slice(server.indexOf("export async function loadInstantlyBlockVisibility"));
    expect(visibility).toContain('count: "exact"');
    expect(visibility).toContain("head: true");
    expect(visibility).not.toContain("email_normalized");
    expect(visibility).not.toContain(".insert(");
    expect(visibility).not.toContain(".update(");
    expect(visibility).not.toContain("fetch(");
    expect(visibility).not.toContain("advanceInstantlyBlock");
    const screen = readFileSync("src/app/admin/operating-screen.tsx", "utf8");
    const section = screen.slice(
      screen.indexOf("function SubscriberStopSection"),
      screen.indexOf("function MetricGrid"),
    );
    expect(section).toContain("Subscriber stops — all time");
    expect(section).toContain("Not a confirmed Instantly block.");
    expect(section).not.toContain("<button");
    expect(section).not.toContain("instantly_blocklist");
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    const cron = store.slice(store.indexOf("export async function runAcquisitionCron"));
    expect(cron.indexOf("reconcileMissingInstantlyBlocks")).toBeLessThan(cron.indexOf("deliverPendingInstantlyBlocks"));
    expect(cron).toContain('enabled: settings.instantlyBlocklist === "on"');
    expect(readFileSync("src/lib/acquisition/instantly-block.ts", "utf8")).not.toContain('method: "DELETE"');
  });
});
