import { beforeEach, describe, expect, it, vi } from "vitest";

const JOB_ID = "22222222-2222-4222-8222-222222222222";
const USER = "user_b1_proc";
const SM = "SMbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ME = "MEcccccccccccccccccccccccccccccccc";
const AC = "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x10, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "ascii"),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
]);

function ftyp(major: string): Buffer {
  const parts = [
    Buffer.from("ftyp", "ascii"),
    Buffer.from(major.padEnd(4, " ").slice(0, 4), "ascii"),
    Buffer.alloc(4),
  ];
  const inner = Buffer.concat(parts);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(4 + inner.length, 0);
  return Buffer.concat([size, inner]);
}

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
const uploadCalls: Array<{ bucket: string; path: string; bytes: Buffer }> = [];
const removeCalls: string[] = [];
const fetchCalls: Array<{ url: string; auth: boolean }> = [];

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
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
            then: (
              resolve: (v: { data: null; error: null }) => void
            ) => void;
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
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  },
}));

vi.mock("@/lib/victory-media/normalize-victory-image", () => ({
  normalizeVictoryImage: vi.fn(() => {
    throw new Error("normalize must not be called in B1");
  }),
}));

vi.mock("@/lib/victory-media/finalize-victory-win-media", () => ({
  finalizeVictoryWinMedia: vi.fn(() => {
    throw new Error("finalize must not be called in B1");
  }),
}));

import { processInboundMediaJobB1 } from "@/lib/victory-media/process-inbound-media-b1";
import { victoryMediaMmsTempPath } from "@/lib/victory-media/storage-paths";
import { VICTORY_MEDIA_BUCKET } from "@/lib/victory-media/constants";

function seed(partial: Partial<Job> = {}): Job {
  const row: Job = {
    id: JOB_ID,
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
  };
  store.set(JOB_ID, row);
  return row;
}

function stream(bytes: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
}

function redirectThenBytes(bytes: Buffer) {
  return vi
    .fn()
    .mockImplementation(async (url: string, init?: RequestInit) => {
      const auth = Boolean(new Headers(init?.headers).get("Authorization"));
      fetchCalls.push({ url, auth });
      if (url.includes("api.twilio.com") && url.includes("/Media/") && !url.includes(".json")) {
        expect(init?.redirect).toBe("manual");
        expect(auth).toBe(true);
        return new Response(null, {
          status: 302,
          headers: { Location: "https://mms.twiliocdn.com/obj" },
        });
      }
      if (url.includes("mms.twiliocdn.com")) {
        expect(auth).toBe(false);
        return new Response(stream(bytes), { status: 200 });
      }
      if (url.includes("/Media.json")) {
        return new Response(JSON.stringify({ media_list: [{ sid: ME }] }), {
          status: 200,
        });
      }
      return new Response(null, { status: 500 });
    });
}

