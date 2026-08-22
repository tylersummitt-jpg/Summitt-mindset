import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/victory-media/claim-inbound-media-job", () => ({
  listInboundMediaJobsForDownloadClaim: vi.fn(async () => []),
  listInboundMediaJobsForB2: vi.fn(async () => []),
}));

vi.mock("@/lib/victory-media/process-inbound-media-b1", () => ({
  processInboundMediaJobB1: vi.fn(),
}));

vi.mock("@/lib/victory-media/process-inbound-media-b2", () => ({
  processInboundMediaJobB2: vi.fn(),
  processInboundMediaJobB2AfterSuccessfulB1: vi.fn(),
}));

vi.mock("@/lib/victory-media/correlate-inbound-mms-c1", () => ({
  INBOUND_MEDIA_PIPELINE_C1_LIMIT: 1,
  listInboundMediaJobsForC1: vi.fn(async () => []),
  tryCorrelateInboundMmsC1Job: vi.fn(async () => null),
}));

vi.mock("@/lib/victory-media/attach-inbound-mms-c2", () => ({
  INBOUND_MEDIA_PIPELINE_C2_LIMIT: 1,
  listInboundMediaJobsForC2: vi.fn(async () => []),
  tryAttachInboundMmsC2Job: vi.fn(async () => null),
}));

vi.mock("@/lib/victory-media/inbound-mms-d2b", () => ({
  INBOUND_MEDIA_PIPELINE_D2_LIMIT: 1,
  listInboundMediaJobsForD2: vi.fn(async () => []),
  processInboundMmsD2Job: vi.fn(async () => null),
}));

import {
  kickInboundMediaPipeline,
  selectInboundMediaPipelineB2Target,
} from "@/lib/victory-media/kick-inbound-media-pipeline";
import { processInboundMediaJobB1 } from "@/lib/victory-media/process-inbound-media-b1";

const B1 = "11111111-1111-4111-8111-111111111111";
const OLD_B2 = "22222222-2222-4222-8222-222222222222";
const OLD_B2_B = "33333333-3333-4333-8333-333333333333";
const DUE_RETRY = "44444444-4444-4444-8444-444444444444";

function emptyCounters() {
  return {
    c2Attempted: 0,
    c2Succeeded: 0,
    attached: 0,
    d2aAttempted: 0,
    d2aClaimed: 0,
    d2bAttempted: 0,
    d2bSent: 0,
    d2bClaimed: 0,
  };
}

function okB1(jobId: string) {
  return {
    ok: true as const,
    jobId,
    tempStoragePath: "p",
    sniffedFormat: "jpeg" as const,
  };
}

function okB2(jobId: string) {
  return {
    ok: true as const,
    jobId,
    mode: "image_only" as const,
    status: "pending_semantics" as const,
    normalizedStoragePath: "n",
  };
}

describe("selectInboundMediaPipelineB2Target", () => {
  it("oldest listed B2 outranks a just-completed B1 job", () => {
    expect(
      selectInboundMediaPipelineB2Target({
        oldestListedB2Id: OLD_B2,
        freshlyCompletedB1JobId: B1,
      })
    ).toEqual({ jobId: OLD_B2, afterSuccessfulB1: false });
  });

  it("new B1 is selected only when no older listed B2 exists", () => {
    expect(
      selectInboundMediaPipelineB2Target({
        oldestListedB2Id: null,
        freshlyCompletedB1JobId: B1,
      })
    ).toEqual({ jobId: B1, afterSuccessfulB1: true });
  });

  it("no B1 and no listed B2 yields nothing", () => {
    expect(
      selectInboundMediaPipelineB2Target({
        oldestListedB2Id: null,
        freshlyCompletedB1JobId: null,
      })
    ).toBeNull();
  });
});

