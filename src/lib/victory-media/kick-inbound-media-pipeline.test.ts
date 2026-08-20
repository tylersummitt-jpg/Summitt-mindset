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

import {
  kickInboundMediaPipeline,
  selectInboundMediaPipelineB2Target,
} from "@/lib/victory-media/kick-inbound-media-pipeline";
import { processInboundMediaJobB1 } from "@/lib/victory-media/process-inbound-media-b1";

const B1 = "11111111-1111-4111-8111-111111111111";
const OLD_B2 = "22222222-2222-4222-8222-222222222222";
const OLD_B2_B = "33333333-3333-4333-8333-333333333333";
const DUE_RETRY = "44444444-4444-4444-8444-444444444444";

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
});
