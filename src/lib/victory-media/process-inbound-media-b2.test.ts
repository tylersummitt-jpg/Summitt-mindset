import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const bodyLookupState = vi.hoisted(() => ({
  error: null as { message: string } | null,
}));

const correlateAwaitingAttach = vi.hoisted(() => vi.fn(async () => []));

vi.mock("@/lib/victory-media/correlate-inbound-mms-c1", () => ({
  tryCorrelateInboundMmsC1Job: correlateAwaitingAttach,
  INBOUND_MEDIA_C1_WAIT_RETRY_MS: 60_000,
}));

const JOB_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const USER = "user_b2_proc";
const SM = "SMbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

type Job = {
  id: string;
  message_sid: string;
  media_ordinal: number;
  clerk_user_id: string;
  twilio_media_sid: string | null;
  declared_content_type: string | null;
  status: string;
  attempt_count: number;
  next_retry_at: string | null;
  last_error_code: string | null;
  temp_storage_path: string | null;
  normalized_storage_path: string | null;
  attached_win_id: string | null;
  resolution: string | null;
  classifier_target: string | null;
  followup_idempotency_key: string | null;
  expires_at: string | null;
  tombstoned_at: string | null;
  created_at: string;
  updated_at: string;
};

const store = new Map<string, Job>();
const bodyRows = new Set<string>();
const storageUploads: Array<{
  bucket: string;
  path: string;
  contentType: string | undefined;
  upsert: boolean | undefined;
  byteSize: number;
}> = [];
const removeCalls: string[][] = [];

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table === "sms_inbound_messages") {
        return {
          select: (cols: string) => {
            expect(cols).toBe("id");
            const filters: Record<string, string> = {};
            const api = {
              eq(col: string, val: string) {
                filters[col] = val;
                return api;
              },
              limit() {
                return {
                  maybeSingle: async () => {
                    if (bodyLookupState.error) {
                      return { data: null, error: bodyLookupState.error };
                    }
                    const key = `${filters.message_sid}::${filters.clerk_user_id}`;
                    if (bodyRows.has(key)) {
                      return { data: { id: "inbound-row" }, error: null };
                    }
                    return { data: null, error: null };
                  },
                };
              },
            };
            return api;
          },
        };
      }
      if (table !== "v2_inbound_media_job") throw new Error(table);
      return {
        select: () => ({
          eq: (col: string, val: string) => ({
            maybeSingle: async () => {
              if (col !== "id") return { data: null, error: null };
              return { data: store.get(val) ?? null, error: null };
            },
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          const filters: Array<[string, unknown]> = [];
          const api: {
            eq: (c: string, v: unknown) => typeof api;
            is: (c: string, v: unknown) => typeof api;
            select: () => { maybeSingle: () => Promise<{ data: unknown; error: null }> };
            then: (resolve: (v: { data: null; error: null }) => void) => void;
          } = {
            eq(c, v) {
              filters.push([c, v]);
              return api;
            },
            is(c, v) {
              filters.push([c, v === null ? null : v]);
              return api;
            },
            select() {
              return {
                maybeSingle: async () => {
                  const id = String(filters.find((f) => f[0] === "id")?.[1] ?? "");
                  const row = store.get(id);
                  if (!row) return { data: null, error: null };
                  for (const [c, v] of filters) {
                    if (c === "id") continue;
                    if (v === null) {
                      if (row[c as keyof Job] != null) return { data: null, error: null };
                    } else if (row[c as keyof Job] !== v) {
                      return { data: null, error: null };
                    }
                  }
                  Object.assign(row, patch);
                  return { data: { ...row }, error: null };
                },
              };
            },
            then(resolve) {
              const id = String(filters.find((f) => f[0] === "id")?.[1] ?? "");
              const row = store.get(id);
              if (row) {
                let ok = true;
                for (const [c, v] of filters) {
                  if (c === "id") continue;
                  if (v === null) {
                    if (row[c as keyof Job] != null) ok = false;
                  } else if (row[c as keyof Job] !== v) {
                    ok = false;
                  }
                }
                if (ok) Object.assign(row, patch);
              }
              resolve({ data: null, error: null });
            },
          };
          return api;
        },
      };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (
          path: string,
          bytes: Buffer,
          opts?: { contentType?: string; upsert?: boolean }
        ) => {
          storageUploads.push({
            bucket,
            path,
            contentType: opts?.contentType,
            upsert: opts?.upsert,
            byteSize: bytes.length,
          });
          return { error: null };
        },
        remove: async (paths: string[]) => {
          removeCalls.push([...paths]);
          return { error: null };
        },
      }),
    },
  },
}));

