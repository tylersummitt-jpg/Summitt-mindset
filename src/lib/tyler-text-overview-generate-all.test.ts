import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const loadAudienceMock = vi.hoisted(() => vi.fn());
const generateMorningUserMock = vi.hoisted(() => vi.fn());
const generateEveningUserMock = vi.hoisted(() => vi.fn());

type DraftRow = {
  clerk_user_id: string;
  draft_for_day_key: string;
  send_slot: string;
  status: string;
  current_generation_id: string | null;
  edited_by_tyler: boolean | null;
  current_body_source: string | null;
  current_body_to_send: string | null;
};

type GenRow = {
  id: string;
  machine_draft_body: string | null;
  machine_should_send?: boolean | null;
};

const draftStore = vi.hoisted(() => [] as DraftRow[]);
const genStore = vi.hoisted(() => [] as GenRow[]);
const poolConcurrencyTracker = vi.hoisted(() => ({ peak: 0, active: 0 }));

vi.mock("@/lib/tyler-text-overview-admin", () => ({
  loadSendableTylerTextOverviewAudienceMembers: (...args: unknown[]) =>
    loadAudienceMock(...args),
}));

vi.mock("@/lib/tyler-text-overview-generate", () => ({
  generateTylerTextOverviewDraftForUser: (...args: unknown[]) =>
    generateMorningUserMock(...args),
  generateTylerTextOverviewEveningPreviewForUser: (...args: unknown[]) =>
    generateEveningUserMock(...args),
}));

vi.mock("@/lib/supabase-server", () => {
  function filterDrafts(filters: {
    day?: string;
    slot?: string;
    ids?: string[];
  }): DraftRow[] {
    return draftStore.filter((row) => {
      if (filters.day && row.draft_for_day_key !== filters.day) return false;
      if (filters.slot && row.send_slot !== filters.slot) return false;
      if (filters.ids && !filters.ids.includes(row.clerk_user_id)) return false;
      return true;
    });
  }

  function makeChain(table: string) {
    const filters: {
      day?: string;
      slot?: string;
      ids?: string[];
      genIds?: string[];
    } = {};
    const api: Record<string, unknown> = {};
    api.select = () => api;
    api.eq = (col: string, val: string) => {
      if (col === "draft_for_day_key") filters.day = val;
      if (col === "send_slot") filters.slot = val;
      return api;
    };
    api.in = (col: string, vals: string[]) => {
      if (col === "clerk_user_id") filters.ids = vals;
      if (col === "id") filters.genIds = vals;
      return Promise.resolve(
        table.includes("generation")
          ? {
              data: genStore.filter((g) =>
                filters.genIds ? filters.genIds.includes(g.id) : true
              ),
              error: null,
            }
          : {
              data: filterDrafts(filters),
              error: null,
            }
      );
    };
    api.maybeSingle = async () => ({ data: null, error: null });
    return api;
  }

  return {
    supabaseServer: {
      from: (table: string) => makeChain(table),
    },
  };
});

import {
  classifyTtoGenerateAllMember,
  generateEveningTtoDraftBatch,
  generateMorningTtoDraftBatch,
  generateTtoDraftBatch,
  processGenerateAllChunk,
  runPoolWithBudget,
  TTO_GENERATE_ALL_CHUNK_USER_CAP,
  TTO_GENERATE_ALL_CONCURRENCY,
  parseGenerateAllRequestBody,
} from "@/lib/tyler-text-overview-generate-all";
import { ttoGenerateAllSessionStorageKey } from "@/lib/tyler-text-overview-dashboard-copy";
import {
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
  TYLER_TEXT_OVERVIEW_ENABLED_ENV,
} from "@/lib/tyler-text-overview-types";

const DAY = "2026-08-07";
const FUTURE = "2026-08-08";
const NOW = new Date("2026-08-07T19:30:00.000Z");

function member(id: string, name: string) {
  return {
    clerkUserId: id,
    phoneNumber: `+1555${id.replace(/\D/g, "").padStart(7, "0").slice(-7)}`,
    timezone: "America/New_York",
    preferredName: name,
  };
}

function setDraft(partial: Partial<DraftRow> & { clerk_user_id: string; send_slot?: string }) {
  const row: DraftRow = {
    clerk_user_id: partial.clerk_user_id,
    draft_for_day_key: partial.draft_for_day_key ?? DAY,
    send_slot: partial.send_slot ?? SMS_DAILY_PRODUCTION_SEND_SLOT,
    status: partial.status ?? "current",
    current_generation_id: partial.current_generation_id ?? null,
    edited_by_tyler: partial.edited_by_tyler ?? null,
    current_body_source: partial.current_body_source ?? null,
    current_body_to_send: partial.current_body_to_send ?? null,
  };
  const idx = draftStore.findIndex(
    (d) =>
      d.clerk_user_id === row.clerk_user_id &&
      d.draft_for_day_key === row.draft_for_day_key &&
      d.send_slot === row.send_slot
  );
  if (idx >= 0) draftStore[idx] = row;
  else draftStore.push(row);
}

