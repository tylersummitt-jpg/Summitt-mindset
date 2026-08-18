import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

const recomputeV2CoachingMemory = vi.hoisted(() => vi.fn());
const setBlockerCapturePending = vi.hoisted(() => vi.fn());

vi.mock("@/lib/v2-coaching-memory", () => ({
  recomputeV2CoachingMemory,
}));

vi.mock("@/lib/v2-commitment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-commitment")>();
  return {
    ...actual,
    setBlockerCapturePending,
  };
});

import { applySolInboundOutcomeSideEffects } from "@/lib/inbound-sol-outcome-side-effects";
import type { InboundOutcomePersistResult } from "@/lib/v2-inbound-accountability-outcome-persist";

describe("applySolInboundOutcomeSideEffects", () => {
  beforeEach(() => {
    recomputeV2CoachingMemory.mockReset();
    setBlockerCapturePending.mockReset();
    recomputeV2CoachingMemory.mockResolvedValue(undefined);
    setBlockerCapturePending.mockResolvedValue(undefined);
  });

  it("user_no inserted: recompute + blocker pending", async () => {
    const persistResult: InboundOutcomePersistResult = {
      status: "inserted",
      eventType: "user_no",
      eventId: "e1",
      idempotencyKey: "k",
      overrideGatedNoWrite: false,
    };
    const r = await applySolInboundOutcomeSideEffects({
      commitmentId: "c1",
      persistResult,
    });
    expect(r.recomputed).toBe(true);
    expect(r.blockerCaptureSet).toBe("user_no");
    expect(recomputeV2CoachingMemory).toHaveBeenCalledWith("c1", {
      reasonCode: "inbound_user_outcome",
    });
    expect(setBlockerCapturePending).toHaveBeenCalledWith("c1", "user_no");
  });

  it("user_partial duplicate: recompute + blocker pending", async () => {
    const persistResult: InboundOutcomePersistResult = {
      status: "duplicate",
      eventType: "user_partial",
      idempotencyKey: "k",
      overrideGatedNoWrite: false,
    };
    const r = await applySolInboundOutcomeSideEffects({
      commitmentId: "c1",
      persistResult,
    });
    expect(r.recomputed).toBe(true);
    expect(r.blockerCaptureSet).toBe("user_partial");
    expect(setBlockerCapturePending).toHaveBeenCalledWith("c1", "user_partial");
  });

  it("user_yes: recompute, no blocker", async () => {
    const persistResult: InboundOutcomePersistResult = {
      status: "inserted",
      eventType: "user_yes",
      eventId: "e3",
      idempotencyKey: "k",
      overrideGatedNoWrite: false,
    };
    const r = await applySolInboundOutcomeSideEffects({
      commitmentId: "c1",
      persistResult,
    });
    expect(r.recomputed).toBe(true);
    expect(r.blockerCaptureSet).toBeNull();
    expect(recomputeV2CoachingMemory).toHaveBeenCalledTimes(1);
    expect(setBlockerCapturePending).not.toHaveBeenCalled();
  });

  it("skipped / no outcome: neither", async () => {
    const r = await applySolInboundOutcomeSideEffects({
      commitmentId: "c1",
      persistResult: { status: "skipped", skipReason: "sol_not_applicable" },
    });
    expect(r.recomputed).toBe(false);
    expect(r.blockerCaptureSet).toBeNull();
    expect(recomputeV2CoachingMemory).not.toHaveBeenCalled();
    expect(setBlockerCapturePending).not.toHaveBeenCalled();
  });
});