describe("kickInboundMediaPipeline", () => {
  it("old B2-ready outranks newly completed B1; max one normalize", async () => {
    const processB1 = vi.fn(async () => okB1(B1));
    const processB2 = vi.fn(async (id: string) => okB2(id));
    const processB2AfterSuccessfulB1 = vi.fn(async (id: string) => okB2(id));
    const listB2 = vi.fn(async () => [OLD_B2, OLD_B2_B]);

    const r = await kickInboundMediaPipeline({
      listB1: async () => [B1],
      listB2,
      processB1,
      processB2,
      processB2AfterSuccessfulB1,
    });

    expect(processB1).toHaveBeenCalledTimes(1);
    expect(listB2).toHaveBeenCalledTimes(1);
    expect(processB2).toHaveBeenCalledTimes(1);
    expect(processB2).toHaveBeenCalledWith(OLD_B2);
    expect(processB2AfterSuccessfulB1).not.toHaveBeenCalled();
    expect(r).toEqual({
      b1Attempted: 1,
      b1Succeeded: 1,
      b2Attempted: 1,
      b2Succeeded: 1,
      normalized: 1,
      c1Attempted: 0,
      ...emptyCounters(),
    });
  });

  it("new B1 normalizes immediately when no older B2 exists", async () => {
    const processB2 = vi.fn(async (id: string) => okB2(id));
    const processB2AfterSuccessfulB1 = vi.fn(async (id: string) => okB2(id));

    const r = await kickInboundMediaPipeline({
      listB1: async () => [B1],
      listB2: async () => [],
      processB1: vi.fn(async () => okB1(B1)),
      processB2,
      processB2AfterSuccessfulB1,
    });

    expect(processB2).not.toHaveBeenCalled();
    expect(processB2AfterSuccessfulB1).toHaveBeenCalledTimes(1);
    expect(processB2AfterSuccessfulB1).toHaveBeenCalledWith(B1);
    expect(r.normalized).toBe(1);
  });

  it("due B2 retry participates in oldest listed ordering", async () => {
    const processB2 = vi.fn(async (id: string) => okB2(id));
    const processB2AfterSuccessfulB1 = vi.fn(async (id: string) => okB2(id));

    await kickInboundMediaPipeline({
      listB1: async () => [B1],
      listB2: async () => [DUE_RETRY],
      processB1: vi.fn(async () => okB1(B1)),
      processB2,
      processB2AfterSuccessfulB1,
    });

    expect(processB2).toHaveBeenCalledWith(DUE_RETRY);
    expect(processB2AfterSuccessfulB1).not.toHaveBeenCalled();
  });

  it("B1 failure still allows one old B2 normalization", async () => {
    const processB1 = vi.fn(async () => ({
      ok: false as const,
      jobId: B1,
      reason: "timeout",
      terminal: false,
    }));
    const processB2 = vi.fn(async (id: string) => okB2(id));
    const processB2AfterSuccessfulB1 = vi.fn(async (id: string) => okB2(id));

    const r = await kickInboundMediaPipeline({
      listB1: async () => [B1],
      listB2: async () => [OLD_B2],
      processB1,
      processB2,
      processB2AfterSuccessfulB1,
    });

    expect(processB2).toHaveBeenCalledTimes(1);
    expect(processB2).toHaveBeenCalledWith(OLD_B2);
    expect(processB2AfterSuccessfulB1).not.toHaveBeenCalled();
    expect(r.normalized).toBe(1);
    expect(r.b1Succeeded).toBe(0);
  });

  it("when no B1, processes at most one oldest listed B2 job", async () => {
    const processB2 = vi.fn(async (id: string) => okB2(id));
    const processB2AfterSuccessfulB1 = vi.fn(async (id: string) => okB2(id));

    const r = await kickInboundMediaPipeline({
      listB1: async () => [],
      listB2: async () => [OLD_B2, OLD_B2_B],
      processB1: processInboundMediaJobB1,
      processB2,
      processB2AfterSuccessfulB1,
    });

    expect(processB2).toHaveBeenCalledTimes(1);
    expect(processB2).toHaveBeenCalledWith(OLD_B2);
    expect(processB2AfterSuccessfulB1).not.toHaveBeenCalled();
    expect(r.normalized).toBe(1);
    expect(r.b1Attempted).toBe(0);
  });

  it("never passes forceClaim or a request-driven bypass flag", async () => {
    const processB2 = vi.fn(async (id: string) => okB2(id));
    const processB2AfterSuccessfulB1 = vi.fn(async (id: string) => okB2(id));

    await kickInboundMediaPipeline({
      listB1: async () => [B1],
      listB2: async () => [],
      processB1: vi.fn(async () => okB1(B1)),
      processB2,
      processB2AfterSuccessfulB1,
    });

    expect(processB2.mock.calls.flat()).not.toContainEqual(
      expect.objectContaining({ forceClaim: true })
    );
    expect(processB2AfterSuccessfulB1).toHaveBeenCalledWith(B1);
    expect(processB2AfterSuccessfulB1.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("runs at most one opportunistic C1 after B1/B2; oldest due listed", async () => {
    const C1_OLD = "55555555-5555-4555-8555-555555555555";
    const C1_NEW = "66666666-6666-4666-8666-666666666666";
    const correlateC1 = vi.fn(async () => ({ kind: "waiting_for_win" }));
    const listC1 = vi.fn(async () => [C1_OLD, C1_NEW]);

    const r = await kickInboundMediaPipeline({
      listB1: async () => [],
      listB2: async () => [],
      listC1,
      processB1: processInboundMediaJobB1,
      processB2: vi.fn(),
      processB2AfterSuccessfulB1: vi.fn(),
      correlateC1,
    });

    expect(listC1).toHaveBeenCalledWith(1);
    expect(correlateC1).toHaveBeenCalledTimes(1);
    expect(correlateC1).toHaveBeenCalledWith(C1_OLD);
    expect(r.c1Attempted).toBe(1);
    expect(r.b1Attempted).toBe(0);
    expect(r.normalized).toBe(0);
    expect(r.c2Attempted).toBe(0);
    expect(r.d2aAttempted).toBe(0);
  });

  it("runs at most one C2 after C1; oldest due listed; C2 throw does not undo prior phases", async () => {
    const C2_OLD = "77777777-7777-4777-8777-777777777777";
    const C2_NEW = "88888888-8888-4888-8888-888888888888";
    const attachC2 = vi.fn(async () => ({
      ok: true as const,
      status: "attached" as const,
      jobId: C2_OLD,
      winId: "win",
    }));
    const listC2 = vi.fn(async () => [C2_OLD, C2_NEW]);
    const correlateC1 = vi.fn(async () => ({ kind: "attach_eligible" }));

    const r = await kickInboundMediaPipeline({
      listB1: async () => [],
      listB2: async () => [],
      listC1: async () => ["55555555-5555-4555-8555-555555555555"],
      listC2,
      processB1: processInboundMediaJobB1,
      processB2: vi.fn(),
      processB2AfterSuccessfulB1: vi.fn(),
      correlateC1,
      attachC2,
    });

    expect(listC2).toHaveBeenCalledWith(1);
    expect(attachC2).toHaveBeenCalledTimes(1);
    expect(attachC2).toHaveBeenCalledWith(C2_OLD);
    expect(r.c1Attempted).toBe(1);
    expect(r.c2Attempted).toBe(1);
    expect(r.c2Succeeded).toBe(1);
    expect(r.attached).toBe(1);
    expect(r.d2aAttempted).toBe(0);
  });

  it("C2 does not run in the same kick against a newly armed not-due job", async () => {
    const attachC2 = vi.fn(async () => ({ ok: true, status: "attached" }));
    const r = await kickInboundMediaPipeline({
      listB1: async () => [],
      listB2: async () => [],
      listC1: async () => ["55555555-5555-4555-8555-555555555555"],
      listC2: async () => [],
      processB1: processInboundMediaJobB1,
      processB2: vi.fn(),
      processB2AfterSuccessfulB1: vi.fn(),
      correlateC1: vi.fn(async () => ({ kind: "attach_eligible" })),
      attachC2,
    });
    expect(attachC2).not.toHaveBeenCalled();
    expect(r.c2Attempted).toBe(0);
    expect(r.c1Attempted).toBe(1);
  });

  it("C2 throw is caught and prior C1 attempt is preserved", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await kickInboundMediaPipeline({
      listB1: async () => [],
      listB2: async () => [],
      listC1: async () => ["55555555-5555-4555-8555-555555555555"],
      listC2: async () => ["77777777-7777-4777-8777-777777777777"],
      processB1: processInboundMediaJobB1,
      processB2: vi.fn(),
      processB2AfterSuccessfulB1: vi.fn(),
      correlateC1: vi.fn(async () => ({ kind: "waiting_for_win" })),
      attachC2: vi.fn(async () => {
        throw new Error("c2 boom");
      }),
    });
    expect(r.c1Attempted).toBe(1);
    expect(r.c2Attempted).toBe(1);
    expect(r.c2Succeeded).toBe(0);
    expect(r.attached).toBe(0);
    error.mockRestore();
  });

  it("runs at most one D2 after C2; oldest due listed; D2 throw does not undo prior phases", async () => {
    const D2_OLD = "99999999-9999-4999-8999-999999999999";
    const D2_NEW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const processD2 = vi.fn(async () => ({
      ok: true as const,
      jobId: D2_OLD,
      action: "claimed" as const,
      phase: "d2a" as const,
    }));
    const listD2 = vi.fn(async () => [D2_OLD, D2_NEW]);
    const attachC2 = vi.fn(async () => ({
      ok: true as const,
      status: "attached" as const,
      jobId: "77777777-7777-4777-8777-777777777777",
      winId: "win",
    }));

    const r = await kickInboundMediaPipeline({
      listB1: async () => [],
      listB2: async () => [],
      listC1: async () => ["55555555-5555-4555-8555-555555555555"],
      listC2: async () => ["77777777-7777-4777-8777-777777777777"],
      listD2,
      processB1: processInboundMediaJobB1,
      processB2: vi.fn(),
      processB2AfterSuccessfulB1: vi.fn(),
      correlateC1: vi.fn(async () => ({ kind: "waiting_for_win" })),
      attachC2,
      processD2,
    });

    expect(listD2).toHaveBeenCalledWith(1);
    expect(processD2).toHaveBeenCalledTimes(1);
    expect(processD2).toHaveBeenCalledWith(D2_OLD);
    expect(r.c2Attempted).toBe(1);
    expect(r.d2aAttempted).toBe(1);
    expect(r.d2aClaimed).toBe(1);
    expect(r.d2bAttempted).toBe(0);
  });

  it("D2b send is counted separately from D2a", async () => {
    const processD2 = vi.fn(async () => ({
      ok: true as const,
      jobId: "99999999-9999-4999-8999-999999999999",
      action: "sent" as const,
      phase: "d2b" as const,
    }));
    const r = await kickInboundMediaPipeline({
      listB1: async () => [],
      listB2: async () => [],
      listC1: async () => [],
      listC2: async () => [],
      listD2: async () => ["99999999-9999-4999-8999-999999999999"],
      processB1: processInboundMediaJobB1,
      processB2: vi.fn(),
      processB2AfterSuccessfulB1: vi.fn(),
      processD2,
    });
    expect(r.d2aAttempted).toBe(0);
    expect(r.d2bAttempted).toBe(1);
    expect(r.d2bSent).toBe(1);
    expect(r.d2bClaimed).toBe(0);
  });

  it("D2 throw is caught and prior C2 attempt is preserved", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await kickInboundMediaPipeline({
      listB1: async () => [],
      listB2: async () => [],
      listC1: async () => [],
      listC2: async () => ["77777777-7777-4777-8777-777777777777"],
      listD2: async () => ["99999999-9999-4999-8999-999999999999"],
      processB1: processInboundMediaJobB1,
      processB2: vi.fn(),
      processB2AfterSuccessfulB1: vi.fn(),
      attachC2: vi.fn(async () => ({
        ok: true as const,
        status: "attached" as const,
      })),
      processD2: vi.fn(async () => {
        throw new Error("d2 boom");
      }),
    });
    expect(r.c2Attempted).toBe(1);
    expect(r.c2Succeeded).toBe(1);
    expect(r.d2aAttempted).toBe(0);
    expect(r.d2aClaimed).toBe(0);
    expect(r.d2bAttempted).toBe(0);
    error.mockRestore();
  });
});