function setGen(id: string, body: string | null, machineShouldSend?: boolean) {
  const idx = genStore.findIndex((g) => g.id === id);
  const row: GenRow = {
    id,
    machine_draft_body: body,
    machine_should_send: machineShouldSend,
  };
  if (idx >= 0) genStore[idx] = row;
  else genStore.push(row);
}

function markGeneratedComplete(userId: string, slot = SMS_DAILY_PRODUCTION_SEND_SLOT) {
  const genId = `gen-${userId}-${slot}`;
  setGen(genId, `Machine draft for ${userId}`, true);
  setDraft({
    clerk_user_id: userId,
    send_slot: slot,
    status: "current",
    current_generation_id: genId,
    edited_by_tyler: false,
    current_body_source: "machine",
    current_body_to_send: `Machine draft for ${userId}`,
  });
}

function audienceOf(n: number) {
  return Array.from({ length: n }, (_, i) =>
    member(`user_${String(i + 1).padStart(3, "0")}`, `User${i + 1}`)
  );
}

describe("classifyTtoGenerateAllMember", () => {
  it("pending when no draft", () => {
    expect(classifyTtoGenerateAllMember({ draft: null, machineDraftBody: null })).toBe(
      "pending"
    );
  });

  it("already_sent", () => {
    expect(
      classifyTtoGenerateAllMember({
        draft: {
          clerk_user_id: "u",
          status: "sent",
          current_generation_id: "g",
          edited_by_tyler: false,
          current_body_source: "machine",
          current_body_to_send: "hi",
        },
        machineDraftBody: "hi",
      })
    ).toBe("already_sent");
  });

  it("noncurrent", () => {
    expect(
      classifyTtoGenerateAllMember({
        draft: {
          clerk_user_id: "u",
          status: "superseded",
          current_generation_id: null,
          edited_by_tyler: null,
          current_body_source: null,
          current_body_to_send: null,
        },
        machineDraftBody: null,
      })
    ).toBe("noncurrent");
  });

  it("protected_complete for Tyler edit", () => {
    expect(
      classifyTtoGenerateAllMember({
        draft: {
          clerk_user_id: "u",
          status: "current",
          current_generation_id: "g",
          edited_by_tyler: true,
          current_body_source: "tyler_edit",
          current_body_to_send: "Tyler body",
        },
        machineDraftBody: "machine",
      })
    ).toBe("protected_complete");
  });

  it("protected_complete for Tyler blank", () => {
    expect(
      classifyTtoGenerateAllMember({
        draft: {
          clerk_user_id: "u",
          status: "current",
          current_generation_id: "g",
          edited_by_tyler: true,
          current_body_source: "tyler_edit",
          current_body_to_send: "",
        },
        machineDraftBody: "machine",
      })
    ).toBe("protected_complete");
  });

  it("generated_complete when machine body present", () => {
    expect(
      classifyTtoGenerateAllMember({
        draft: {
          clerk_user_id: "u",
          status: "current",
          current_generation_id: "g",
          edited_by_tyler: false,
          current_body_source: "machine",
          current_body_to_send: "hi",
        },
        machineDraftBody: "hi",
      })
    ).toBe("generated_complete");
  });

  it("generated_complete even when machine_should_send is irrelevant to body presence", () => {
    // Classification uses body presence, not machine_should_send.
    expect(
      classifyTtoGenerateAllMember({
        draft: {
          clerk_user_id: "u",
          status: "current",
          current_generation_id: "g",
          edited_by_tyler: false,
          current_body_source: "machine",
          current_body_to_send: "no send body",
        },
        machineDraftBody: "no send body",
      })
    ).toBe("generated_complete");
  });

  it("failed_or_incomplete when current but blank machine body", () => {
    expect(
      classifyTtoGenerateAllMember({
        draft: {
          clerk_user_id: "u",
          status: "current",
          current_generation_id: "g",
          edited_by_tyler: false,
          current_body_source: "machine",
          current_body_to_send: null,
        },
        machineDraftBody: null,
      })
    ).toBe("failed_or_incomplete");
  });
});

describe("runPoolWithBudget", () => {
  it("never exceeds concurrency 2", async () => {
    poolConcurrencyTracker.peak = 0;
    poolConcurrencyTracker.active = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await runPoolWithBudget({
      items,
      concurrency: 2,
      shouldStop: () => false,
      worker: async () => {
        poolConcurrencyTracker.active += 1;
        poolConcurrencyTracker.peak = Math.max(
          poolConcurrencyTracker.peak,
          poolConcurrencyTracker.active
        );
        await new Promise((r) => setTimeout(r, 5));
        poolConcurrencyTracker.active -= 1;
        return "ok";
      },
    });
    expect(poolConcurrencyTracker.peak).toBeLessThanOrEqual(2);
  });

  it("does not start new work after shouldStop", async () => {
    let clock = 0;
    const { started } = await runPoolWithBudget({
      items: [1, 2, 3, 4, 5, 6, 7, 8],
      concurrency: 2,
      shouldStop: () => clock >= 1,
      worker: async () => {
        clock += 1;
        await new Promise((r) => setTimeout(r, 1));
        return "ok";
      },
    });
    expect(started).toBeLessThanOrEqual(2);
  });
});