import {
  processInboundMediaJobB2,
  processInboundMediaJobB2AfterSuccessfulB1,
} from "@/lib/victory-media/process-inbound-media-b2";
import { VICTORY_MEDIA_BUCKET } from "@/lib/victory-media/constants";
import { INBOUND_MEDIA_B2_EXPIRES_MS } from "@/lib/victory-media/claim-inbound-media-job";
import type {
  NormalizeVictoryImageResult,
  VictoryMediaStorageBridge,
} from "@/lib/victory-media/image-types";
import {
  victoryMediaMmsNormCardPath,
  victoryMediaMmsNormMasterPath,
  victoryMediaMmsTempPath,
} from "@/lib/victory-media/storage-paths";

const NOW = new Date("2026-08-19T18:00:00.000Z");
const TEMP = victoryMediaMmsTempPath(USER, JOB_ID);
const MASTER = victoryMediaMmsNormMasterPath(USER, JOB_ID);
const CARD = victoryMediaMmsNormCardPath(USER, JOB_ID);

function jpegAsset(width: number, height: number, size: number) {
  return {
    bytes: Buffer.alloc(size, 1),
    mime: "image/jpeg" as const,
    width,
    height,
    byteSize: size,
  };
}

function fakeNormalized(partial?: Partial<NormalizeVictoryImageResult>): NormalizeVictoryImageResult {
  return {
    ok: true,
    master: jpegAsset(80, 120, 400),
    card: jpegAsset(80, 120, 200),
    source: { sniffedFormat: "jpeg", usedHeicBridge: false },
    ...partial,
  } as NormalizeVictoryImageResult;
}

async function jpegBytes(opts?: {
  width?: number;
  height?: number;
  orientation?: number;
}): Promise<Buffer> {
  const width = opts?.width ?? 40;
  const height = opts?.height ?? 60;
  let pipeline = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 40, b: 40 },
    },
  }).jpeg({ quality: 90 });
  if (opts?.orientation != null) {
    pipeline = pipeline.withMetadata({ orientation: opts.orientation });
  }
  return pipeline.toBuffer();
}

