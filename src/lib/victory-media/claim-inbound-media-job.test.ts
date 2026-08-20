import { beforeEach, describe, expect, it, vi } from "vitest";

type JobRow = Record<string, unknown>;

const jobs = new Map<string, JobRow>();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table !== "v2_inbound_media_job") throw new Error(`unexpected ${table}`);
      return {
        select: () => ({
          eq: (col: string, val: string) => ({
            maybeSingle: async () => {
              if (col === "id") {
                return { data: jobs.get(val) ?? null, error: null };
              }
              return { data: null, error: null };
            },
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          const filters: Array<[string, unknown]> = [];
          const api = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return api;
            },
            is(col: string, val: unknown) {
              filters.push([col, val]);
              return api;
            },
            select() {
              return {
                maybeSingle: async () => {
                  const idFilter = filters.find((f) => f[0] === "id");
                  if (!idFilter) return { data: null, error: null };
                  const id = String(idFilter[1]);
                  const row = jobs.get(id);
                  if (!row) return { data: null, error: null };
                  for (const [c, v] of filters) {
                    if (c === "id") continue;
                    if (v === null) {
                      if (row[c] != null) return { data: null, error: null };
                    } else if (row[c] !== v) {
                      return { data: null, error: null };
                    }
                  }
                  const next = { ...row, ...patch };
                  jobs.set(id, next);
                  return { data: next, error: null };
                },
              };
            },
          };
          return api;
        },
      };
    },
  },
}));

import {
  claimInboundMediaJobForDownload,
  claimInboundMediaJobForNormalize,
  claimInboundMediaJobForNormalizeAfterSuccessfulB1,
  INBOUND_MEDIA_B1_MAX_ATTEMPTS,
  INBOUND_MEDIA_B1_STALE_NORMALIZING_MS,
  INBOUND_MEDIA_B2_LEASE_MS,
  INBOUND_MEDIA_B2_MAX_ATTEMPTS,
  isInboundMediaJobActionableForB1Download,
  isInboundMediaJobActionableForB2,
  isInboundMediaJobB2Ready,
  isInboundMediaJobExpiresAtPast,
  isInboundMediaJobTombstonedOrRemoved,
  pickActionableInboundMediaJobIds,
  pickActionableInboundMediaJobIdsForB2,
  type InboundMediaJobActionableLite,
} from "@/lib/victory-media/claim-inbound-media-job";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const JOB_B = "22222222-2222-4222-8222-222222222222";
const JOB_C = "33333333-3333-4333-8333-333333333333";
const USER = "user_b1_claim";
const SM = "SMbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ME = "MEcccccccccccccccccccccccccccccccc";

const NOW = new Date("2026-08-13T12:00:00.000Z");

function seed(partial: Partial<JobRow> = {}, id = JOB_ID): JobRow {
  const row: JobRow = {
    id,
    message_sid: SM,
    media_ordinal: 0,
    clerk_user_id: USER,
    twilio_media_sid: ME,
    declared_content_type: "image/jpeg",
    status: "pending_download",
    attempt_count: 0,
    next_retry_at: null,
    last_error_code: null,
    temp_storage_path: null,
    normalized_storage_path: null,
    attached_win_id: null,
    resolution: null,
    classifier_target: null,
    followup_idempotency_key: null,
    expires_at: null,
    tombstoned_at: null,
    created_at: "2026-08-12T00:00:00.000Z",
    updated_at: "2026-08-12T00:00:00.000Z",
    ...partial,
    id: partial.id ?? id,
  };
  jobs.set(String(row.id), row);
  return row;
}

function lite(partial: Partial<InboundMediaJobActionableLite>): InboundMediaJobActionableLite {
  return {
    id: JOB_ID,
    status: "pending_download",
    attempt_count: 0,
    next_retry_at: null,
    temp_storage_path: null,
    resolution: null,
    tombstoned_at: null,
    created_at: "2026-08-12T00:00:00.000Z",
    updated_at: "2026-08-12T00:00:00.000Z",
    ...partial,
  };
}

