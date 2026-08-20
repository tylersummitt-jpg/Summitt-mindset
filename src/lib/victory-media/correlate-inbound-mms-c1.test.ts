import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  after: vi.fn((fn: () => unknown) => {
    void fn();
  }),
}));

const jobs = new Map<string, Record<string, unknown>>();
const wins = new Map<string, Record<string, unknown>>();
const media = new Map<string, Record<string, unknown>>();

const c1Hooks = vi.hoisted(() => ({
  hideWinBAfterFirstWinLoad: false,
  dropWinMediaAfterFirstWinMediaLoad: false,
  jobCollectionError: false,
  winLoads: 0,
  winMediaLoads: 0,
  jobSampleLoads: 0,
  failOnWinLoad: null as number | null,
  failOnWinMediaLoad: null as number | null,
  failOnJobSampleLoad: null as number | null,
  dropJob2OnSampleLoad: null as number | null,
  winMediaSequence: null as Array<Record<string, unknown> | null | "error"> | null,
  reset() {
    this.hideWinBAfterFirstWinLoad = false;
    this.dropWinMediaAfterFirstWinMediaLoad = false;
    this.jobCollectionError = false;
    this.winLoads = 0;
    this.winMediaLoads = 0;
    this.jobSampleLoads = 0;
    this.failOnWinLoad = null;
    this.failOnWinMediaLoad = null;
    this.failOnJobSampleLoad = null;
    this.dropJob2OnSampleLoad = null;
    this.winMediaSequence = null;
  },
}));

function matchesFilters(
  row: Record<string, unknown>,
  filters: Array<[string, string, unknown]>
): boolean {
  for (const [op, col, val] of filters) {
    const cur = row[col];
    if (op === "eq" && cur !== val) return false;
    if (op === "is") {
      if (val === null && cur != null) return false;
    }
    if (op === "not") {
      if (val === null && cur == null) return false;
    }
    if (op === "lte") {
      if (typeof cur !== "string" || cur > String(val)) return false;
    }
    if (op === "in") {
      if (!Array.isArray(val) || !val.includes(cur)) return false;
    }
  }
  return true;
}

function rowsFor(table: string): Record<string, unknown>[] {
  if (table === "v2_inbound_media_job") return [...jobs.values()];
  if (table === "v2_win") return [...wins.values()];
  if (table === "v2_win_media") return [...media.values()];
  return [];
}

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      const filters: Array<[string, string, unknown]> = [];
      const api: {
        select: () => typeof api;
        eq: (c: string, v: unknown) => typeof api;
        is: (c: string, v: unknown) => typeof api;
        not: (c: string, op: string, v: unknown) => typeof api;
        lte: (c: string, v: unknown) => typeof api;
        in: (c: string, v: unknown) => typeof api;
        order: () => typeof api;
        limit: () => typeof api;
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
        then: (
          resolve: (v: { data: unknown[] | null; error: { message: string } | null }) => void
        ) => void;
      } = {
        select() {
          return api;
        },
        eq(c, v) {
          filters.push(["eq", c, v]);
          return api;
        },
        is(c, v) {
          filters.push(["is", c, v]);
          return api;
        },
        not(c, _op, v) {
          filters.push(["not", c, v]);
          return api;
        },
        lte(c, v) {
          filters.push(["lte", c, v]);
          return api;
        },
        in(c, v) {
          filters.push(["in", c, v]);
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
        async maybeSingle() {
          if (table === "v2_win_media" && filters.some((f) => f[0] === "eq" && f[1] === "win_id")) {
            c1Hooks.winMediaLoads += 1;
            if (c1Hooks.failOnWinMediaLoad === c1Hooks.winMediaLoads) {
              return { data: null, error: { message: "db down" } };
            }
            if (c1Hooks.winMediaSequence) {
              const item = c1Hooks.winMediaSequence[c1Hooks.winMediaLoads - 1];
              if (item === "error") {
                return { data: null, error: { message: "db down" } };
              }
              if (item !== undefined) {
                return { data: item ? { ...item } : null, error: null };
              }
            }
            if (c1Hooks.dropWinMediaAfterFirstWinMediaLoad && c1Hooks.winMediaLoads >= 2) {
              return { data: null, error: null };
            }
          }
          const match = rowsFor(table).find((row) => matchesFilters(row, filters));
          return { data: match ? { ...match } : null, error: null };
        },
        then(resolve) {
          if (c1Hooks.jobCollectionError && table === "v2_inbound_media_job") {
            resolve({ data: null, error: { message: "db down" } });
            return;
          }
          const hasStatusIn = filters.some((f) => f[0] === "in" && f[1] === "status");
          const hasStatusEq = filters.some((f) => f[0] === "eq" && f[1] === "status");
          if (table === "v2_inbound_media_job" && !hasStatusIn && !hasStatusEq) {
            c1Hooks.jobSampleLoads += 1;
            if (c1Hooks.failOnJobSampleLoad === c1Hooks.jobSampleLoads) {
              resolve({ data: null, error: { message: "db down" } });
              return;
            }
          }
          if (table === "v2_win") {
            c1Hooks.winLoads += 1;
            if (c1Hooks.failOnWinLoad === c1Hooks.winLoads) {
              resolve({ data: null, error: { message: "db down" } });
              return;
            }
          }
          let match = rowsFor(table).filter((row) => matchesFilters(row, filters));
          if (
            table === "v2_inbound_media_job" &&
            !hasStatusIn &&
            !hasStatusEq &&
            c1Hooks.dropJob2OnSampleLoad != null &&
            c1Hooks.jobSampleLoads >= c1Hooks.dropJob2OnSampleLoad
          ) {
            match = match.filter(
              (row) => row.id !== "bbbbbbbb-2222-4222-8222-222222222222"
            );
          }
          if (table === "v2_win") {
            if (c1Hooks.hideWinBAfterFirstWinLoad && c1Hooks.winLoads >= 2) {
              match = match.filter((row) => row.id !== "dddddddd-4444-4444-8444-444444444444");
            }
          }
          resolve({ data: match.map((r) => ({ ...r })), error: null });
        },
      };
      return {
        select: () => api,
        update: (patch: Record<string, unknown>) => {
          const uf: Array<[string, string, unknown]> = [];
          const uapi = {
            eq(c: string, v: unknown) {
              uf.push(["eq", c, v]);
              return uapi;
            },
            is(c: string, v: unknown) {
              uf.push(["is", c, v]);
              return uapi;
            },
            select() {
              return {
                maybeSingle: async () => {
                  const id = String(uf.find((f) => f[0] === "eq" && f[1] === "id")?.[2] ?? "");
                  const row = jobs.get(id);
                  if (!row || table !== "v2_inbound_media_job") {
                    return { data: null, error: null };
                  }
                  for (const [op, c, v] of uf) {
                    if (c === "id") continue;
                    if (op === "is") {
                      if (v === null && row[c] != null) return { data: null, error: null };
                    } else if (row[c] !== v) {
                      return { data: null, error: null };
                    }
                  }
                  Object.assign(row, patch);
                  return { data: { id: row.id }, error: null };
                },
              };
            },
          };
          return uapi;
        },
      };
    },
  },
}));

vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  hasUnresolvedAccountDeletionRequest: vi.fn(async () => false),
}));

import {
  applyInboundMmsC1Decision,
  evaluateAwaitingInboundMmsAttachment,
  INBOUND_MEDIA_C1_SID_CARDINALITY_LIMIT,
  INBOUND_MEDIA_C1_WAIT_RETRY_MS,
  isInboundMediaJobC1OpportunisticCandidate,
  isInboundMediaJobC1RetryShape,
  listInboundMediaJobsForC1,
  sameSidMediaJobCardinalityIsMulti,
  tryCorrelateAwaitingInboundMmsForMessageSid,
  tryCorrelateInboundMmsC1Job,
  type InboundMmsC1MediaLite,
  type InboundMmsC1SiblingLite,
  type InboundMmsC1WinLite,
} from "@/lib/victory-media/correlate-inbound-mms-c1";
import {
  isInboundMediaJobActionableForB1Download,
  isInboundMediaJobActionableForB2,
  type InboundMediaJobRow,
} from "@/lib/victory-media/claim-inbound-media-job";

const NOW = new Date("2026-08-20T12:00:00.000Z");
const JOB_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const JOB_2 = "bbbbbbbb-2222-4222-8222-222222222222";
const WIN_A = "cccccccc-3333-4333-8333-333333333333";
const WIN_B = "dddddddd-4444-4444-8444-444444444444";
const MEDIA_ID = "eeeeeeee-5555-4555-8555-555555555555";
const USER = "user_c1";
const OTHER = "user_other";
const SID = "SMcccccccccccccccccccccccccccccccc";
const NORM = `${USER}/mms-norm/${JOB_ID}/master.jpg`;

function c1Job(partial: Partial<InboundMediaJobRow> = {}): InboundMediaJobRow {
  return {
    id: JOB_ID,
    message_sid: SID,
    media_ordinal: 0,
    clerk_user_id: USER,
    twilio_media_sid: null,
    declared_content_type: "image/jpeg",
    status: "awaiting_attach",
    attempt_count: 2,
    next_retry_at: null,
    last_error_code: null,
    temp_storage_path: null,
    normalized_storage_path: NORM,
    attached_win_id: null,
    resolution: null,
    classifier_target: null,
    followup_idempotency_key: null,
    expires_at: "2026-08-23T12:00:00.000Z",
    tombstoned_at: null,
    created_at: "2026-08-19T00:00:00.000Z",
    updated_at: "2026-08-20T11:00:00.000Z",
    ...partial,
  };
}

function winLite(partial: Partial<InboundMmsC1WinLite> = {}): InboundMmsC1WinLite {
  return {
    id: WIN_A,
    clerk_user_id: USER,
    source_message_sid: SID,
    source_type: "sms_inbound",
    status: "active",
    hidden_at: null,
    ...partial,
  };
}

function sibling(partial: Partial<InboundMmsC1SiblingLite> = {}): InboundMmsC1SiblingLite {
  return {
    id: JOB_ID,
    status: "awaiting_attach",
    temp_storage_path: null,
    normalized_storage_path: NORM,
    resolution: null,
    attached_win_id: null,
    tombstoned_at: null,
    expires_at: "2026-08-23T12:00:00.000Z",
    ...partial,
  };
}

function decide(
  extra: Partial<Parameters<typeof evaluateAwaitingInboundMmsAttachment>[0]> = {}
) {
  const job = extra.job ?? c1Job();
  return evaluateAwaitingInboundMmsAttachment({
    job,
    now: NOW,
    deletion: "clear",
    wins: [],
    mediaByWinId: new Map(),
    provenanceMedia: null,
    siblings: [sibling({ id: job.id })],
    ...extra,
  });
}