describe("processInboundMediaJobB1", () => {
  beforeEach(() => {
    store.clear();
    uploadCalls.length = 0;
    removeCalls.length = 0;
    fetchCalls.length = 0;
    vi.stubEnv("TWILIO_ACCOUNT_SID", AC);
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");
  });

  it("downloads supported JPEG to deterministic private temp path", async () => {
    seed();
    const fetchFn = redirectThenBytes(JPEG);
    const r = await processInboundMediaJobB1(JOB_ID, {
      downloadDeps: {
        fetchFn: fetchFn as unknown as typeof fetch,
        accountSid: AC,
        authToken: "tok",
      },
      uploadTemp: async (args) => {
        uploadCalls.push(args);
      },
      hasUnresolvedDeletion: async () => false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const expected = victoryMediaMmsTempPath(USER, JOB_ID);
    expect(r.tempStoragePath).toBe(expected);
    expect(r.sniffedFormat).toBe("jpeg");
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0]!.bucket).toBe(VICTORY_MEDIA_BUCKET);
    expect(uploadCalls[0]!.path).toBe(expected);
    const job = store.get(JOB_ID)!;
    expect(job.status).toBe("normalizing");
    expect(job.temp_storage_path).toBe(expected);
    expect(job.last_error_code).toBeNull();
    expect(job.next_retry_at).toBeNull();
    expect(job.normalized_storage_path).toBeNull();
    expect(job.attached_win_id).toBeNull();
  });

  it("accepts png/webp/heic/heif sniff; rejects gif/avif/unknown", async () => {
    const cases: Array<{ bytes: Buffer; ok: boolean; format?: string }> = [
      { bytes: PNG, ok: true, format: "png" },
      { bytes: WEBP, ok: true, format: "webp" },
      { bytes: ftyp("heic"), ok: true, format: "heic_heif" },
      { bytes: ftyp("heif"), ok: true, format: "heic_heif" },
      { bytes: Buffer.from("GIF89a......"), ok: false },
      { bytes: ftyp("avif"), ok: false },
      { bytes: Buffer.from("not-an-image-xxx"), ok: false },
    ];
    for (const c of cases) {
      store.clear();
      uploadCalls.length = 0;
      seed();
      const r = await processInboundMediaJobB1(JOB_ID, {
        downloadDeps: {
          fetchFn: redirectThenBytes(c.bytes) as unknown as typeof fetch,
          accountSid: AC,
          authToken: "tok",
        },
        uploadTemp: async (args) => {
          uploadCalls.push(args);
        },
        hasUnresolvedDeletion: async () => false,
      });
      if (c.ok) {
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.sniffedFormat).toBe(c.format);
        expect(uploadCalls.length).toBe(1);
      } else {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.terminal).toBe(true);
        expect(uploadCalls.length).toBe(0);
      }
    }
  });

  it("byte sniff truth over declared MIME (HEIC bytes + jpeg declaration)", async () => {
    seed({ declared_content_type: "image/jpeg" });
    const heic = ftyp("heic");
    const r = await processInboundMediaJobB1(JOB_ID, {
      downloadDeps: {
        fetchFn: redirectThenBytes(heic) as unknown as typeof fetch,
        accountSid: AC,
        authToken: "tok",
      },
      uploadTemp: async (args) => {
        uploadCalls.push(args);
      },
      hasUnresolvedDeletion: async () => false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sniffedFormat).toBe("heic_heif");
  });

  it("deletion-pending never contacts Twilio and expires job", async () => {
    seed();
    const fetchFn = vi.fn();
    const r = await processInboundMediaJobB1(JOB_ID, {
      downloadDeps: {
        fetchFn: fetchFn as unknown as typeof fetch,
        accountSid: AC,
        authToken: "tok",
      },
      hasUnresolvedDeletion: async () => true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("account_deletion_unresolved");
      expect(r.terminal).toBe(true);
    }
    expect(fetchFn).not.toHaveBeenCalled();
    expect(store.get(JOB_ID)!.status).toBe("expired");
    expect(store.get(JOB_ID)!.resolution).toBe("expired");
  });

  it("missing ME + exactly one list result recovers; 0/2+ terminal", async () => {
    // exactly one
    seed({ twilio_media_sid: null });
    let r = await processInboundMediaJobB1(JOB_ID, {
      downloadDeps: {
        fetchFn: redirectThenBytes(JPEG) as unknown as typeof fetch,
        accountSid: AC,
        authToken: "tok",
      },
      uploadTemp: async (a) => {
        uploadCalls.push(a);
      },
      hasUnresolvedDeletion: async () => false,
    });
    expect(r.ok).toBe(true);
    expect(store.get(JOB_ID)!.twilio_media_sid).toBe(ME);

    // zero
    store.clear();
    seed({ twilio_media_sid: null, status: "pending_download", attempt_count: 0 });
    const zeroFetch = vi.fn(async (url: string) => {
      if (url.includes("/Media.json")) {
        return new Response(JSON.stringify({ media_list: [] }), { status: 200 });
      }
      return new Response(null, { status: 500 });
    });
    r = await processInboundMediaJobB1(JOB_ID, {
      downloadDeps: {
        fetchFn: zeroFetch as unknown as typeof fetch,
        accountSid: AC,
        authToken: "tok",
      },
      hasUnresolvedDeletion: async () => false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("media_sid_unresolved");

    // multiple
    store.clear();
    seed({ twilio_media_sid: null, status: "pending_download", attempt_count: 0 });
    const multi = "MEdddddddddddddddddddddddddddddddd";
    const multiFetch = vi.fn(async (url: string) => {
      if (url.includes("/Media.json")) {
        return new Response(
          JSON.stringify({ media_list: [{ sid: ME }, { sid: multi }] }),
          { status: 200 }
        );
      }
      return new Response(null, { status: 500 });
    });
    r = await processInboundMediaJobB1(JOB_ID, {
      downloadDeps: {
        fetchFn: multiFetch as unknown as typeof fetch,
        accountSid: AC,
        authToken: "tok",
      },
      hasUnresolvedDeletion: async () => false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("media_sid_unresolved");
      expect(r.terminal).toBe(true);
    }
  });

  it("first 404 retryable; attempt cap makes 404 terminal", async () => {
    seed();
    const fetch404 = vi.fn(async () => new Response(null, { status: 404 }));
    let r = await processInboundMediaJobB1(JOB_ID, {
      downloadDeps: {
        fetchFn: fetch404 as unknown as typeof fetch,
        accountSid: AC,
        authToken: "tok",
      },
      hasUnresolvedDeletion: async () => false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("http_404");
      expect(r.terminal).toBe(false);
    }
    expect(store.get(JOB_ID)!.status).toBe("failed");
    expect(store.get(JOB_ID)!.next_retry_at).not.toBeNull();

    // at max attempts → terminal
    store.clear();
    seed({ status: "pending_download", attempt_count: 4 });
    r = await processInboundMediaJobB1(JOB_ID, {
      downloadDeps: {
        fetchFn: fetch404 as unknown as typeof fetch,
        accountSid: AC,
        authToken: "tok",
      },
      hasUnresolvedDeletion: async () => false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.terminal).toBe(true);
    expect(store.get(JOB_ID)!.next_retry_at).toBeNull();
  });

  it("retry uses same deterministic temp path (upsert idempotency)", async () => {
    seed();
    const path = victoryMediaMmsTempPath(USER, JOB_ID);
    await processInboundMediaJobB1(JOB_ID, {
      downloadDeps: {
        fetchFn: redirectThenBytes(JPEG) as unknown as typeof fetch,
        accountSid: AC,
        authToken: "tok",
      },
      uploadTemp: async (a) => {
        uploadCalls.push(a);
      },
      hasUnresolvedDeletion: async () => false,
    });
    expect(uploadCalls[0]!.path).toBe(path);

    // Simulate B1 incomplete reclaim via failed→retry would re-upload same path
    store.set(JOB_ID, {
      ...store.get(JOB_ID)!,
      status: "failed",
      temp_storage_path: null,
      next_retry_at: new Date(Date.now() - 1000).toISOString(),
      attempt_count: 1,
    });
    await processInboundMediaJobB1(JOB_ID, {
      downloadDeps: {
        fetchFn: redirectThenBytes(JPEG) as unknown as typeof fetch,
        accountSid: AC,
        authToken: "tok",
      },
      uploadTemp: async (a) => {
        uploadCalls.push(a);
      },
      hasUnresolvedDeletion: async () => false,
    });
    expect(uploadCalls[1]!.path).toBe(path);
    expect(new Set(uploadCalls.map((c) => c.path)).size).toBe(1);
  });
});
