import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveCanonicalMorningTtoBatchDraftForDayKey } from "@/lib/tyler-text-overview-draft-day-key";

const generateBatchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tyler-text-overview-generate", () => ({
  generateTylerTextOverviewDailyDrafts: generateBatchMock,
}));

vi.mock("@/lib/cron-auth", () => ({
  validateCronSecretRequest: () => true,
}));

describe("tyler-text-overview-generate cron route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("computes one Eastern tomorrow day and passes it to the batch", async () => {
    generateBatchMock.mockResolvedValue({
      ok: true,
      enabled: true,
      draft_for_day_key: "2026-08-06",
      scanned: 0,
      eligible: 0,
      generated: 0,
      generation_inserted: 0,
      current_drafts_upserted: 0,
      skipped_disabled: 0,
      skipped_audience: 0,
      skipped_not_v2: 0,
      skipped_comms_prefs: 0,
      build_failed: 0,
      insert_failed: 0,
      upsert_failed: 0,
      supersede_failed: 0,
      errors_preview: [],
    });

    const { GET } = await import("@/app/api/cron/tyler-text-overview-generate/route");
    const fixedNow = new Date("2026-08-05T15:57:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    try {
      const res = await GET(new Request("http://localhost/api/cron/tyler-text-overview-generate"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.draft_for_day_key).toBe("2026-08-06");
      expect(generateBatchMock).toHaveBeenCalledTimes(1);
      expect(generateBatchMock).toHaveBeenCalledWith({
        now: fixedNow,
        draftForDayKey: "2026-08-06",
      });
      expect(resolveCanonicalMorningTtoBatchDraftForDayKey(fixedNow)).toBe("2026-08-06");
    } finally {
      vi.useRealTimers();
    }
  });

  it("route source does not call per-user local-hour day resolver", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/cron/tyler-text-overview-generate/route.ts"),
      "utf8"
    );
    expect(src).toContain("resolveCanonicalMorningTtoBatchDraftForDayKey");
    expect(src).toContain("draftForDayKey");
    expect(src).not.toContain("resolveTylerTextOverviewDraftForDayKey");
  });
});