describe("pickActionableInboundMediaJobIds / actionable predicate", () => {
  it("selects pending_download", () => {
    const ids = pickActionableInboundMediaJobIds(
      [lite({ id: JOB_ID, status: "pending_download" })],
      2,
      NOW
    );
    expect(ids).toEqual([JOB_ID]);
  });

  it("selects due failed; not future, not terminal null retry, not at attempt cap", () => {
    const due = lite({
      id: JOB_ID,
      status: "failed",
      attempt_count: 2,
      next_retry_at: "2026-08-13T11:59:00.000Z",
    });
    const future = lite({
      id: JOB_B,
      status: "failed",
      attempt_count: 1,
      next_retry_at: "2026-08-13T12:30:00.000Z",
    });
    const terminal = lite({
      id: JOB_C,
      status: "failed",
      attempt_count: 3,
      next_retry_at: null,
    });
    const atCap = lite({
      id: "44444444-4444-4444-8444-444444444444",
      status: "failed",
      attempt_count: INBOUND_MEDIA_B1_MAX_ATTEMPTS,
      next_retry_at: "2026-08-13T11:00:00.000Z",
    });
    expect(isInboundMediaJobActionableForB1Download(due, NOW)).toBe(true);
    expect(isInboundMediaJobActionableForB1Download(future, NOW)).toBe(false);
    expect(isInboundMediaJobActionableForB1Download(terminal, NOW)).toBe(false);
    expect(isInboundMediaJobActionableForB1Download(atCap, NOW)).toBe(false);
    expect(pickActionableInboundMediaJobIds([due, future, terminal, atCap], 5, NOW)).toEqual([
      JOB_ID,
    ]);
  });

  it("failed + temp is never B1-actionable (B2 retry phase)", () => {
    const failedTemp = lite({
      id: JOB_ID,
      status: "failed",
      attempt_count: 2,
      next_retry_at: "2026-08-13T11:59:00.000Z",
      temp_storage_path: `${USER}/mms-temp/${JOB_ID}.bin`,
    });
    const failedNull = lite({
      id: JOB_B,
      status: "failed",
      attempt_count: 2,
      next_retry_at: "2026-08-13T11:59:00.000Z",
      temp_storage_path: null,
    });
    expect(isInboundMediaJobActionableForB1Download(failedTemp, NOW)).toBe(false);
    expect(isInboundMediaJobActionableForB1Download(failedNull, NOW)).toBe(true);
    expect(pickActionableInboundMediaJobIds([failedTemp, failedNull], 5, NOW)).toEqual([
      JOB_B,
    ]);
  });

  it("selects stale normalizing + null temp; not fresh; never B1-complete with temp", () => {
    const staleUpdated = new Date(
      NOW.getTime() - INBOUND_MEDIA_B1_STALE_NORMALIZING_MS - 1000
    ).toISOString();
    const freshUpdated = new Date(NOW.getTime() - 60_000).toISOString();
    const stale = lite({
      id: JOB_ID,
      status: "normalizing",
      attempt_count: 1,
      temp_storage_path: null,
      updated_at: staleUpdated,
    });
    const fresh = lite({
      id: JOB_B,
      status: "normalizing",
      attempt_count: 1,
      temp_storage_path: null,
      updated_at: freshUpdated,
    });
    const complete = lite({
      id: JOB_C,
      status: "normalizing",
      attempt_count: 1,
      temp_storage_path: `${USER}/mms-temp/${JOB_C}.bin`,
      updated_at: staleUpdated,
    });
    expect(isInboundMediaJobActionableForB1Download(stale, NOW)).toBe(true);
    expect(isInboundMediaJobActionableForB1Download(fresh, NOW)).toBe(false);
    expect(isInboundMediaJobActionableForB1Download(complete, NOW)).toBe(false);
    expect(pickActionableInboundMediaJobIds([stale, fresh, complete], 5, NOW)).toEqual([
      JOB_ID,
    ]);
  });

  it("excludes tombstoned, removed, expired", () => {
    const rows = [
      lite({ id: JOB_ID, status: "tombstoned", tombstoned_at: NOW.toISOString() }),
      lite({ id: JOB_B, status: "failed", resolution: "removed", next_retry_at: "2026-08-13T11:00:00.000Z" }),
      lite({ id: JOB_C, status: "expired" }),
    ];
    expect(pickActionableInboundMediaJobIds(rows, 5, NOW)).toEqual([]);
  });

  it("batch max 2 with deterministic oldest-first ordering", () => {
    const ids = pickActionableInboundMediaJobIds(
      [
        lite({
          id: JOB_C,
          status: "pending_download",
          created_at: "2026-08-12T03:00:00.000Z",
        }),
        lite({
          id: JOB_ID,
          status: "failed",
          attempt_count: 1,
          next_retry_at: "2026-08-12T01:00:00.000Z",
        }),
        lite({
          id: JOB_B,
          status: "pending_download",
          created_at: "2026-08-12T02:00:00.000Z",
        }),
      ],
      2,
      NOW
    );
    expect(ids).toHaveLength(2);
    expect(ids).toEqual([JOB_ID, JOB_B]);
  });

  it("stale threshold constant is 15 minutes", () => {
    expect(INBOUND_MEDIA_B1_STALE_NORMALIZING_MS).toBe(15 * 60 * 1000);
  });
});