describe("evaluateAwaitingInboundMmsAttachment", () => {
  it("0 matching Wins → WAIT", () => {
    expect(decide({ wins: [] }).kind).toBe("waiting_for_win");
  });

  it("1 active Win → attach eligible", () => {
    const d = decide({ wins: [winLite()] });
    expect(d).toMatchObject({
      kind: "attach_eligible",
      winId: WIN_A,
      jobId: JOB_ID,
      clerkUserId: USER,
      messageSid: SID,
      mediaOrdinal: 0,
      normalizedMasterPath: NORM,
    });
  });

  it("2 active Wins same SID → ambiguous; no ordinal preference", () => {
    const d = decide({
      wins: [
        winLite({ id: WIN_B }),
        winLite({ id: WIN_A }),
      ],
    });
    expect(d.kind).toBe("ambiguous_wins");
  });

  it("hidden Win excluded → WAIT", () => {
    expect(
      decide({
        wins: [winLite({ status: "hidden", hidden_at: NOW.toISOString() })],
      }).kind
    ).toBe("waiting_for_win");
  });

  it("one hidden + one active → attach to the active Win only", () => {
    const d = decide({
      wins: [
        winLite({
          id: WIN_B,
          status: "hidden",
          hidden_at: NOW.toISOString(),
        }),
        winLite(),
      ],
    });
    expect(d).toMatchObject({ kind: "attach_eligible", winId: WIN_A });
  });

  it("cross-user same SID excluded", () => {
    expect(
      decide({
        wins: [winLite({ clerk_user_id: OTHER })],
      }).kind
    ).toBe("waiting_for_win");
  });

  it("manual/system Win excluded", () => {
    expect(decide({ wins: [winLite({ source_type: "manual" })] }).kind).toBe(
      "waiting_for_win"
    );
    expect(decide({ wins: [winLite({ source_type: "system_event" })] }).kind).toBe(
      "waiting_for_win"
    );
  });

  it("2 eligible media jobs → ambiguous media; ordinal 0/1 not preferred", () => {
    const d0 = decide({
      job: c1Job({ media_ordinal: 0 }),
      wins: [winLite()],
      siblings: [
        sibling({ id: JOB_ID }),
        sibling({
          id: JOB_2,
          normalized_storage_path: `${USER}/mms-norm/${JOB_2}/master.jpg`,
        }),
      ],
    });
    const d1 = decide({
      job: c1Job({ id: JOB_2, media_ordinal: 1 }),
      wins: [winLite()],
      siblings: [
        sibling({ id: JOB_ID }),
        sibling({
          id: JOB_2,
          normalized_storage_path: `${USER}/mms-norm/${JOB_2}/master.jpg`,
        }),
      ],
    });
    expect(d0.kind).toBe("ambiguous_media");
    expect(d1.kind).toBe("ambiguous_media");
  });

  it("pending_semantics sibling is still a second media-job row → never attach", () => {
    const d = decide({
      wins: [winLite()],
      siblings: [
        sibling({ id: JOB_ID }),
        sibling({
          id: JOB_2,
          status: "pending_semantics",
          normalized_storage_path: `${USER}/mms-norm/${JOB_2}/master.jpg`,
        }),
      ],
    });
    expect(d.kind).toBe("ambiguous_media");
  });

  it("tombstoned sibling still counts as multi-image history → never attach", () => {
    const d = decide({
      wins: [winLite()],
      siblings: [
        sibling({ id: JOB_ID }),
        sibling({
          id: JOB_2,
          status: "tombstoned",
          tombstoned_at: NOW.toISOString(),
          resolution: "removed",
        }),
      ],
    });
    expect(d.kind).toBe("ambiguous_media");
  });

  it("expired sibling still counts as multi-image history → never attach", () => {
    const d = decide({
      wins: [winLite()],
      siblings: [
        sibling({ id: JOB_ID }),
        sibling({
          id: JOB_2,
          expires_at: "2026-08-19T00:00:00.000Z",
        }),
      ],
    });
    expect(d.kind).toBe("ambiguous_media");
  });

  it("in-flight sibling waits rather than attaching", () => {
    expect(
      decide({
        wins: [winLite()],
        siblings: [
          sibling({ id: JOB_ID }),
          sibling({
            id: JOB_2,
            status: "pending_download",
            normalized_storage_path: null,
          }),
        ],
      }).kind
    ).toBe("waiting_for_sibling_media");
  });

  it("failed + temp null sibling is B1 retry — still a second image", () => {
    expect(
      decide({
        wins: [winLite()],
        siblings: [
          sibling({ id: JOB_ID }),
          sibling({
            id: JOB_2,
            status: "failed",
            temp_storage_path: null,
            normalized_storage_path: null,
          }),
        ],
      }).kind
    ).toBe("waiting_for_sibling_media");
  });

  it("normalizing sibling waits, with or without temp", () => {
    expect(
      decide({
        wins: [winLite()],
        siblings: [
          sibling({ id: JOB_ID }),
          sibling({
            id: JOB_2,
            status: "normalizing",
            temp_storage_path: null,
          }),
        ],
      }).kind
    ).toBe("waiting_for_sibling_media");
    expect(
      decide({
        wins: [winLite()],
        siblings: [
          sibling({ id: JOB_ID }),
          sibling({
            id: JOB_2,
            status: "normalizing",
            temp_storage_path: `${USER}/mms-temp/${JOB_2}.bin`,
          }),
        ],
      }).kind
    ).toBe("waiting_for_sibling_media");
  });

  it("failed + temp sibling waits", () => {
    expect(
      decide({
        wins: [winLite()],
        siblings: [
          sibling({ id: JOB_ID }),
          sibling({
            id: JOB_2,
            status: "failed",
            temp_storage_path: `${USER}/mms-temp/${JOB_2}.bin`,
          }),
        ],
      }).kind
    ).toBe("waiting_for_sibling_media");
  });

  it("10-job SID cannot false-single; cardinality is 1 vs 2+", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      sibling({
        id: `aaaaaaaa-1111-4111-8111-11111111111${i}`,
        status: i === 0 ? "awaiting_attach" : "expired",
        expires_at: i === 0 ? "2026-08-23T12:00:00.000Z" : "2026-08-19T00:00:00.000Z",
      })
    );
    const sample = many.slice(0, INBOUND_MEDIA_C1_SID_CARDINALITY_LIMIT);
    expect(sameSidMediaJobCardinalityIsMulti(sample, JOB_ID)).toBe(true);
    expect(decide({ wins: [winLite()], siblings: sample }).kind).toBe("ambiguous_media");
    expect(decide({ job: c1Job({ media_ordinal: 9 }), wins: [winLite()], siblings: sample }).kind).not.toBe(
      "attach_eligible"
    );
  });

  it("malformed expires_at fails closed — not attach_eligible", () => {
    const d = decide({
      job: c1Job({ expires_at: "not-a-timestamp" }),
      wins: [winLite()],
    });
    expect(d.kind).toBe("error_retry");
    if (d.kind !== "error_retry") return;
    expect(d.errorCode).toBe("invalid_expires_at");
  });

  it("same MMS provenance with media.id !== job.id is repair retry, not replay", () => {
    const stolenId: InboundMmsC1MediaLite = {
      id: MEDIA_ID,
      win_id: WIN_A,
      clerk_user_id: USER,
      source_type: "inbound_mms",
      source_message_sid: SID,
      source_media_ordinal: 0,
    };
    const d = decide({
      wins: [winLite()],
      mediaByWinId: new Map([[WIN_A, stolenId]]),
      provenanceMedia: stolenId,
    });
    expect(d.kind).toBe("error_retry");
    if (d.kind !== "error_retry") return;
    expect(d.errorCode).toBe("same_mms_media_id_mismatch");
  });

  it("web media → user_priority_blocked", () => {
    const web: InboundMmsC1MediaLite = {
      id: MEDIA_ID,
      win_id: WIN_A,
      clerk_user_id: USER,
      source_type: "web_upload",
      source_message_sid: null,
      source_media_ordinal: null,
    };
    expect(
      decide({
        wins: [winLite()],
        mediaByWinId: new Map([[WIN_A, web]]),
      }).kind
    ).toBe("web_priority_blocked");
  });

  it("different inbound MMS → other_mms_occupied", () => {
    const other: InboundMmsC1MediaLite = {
      id: MEDIA_ID,
      win_id: WIN_A,
      clerk_user_id: USER,
      source_type: "inbound_mms",
      source_message_sid: "SMother",
      source_media_ordinal: 0,
    };
    expect(
      decide({
        wins: [winLite()],
        mediaByWinId: new Map([[WIN_A, other]]),
      }).kind
    ).toBe("other_mms_occupied");
  });

  it("same MMS provenance → replay only when media.id === job.id", () => {
    const same: InboundMmsC1MediaLite = {
      id: JOB_ID,
      win_id: WIN_A,
      clerk_user_id: USER,
      source_type: "inbound_mms",
      source_message_sid: SID,
      source_media_ordinal: 0,
    };
    expect(
      decide({
        wins: [winLite()],
        mediaByWinId: new Map([[WIN_A, same]]),
        provenanceMedia: same,
      })
    ).toMatchObject({ kind: "same_mms_replay", winId: WIN_A, mediaId: JOB_ID });
  });

  it("replay rejects mismatched source_type / SID / ordinal", () => {
    const base: InboundMmsC1MediaLite = {
      id: JOB_ID,
      win_id: WIN_A,
      clerk_user_id: USER,
      source_type: "inbound_mms",
      source_message_sid: SID,
      source_media_ordinal: 0,
    };
    expect(
      decide({
        wins: [winLite()],
        provenanceMedia: { ...base, source_type: "web_upload" },
      }).kind
    ).toBe("attach_eligible");
    expect(
      decide({
        wins: [winLite()],
        provenanceMedia: { ...base, source_message_sid: "SMother" },
      }).kind
    ).toBe("attach_eligible");
    expect(
      decide({
        wins: [winLite()],
        provenanceMedia: { ...base, source_media_ordinal: 1 },
      }).kind
    ).toBe("attach_eligible");
  });

  it("replay cross-user provenance fails closed", () => {
    const stolen: InboundMmsC1MediaLite = {
      id: MEDIA_ID,
      win_id: WIN_A,
      clerk_user_id: OTHER,
      source_type: "inbound_mms",
      source_message_sid: SID,
      source_media_ordinal: 0,
    };
    expect(
      decide({
        wins: [winLite()],
        provenanceMedia: stolen,
      }).kind
    ).toBe("provenance_clerk_mismatch");
  });

  it("unknown media source is occupied, not attachable", () => {
    const weird: InboundMmsC1MediaLite = {
      id: MEDIA_ID,
      win_id: WIN_A,
      clerk_user_id: USER,
      source_type: "mystery",
      source_message_sid: null,
      source_media_ordinal: null,
    };
    expect(
      decide({
        wins: [winLite()],
        mediaByWinId: new Map([[WIN_A, weird]]),
      }).kind
    ).toBe("other_mms_occupied");
  });

  it("already expired awaiting_attach → expired", () => {
    expect(
      decide({
        job: c1Job({ expires_at: "2026-08-19T00:00:00.000Z" }),
        wins: [winLite()],
      }).kind
    ).toBe("expired");
  });

  it("future expiry remains eligible", () => {
    expect(decide({ wins: [winLite()] }).kind).toBe("attach_eligible");
  });

  it("null expires_at remains eligible", () => {
    expect(
      decide({ job: c1Job({ expires_at: null }), wins: [winLite()] }).kind
    ).toBe("attach_eligible");
  });

  it("deletion unresolved → deletion_blocked", () => {
    expect(decide({ deletion: "unresolved", wins: [winLite()] }).kind).toBe(
      "deletion_blocked"
    );
  });

  it("already-ambiguous sibling still blocks attach (no leftover ordinal attach)", () => {
    expect(
      decide({
        wins: [winLite()],
        siblings: [
          sibling({ id: JOB_ID }),
          sibling({
            id: JOB_2,
            status: "skipped_conflict",
            resolution: "ambiguous",
            normalized_storage_path: `${USER}/mms-norm/${JOB_2}/master.jpg`,
          }),
        ],
      }).kind
    ).toBe("ambiguous_media");
  });

  it("empty source_message_sid is not correlatable", () => {
    expect(decide({ job: c1Job({ message_sid: "  " }), wins: [winLite()] }).kind).toBe(
      "not_c1_ready"
    );
  });

  it("win without source_message_sid is excluded", () => {
    expect(
      decide({
        wins: [winLite({ source_message_sid: null })],
      }).kind
    ).toBe("waiting_for_win");
  });

  it("UNIQUE(win_id): existing media is classified, never ignored", () => {
    const web: InboundMmsC1MediaLite = {
      id: MEDIA_ID,
      win_id: WIN_A,
      clerk_user_id: USER,
      source_type: "web_upload",
      source_message_sid: null,
      source_media_ordinal: null,
    };
    expect(
      decide({
        wins: [winLite()],
        mediaByWinId: new Map([[WIN_A, web]]),
      }).kind
    ).toBe("web_priority_blocked");
  });

  it("tombstoned job → tombstoned", () => {
    expect(
      decide({
        job: c1Job({
          status: "tombstoned",
          resolution: "removed",
          tombstoned_at: NOW.toISOString(),
        }),
      }).kind
    ).toBe("tombstoned");
  });
});