describe("processGenerateAllChunk / Generate All", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env = { ...env, [TYLER_TEXT_OVERVIEW_ENABLED_ENV]: "true" };
    draftStore.length = 0;
    genStore.length = 0;
    loadAudienceMock.mockReset();
    generateMorningUserMock.mockReset();
    generateEveningUserMock.mockReset();
    loadAudienceMock.mockResolvedValue([
      member("user_a", "Alex"),
      member("user_b", "Blake"),
    ]);

    generateMorningUserMock.mockImplementation(async (args: {
      audienceUser: { clerk_user_id: string };
    }) => {
      const id = args.audienceUser.clerk_user_id;
      markGeneratedComplete(id, SMS_DAILY_PRODUCTION_SEND_SLOT);
      return {
        ok: true,
        generationId: `gen-${id}-morning`,
        supersedeFailed: false,
        currentDraftProtected: false,
      };
    });

    generateEveningUserMock.mockImplementation(async (args: { clerkUserId: string }) => {
      const id = args.clerkUserId;
      markGeneratedComplete(id, SMS_DAILY_EVENING_PREVIEW_SEND_SLOT);
      return {
        ok: true,
        generationId: `gen-${id}-evening`,
        supersedeFailed: false,
        currentDraftProtected: false,
      };
    });
  });

  afterEach(() => {
    process.env = env;
  });

  it("Morning uses exact selected day (wall-clock does not override)", async () => {
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.draftForDayKey).toBe(DAY);
    expect(result.sendSlot).toBe(SMS_DAILY_PRODUCTION_SEND_SLOT);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(2);
    for (const call of generateMorningUserMock.mock.calls) {
      expect(call[0].draftForDayKey).toBe(DAY);
      expect(call[0].now).toBe(NOW);
    }
    expect(generateEveningUserMock).not.toHaveBeenCalled();
  });

  it("Evening uses exact selected day (wall-clock does not override)", async () => {
    const result = await generateEveningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.draftForDayKey).toBe(DAY);
    expect(result.sendSlot).toBe(SMS_DAILY_EVENING_PREVIEW_SEND_SLOT);
    expect(generateEveningUserMock).toHaveBeenCalledTimes(2);
    expect(generateMorningUserMock).not.toHaveBeenCalled();
  });

  it("future Morning and Evening days work independently", async () => {
    const morning = await generateMorningTtoDraftBatch({
      draftForDayKey: FUTURE,
      now: NOW,
    });
    const evening = await generateEveningTtoDraftBatch({
      draftForDayKey: FUTURE,
      now: NOW,
    });
    expect(morning.ok).toBe(true);
    expect(evening.ok).toBe(true);
    if ("status" in morning || "status" in evening) throw new Error("unexpected");
    expect(morning.draftForDayKey).toBe(FUTURE);
    expect(evening.draftForDayKey).toBe(FUTURE);
    expect(morning.sendSlot).toBe(SMS_DAILY_PRODUCTION_SEND_SLOT);
    expect(evening.sendSlot).toBe(SMS_DAILY_EVENING_PREVIEW_SEND_SLOT);
  });

  it("Morning+Evening same day both supported without cross-slot skip", async () => {
    markGeneratedComplete("user_a", SMS_DAILY_EVENING_PREVIEW_SEND_SLOT);
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.already_sent).toBe(0);
    expect(result.generated_complete).toBe(2);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(2);
  });

  it("missing drafts are generated", async () => {
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.generated_this_chunk).toBe(2);
    expect(result.generated_complete).toBe(2);
    expect(result.targeted).toBe(2);
    expect(result.is_complete).toBe(true);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(2);
  });

  it("successful current machine draft skipped on resume (generated_complete)", async () => {
    markGeneratedComplete("user_a");
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.generated_complete).toBe(2);
    expect(result.processed_this_chunk).toBe(1);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(1);
    expect(generateMorningUserMock.mock.calls[0][0].audienceUser.clerk_user_id).toBe(
      "user_b"
    );
  });

  it("machine_should_send=false successful generation still complete", async () => {
    setGen("gen-nosend", "body ok", false);
    setDraft({
      clerk_user_id: "user_a",
      status: "current",
      current_generation_id: "gen-nosend",
      edited_by_tyler: false,
      current_body_source: "machine",
      current_body_to_send: "body ok",
    });
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.generated_complete).toBe(2);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(1);
    expect(generateMorningUserMock.mock.calls[0][0].audienceUser.clerk_user_id).toBe(
      "user_b"
    );
  });

  it("Tyler edit skipped/protected without regenerating", async () => {
    setDraft({
      clerk_user_id: "user_a",
      status: "current",
      current_generation_id: "gen-t",
      edited_by_tyler: true,
      current_body_source: "tyler_edit",
      current_body_to_send: "Tyler wrote this",
    });
    setGen("gen-t", "old machine");
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.protected_complete).toBe(1);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(1);
    expect(generateMorningUserMock.mock.calls[0][0].audienceUser.clerk_user_id).toBe(
      "user_b"
    );
  });

  it("Tyler blank skipped/protected", async () => {
    setDraft({
      clerk_user_id: "user_a",
      status: "current",
      current_generation_id: "gen-blank",
      edited_by_tyler: true,
      current_body_source: "tyler_edit",
      current_body_to_send: "",
    });
    setGen("gen-blank", "machine");
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.protected_complete).toBe(1);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(1);
  });

  it("sent skipped", async () => {
    setDraft({
      clerk_user_id: "user_a",
      status: "sent",
      current_generation_id: "gen-s",
      current_body_to_send: "sent body",
    });
    setGen("gen-s", "sent body");
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.already_sent).toBe(1);
    expect(result.skippedAlreadySent).toBe(1);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(1);
  });

  it("noncurrent skipped", async () => {
    setDraft({
      clerk_user_id: "user_a",
      status: "superseded",
    });
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.noncurrent).toBe(1);
    expect(result.skippedNonCurrent).toBe(1);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(1);
  });

  it("failed/incomplete generated on resume", async () => {
    setDraft({
      clerk_user_id: "user_a",
      status: "current",
      current_generation_id: "gen-bad",
      edited_by_tyler: false,
      current_body_source: "machine",
      current_body_to_send: null,
    });
    setGen("gen-bad", null);
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(generateMorningUserMock).toHaveBeenCalledTimes(2);
    expect(result.generated_complete).toBe(2);
  });

  it("failed user does not stop another user in the same chunk", async () => {
    generateMorningUserMock
      .mockImplementationOnce(async () => ({
        ok: false,
        reason: "sol_failed",
        error: "interpreter boom",
      }))
      .mockImplementationOnce(async (args: {
        audienceUser: { clerk_user_id: string };
      }) => {
        markGeneratedComplete(args.audienceUser.clerk_user_id);
        return {
          ok: true,
          generationId: "gen-ok",
          supersedeFailed: false,
          currentDraftProtected: false,
        };
      });
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.clerkUserId).toBe("user_a");
    expect(result.generated_this_chunk).toBe(1);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(2);
  });

  it("failed user does not stop next chunk", async () => {
    const audience = audienceOf(10);
    loadAudienceMock.mockResolvedValue(audience);
    generateMorningUserMock.mockImplementation(async (args: {
      audienceUser: { clerk_user_id: string };
    }) => {
      const id = args.audienceUser.clerk_user_id;
      if (id === "user_001") {
        setDraft({
          clerk_user_id: id,
          status: "current",
          current_generation_id: "gen-bad-001",
          edited_by_tyler: false,
          current_body_source: "machine",
          current_body_to_send: null,
        });
        setGen("gen-bad-001", null);
        return { ok: false, reason: "sol_failed", error: "boom" };
      }
      markGeneratedComplete(id);
      return {
        ok: true,
        generationId: `gen-${id}`,
        supersedeFailed: false,
        currentDraftProtected: false,
      };
    });

    const frozen = audience.map((m) => m.clerkUserId);
    const chunk1 = await processGenerateAllChunk({
      draftForDayKey: DAY,
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      now: NOW,
      audienceClerkUserIds: frozen,
      chunkUserCap: 8,
    });
    expect(chunk1.ok).toBe(false);
    if ("status" in chunk1) throw new Error("unexpected");
    expect(chunk1.processed_this_chunk).toBe(8);
    expect(chunk1.failures.some((f) => f.clerkUserId === "user_001")).toBe(true);

    const chunk2 = await processGenerateAllChunk({
      draftForDayKey: DAY,
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      now: NOW,
      audienceClerkUserIds: frozen,
      excludeClerkUserIds: chunk1.failures.map((f) => f.clerkUserId),
      chunkUserCap: 8,
    });
    if ("status" in chunk2) throw new Error("unexpected");
    expect(chunk2.processed_this_chunk).toBe(2);
    expect(chunk2.generated_complete).toBe(9);
    expect(chunk2.failed).toBe(1);
    expect(chunk2.is_complete).toBe(false);
  });

  it("completed user never regenerated by Generate All", async () => {
    markGeneratedComplete("user_a");
    markGeneratedComplete("user_b");
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected");
    expect(result.processed_this_chunk).toBe(0);
    expect(result.is_complete).toBe(true);
    expect(generateMorningUserMock).not.toHaveBeenCalled();
  });

  it("frozen audience stays stable; new eligible user not silently appended", async () => {
    const frozen = ["user_a", "user_b"];
    loadAudienceMock.mockResolvedValue([
      member("user_a", "Alex"),
      member("user_b", "Blake"),
      member("user_c", "Casey"),
    ]);
    const result = await processGenerateAllChunk({
      draftForDayKey: DAY,
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      now: NOW,
      audienceClerkUserIds: frozen,
    });
    if ("status" in result) throw new Error("unexpected");
    expect(result.audience_clerk_user_ids).toEqual(frozen);
    expect(result.targeted).toBe(2);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(2);
    const generatedIds = generateMorningUserMock.mock.calls.map(
      (c) => c[0].audienceUser.clerk_user_id
    );
    expect(generatedIds).not.toContain("user_c");
  });

  it("dropped eligibility handled truthfully", async () => {
    loadAudienceMock.mockResolvedValue([member("user_b", "Blake")]);
    const result = await processGenerateAllChunk({
      draftForDayKey: DAY,
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      now: NOW,
      audienceClerkUserIds: ["user_a", "user_b"],
    });
    if ("status" in result) throw new Error("unexpected");
    expect(result.failures.some((f) => f.clerkUserId === "user_a")).toBe(true);
    expect(result.failures.find((f) => f.clerkUserId === "user_a")!.error).toBe(
      "user_not_in_sendable_audience"
    );
    expect(result.generated_complete).toBe(1);
  });

  it("chunk cap obeyed (max 8 processed)", async () => {
    loadAudienceMock.mockResolvedValue(audienceOf(20));
    const result = await processGenerateAllChunk({
      draftForDayKey: DAY,
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      now: NOW,
      chunkUserCap: TTO_GENERATE_ALL_CHUNK_USER_CAP,
    });
    if ("status" in result) throw new Error("unexpected");
    expect(result.processed_this_chunk).toBe(8);
    expect(result.targeted).toBe(20);
    expect(result.remaining).toBe(12);
    expect(result.is_complete).toBe(false);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(8);
  });

  it("38-user frozen batch completes across multiple chunks", async () => {
    const audience = audienceOf(38);
    loadAudienceMock.mockResolvedValue(audience);
    let frozen: string[] | null = null;
    let remaining = 38;
    let chunks = 0;
    while (remaining > 0 && chunks < 20) {
      chunks += 1;
      const result = await processGenerateAllChunk({
        draftForDayKey: DAY,
        sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
        now: NOW,
        audienceClerkUserIds: frozen,
      });
      if ("status" in result) throw new Error("unexpected");
      frozen = result.audience_clerk_user_ids;
      expect(frozen).toHaveLength(38);
      remaining = result.remaining;
      if (result.is_complete) break;
      expect(result.processed_this_chunk).toBeGreaterThan(0);
    }
    expect(remaining).toBe(0);
    expect(chunks).toBeGreaterThan(1);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(38);
  });

  it("simulated 250-user audience completes through repeated chunks; one request never processes all 250", async () => {
    const audience = audienceOf(250);
    loadAudienceMock.mockResolvedValue(audience);
    let frozen: string[] | null = null;
    let remaining = 250;
    let chunks = 0;
    let maxProcessed = 0;
    while (remaining > 0 && chunks < 80) {
      chunks += 1;
      const result = await processGenerateAllChunk({
        draftForDayKey: DAY,
        sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
        now: NOW,
        audienceClerkUserIds: frozen,
      });
      if ("status" in result) throw new Error("unexpected");
      frozen = result.audience_clerk_user_ids;
      maxProcessed = Math.max(maxProcessed, result.processed_this_chunk);
      remaining = result.remaining;
      if (result.is_complete) break;
    }
    expect(remaining).toBe(0);
    expect(maxProcessed).toBeLessThanOrEqual(TTO_GENERATE_ALL_CHUNK_USER_CAP);
    expect(maxProcessed).toBeLessThan(250);
    expect(chunks).toBeGreaterThanOrEqual(Math.ceil(250 / TTO_GENERATE_ALL_CHUNK_USER_CAP));
    expect(generateMorningUserMock).toHaveBeenCalledTimes(250);
  });

  it("elapsed-time stop obeyed", async () => {
    loadAudienceMock.mockResolvedValue(audienceOf(8));
    let t = 0;
    generateMorningUserMock.mockImplementation(async (args: {
      audienceUser: { clerk_user_id: string };
    }) => {
      t += 100;
      markGeneratedComplete(args.audienceUser.clerk_user_id);
      return {
        ok: true,
        generationId: "g",
        supersedeFailed: false,
        currentDraftProtected: false,
      };
    });
    const result = await processGenerateAllChunk({
      draftForDayKey: DAY,
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      now: NOW,
      timeBudgetMs: 50,
      nowMs: () => t,
      concurrency: 2,
    });
    if ("status" in result) throw new Error("unexpected");
    expect(result.processed_this_chunk).toBeLessThan(8);
    expect(result.is_complete).toBe(false);
  });

  it("concurrency constant is 2", () => {
    expect(TTO_GENERATE_ALL_CONCURRENCY).toBe(2);
  });

  it("no cross-user packet/body association — each generate gets its own user id", async () => {
    await generateMorningTtoDraftBatch({ draftForDayKey: DAY, now: NOW });
    const ids = generateMorningUserMock.mock.calls.map(
      (c) => c[0].audienceUser.clerk_user_id
    );
    expect(ids).toEqual(["user_a", "user_b"]);
    expect(new Set(ids).size).toBe(2);
  });

  it("progress / remaining / is_complete truthful", async () => {
    markGeneratedComplete("user_a");
    setDraft({
      clerk_user_id: "user_b",
      status: "sent",
    });
    loadAudienceMock.mockResolvedValue([
      member("user_a", "Alex"),
      member("user_b", "Blake"),
      member("user_c", "Casey"),
    ]);
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    if ("status" in result) throw new Error("unexpected");
    expect(result.targeted).toBe(3);
    expect(result.generated_complete).toBe(2);
    expect(result.already_sent).toBe(1);
    expect(result.pending).toBe(0);
    expect(result.remaining).toBe(0);
    expect(result.is_complete).toBe(true);
  });

  it("Resume processes only incomplete (exclude + COMPLETE skip)", async () => {
    markGeneratedComplete("user_a");
    const result = await processGenerateAllChunk({
      draftForDayKey: DAY,
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      now: NOW,
      audienceClerkUserIds: ["user_a", "user_b"],
      excludeClerkUserIds: [],
    });
    if ("status" in result) throw new Error("unexpected");
    expect(generateMorningUserMock).toHaveBeenCalledTimes(1);
    expect(generateMorningUserMock.mock.calls[0][0].audienceUser.clerk_user_id).toBe(
      "user_b"
    );
  });

  it("parseGenerateAllRequestBody accepts frozen audience", () => {
    const parsed = parseGenerateAllRequestBody({
      draft_for_day_key: DAY,
      audience_clerk_user_ids: ["a", "b"],
      exclude_clerk_user_ids: ["a"],
    });
    expect(parsed).toEqual({
      draftForDayKey: DAY,
      audienceClerkUserIds: ["a", "b"],
      excludeClerkUserIds: ["a"],
    });
  });

  it("sessionStorage key includes day+slot", () => {
    expect(
      ttoGenerateAllSessionStorageKey({
        sendSlot: "morning",
        draftForDayKey: DAY,
      })
    ).toBe(`tto-generate-all:morning:${DAY}`);
    expect(
      ttoGenerateAllSessionStorageKey({
        sendSlot: "evening_checkin",
        draftForDayKey: DAY,
      })
    ).toBe(`tto-generate-all:evening_checkin:${DAY}`);
  });

  it("rejects invalid draft_for_day_key", async () => {
    const result = await generateTtoDraftBatch({
      draftForDayKey: "not-a-day",
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!("status" in result)) throw new Error("expected status error");
    expect(result.status).toBe(400);
  });

  it("no Twilio / send / reservation imports in orchestrator or routes", () => {
    const files = [
      "src/lib/tyler-text-overview-generate-all.ts",
      "src/app/api/admin/tyler-text-overview/morning-generate-all/route.ts",
      "src/app/api/admin/tyler-text-overview/evening-generate-all/route.ts",
    ];
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src).not.toMatch(/sendSMS/);
      expect(src).not.toMatch(/from ["']@\/lib\/twilio/);
      expect(src).not.toMatch(/daily-sms-scheduling/);
      expect(src).not.toMatch(/tyler-text-overview-evening-send/);
      expect(src).not.toMatch(/evening-sms/);
      expect(src).not.toMatch(/reserveSms|sms_send_events/);
      expect(src).not.toMatch(/CRON_SECRET/);
    }
  });

  it("orchestrator does not import writer/interpreter modules", () => {
    const orch = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-generate-all.ts"),
      "utf8"
    );
    expect(orch).not.toContain("morning-tto-writer");
    expect(orch).not.toContain("morning-tto-coaching-brief");
    expect(orch).not.toContain("buildDailySmsContent");
  });

  it("admin routes fix slot server-side, auth, and maxDuration=300", () => {
    const morning = readFileSync(
      join(
        process.cwd(),
        "src/app/api/admin/tyler-text-overview/morning-generate-all/route.ts"
      ),
      "utf8"
    );
    const evening = readFileSync(
      join(
        process.cwd(),
        "src/app/api/admin/tyler-text-overview/evening-generate-all/route.ts"
      ),
      "utf8"
    );
    expect(morning).toContain("requireTylerAdmin");
    expect(morning).toContain("generateMorningTtoDraftBatch");
    expect(morning).toContain("maxDuration = 300");
    expect(evening).toContain("requireTylerAdmin");
    expect(evening).toContain("generateEveningTtoDraftBatch");
    expect(evening).toContain("maxDuration = 300");
    expect(morning).not.toContain("generateEveningTtoDraftBatch");
    expect(evening).not.toContain("generateMorningTtoDraftBatch");
  });

  it("dashboard auto-chains Generate All and uses sessionStorage snapshot", () => {
    const dashboard = readFileSync(
      join(
        process.cwd(),
        "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx"
      ),
      "utf8"
    );
    expect(dashboard).toContain("ttoGenerateAllSessionStorageKey");
    expect(dashboard).toContain("audience_clerk_user_ids");
    expect(dashboard).toContain("exclude_clerk_user_ids");
    expect(dashboard).toContain("processed_this_chunk");
    expect(dashboard).toContain("resumeAvailable");
    expect(dashboard).not.toContain("/api/cron/tyler-text-overview-generate");
  });

  it("explicit per-user Regenerate path remains outside Generate All COMPLETE skip", () => {
    const orch = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-generate-all.ts"),
      "utf8"
    );
    expect(orch).toContain("classifyTtoGenerateAllMember");
    // Per-user evening preview route must not call processGenerateAllChunk.
    const eveningPreview = readFileSync(
      join(
        process.cwd(),
        "src/app/api/admin/tyler-text-overview/evening-preview/route.ts"
      ),
      "utf8"
    );
    expect(eveningPreview).not.toContain("processGenerateAllChunk");
    expect(eveningPreview).not.toContain("classifyTtoGenerateAllMember");
    expect(eveningPreview).toContain("generateTylerTextOverviewEveningPreviewForUser");
  });

  it("ok:true + null body + openai_request_failed becomes Generate All failure/exclude", async () => {
    generateEveningUserMock.mockImplementation(async (args: { clerkUserId: string }) => {
      const id = args.clerkUserId;
      setDraft({
        clerk_user_id: id,
        send_slot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
        status: "current",
        current_generation_id: `gen-soft-${id}`,
        edited_by_tyler: false,
        current_body_source: "machine",
        current_body_to_send: null,
      });
      setGen(`gen-soft-${id}`, null, false);
      return {
        ok: true,
        body: null,
        machineShouldSend: false,
        machineNoSendReason: "openai_request_failed",
        generationId: `gen-soft-${id}`,
        supersedeFailed: false,
        currentDraftProtected: false,
      };
    });

    const frozen = ["user_a", "user_b"];
    const chunk1 = await processGenerateAllChunk({
      draftForDayKey: DAY,
      sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      now: NOW,
      audienceClerkUserIds: frozen,
    });
    if ("status" in chunk1) throw new Error("unexpected");
    expect(chunk1.processed_this_chunk).toBe(2);
    expect(chunk1.failures).toHaveLength(2);
    expect(chunk1.failures.every((f) => f.error === "openai_request_failed")).toBe(true);
    expect(chunk1.generated_this_chunk).toBe(0);
    expect(generateEveningUserMock).toHaveBeenCalledTimes(2);

    const chunk2 = await processGenerateAllChunk({
      draftForDayKey: DAY,
      sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      now: NOW,
      audienceClerkUserIds: frozen,
      excludeClerkUserIds: chunk1.failures.map((f) => f.clerkUserId),
    });
    if ("status" in chunk2) throw new Error("unexpected");
    expect(chunk2.processed_this_chunk).toBe(0);
    expect(generateEveningUserMock).toHaveBeenCalledTimes(2);
    expect(chunk2.failed).toBe(2);
    expect(chunk2.is_complete).toBe(false);
  });

  it("full chunk of soft failures advances later frozen-audience users", async () => {
    const audience = audienceOf(10);
    loadAudienceMock.mockResolvedValue(audience);
    const softFailed = new Set<string>();
    generateEveningUserMock.mockImplementation(async (args: { clerkUserId: string }) => {
      const id = args.clerkUserId;
      const idx = audience.findIndex((m) => m.clerkUserId === id);
      if (idx >= 0 && idx < 8) {
        softFailed.add(id);
        setDraft({
          clerk_user_id: id,
          send_slot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
          status: "current",
          current_generation_id: `gen-soft-${id}`,
          edited_by_tyler: false,
          current_body_source: "machine",
          current_body_to_send: null,
        });
        setGen(`gen-soft-${id}`, null, false);
        return {
          ok: true,
          body: null,
          machineShouldSend: false,
          machineNoSendReason: "openai_request_failed",
          generationId: `gen-soft-${id}`,
          supersedeFailed: false,
          currentDraftProtected: false,
        };
      }
      markGeneratedComplete(id, SMS_DAILY_EVENING_PREVIEW_SEND_SLOT);
      return {
        ok: true,
        body: `Evening body for ${id}`,
        machineShouldSend: true,
        machineNoSendReason: null,
        generationId: `gen-${id}-evening`,
        supersedeFailed: false,
        currentDraftProtected: false,
      };
    });

    const frozen = audience.map((m) => m.clerkUserId);
    const chunk1 = await processGenerateAllChunk({
      draftForDayKey: DAY,
      sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      now: NOW,
      audienceClerkUserIds: frozen,
      chunkUserCap: 8,
    });
    if ("status" in chunk1) throw new Error("unexpected");
    expect(chunk1.processed_this_chunk).toBe(8);
    expect(chunk1.failures).toHaveLength(8);
    expect(chunk1.failures.every((f) => f.error === "openai_request_failed")).toBe(true);

    const chunk2 = await processGenerateAllChunk({
      draftForDayKey: DAY,
      sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      now: NOW,
      audienceClerkUserIds: frozen,
      excludeClerkUserIds: chunk1.failures.map((f) => f.clerkUserId),
      chunkUserCap: 8,
    });
    if ("status" in chunk2) throw new Error("unexpected");
    expect(chunk2.processed_this_chunk).toBe(2);
    expect(chunk2.generated_complete).toBe(2);
    expect(chunk2.failed).toBe(8);
    expect(chunk2.failures).toHaveLength(0);
    const secondIds = generateEveningUserMock.mock.calls
      .slice(8)
      .map((c) => c[0].clerkUserId);
    expect(secondIds).toEqual(["user_009", "user_010"]);
    expect(secondIds.every((id) => !softFailed.has(id))).toBe(true);
  });

  it("Morning soft-fail ok:true + null body uses same shared orchestration", async () => {
    generateMorningUserMock.mockImplementation(async (args: {
      audienceUser: { clerk_user_id: string };
    }) => {
      const id = args.audienceUser.clerk_user_id;
      if (id === "user_a") {
        setDraft({
          clerk_user_id: id,
          status: "current",
          current_generation_id: "gen-soft-a",
          edited_by_tyler: false,
          current_body_source: "machine",
          current_body_to_send: null,
        });
        setGen("gen-soft-a", null, false);
        return {
          ok: true,
          body: null,
          machineShouldSend: false,
          generationId: "gen-soft-a",
          supersedeFailed: false,
          currentDraftProtected: false,
        };
      }
      markGeneratedComplete(id);
      return {
        ok: true,
        body: `Machine draft for ${id}`,
        machineShouldSend: true,
        generationId: `gen-${id}-morning`,
        supersedeFailed: false,
        currentDraftProtected: false,
      };
    });

    const chunk1 = await processGenerateAllChunk({
      draftForDayKey: DAY,
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      now: NOW,
    });
    if ("status" in chunk1) throw new Error("unexpected");
    expect(chunk1.failures).toEqual([
      expect.objectContaining({
        clerkUserId: "user_a",
        error: "generation_incomplete",
      }),
    ]);
    expect(chunk1.generated_complete).toBe(1);

    const chunk2 = await processGenerateAllChunk({
      draftForDayKey: DAY,
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      now: NOW,
      audienceClerkUserIds: chunk1.audience_clerk_user_ids,
      excludeClerkUserIds: chunk1.failures.map((f) => f.clerkUserId),
    });
    if ("status" in chunk2) throw new Error("unexpected");
    expect(chunk2.processed_this_chunk).toBe(0);
    expect(generateMorningUserMock.mock.calls.map((c) => c[0].audienceUser.clerk_user_id)).toEqual([
      "user_a",
      "user_b",
    ]);
  });

  it("Resume without exclude can retry failed_or_incomplete soft failures", async () => {
    setDraft({
      clerk_user_id: "user_a",
      status: "current",
      current_generation_id: "gen-soft-a",
      edited_by_tyler: false,
      current_body_source: "machine",
      current_body_to_send: null,
    });
    setGen("gen-soft-a", null, false);
    markGeneratedComplete("user_b");

    generateMorningUserMock.mockImplementation(async (args: {
      audienceUser: { clerk_user_id: string };
    }) => {
      const id = args.audienceUser.clerk_user_id;
      markGeneratedComplete(id);
      return {
        ok: true,
        body: `Recovered ${id}`,
        machineShouldSend: true,
        generationId: `gen-${id}-recovered`,
        supersedeFailed: false,
        currentDraftProtected: false,
      };
    });

    const result = await processGenerateAllChunk({
      draftForDayKey: DAY,
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      now: NOW,
      audienceClerkUserIds: ["user_a", "user_b"],
      excludeClerkUserIds: [],
    });
    if ("status" in result) throw new Error("unexpected");
    expect(result.processed_this_chunk).toBe(1);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(1);
    expect(generateMorningUserMock.mock.calls[0]![0].audienceUser.clerk_user_id).toBe(
      "user_a"
    );
    expect(result.generated_complete).toBe(2);
    expect(result.is_complete).toBe(true);
  });

  it("Generate All soft-fail helper is exported for shared Morning/Evening accounting", () => {
    const orch = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-generate-all.ts"),
      "utf8"
    );
    expect(orch).toContain("generateAllSoftFailureError");
    expect(orch).toContain('return { ok: false, error: softError }');
  });
});