describe("claimInboundMediaJobForDownload", () => {
  beforeEach(() => {
    jobs.clear();
  });

  it("claims pending_download → normalizing and increments attempt_count once", async () => {
    seed();
    const claimed = await claimInboundMediaJobForDownload(JOB_ID, { now: NOW });
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe("normalizing");
    expect(claimed!.attempt_count).toBe(1);
  });

  it("second worker cannot claim the same pending job", async () => {
    seed();
    expect(await claimInboundMediaJobForDownload(JOB_ID, { now: NOW })).not.toBeNull();
    expect(await claimInboundMediaJobForDownload(JOB_ID, { now: NOW })).toBeNull();
    expect(jobs.get(JOB_ID)!.attempt_count).toBe(1);
  });

  it("claims due failed; refuses future / terminal / at-cap failed", async () => {
    seed({
      status: "failed",
      attempt_count: 2,
      next_retry_at: "2026-08-13T11:00:00.000Z",
    });
    const claimed = await claimInboundMediaJobForDownload(JOB_ID, { now: NOW });
    expect(claimed!.attempt_count).toBe(3);

    jobs.clear();
    seed({
      status: "failed",
      attempt_count: 1,
      next_retry_at: "2026-08-13T13:00:00.000Z",
    });
    expect(await claimInboundMediaJobForDownload(JOB_ID, { now: NOW })).toBeNull();

    jobs.clear();
    seed({ status: "failed", attempt_count: 2, next_retry_at: null });
    expect(await claimInboundMediaJobForDownload(JOB_ID, { now: NOW })).toBeNull();

    jobs.clear();
    seed({
      status: "failed",
      attempt_count: INBOUND_MEDIA_B1_MAX_ATTEMPTS,
      next_retry_at: "2026-08-13T11:00:00.000Z",
    });
    expect(await claimInboundMediaJobForDownload(JOB_ID, { now: NOW })).toBeNull();
  });

  it("recovers stale normalizing+null temp with single attempt increment; two workers race-safe", async () => {
    const staleUpdated = new Date(
      NOW.getTime() - INBOUND_MEDIA_B1_STALE_NORMALIZING_MS - 5_000
    ).toISOString();
    seed({
      status: "normalizing",
      attempt_count: 1,
      temp_storage_path: null,
      updated_at: staleUpdated,
      last_error_code: null,
    });

    const a = await claimInboundMediaJobForDownload(JOB_ID, { now: NOW });
    expect(a).not.toBeNull();
    // Recovered from attempt 1 → claim makes attempt 2 (stale→failed did not increment)
    expect(a!.attempt_count).toBe(2);
    expect(a!.status).toBe("normalizing");
    expect(jobs.get(JOB_ID)!.attempt_count).toBe(2);

    const b = await claimInboundMediaJobForDownload(JOB_ID, { now: NOW });
    expect(b).toBeNull();
    expect(jobs.get(JOB_ID)!.attempt_count).toBe(2);
  });

  it("fresh normalizing + null temp is not reclaimable", async () => {
    seed({
      status: "normalizing",
      attempt_count: 1,
      temp_storage_path: null,
      updated_at: new Date(NOW.getTime() - 60_000).toISOString(),
    });
    expect(await claimInboundMediaJobForDownload(JOB_ID, { now: NOW })).toBeNull();
    expect(jobs.get(JOB_ID)!.attempt_count).toBe(1);
  });

  it("does not reclaim B1-complete normalizing+temp", async () => {
    seed({
      status: "normalizing",
      attempt_count: 1,
      temp_storage_path: `${USER}/mms-temp/${JOB_ID}.bin`,
      updated_at: new Date(
        NOW.getTime() - INBOUND_MEDIA_B1_STALE_NORMALIZING_MS - 60_000
      ).toISOString(),
    });
    expect(await claimInboundMediaJobForDownload(JOB_ID, { now: NOW })).toBeNull();
  });

  it("does not claim failed + temp (B2 retry, not B1)", async () => {
    seed({
      status: "failed",
      attempt_count: 2,
      next_retry_at: "2026-08-13T11:00:00.000Z",
      temp_storage_path: `${USER}/mms-temp/${JOB_ID}.bin`,
    });
    expect(await claimInboundMediaJobForDownload(JOB_ID, { now: NOW })).toBeNull();
    expect(jobs.get(JOB_ID)!.attempt_count).toBe(2);
    expect(jobs.get(JOB_ID)!.status).toBe("failed");
  });

  it("ignores tombstoned / removed / expired", async () => {
    seed({ status: "tombstoned", tombstoned_at: NOW.toISOString() });
    expect(await claimInboundMediaJobForDownload(JOB_ID, { now: NOW })).toBeNull();

    jobs.clear();
    seed({ status: "failed", resolution: "removed", next_retry_at: "2026-08-13T11:00:00.000Z" });
    expect(await claimInboundMediaJobForDownload(JOB_ID, { now: NOW })).toBeNull();

    jobs.clear();
    seed({ status: "expired" });
    expect(await claimInboundMediaJobForDownload(JOB_ID, { now: NOW })).toBeNull();
  });
});