describe("applyInboundMmsC1Decision CAS", () => {
  beforeEach(() => {
    jobs.clear();
    wins.clear();
    media.clear();
    c1Hooks.reset();
  });

  function seedJob(row: InboundMediaJobRow) {
    jobs.set(row.id, { ...row });
  }

  it("zero-win stays awaiting_attach and sets next_retry_at without failed", async () => {
    const job = c1Job();
    seedJob(job);
    const d = await applyInboundMmsC1Decision({
      job,
      decision: { kind: "waiting_for_win", jobId: job.id },
      now: NOW,
    });
    expect(d.kind).toBe("waiting_for_win");
    const stored = jobs.get(JOB_ID)!;
    expect(stored.status).toBe("awaiting_attach");
    expect(stored.resolution).toBeNull();
    expect(stored.attached_win_id).toBeNull();
    expect(stored.normalized_storage_path).toBe(NORM);
    expect(stored.next_retry_at).toBe(
      new Date(NOW.getTime() + INBOUND_MEDIA_C1_WAIT_RETRY_MS).toISOString()
    );
    expect(stored.last_error_code).toBe("waiting_for_win");
    expect(stored.status).not.toBe("failed");
    expect(stored.attempt_count).toBe(2);
  });

  it("attach-eligible does not mutate attached fields but arms next_retry_at", async () => {
    const job = c1Job();
    seedJob(job);
    await applyInboundMmsC1Decision({
      job,
      decision: {
        kind: "attach_eligible",
        jobId: JOB_ID,
        clerkUserId: USER,
        messageSid: SID,
        mediaOrdinal: 0,
        winId: WIN_A,
        normalizedMasterPath: NORM,
      },
      now: NOW,
    });
    expect(jobs.get(JOB_ID)!.status).toBe("awaiting_attach");
    expect(jobs.get(JOB_ID)!.attached_win_id).toBeNull();
    expect(jobs.get(JOB_ID)!.resolution).toBeNull();
    expect(jobs.get(JOB_ID)!.next_retry_at).toBe(
      new Date(NOW.getTime() + INBOUND_MEDIA_C1_WAIT_RETRY_MS).toISOString()
    );
    expect(jobs.get(JOB_ID)!.last_error_code).toBe("attach_eligible");
    expect(jobs.get(JOB_ID)!.attempt_count).toBe(2);
    expect(media.size).toBe(0);
  });

  it("ambiguous wins CAS skipped_conflict + ambiguous", async () => {
    const job = c1Job();
    seedJob(job);
    await applyInboundMmsC1Decision({
      job,
      decision: { kind: "ambiguous_wins", jobId: JOB_ID },
      now: NOW,
    });
    expect(jobs.get(JOB_ID)!.status).toBe("skipped_conflict");
    expect(jobs.get(JOB_ID)!.resolution).toBe("ambiguous");
    expect(jobs.get(JOB_ID)!.attached_win_id).toBeNull();
    expect(jobs.get(JOB_ID)!.next_retry_at).toBeNull();
    expect(jobs.get(JOB_ID)!.last_error_code).toBe("ambiguous_wins");
  });

  it("web block CAS user_priority_blocked", async () => {
    const job = c1Job();
    seedJob(job);
    await applyInboundMmsC1Decision({
      job,
      decision: { kind: "web_priority_blocked", jobId: JOB_ID, winId: WIN_A },
      now: NOW,
    });
    expect(jobs.get(JOB_ID)!.status).toBe("skipped_conflict");
    expect(jobs.get(JOB_ID)!.resolution).toBe("user_priority_blocked");
  });

  it("other-MMS CAS skipped_conflict + resolution null", async () => {
    const job = c1Job();
    seedJob(job);
    await applyInboundMmsC1Decision({
      job,
      decision: { kind: "other_mms_occupied", jobId: JOB_ID, winId: WIN_A },
      now: NOW,
    });
    expect(jobs.get(JOB_ID)!.status).toBe("skipped_conflict");
    expect(jobs.get(JOB_ID)!.resolution).toBeNull();
    expect(jobs.get(JOB_ID)!.last_error_code).toBe("other_mms_occupied");
  });

  it("replay attached CAS", async () => {
    const job = c1Job();
    seedJob(job);
    await applyInboundMmsC1Decision({
      job,
      decision: {
        kind: "same_mms_replay",
        jobId: JOB_ID,
        winId: WIN_A,
        mediaId: MEDIA_ID,
      },
      now: NOW,
    });
    expect(jobs.get(JOB_ID)!.status).toBe("attached");
    expect(jobs.get(JOB_ID)!.resolution).toBe("attached");
    expect(jobs.get(JOB_ID)!.attached_win_id).toBe(WIN_A);
    expect(media.size).toBe(0);
  });

  it("tombstone CAS loses", async () => {
    const job = c1Job();
    seedJob({
      ...job,
      status: "tombstoned",
      resolution: "removed",
      tombstoned_at: NOW.toISOString(),
    });
    const d = await applyInboundMmsC1Decision({
      job,
      decision: { kind: "waiting_for_win", jobId: JOB_ID },
      now: NOW,
    });
    expect(d.kind).toBe("stale_ownership");
    expect(jobs.get(JOB_ID)!.status).toBe("tombstoned");
    expect(jobs.get(JOB_ID)!.resolution).toBe("removed");
  });

  it("expired CAS", async () => {
    const job = c1Job({ expires_at: "2026-08-19T00:00:00.000Z" });
    seedJob({ ...job, status: "awaiting_attach" });
    await applyInboundMmsC1Decision({
      job: c1Job(),
      decision: { kind: "expired", jobId: JOB_ID },
      now: NOW,
    });
    expect(jobs.get(JOB_ID)!.status).toBe("expired");
    expect(jobs.get(JOB_ID)!.resolution).toBe("expired");
    expect(jobs.get(JOB_ID)!.next_retry_at).toBeNull();
  });
});