async function pngAlpha(): Promise<Buffer> {
  return sharp({
    create: {
      width: 16,
      height: 16,
      channels: 4,
      background: { r: 0, g: 0, b: 255, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
}

async function webpBytes(): Promise<Buffer> {
  return sharp({
    create: {
      width: 24,
      height: 24,
      channels: 3,
      background: { r: 20, g: 20, b: 200 },
    },
  })
    .webp({ quality: 80 })
    .toBuffer();
}

function heicFtyp(): Buffer {
  const parts = [
    Buffer.from("ftyp", "ascii"),
    Buffer.from("heic", "ascii"),
    Buffer.alloc(4),
    Buffer.from("mif1", "ascii"),
  ];
  const inner = Buffer.concat(parts);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(4 + inner.length, 0);
  return Buffer.concat([size, inner]);
}

function mockStorage(args: {
  original: Buffer;
  transformed?: Buffer;
}): VictoryMediaStorageBridge {
  return {
    downloadObject: vi.fn(async () => args.original),
    downloadTransformed: vi.fn(async () => {
      if (!args.transformed) throw new Error("missing_transformed");
      return args.transformed;
    }),
  };
}

function seed(partial: Partial<Job> = {}): Job {
  const row: Job = {
    id: JOB_ID,
    message_sid: SM,
    media_ordinal: 0,
    clerk_user_id: USER,
    twilio_media_sid: "MEcccccccccccccccccccccccccccccccc",
    declared_content_type: "image/jpeg",
    status: "normalizing",
    attempt_count: 1,
    next_retry_at: null,
    last_error_code: null,
    temp_storage_path: TEMP,
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
  };
  store.set(JOB_ID, row);
  return row;
}

describe("processInboundMediaJobB2", () => {
  beforeEach(() => {
    store.clear();
    bodyRows.clear();
    bodyLookupState.error = null;
    storageUploads.length = 0;
    removeCalls.length = 0;
    correlateAwaitingAttach.mockClear();
  });

  it("image-only → pending_semantics; resolution/attach stay null; temp deleted after DB", async () => {
    seed();
    const order: string[] = [];
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      lookupBodyMode: async () => {
        order.push("mode");
        return "image_only";
      },
      normalize: async () => {
        order.push("normalize");
        return fakeNormalized();
      },
      uploadNorm: async () => {
        order.push("upload");
      },
      removeObjects: async (args) => {
        order.push(`remove:${args.paths.join(",")}`);
        removeCalls.push(args.paths);
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("pending_semantics");
    expect(r.mode).toBe("image_only");
    expect(r.normalizedStoragePath).toBe(MASTER);
    const job = store.get(JOB_ID)!;
    expect(job.status).toBe("pending_semantics");
    expect(job.resolution).toBeNull();
    expect(job.attached_win_id).toBeNull();
    expect(job.normalized_storage_path).toBe(MASTER);
    expect(job.temp_storage_path).toBeNull();
    expect(job.next_retry_at).toBeNull();
    expect(job.expires_at).toBe(
      new Date(NOW.getTime() + INBOUND_MEDIA_B2_EXPIRES_MS).toISOString()
    );
    expect(order.indexOf("normalize")).toBeLessThan(order.indexOf("upload"));
    expect(order.filter((x) => x.startsWith("remove"))[0]).toBe(`remove:${TEMP}`);
    expect(removeCalls.some((p) => p.includes(TEMP))).toBe(true);
    expect(correlateAwaitingAttach).not.toHaveBeenCalled();
  });

  it("matching Body row → awaiting_attach; preserves existing expires_at", async () => {
    seed({ expires_at: "2026-09-01T00:00:00.000Z" });
    bodyRows.add(`${SM}::${USER}`);
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      normalize: async () => fakeNormalized(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("awaiting_attach");
    expect(r.mode).toBe("body_photo");
    expect(store.get(JOB_ID)!.resolution).toBeNull();
    expect(store.get(JOB_ID)!.attached_win_id).toBeNull();
    expect(store.get(JOB_ID)!.expires_at).toBe("2026-09-01T00:00:00.000Z");
    expect(store.get(JOB_ID)!.next_retry_at).toBe(
      new Date(NOW.getTime() + 60_000).toISOString()
    );
    expect(correlateAwaitingAttach).toHaveBeenCalledTimes(1);
    expect(correlateAwaitingAttach).toHaveBeenCalledWith(JOB_ID);
  });

  it("immediate C1 throw still leaves B2 success and armed next_retry_at", async () => {
    seed({ expires_at: "2026-09-01T00:00:00.000Z" });
    bodyRows.add(`${SM}::${USER}`);
    correlateAwaitingAttach.mockRejectedValueOnce(new Error("c1 boom"));
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      normalize: async () => fakeNormalized(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("awaiting_attach");
    expect(store.get(JOB_ID)!.status).toBe("awaiting_attach");
    expect(store.get(JOB_ID)!.next_retry_at).toBe(
      new Date(NOW.getTime() + 60_000).toISOString()
    );
    expect(store.get(JOB_ID)!.attached_win_id).toBeNull();
  });

  it("no Body row uses default lookup → pending_semantics", async () => {
    seed();
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      normalize: async () => fakeNormalized(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("pending_semantics");
    expect(correlateAwaitingAttach).not.toHaveBeenCalled();
  });

  it("uploads mms-norm JPEG with upsert:true; not canonical media path", async () => {
    seed();
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      lookupBodyMode: async () => "image_only",
      normalize: async () => fakeNormalized(),
    });
    expect(r.ok).toBe(true);
    expect(storageUploads).toHaveLength(2);
    expect(storageUploads[0]).toMatchObject({
      bucket: VICTORY_MEDIA_BUCKET,
      path: MASTER,
      contentType: "image/jpeg",
      upsert: true,
    });
    expect(storageUploads[1]).toMatchObject({
      bucket: VICTORY_MEDIA_BUCKET,
      path: CARD,
      contentType: "image/jpeg",
      upsert: true,
    });
    expect(MASTER).toContain("/mms-norm/");
    expect(MASTER).not.toMatch(new RegExp(`^${USER}/[0-9a-f-]{36}/master\\.jpg$`));
  });

  it("master ok / card fail is retryable, keeps temp, leaves partial master", async () => {
    seed();
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      lookupBodyMode: async () => "image_only",
      normalize: async () => fakeNormalized(),
      uploadNorm: async (args) => {
        if (args.path.endsWith("/card.jpg")) throw new Error("card boom");
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("card_upload_failed");
    expect(r.terminal).toBe(false);
    const job = store.get(JOB_ID)!;
    expect(job.status).toBe("failed");
    expect(job.temp_storage_path).toBe(TEMP);
    expect(job.normalized_storage_path).toBeNull();
    expect(job.next_retry_at).not.toBeNull();
  });

  it("retry overwrites master and card", async () => {
    seed();
    const paths: string[] = [];
    await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      lookupBodyMode: async () => "image_only",
      normalize: async () => fakeNormalized(),
      uploadNorm: async (args) => {
        paths.push(args.path);
        if (args.path.endsWith("/card.jpg") && paths.filter((p) => p.endsWith("/card.jpg")).length === 1) {
          throw new Error("first card fail");
        }
      },
    });
    seed({
      status: "failed",
      attempt_count: 2,
      temp_storage_path: TEMP,
      next_retry_at: "2026-08-19T17:00:00.000Z",
    });
    const r2 = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      lookupBodyMode: async () => "image_only",
      normalize: async () => fakeNormalized(),
      uploadNorm: async (args) => {
        paths.push(`retry:${args.path}`);
      },
    });
    expect(r2.ok).toBe(true);
    expect(paths.filter((p) => p.includes("master.jpg")).length).toBeGreaterThanOrEqual(2);
    expect(paths.filter((p) => p.includes("card.jpg")).length).toBeGreaterThanOrEqual(2);
  });

  it("temp cleanup failure does not undo successful DB transition", async () => {
    seed();
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      lookupBodyMode: async () => "image_only",
      normalize: async () => fakeNormalized(),
      uploadNorm: async () => {},
      removeObjects: async () => {
        throw new Error("cleanup failed");
      },
    });
    expect(r.ok).toBe(true);
    expect(store.get(JOB_ID)!.status).toBe("pending_semantics");
    expect(store.get(JOB_ID)!.normalized_storage_path).toBe(MASTER);
  });

  it("tombstoned job refused at claim", async () => {
    seed({ status: "tombstoned", tombstoned_at: NOW.toISOString(), resolution: "removed" });
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      normalize: async () => fakeNormalized(),
    });
    expect(r).toEqual({ ok: false, jobId: JOB_ID, reason: "claim_failed", terminal: false });
  });

  it("tombstone race after uploads cleans mms-norm, does not transition", async () => {
    seed();
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      lookupBodyMode: async () => "image_only",
      normalize: async () => fakeNormalized(),
      uploadNorm: async () => {
        const row = store.get(JOB_ID)!;
        row.status = "tombstoned";
        row.resolution = "removed";
        row.tombstoned_at = NOW.toISOString();
      },
      removeObjects: async (args) => {
        removeCalls.push(args.paths);
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("tombstoned_race");
    expect(store.get(JOB_ID)!.status).toBe("tombstoned");
    expect(removeCalls.some((p) => p.includes(MASTER) && p.includes(CARD))).toBe(true);
  });

  it("deletion pending expires and cleans temp/norm", async () => {
    seed();
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => true,
      normalize: async () => fakeNormalized(),
      removeObjects: async (args) => {
        removeCalls.push(args.paths);
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("account_deletion_unresolved");
    expect(store.get(JOB_ID)!.status).toBe("expired");
    expect(store.get(JOB_ID)!.resolution).toBe("expired");
    expect(removeCalls.flat()).toEqual(expect.arrayContaining([TEMP, MASTER, CARD]));
  });

  it("deletion lookup failure fails closed", async () => {
    seed();
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => {
        throw new Error("lookup");
      },
      normalize: async () => fakeNormalized(),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("account_deletion_lookup_failed");
    expect(store.get(JOB_ID)!.status).toBe("expired");
  });

  it("B2 retry keeps temp and does not contact Twilio", async () => {
    seed({
      status: "failed",
      attempt_count: 6,
      next_retry_at: "2026-08-19T17:00:00.000Z",
      last_error_code: "heic_transform_failed",
    });
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      lookupBodyMode: async () => "image_only",
      normalize: async (input) => {
        expect(input.source.kind).toBe("supabase_object");
        if (input.source.kind === "supabase_object") {
          expect(input.source.path).toBe(TEMP);
        }
        return fakeNormalized();
      },
    });
    expect(r.ok).toBe(true);
    expect(store.get(JOB_ID)!.temp_storage_path).toBeNull();
  });

  it("calls normalizeVictoryImage with supabase_object + 12MB cap, no quality override", async () => {
    seed();
    let seen: unknown = null;
    await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      lookupBodyMode: async () => "image_only",
      normalize: async (input) => {
        seen = input;
        return fakeNormalized();
      },
    });
    expect(seen).toEqual({
      source: {
        kind: "supabase_object",
        bucket: VICTORY_MEDIA_BUCKET,
        path: TEMP,
      },
      maxIncomingBytes: 12_000_000,
    });
  });

  it("too_many_pixels is terminal", async () => {
    seed();
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      normalize: async () => ({ ok: false, code: "too_many_pixels" }),
    });
    expect(r).toMatchObject({ ok: false, reason: "too_many_pixels", terminal: true });
    expect(store.get(JOB_ID)!.temp_storage_path).toBe(TEMP);
    expect(store.get(JOB_ID)!.next_retry_at).toBeNull();
  });

  it("heic_transform_failed is retryable", async () => {
    seed();
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      normalize: async () => ({ ok: false, code: "heic_transform_failed" }),
    });
    expect(r).toMatchObject({
      ok: false,
      reason: "heic_transform_failed",
      terminal: false,
    });
    expect(store.get(JOB_ID)!.temp_storage_path).toBe(TEMP);
    expect(store.get(JOB_ID)!.next_retry_at).not.toBeNull();
  });
});