describe("isInboundMediaJobTombstonedOrRemoved", () => {
  it("detects tombstone signals", () => {
    expect(
      isInboundMediaJobTombstonedOrRemoved({
        status: "tombstoned",
        resolution: null,
        tombstoned_at: null,
      })
    ).toBe(true);
    expect(
      isInboundMediaJobTombstonedOrRemoved({
        status: "failed",
        resolution: "removed",
        tombstoned_at: null,
      })
    ).toBe(true);
  });
});

describe("B2 ready / lease / claim", () => {
  const TEMP = `${USER}/mms-temp/${JOB_ID}.bin`;
  const staleUpdated = new Date(
    NOW.getTime() - INBOUND_MEDIA_B2_LEASE_MS - 1000
  ).toISOString();
  const freshUpdated = new Date(NOW.getTime() - 30_000).toISOString();

  function b2Lite(
    partial: Partial<InboundMediaJobActionableLite>
  ): InboundMediaJobActionableLite {
    return lite({
      status: "normalizing",
      attempt_count: 1,
      temp_storage_path: TEMP,
      normalized_storage_path: null,
      attached_win_id: null,
      resolution: null,
      tombstoned_at: null,
      updated_at: staleUpdated,
      ...partial,
    });
  }

  it("normalizing + temp is B2-ready; normalizing + null temp is not", () => {
    expect(isInboundMediaJobB2Ready(b2Lite({}))).toBe(true);
    expect(
      isInboundMediaJobB2Ready(b2Lite({ temp_storage_path: null }))
    ).toBe(false);
    expect(
      isInboundMediaJobB2Ready(
        b2Lite({ normalized_storage_path: `${USER}/mms-norm/${JOB_ID}/master.jpg` })
      )
    ).toBe(false);
  });

  it("lease blocks fresh B2-ready and allows stale B2-ready", () => {
    const stale = b2Lite({ id: JOB_ID, updated_at: staleUpdated });
    const fresh = b2Lite({ id: JOB_B, updated_at: freshUpdated });
    expect(isInboundMediaJobActionableForB2(stale, NOW)).toBe(true);
    expect(isInboundMediaJobActionableForB2(fresh, NOW)).toBe(false);
    expect(pickActionableInboundMediaJobIdsForB2([stale, fresh], 5, NOW)).toEqual([
      JOB_ID,
    ]);
  });

  it("failed + temp is B2-actionable; failed + null temp is not", () => {
    const b2Fail = b2Lite({
      id: JOB_ID,
      status: "failed",
      attempt_count: 6,
      next_retry_at: "2026-08-13T11:59:00.000Z",
    });
    const b1Fail = lite({
      id: JOB_B,
      status: "failed",
      attempt_count: 2,
      next_retry_at: "2026-08-13T11:59:00.000Z",
      temp_storage_path: null,
    });
    expect(isInboundMediaJobActionableForB2(b2Fail, NOW)).toBe(true);
    expect(isInboundMediaJobActionableForB2(b1Fail, NOW)).toBe(false);
    expect(isInboundMediaJobActionableForB1Download(b2Fail, NOW)).toBe(false);
  });

  it("B2 cap is 10, not B1's 5", () => {
    const atB1Cap = b2Lite({
      attempt_count: INBOUND_MEDIA_B1_MAX_ATTEMPTS,
      updated_at: staleUpdated,
    });
    const atB2Cap = b2Lite({
      attempt_count: INBOUND_MEDIA_B2_MAX_ATTEMPTS,
      updated_at: staleUpdated,
    });
    expect(isInboundMediaJobActionableForB2(atB1Cap, NOW)).toBe(true);
    expect(isInboundMediaJobActionableForB2(atB2Cap, NOW)).toBe(false);
  });

  it("due failed+temp older than leased normalizing+temp wins oldest-actionable order", () => {
    const leasedReady = b2Lite({
      id: JOB_ID,
      status: "normalizing",
      updated_at: "2026-08-13T11:00:00.000Z",
    });
    const dueFailed = b2Lite({
      id: JOB_B,
      status: "failed",
      attempt_count: 6,
      next_retry_at: "2026-08-13T10:00:00.000Z",
      updated_at: "2026-08-13T11:30:00.000Z",
    });
    expect(pickActionableInboundMediaJobIdsForB2([leasedReady, dueFailed], 5, NOW)).toEqual([
      JOB_B,
      JOB_ID,
    ]);
  });

  it("leased normalizing+temp older than a later due failed+temp wins oldest-actionable order", () => {
    const leasedReady = b2Lite({
      id: JOB_ID,
      status: "normalizing",
      updated_at: "2026-08-13T09:00:00.000Z",
    });
    const dueFailed = b2Lite({
      id: JOB_B,
      status: "failed",
      attempt_count: 6,
      next_retry_at: "2026-08-13T11:00:00.000Z",
      updated_at: "2026-08-13T08:00:00.000Z",
    });
    expect(pickActionableInboundMediaJobIdsForB2([dueFailed, leasedReady], 5, NOW)).toEqual([
      JOB_ID,
      JOB_B,
    ]);
  });

  it("past expires_at is not B2-actionable; null and future remain eligible", () => {
    const past = b2Lite({
      id: JOB_C,
      expires_at: "2026-08-13T11:00:00.000Z",
    });
    const unset = b2Lite({ id: JOB_ID, expires_at: null });
    const future = b2Lite({
      id: JOB_B,
      expires_at: "2026-08-20T00:00:00.000Z",
    });
    expect(isInboundMediaJobExpiresAtPast(past, NOW)).toBe(true);
    expect(isInboundMediaJobActionableForB2(past, NOW)).toBe(false);
    expect(isInboundMediaJobActionableForB2(unset, NOW)).toBe(true);
    expect(isInboundMediaJobActionableForB2(future, NOW)).toBe(true);
    expect(pickActionableInboundMediaJobIdsForB2([past, unset, future], 5, NOW)).toEqual([
      JOB_ID,
      JOB_B,
    ]);
  });
});

