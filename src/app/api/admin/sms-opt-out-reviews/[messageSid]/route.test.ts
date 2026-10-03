import { beforeEach, describe, expect, it, vi } from "vitest";

const requireTylerAdmin = vi.hoisted(() => vi.fn());
const keepSmsOptOutReviewTextsOn = vi.hoisted(() => vi.fn());
const stopSmsOptOutReviewTexts = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/require-tyler-admin", () => ({
  requireTylerAdmin,
}));

vi.mock("@/lib/sms-opt-out-review-resolve", () => ({
  keepSmsOptOutReviewTextsOn,
  stopSmsOptOutReviewTexts,
}));

import { POST } from "@/app/api/admin/sms-opt-out-reviews/[messageSid]/route";

function request(body: unknown) {
  return new Request("http://localhost/api/admin/sms-opt-out-reviews/SMreview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/sms-opt-out-reviews/[messageSid]", () => {
  beforeEach(() => {
    requireTylerAdmin.mockReset();
    requireTylerAdmin.mockResolvedValue({ userId: "user_tyler" });
    keepSmsOptOutReviewTextsOn.mockReset();
    stopSmsOptOutReviewTexts.mockReset();
    keepSmsOptOutReviewTextsOn.mockResolvedValue({ ok: true, outcome: "kept" });
    stopSmsOptOutReviewTexts.mockResolvedValue({ ok: true, outcome: "stopped" });
  });

  it("rejects a non-admin before any review action", async () => {
    const err = new Error("FORBIDDEN");
    (err as Error & { status: number }).status = 403;
    requireTylerAdmin.mockRejectedValue(err);
    const res = await POST(request({ action: "keep_texts_on", latest_inbound_at: "t1" }), {
      params: Promise.resolve({ messageSid: "SMreview" }),
    });
    expect(res.status).toBe(403);
    expect(keepSmsOptOutReviewTextsOn).not.toHaveBeenCalled();
    expect(stopSmsOptOutReviewTexts).not.toHaveBeenCalled();
  });

  it("does not act when the review is already resolved", async () => {
    keepSmsOptOutReviewTextsOn.mockResolvedValue({ ok: true, outcome: "already_resolved" });
    const res = await POST(request({ action: "keep_texts_on", latest_inbound_at: "t1" }), {
      params: Promise.resolve({ messageSid: "SMreview" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.outcome).toBe("already_resolved");
  });
});