describe("processInboundMediaJobB2 object-source formats", () => {
  beforeEach(() => {
    store.clear();
    bodyRows.clear();
    bodyLookupState.error = null;
    storageUploads.length = 0;
    removeCalls.length = 0;
  });

  it("JPEG object-source master/card jpeg with EXIF stripped and long-edge caps", async () => {
    seed();
    const bytes = await jpegBytes({ width: 80, height: 120, orientation: 6 });
    const captured: Buffer[] = [];
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      lookupBodyMode: async () => "image_only",
      normalizeDeps: { storage: mockStorage({ original: bytes }) },
      uploadNorm: async (args) => {
        captured.push(args.bytes);
        expect(args.contentType).toBe("image/jpeg");
      },
    });
    expect(r.ok).toBe(true);
    expect(captured).toHaveLength(2);
    const masterMeta = await sharp(captured[0]!).metadata();
    const cardMeta = await sharp(captured[1]!).metadata();
    expect(masterMeta.format).toBe("jpeg");
    expect(cardMeta.format).toBe("jpeg");
    expect(masterMeta.exif).toBeUndefined();
    expect(masterMeta.orientation).toBeUndefined();
    expect(Math.max(masterMeta.width ?? 0, masterMeta.height ?? 0)).toBeLessThanOrEqual(2048);
    expect(Math.max(cardMeta.width ?? 0, cardMeta.height ?? 0)).toBeLessThanOrEqual(1280);
  });

  it("PNG object-source → JPEG; alpha flattens white", async () => {
    seed();
    const bytes = await pngAlpha();
    const captured: Buffer[] = [];
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      lookupBodyMode: async () => "image_only",
      normalizeDeps: { storage: mockStorage({ original: bytes }) },
      uploadNorm: async (args) => {
        captured.push(args.bytes);
      },
    });
    expect(r.ok).toBe(true);
    const { data } = await sharp(captured[0]!).ensureAlpha().raw().toBuffer({
      resolveWithObject: true,
    });
    expect(data[0]).toBe(255);
    expect(data[1]).toBe(255);
    expect(data[2]).toBe(255);
  });

  it("WebP object-source → JPEG", async () => {
    seed();
    const bytes = await webpBytes();
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      lookupBodyMode: async () => "image_only",
      normalizeDeps: { storage: mockStorage({ original: bytes }) },
    });
    expect(r.ok).toBe(true);
    expect(storageUploads[0]?.contentType).toBe("image/jpeg");
  });

  it("HEIC/HEIF object bridge → JPEG via transform", async () => {
    seed();
    const original = heicFtyp();
    const transformed = await jpegBytes({ width: 90, height: 120 });
    const storage = mockStorage({ original, transformed });
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      lookupBodyMode: async () => "image_only",
      normalizeDeps: { storage },
    });
    expect(r.ok).toBe(true);
    expect(storage.downloadTransformed).toHaveBeenCalled();
    expect(storageUploads[0]?.contentType).toBe("image/jpeg");
  });
});