describe("tryCorrelateInboundMmsC1Job", () => {
  beforeEach(() => {
    jobs.clear();
    wins.clear();
    media.clear();
    c1Hooks.reset();
  });

  it("1 win no media → attach_eligible without v2_win_media insert; retry armed", async () => {
    jobs.set(JOB_ID, { ...c1Job() });
    wins.set(WIN_A, { ...winLite() });
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("attach_eligible");
    expect(jobs.get(JOB_ID)!.status).toBe("awaiting_attach");
    expect(jobs.get(JOB_ID)!.attached_win_id).toBeNull();
    expect(jobs.get(JOB_ID)!.next_retry_at).toBe(
      new Date(NOW.getTime() + INBOUND_MEDIA_C1_WAIT_RETRY_MS).toISOString()
    );
    expect(media.size).toBe(0);
  });

  it("0 wins → wait retry shape never B1/B2 actionable", async () => {
    jobs.set(JOB_ID, { ...c1Job() });
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("waiting_for_win");
    const row = jobs.get(JOB_ID)!;
    expect(isInboundMediaJobC1RetryShape(row as never)).toBe(true);
    expect(isInboundMediaJobActionableForB1Download(row as never, NOW)).toBe(false);
    expect(isInboundMediaJobActionableForB2(row as never, NOW)).toBe(false);
    expect(row.status).not.toBe("failed");
  });

  it("2 active Wins → ambiguous; does not pick first or last", async () => {
    jobs.set(JOB_ID, { ...c1Job() });
    wins.set(WIN_A, { ...winLite() });
    wins.set(WIN_B, { ...winLite({ id: WIN_B }) });
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("ambiguous_wins");
    expect(jobs.get(JOB_ID)!.status).toBe("skipped_conflict");
    expect(jobs.get(JOB_ID)!.resolution).toBe("ambiguous");
    expect(jobs.get(JOB_ID)!.attached_win_id).toBeNull();
    expect(jobs.get(JOB_ID)!.next_retry_at).toBeNull();
  });

  it("deletion → expired", async () => {
    jobs.set(JOB_ID, { ...c1Job() });
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => true,
    });
    expect(d?.kind).toBe("deletion_blocked");
    expect(jobs.get(JOB_ID)!.status).toBe("expired");
    expect(jobs.get(JOB_ID)!.resolution).toBe("expired");
    expect(jobs.get(JOB_ID)!.next_retry_at).toBeNull();
  });

  it("stale 2-Win snapshot re-read as 1 Win is not terminal ambiguous", async () => {
    c1Hooks.hideWinBAfterFirstWinLoad = true;
    jobs.set(JOB_ID, { ...c1Job() });
    wins.set(WIN_A, { ...winLite() });
    wins.set(WIN_B, { ...winLite({ id: WIN_B }) });
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("attach_eligible");
    expect(jobs.get(JOB_ID)!.status).toBe("awaiting_attach");
    expect(jobs.get(JOB_ID)!.resolution).toBeNull();
  });

  it("stale web block re-read with media gone is not terminal blocked", async () => {
    c1Hooks.dropWinMediaAfterFirstWinMediaLoad = true;
    jobs.set(JOB_ID, { ...c1Job() });
    wins.set(WIN_A, { ...winLite() });
    media.set(MEDIA_ID, {
      id: MEDIA_ID,
      win_id: WIN_A,
      clerk_user_id: USER,
      source_type: "web_upload",
      source_message_sid: null,
      source_media_ordinal: null,
    });
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("attach_eligible");
    expect(jobs.get(JOB_ID)!.status).toBe("awaiting_attach");
    expect(jobs.get(JOB_ID)!.resolution).toBeNull();
  });

  it("stale other-MMS re-read with media gone is not terminal occupied", async () => {
    c1Hooks.dropWinMediaAfterFirstWinMediaLoad = true;
    jobs.set(JOB_ID, { ...c1Job() });
    wins.set(WIN_A, { ...winLite() });
    media.set(MEDIA_ID, {
      id: MEDIA_ID,
      win_id: WIN_A,
      clerk_user_id: USER,
      source_type: "inbound_mms",
      source_message_sid: "SMother",
      source_media_ordinal: 0,
    });
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("attach_eligible");
    expect(jobs.get(JOB_ID)!.status).toBe("awaiting_attach");
    expect(jobs.get(JOB_ID)!.resolution).toBeNull();
  });

  it("same-MMS replay requires source_type inbound_mms, SID, ordinal, clerk, active Win", async () => {
    jobs.set(JOB_ID, { ...c1Job() });
    wins.set(WIN_A, { ...winLite() });
    media.set(JOB_ID, {
      id: JOB_ID,
      win_id: WIN_A,
      clerk_user_id: USER,
      source_type: "inbound_mms",
      source_message_sid: SID,
      source_media_ordinal: 0,
    });
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("same_mms_replay");
    expect(jobs.get(JOB_ID)!.status).toBe("attached");
    expect(jobs.get(JOB_ID)!.attached_win_id).toBe(WIN_A);
    expect(jobs.get(JOB_ID)!.next_retry_at).toBeNull();
  });

  it("replay media.id != job.id → repair retry, not attached", async () => {
    jobs.set(JOB_ID, { ...c1Job() });
    wins.set(WIN_A, { ...winLite() });
    media.set(MEDIA_ID, {
      id: MEDIA_ID,
      win_id: WIN_A,
      clerk_user_id: USER,
      source_type: "inbound_mms",
      source_message_sid: SID,
      source_media_ordinal: 0,
    });
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("error_retry");
    expect(jobs.get(JOB_ID)!.status).toBe("awaiting_attach");
    expect(jobs.get(JOB_ID)!.attached_win_id).toBeNull();
    expect(jobs.get(JOB_ID)!.last_error_code).toBe("same_mms_media_id_mismatch");
  });

  it("C1 uses evaluation clock, not a stale earlier timestamp", async () => {
    jobs.set(JOB_ID, {
      ...c1Job({ expires_at: "2026-08-20T12:00:00.400Z" }),
    });
    wins.set(WIN_A, { ...winLite() });
    const stillOpen = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: new Date("2026-08-20T12:00:00.000Z"),
      hasUnresolvedDeletion: async () => false,
    });
    expect(stillOpen?.kind).toBe("attach_eligible");
    jobs.set(JOB_ID, {
      ...c1Job({ expires_at: "2026-08-20T12:00:00.400Z" }),
    });
    const after = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: new Date("2026-08-20T12:00:01.000Z"),
      hasUnresolvedDeletion: async () => false,
    });
    expect(after?.kind).toBe("expired");
  });

  it("two same-SID jobs remain ambiguous after revalidation", async () => {
    jobs.set(JOB_ID, { ...c1Job() });
    jobs.set(JOB_2, { ...c1Job({ id: JOB_2, media_ordinal: 1 }) });
    wins.set(WIN_A, { ...winLite() });
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("ambiguous_media");
    expect(jobs.get(JOB_ID)!.status).toBe("skipped_conflict");
    expect(jobs.get(JOB_ID)!.last_error_code).toBe("ambiguous_media");
    expect(jobs.get(JOB_ID)!.next_retry_at).toBeNull();
  });

  function webMedia(): Record<string, unknown> {
    return {
      id: MEDIA_ID,
      win_id: WIN_A,
      clerk_user_id: USER,
      source_type: "web_upload",
      source_message_sid: null,
      source_media_ordinal: null,
    };
  }

  function otherMmsMedia(): Record<string, unknown> {
    return {
      id: MEDIA_ID,
      win_id: WIN_A,
      clerk_user_id: USER,
      source_type: "inbound_mms",
      source_message_sid: "SMother",
      source_media_ordinal: 0,
    };
  }

  function expectStaleRetry(errorCode: string) {
    const row = jobs.get(JOB_ID)!;
    expect(row.status).toBe("awaiting_attach");
    expect(row.resolution).toBeNull();
    expect(row.attached_win_id).toBeNull();
    expect(row.normalized_storage_path).toBe(NORM);
    expect(row.next_retry_at).toBe(
      new Date(NOW.getTime() + INBOUND_MEDIA_C1_WAIT_RETRY_MS).toISOString()
    );
    expect(row.last_error_code).toBe(errorCode);
    expect(row.attempt_count).toBe(2);
  }

  it("changed-kind web → other-MMS → validator sees no media → retry, not terminal", async () => {
    c1Hooks.winMediaSequence = [webMedia(), otherMmsMedia(), null];
    jobs.set(JOB_ID, { ...c1Job() });
    wins.set(WIN_A, { ...winLite() });
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("error_retry");
    if (d?.kind === "error_retry") expect(d.errorCode).toBe("stale_other_mms_occupied");
    expectStaleRetry("stale_other_mms_occupied");
    expect(media.size).toBe(0);
  });

  it("changed-kind other-MMS → web → validator sees no media → retry, not terminal", async () => {
    c1Hooks.winMediaSequence = [otherMmsMedia(), webMedia(), null];
    jobs.set(JOB_ID, { ...c1Job() });
    wins.set(WIN_A, { ...winLite() });
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("error_retry");
    if (d?.kind === "error_retry") expect(d.errorCode).toBe("stale_web_priority");
    expectStaleRetry("stale_web_priority");
    expect(jobs.get(JOB_ID)!.resolution).not.toBe("user_priority_blocked");
    expect(media.size).toBe(0);
  });

  it("changed-kind 2 Wins → 1 Win + web → validator sees removed web → retry", async () => {
    c1Hooks.hideWinBAfterFirstWinLoad = true;
    c1Hooks.winMediaSequence = [webMedia(), null];
    jobs.set(JOB_ID, { ...c1Job() });
    wins.set(WIN_A, { ...winLite() });
    wins.set(WIN_B, { ...winLite({ id: WIN_B }) });
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("error_retry");
    if (d?.kind === "error_retry") expect(d.errorCode).toBe("stale_web_priority");
    expectStaleRetry("stale_web_priority");
    expect(jobs.get(JOB_ID)!.status).not.toBe("skipped_conflict");
  });

  it("ambiguous_wins validator still seeing 2+ terminals ambiguous", async () => {
    jobs.set(JOB_ID, { ...c1Job() });
    wins.set(WIN_A, { ...winLite() });
    wins.set(WIN_B, { ...winLite({ id: WIN_B }) });
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("ambiguous_wins");
    expect(jobs.get(JOB_ID)!.status).toBe("skipped_conflict");
    expect(jobs.get(JOB_ID)!.resolution).toBe("ambiguous");
    expect(jobs.get(JOB_ID)!.last_error_code).toBe("ambiguous_wins");
    expect(jobs.get(JOB_ID)!.attached_win_id).toBeNull();
    expect(media.size).toBe(0);
  });

  it("ambiguous_media validator still seeing 2+ terminals ambiguous", async () => {
    jobs.set(JOB_ID, { ...c1Job() });
    jobs.set(JOB_2, { ...c1Job({ id: JOB_2, media_ordinal: 1 }) });
    wins.set(WIN_A, { ...winLite() });
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("ambiguous_media");
    expect(jobs.get(JOB_ID)!.status).toBe("skipped_conflict");
    expect(jobs.get(JOB_ID)!.resolution).toBe("ambiguous");
    expect(jobs.get(JOB_ID)!.last_error_code).toBe("ambiguous_media");
  });

  it("ambiguous_media validator seeing <2 → retry, not terminal", async () => {
    c1Hooks.dropJob2OnSampleLoad = 3;
    jobs.set(JOB_ID, { ...c1Job() });
    jobs.set(JOB_2, { ...c1Job({ id: JOB_2, media_ordinal: 1 }) });
    wins.set(WIN_A, { ...winLite() });
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("error_retry");
    if (d?.kind === "error_retry") expect(d.errorCode).toBe("stale_ambiguous_media");
    expectStaleRetry("stale_ambiguous_media");
    expect(jobs.get(JOB_ID)!.status).not.toBe("skipped_conflict");
  });

  it("web validator seeing web → user_priority_blocked", async () => {
    jobs.set(JOB_ID, { ...c1Job() });
    wins.set(WIN_A, { ...winLite() });
    media.set(MEDIA_ID, webMedia());
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("web_priority_blocked");
    expect(jobs.get(JOB_ID)!.status).toBe("skipped_conflict");
    expect(jobs.get(JOB_ID)!.resolution).toBe("user_priority_blocked");
    expect(jobs.get(JOB_ID)!.attached_win_id).toBeNull();
    expect(jobs.get(JOB_ID)!.next_retry_at).toBeNull();
  });

  it("web validator seeing other MMS → retry, not other_mms terminal", async () => {
    c1Hooks.winMediaSequence = [webMedia(), webMedia(), otherMmsMedia()];
    jobs.set(JOB_ID, { ...c1Job() });
    wins.set(WIN_A, { ...winLite() });
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("error_retry");
    if (d?.kind === "error_retry") expect(d.errorCode).toBe("stale_web_priority");
    expectStaleRetry("stale_web_priority");
    expect(jobs.get(JOB_ID)!.status).not.toBe("skipped_conflict");
    expect(jobs.get(JOB_ID)!.last_error_code).not.toBe("other_mms_occupied");
    expect(media.size).toBe(0);
  });

  it("other-MMS validator seeing other MMS → terminal occupied", async () => {
    jobs.set(JOB_ID, { ...c1Job() });
    wins.set(WIN_A, { ...winLite() });
    media.set(MEDIA_ID, otherMmsMedia());
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("other_mms_occupied");
    expect(jobs.get(JOB_ID)!.status).toBe("skipped_conflict");
    expect(jobs.get(JOB_ID)!.resolution).toBeNull();
    expect(jobs.get(JOB_ID)!.last_error_code).toBe("other_mms_occupied");
    expect(jobs.get(JOB_ID)!.attached_win_id).toBeNull();
  });

  it("other-MMS validator seeing web → retry, not user_priority_blocked", async () => {
    c1Hooks.winMediaSequence = [otherMmsMedia(), otherMmsMedia(), webMedia()];
    jobs.set(JOB_ID, { ...c1Job() });
    wins.set(WIN_A, { ...winLite() });
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("error_retry");
    if (d?.kind === "error_retry") expect(d.errorCode).toBe("stale_other_mms_occupied");
    expectStaleRetry("stale_other_mms_occupied");
    expect(jobs.get(JOB_ID)!.resolution).not.toBe("user_priority_blocked");
    expect(jobs.get(JOB_ID)!.last_error_code).not.toBe("user_priority_blocked");
    expect(media.size).toBe(0);
  });

  it("validator query failure → retry, not terminal", async () => {
    c1Hooks.failOnWinLoad = 3;
    jobs.set(JOB_ID, { ...c1Job() });
    wins.set(WIN_A, { ...winLite() });
    wins.set(WIN_B, { ...winLite({ id: WIN_B }) });
    const d = await tryCorrelateInboundMmsC1Job(JOB_ID, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(d?.kind).toBe("error_retry");
    if (d?.kind === "error_retry") expect(d.errorCode).toBe("correlation_query_failed");
    expectStaleRetry("correlation_query_failed");
    expect(jobs.get(JOB_ID)!.status).not.toBe("skipped_conflict");
  });
});