describe("claimInboundMediaJobForNormalize", () => {
  const TEMP = `${USER}/mms-temp/${JOB_ID}.bin`;
  const staleUpdated = new Date(
    NOW.getTime() - INBOUND_MEDIA_B2_LEASE_MS - 5000
  ).toISOString();

  beforeEach(() => {
    jobs.clear();
  });

  it("CAS: first worker wins, second loses, attempt increments once", async () => {
    seed({
      status: "normalizing",
      attempt_count: 1,
      temp_storage_path: TEMP,
      updated_at: staleUpdated,
    });
    const a = await claimInboundMediaJobForNormalize(JOB_ID, { now: NOW });
    expect(a).not.toBeNull();
    expect(a!.attempt_count).toBe(2);
    expect(a!.status).toBe("normalizing");
    const b = await claimInboundMediaJobForNormalize(JOB_ID, { now: NOW });
    expect(b).toBeNull();
    expect(jobs.get(JOB_ID)!.attempt_count).toBe(2);
  });

  it("lease blocks fresh B2-ready; AfterSuccessfulB1 bypasses lease via CAS", async () => {
    seed({
      status: "normalizing",
      attempt_count: 1,
      temp_storage_path: TEMP,
      updated_at: NOW.toISOString(),
    });
    expect(await claimInboundMediaJobForNormalize(JOB_ID, { now: NOW })).toBeNull();
    expect(jobs.get(JOB_ID)!.attempt_count).toBe(1);

    const forced = await claimInboundMediaJobForNormalizeAfterSuccessfulB1(JOB_ID, {
      now: NOW,
    });
    expect(forced).not.toBeNull();
    expect(forced!.attempt_count).toBe(2);
    expect(forced!.status).toBe("normalizing");
  });

  it("refuses already-past expires_at without claiming", async () => {
    seed({
      status: "normalizing",
      attempt_count: 1,
      temp_storage_path: TEMP,
      updated_at: staleUpdated,
      expires_at: "2026-08-13T11:00:00.000Z",
    });
    expect(await claimInboundMediaJobForNormalize(JOB_ID, { now: NOW })).toBeNull();
    expect(jobs.get(JOB_ID)!.attempt_count).toBe(1);
    expect(jobs.get(JOB_ID)!.status).toBe("normalizing");
  });

  it("claims due failed+temp as B2 retry into normalizing", async () => {
    seed({
      status: "failed",
      attempt_count: 6,
      next_retry_at: "2026-08-13T11:00:00.000Z",
      temp_storage_path: TEMP,
      updated_at: staleUpdated,
    });
    const claimed = await claimInboundMediaJobForNormalize(JOB_ID, { now: NOW });
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe("normalizing");
    expect(claimed!.attempt_count).toBe(7);
    expect(claimed!.temp_storage_path).toBe(TEMP);
  });
});