describe("processInboundMediaJobB2 owned-attempt CAS and eligibility", () => {
  beforeEach(() => {
    store.clear();
    bodyRows.clear();
    bodyLookupState.error = null;
    storageUploads.length = 0;
    removeCalls.length = 0;
  });

  it("sms_inbound_messages DB error fails closed: not image_only, retryable, temp kept", async () => {
    seed();
    bodyLookupState.error = { message: "connection reset" };
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      normalize: async () => fakeNormalized(),
      removeObjects: async (args) => {
        removeCalls.push(args.paths);
      },
    });
    expect(r).toMatchObject({
      ok: false,
      reason: "mode_lookup_failed",
      terminal: false,
    });
    const job = store.get(JOB_ID)!;
    expect(job.status).toBe("failed");
    expect(job.last_error_code).toBe("mode_lookup_failed");
    expect(job.temp_storage_path).toBe(TEMP);
    expect(job.normalized_storage_path).toBeNull();
    expect(job.status).not.toBe("pending_semantics");
    expect(job.status).not.toBe("awaiting_attach");
    expect(storageUploads.some((u) => u.path === MASTER)).toBe(true);
    expect(storageUploads.some((u) => u.path === CARD)).toBe(true);
    expect(removeCalls.flat()).not.toContain(TEMP);
  });

  it("already-past expires_at does not normalize; CAS expires and keeps attempt", async () => {
    seed({
      expires_at: "2026-08-18T00:00:00.000Z",
      attempt_count: 3,
    });
    const normalize = vi.fn(async () => fakeNormalized());
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      normalize,
      removeObjects: async (args) => {
        removeCalls.push(args.paths);
      },
    });
    expect(r).toMatchObject({ ok: false, reason: "expired", terminal: true });
    expect(normalize).not.toHaveBeenCalled();
    const job = store.get(JOB_ID)!;
    expect(job.status).toBe("expired");
    expect(job.resolution).toBe("expired");
    expect(job.last_error_code).toBe("expired");
    expect(job.attempt_count).toBe(3);
    expect(job.expires_at).toBe("2026-08-18T00:00:00.000Z");
    expect(removeCalls.flat()).toEqual(expect.arrayContaining([TEMP, MASTER, CARD]));
  });

  it("null expires_at old production shape still processes", async () => {
    seed({ expires_at: null });
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      lookupBodyMode: async () => "image_only",
      normalize: async () => fakeNormalized(),
    });
    expect(r.ok).toBe(true);
    expect(store.get(JOB_ID)!.status).toBe("pending_semantics");
  });

  it("future expires_at processes and is preserved", async () => {
    seed({ expires_at: "2026-08-22T00:00:00.000Z" });
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      lookupBodyMode: async () => "image_only",
      normalize: async () => fakeNormalized(),
    });
    expect(r.ok).toBe(true);
    expect(store.get(JOB_ID)!.expires_at).toBe("2026-08-22T00:00:00.000Z");
  });

  it("public processB2 cannot bypass lease; AfterSuccessfulB1 can for that exact job", async () => {
    seed({ updated_at: NOW.toISOString(), attempt_count: 1 });
    const ordinary = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      lookupBodyMode: async () => "image_only",
      normalize: async () => fakeNormalized(),
    });
    expect(ordinary).toEqual({
      ok: false,
      jobId: JOB_ID,
      reason: "claim_failed",
      terminal: false,
    });
    expect(store.get(JOB_ID)!.attempt_count).toBe(1);
    expect(store.get(JOB_ID)!.status).toBe("normalizing");

    const sameInvocation = await processInboundMediaJobB2AfterSuccessfulB1(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      lookupBodyMode: async () => "image_only",
      normalize: async () => fakeNormalized(),
    });
    expect(sameInvocation.ok).toBe(true);
    expect(store.get(JOB_ID)!.status).toBe("pending_semantics");
  });

  it("markFailed matches claimed attempt_count and updated_at", async () => {
    seed({ attempt_count: 1, updated_at: "2026-08-12T00:00:00.000Z" });
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      normalize: async () => {
        const row = store.get(JOB_ID)!;
        row.attempt_count = 99;
        row.updated_at = "2026-08-19T19:00:00.000Z";
        return { ok: false, code: "heic_transform_failed" };
      },
    });
    expect(r).toMatchObject({ ok: false, reason: "stale_ownership", terminal: false });
    const job = store.get(JOB_ID)!;
    expect(job.status).toBe("normalizing");
    expect(job.attempt_count).toBe(99);
    expect(job.last_error_code).toBeNull();
    expect(job.temp_storage_path).toBe(TEMP);
  });

  it("stale markFailed loses after tombstone; tombstone stays canonical", async () => {
    seed();
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      normalize: async () => {
        const row = store.get(JOB_ID)!;
        row.status = "tombstoned";
        row.resolution = "removed";
        row.tombstoned_at = NOW.toISOString();
        return { ok: false, code: "heic_transform_failed" };
      },
      removeObjects: async (args) => {
        removeCalls.push(args.paths);
      },
    });
    expect(r).toMatchObject({ ok: false, reason: "stale_ownership" });
    const job = store.get(JOB_ID)!;
    expect(job.status).toBe("tombstoned");
    expect(job.resolution).toBe("removed");
    expect(job.tombstoned_at).toBe(NOW.toISOString());
    expect(job.last_error_code).toBeNull();
  });

  it("stale markFailed loses after successful ready transition; does not delete winner files", async () => {
    seed();
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
      lookupBodyMode: async () => {
        const row = store.get(JOB_ID)!;
        row.status = "pending_semantics";
        row.temp_storage_path = null;
        row.normalized_storage_path = MASTER;
        row.attempt_count = 7;
        row.updated_at = "2026-08-19T18:05:00.000Z";
        throw new Error("mode_lookup_failed:db down");
      },
      normalize: async () => fakeNormalized(),
      removeObjects: async (args) => {
        removeCalls.push(args.paths);
      },
    });
    expect(r).toMatchObject({ ok: false, reason: "stale_ownership" });
    const job = store.get(JOB_ID)!;
    expect(job.status).toBe("pending_semantics");
    expect(job.normalized_storage_path).toBe(MASTER);
    expect(job.temp_storage_path).toBeNull();
    expect(job.resolution).toBeNull();
    expect(removeCalls.flat()).not.toContain(MASTER);
    expect(removeCalls.flat()).not.toContain(CARD);
    expect(removeCalls.flat()).not.toContain(TEMP);
  });

  it("stale markExpired loses after tombstone; tombstone stays canonical", async () => {
    seed();
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => {
        const row = store.get(JOB_ID)!;
        row.status = "tombstoned";
        row.resolution = "removed";
        row.tombstoned_at = NOW.toISOString();
        return true;
      },
      normalize: async () => fakeNormalized(),
      removeObjects: async (args) => {
        removeCalls.push(args.paths);
      },
    });
    expect(r).toMatchObject({ ok: false, reason: "stale_ownership" });
    const job = store.get(JOB_ID)!;
    expect(job.status).toBe("tombstoned");
    expect(job.resolution).toBe("removed");
    expect(job.tombstoned_at).toBe(NOW.toISOString());
    expect(removeCalls).toHaveLength(0);
  });

  it("CAS-loss expire does not overwrite a ready winner or delete its files", async () => {
    seed();
    const r = await processInboundMediaJobB2(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => {
        const row = store.get(JOB_ID)!;
        row.status = "awaiting_attach";
        row.temp_storage_path = null;
        row.normalized_storage_path = MASTER;
        row.updated_at = "2026-08-19T18:05:00.000Z";
        return true;
      },
      normalize: async () => fakeNormalized(),
      removeObjects: async (args) => {
        removeCalls.push(args.paths);
      },
    });
    expect(r).toMatchObject({ ok: false, reason: "stale_ownership" });
    const job = store.get(JOB_ID)!;
    expect(job.status).toBe("awaiting_attach");
    expect(job.normalized_storage_path).toBe(MASTER);
    expect(job.resolution).toBeNull();
    expect(removeCalls.flat()).not.toContain(MASTER);
    expect(removeCalls.flat()).not.toContain(TEMP);
  });
});