describe("opportunistic C1 list", () => {
  beforeEach(() => {
    jobs.clear();
    wins.clear();
    media.clear();
    c1Hooks.reset();
  });

  it("expired due row is a candidate (not dropped)", () => {
    const expiredDue = {
      status: "awaiting_attach",
      temp_storage_path: null,
      normalized_storage_path: NORM,
      resolution: null,
      attached_win_id: null,
      tombstoned_at: null,
      expires_at: "2026-08-19T00:00:00.000Z",
      next_retry_at: "2026-08-20T11:00:00.000Z",
    };
    expect(isInboundMediaJobC1OpportunisticCandidate(expiredDue, NOW)).toBe(true);
  });

  it("expired due row is processed to expired instead of dropped; then live row can be listed", async () => {
    const expiredIds = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ];
    for (const id of expiredIds) {
      jobs.set(id, {
        ...c1Job({
          id,
          expires_at: "2026-08-19T00:00:00.000Z",
          next_retry_at: "2026-08-20T11:00:00.000Z",
        }),
      });
    }
    jobs.set(JOB_ID, {
      ...c1Job({ next_retry_at: "2026-08-20T11:30:00.000Z" }),
    });
    wins.set(WIN_A, { ...winLite() });

    const first = await listInboundMediaJobsForC1(1, { now: NOW });
    expect(first).toHaveLength(1);
    expect(expiredIds).toContain(first[0]);
    const expiredDecision = await tryCorrelateInboundMmsC1Job(first[0]!, {
      now: NOW,
      hasUnresolvedDeletion: async () => false,
    });
    expect(expiredDecision?.kind).toBe("expired");
    expect(jobs.get(first[0]!)!.status).toBe("expired");

    for (const id of expiredIds) {
      if (jobs.get(id)!.status === "awaiting_attach") {
        await tryCorrelateInboundMmsC1Job(id, {
          now: NOW,
          hasUnresolvedDeletion: async () => false,
        });
      }
    }
    const later = await listInboundMediaJobsForC1(1, { now: NOW });
    expect(later).toEqual([JOB_ID]);
  });
});

