import { beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      insert: (row: unknown) => insertMock(row),
    }),
  },
}));

import { insertMarketingEventFailOpen } from "@/lib/marketing-collect";
import type { MarketingEventInsert } from "@/lib/marketing-collect";

const ATTR = {
  v: 1 as const,
  first_touch_at: "2026-09-01T12:00:00.000Z",
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  utm_content: null,
  gclid_present: false,
  fbclid_present: false,
  referrer_host: null,
  source_normalized: "direct" as const,
  is_paid_acquisition: false,
  source_detail: null,
  meta_fbclid: null,
  meta_fbclid_observed_at: null,
};

function row(
  partial: Partial<MarketingEventInsert> & Pick<MarketingEventInsert, "event_type">
): MarketingEventInsert {
  return {
    visitor_id: "3b241101-e2bb-4255-8caf-4136c566a962",
    attribution: ATTR,
    ...partial,
  };
}

describe("homepage video marketing insert", () => {
  beforeEach(() => {
    insertMock.mockReset();
    insertMock.mockResolvedValue({ error: null });
  });

  it("keeps a trimmed digit Vimeo id and drops every other metadata key", async () => {
    const result = await insertMarketingEventFailOpen(
      row({
        event_type: "homepage_video_50",
        metadata: {
          vimeo_video_id: " 123456 ",
          cta_surface: "hero",
        },
      })
    );
    expect(result).toBe("ok");
    expect(insertMock.mock.calls[0][0].metadata).toEqual({ vimeo_video_id: "123456" });
  });

  it("does not insert a video row when the Vimeo id is invalid", async () => {
    const result = await insertMarketingEventFailOpen(
      row({
        event_type: "homepage_video_reached",
        metadata: { vimeo_video_id: "https://vimeo.com/123456" },
      })
    );
    expect(result).toBe("ok");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("still stores only cta_surface for trial clicks", async () => {
    await insertMarketingEventFailOpen(
      row({
        event_type: "trial_cta_clicked",
        metadata: { cta_surface: " hero ", vimeo_video_id: "123456" },
      })
    );
    expect(insertMock.mock.calls[0][0].metadata).toEqual({ cta_surface: "hero" });
  });

  it("treats a duplicate video milestone as success", async () => {
    insertMock.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate key" },
    });
    const result = await insertMarketingEventFailOpen(
      row({
        event_type: "homepage_video_completed",
        metadata: { vimeo_video_id: "12345678901234567890" },
      })
    );
    expect(result).toBe("ok");
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