describe("tryCorrelateAwaitingInboundMmsForMessageSid bound", () => {
  beforeEach(() => {
    jobs.clear();
    wins.clear();
    media.clear();
    c1Hooks.reset();
  });

  it("evaluates at most one awaiting_attach job per SID trigger", async () => {
    jobs.set(JOB_ID, { ...c1Job() });
    jobs.set(JOB_2, { ...c1Job({ id: JOB_2, media_ordinal: 1 }) });
    wins.set(WIN_A, { ...winLite() });
    const out = await tryCorrelateAwaitingInboundMmsForMessageSid(
      { clerkUserId: USER, messageSid: SID },
      { now: NOW, hasUnresolvedDeletion: async () => false }
    );
    expect(out).toHaveLength(1);
  });

  it("SID collection query error is not silent attach and does not throw", async () => {
    c1Hooks.jobCollectionError = true;
    jobs.set(JOB_ID, { ...c1Job({ next_retry_at: "2026-08-20T12:01:00.000Z" }) });
    const out = await tryCorrelateAwaitingInboundMmsForMessageSid(
      { clerkUserId: USER, messageSid: SID },
      { now: NOW, hasUnresolvedDeletion: async () => false }
    );
    expect(out).toEqual([]);
    expect(jobs.get(JOB_ID)!.status).toBe("awaiting_attach");
    expect(jobs.get(JOB_ID)!.next_retry_at).toBe("2026-08-20T12:01:00.000Z");
  });
});
