import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPeopleSummaryMirror } from "@/lib/onboarding-people-summary";

const fromMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

const getActiveCommitmentMock = vi.fn();
const recomputeMock = vi.fn();
const loadDraftMock = vi.fn();

vi.mock("@/lib/v2-commitment", () => ({
  getActiveCommitment: (...args: unknown[]) => getActiveCommitmentMock(...args),
}));

vi.mock("@/lib/v2-coaching-memory", () => ({
  recomputeV2CoachingMemory: (...args: unknown[]) => recomputeMock(...args),
}));

vi.mock("@/lib/load-identity-edit-draft", () => ({
  loadIdentityEditDraft: (...args: unknown[]) => loadDraftMock(...args),
}));

vi.mock("@/lib/v2-identity-anchor", () => ({
  computeIdentityRefreshDueAtIsoFromNow: () => "2026-06-01T00:00:00.000Z",
}));

import {
  persistAppIdentityEdit,
  persistGuidedIdentityAnchorEdit,
  persistWave11ConfirmedIdentityAnchorEdit,
} from "@/lib/v2-persist-identity-edit";

const USER = "user_edit_1";
const OLD_VERSION = "ver_old";
const NEW_VERSION = "ver_new";
const COMMITMENT = "cmt_1";

function chain(result: unknown) {
  const proxy: Record<string, unknown> = {};
  const ret = () => proxy;
  for (const m of [
    "select",
    "eq",
    "in",
    "is",
    "order",
    "limit",
    "update",
    "insert",
    "delete",
    "not",
    "upsert",
  ]) {
    proxy[m] = ret;
  }
  proxy.maybeSingle = () => Promise.resolve(result);
  proxy.then = (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve);
  return proxy;
}

/** Successful profile upsert that returns a verified mirror row. */
function profileUpsertOk(
  updates?: Record<string, unknown>[],
  options?: { data?: Record<string, unknown> | null; error?: unknown }
) {
  return {
    upsert: (row: Record<string, unknown>) => {
      updates?.push(row);
      const data =
        options && "data" in options
          ? options.data
          : {
              clerk_user_id: row.clerk_user_id,
              preferred_name: row.preferred_name,
              identity_anchor_text: row.identity_anchor_text,
              identity_source: row.identity_source,
              active_identity_version_id: row.active_identity_version_id,
            };
      return {
        select: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data,
              error: options?.error ?? null,
            }),
        }),
      };
    },
  };
}

function baseIdentityVersionHandlers(inserts: Record<string, unknown>[]) {
  let selectCall = 0;
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () => {
            selectCall += 1;
            if (selectCall === 1) {
              return Promise.resolve({
                data: { id: OLD_VERSION, version_number: 2 },
                error: null,
              });
            }
            return Promise.resolve({ data: { version_number: 2 }, error: null });
          },
        }),
        order: () => ({
          limit: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { version_number: 2 }, error: null }),
          }),
        }),
      }),
    }),
    update: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ error: null }),
        }),
      }),
    }),
    insert: (row: Record<string, unknown>) => {
      inserts.push(row);
      return {
        select: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { id: NEW_VERSION }, error: null }),
        }),
      };
    },
    delete: () => ({
      eq: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    }),
  };
}

const baseInput = {
  clerkUserId: USER,
  preferredName: "Alex",
  identityAnchorText: "I am becoming a steadier parent every day.",
  ingredientIds: ["dad"],
  otherText: null as string | null,
  intakeOrigin: "generated" as const,
  useMineAnyway: false,
  clarityScore: 80,
  replaceImportantPeople: true,
  expectedActiveVersionId: OLD_VERSION,
};

describe("persistAppIdentityEdit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveCommitmentMock.mockResolvedValue({ id: COMMITMENT });
    recomputeMock.mockResolvedValue(undefined);
  });

  it("creates new version, deactivates old, upserts profile, and recomputes coaching memory", async () => {
    const updates: Record<string, unknown>[] = [];
    const inserts: Record<string, unknown>[] = [];
    const peopleOps: string[] = [];

    fromMock.mockImplementation((table: string) => {
      if (table === "user_identity_version") {
        return baseIdentityVersionHandlers(inserts);
      }
      if (table === "user_profiles") {
        return profileUpsertOk(updates);
      }
      if (table === "important_people") {
        return {
          insert: (rows: Record<string, unknown>[]) => {
            peopleOps.push("insert");
            inserts.push(...rows);
            return {
              select: () =>
                Promise.resolve({
                  data: [{ id: "ppl_new_1" }],
                  error: null,
                }),
            };
          },
          update: () => {
            peopleOps.push("deactivate_prior");
            const q: Record<string, unknown> = {};
            const ret = () => q;
            for (const m of ["eq", "in", "is", "not"]) q[m] = ret;
            q.then = (resolve: (v: unknown) => void) =>
              Promise.resolve({ error: null }).then(resolve);
            return q;
          },
        };
      }
      return chain({ data: null, error: null });
    });

    const people = [{ display_name: "Sam", relationship_type: "child" as const }];
    const mirror = buildPeopleSummaryMirror(
      people.map((p) => ({ relationship_type: p.relationship_type }))
    );

    const result = await persistAppIdentityEdit({
      ...baseInput,
      importantPeople: people,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.versionId).toBe(NEW_VERSION);
    }
    expect(updates[0]).toMatchObject({
      clerk_user_id: USER,
      active_identity_version_id: NEW_VERSION,
      identity_source: "user_edited",
      people_summary: mirror,
    });
    expect(inserts.some((r) => r.version_number === 3 && r.is_active === true)).toBe(true);
    expect(peopleOps).toEqual(["insert", "deactivate_prior"]);
    expect(inserts.some((r) => r.source === "edit" && r.is_private === true)).toBe(true);
    expect(recomputeMock).toHaveBeenCalledWith(COMMITMENT, { reasonCode: "app_identity_edit" });
  });

  it("creates a missing user_profiles row via upsert (skipped-onboarding / orphan-version state)", async () => {
    const updates: Record<string, unknown>[] = [];
    const inserts: Record<string, unknown>[] = [];

    fromMock.mockImplementation((table: string) => {
      if (table === "user_identity_version") {
        return baseIdentityVersionHandlers(inserts);
      }
      if (table === "user_profiles") {
        return profileUpsertOk(updates);
      }
      return chain({ data: null, error: null });
    });

    const result = await persistAppIdentityEdit({
      ...baseInput,
      importantPeople: [],
      replaceImportantPeople: false,
    });

    expect(result.ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      clerk_user_id: USER,
      identity_anchor_text: baseInput.identityAnchorText,
      identity_source: "user_edited",
      active_identity_version_id: NEW_VERSION,
    });
    expect(inserts.some((r) => r.is_active === true && r.version_number === 3)).toBe(true);
  });

  it("rejects false success when profile upsert returns zero mirrored rows", async () => {
    const deletes: string[] = [];
    fromMock.mockImplementation((table: string) => {
      if (table === "user_identity_version") {
        const handlers = baseIdentityVersionHandlers([]);
        return {
          ...handlers,
          delete: () => ({
            eq: () => ({
              eq: () => {
                deletes.push("version");
                return Promise.resolve({ error: null });
              },
            }),
          }),
        };
      }
      if (table === "user_profiles") {
        return profileUpsertOk([], { data: null, error: null });
      }
      return chain({ data: null, error: null });
    });

    const result = await persistAppIdentityEdit({
      ...baseInput,
      importantPeople: [],
      replaceImportantPeople: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("save_failed");
    }
    expect(deletes).toContain("version");
    expect(recomputeMock).not.toHaveBeenCalled();
  });

  it("rejects mismatched returned clerk_user_id on profile mirror", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "user_identity_version") {
        return baseIdentityVersionHandlers([]);
      }
      if (table === "user_profiles") {
        return profileUpsertOk([], {
          data: {
            clerk_user_id: "user_other",
            identity_anchor_text: baseInput.identityAnchorText,
            identity_source: "user_edited",
            active_identity_version_id: NEW_VERSION,
          },
        });
      }
      return chain({ data: null, error: null });
    });

    const result = await persistAppIdentityEdit({
      ...baseInput,
      importantPeople: [],
      replaceImportantPeople: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("save_failed");
    }
  });

  it("returns version_conflict when expectedActiveVersionId mismatches", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "user_identity_version") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: "other_ver", version_number: 1 },
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      return chain({ data: null, error: null });
    });

    const result = await persistAppIdentityEdit({
      ...baseInput,
      importantPeople: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("version_conflict");
    }
    expect(recomputeMock).not.toHaveBeenCalled();
  });

  it("does not deactivate prior important_people when insert fails", async () => {
    const peopleOps: string[] = [];
    const inserts: Record<string, unknown>[] = [];

    fromMock.mockImplementation((table: string) => {
      if (table === "user_identity_version") {
        return baseIdentityVersionHandlers(inserts);
      }
      if (table === "user_profiles") {
        return profileUpsertOk();
      }
      if (table === "important_people") {
        return {
          insert: () => {
            peopleOps.push("insert");
            return {
              select: () =>
                Promise.resolve({ data: null, error: { message: "insert failed" } }),
            };
          },
          update: () => {
            peopleOps.push("deactivate_prior");
            return chain({ error: null });
          },
        };
      }
      return chain({ data: null, error: null });
    });

    const result = await persistAppIdentityEdit({
      ...baseInput,
      importantPeople: [{ display_name: "Sam", relationship_type: "child" }],
    });

    expect(result.ok).toBe(false);
    expect(peopleOps).toEqual(["insert"]);
    expect(peopleOps).not.toContain("deactivate_prior");
  });

  it("intentionally clears intake people when importantPeople is empty", async () => {
    const peopleOps: string[] = [];

    fromMock.mockImplementation((table: string) => {
      if (table === "user_identity_version") {
        return baseIdentityVersionHandlers([]);
      }
      if (table === "user_profiles") {
        return profileUpsertOk();
      }
      if (table === "important_people") {
        return {
          insert: () => {
            peopleOps.push("insert");
            return { select: () => Promise.resolve({ data: [], error: null }) };
          },
          update: () => {
            peopleOps.push("deactivate_prior");
            const q: Record<string, unknown> = {};
            const ret = () => q;
            for (const m of ["eq", "in", "is"]) q[m] = ret;
            q.then = (resolve: (v: unknown) => void) =>
              Promise.resolve({ error: null }).then(resolve);
            return q;
          },
        };
      }
      return chain({ data: null, error: null });
    });

    const result = await persistAppIdentityEdit({
      ...baseInput,
      importantPeople: [],
    });

    expect(result.ok).toBe(true);
    expect(peopleOps).toEqual(["deactivate_prior"]);
    expect(peopleOps).not.toContain("insert");
  });

  it("only touches onboarding/edit sources for people replacement, not sms", async () => {
    let deactivateInSources: unknown = null;

    fromMock.mockImplementation((table: string) => {
      if (table === "user_identity_version") {
        return baseIdentityVersionHandlers([]);
      }
      if (table === "user_profiles") {
        return profileUpsertOk();
      }
      if (table === "important_people") {
        return {
          insert: () => ({
            select: () =>
              Promise.resolve({ data: [{ id: "ppl_new" }], error: null }),
          }),
          update: () => ({
            eq: () => ({
              in: (col: string, sources: unknown) => {
                if (col === "source") deactivateInSources = sources;
                const q: Record<string, unknown> = {};
                const ret = () => q;
                q.is = ret;
                q.not = ret;
                q.then = (resolve: (v: unknown) => void) =>
                  Promise.resolve({ error: null }).then(resolve);
                return q;
              },
            }),
          }),
        };
      }
      return chain({ data: null, error: null });
    });

    await persistAppIdentityEdit({
      ...baseInput,
      importantPeople: [{ display_name: "Jordan", relationship_type: "spouse_partner" }],
    });

    expect(deactivateInSources).toEqual(["onboarding", "edit"]);
    expect(deactivateInSources).not.toContain("sms");
  });

  it("returns identity_state_may_need_repair when profile update fails and version rollback fails", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "user_identity_version") {
        let selectCall = 0;
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => {
                  selectCall += 1;
                  if (selectCall === 1) {
                    return Promise.resolve({
                      data: { id: OLD_VERSION, version_number: 1 },
                      error: null,
                    });
                  }
                  return Promise.resolve({ data: { version_number: 1 }, error: null });
                },
              }),
              order: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: { version_number: 1 }, error: null }),
                }),
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: NEW_VERSION }, error: null }),
            }),
          }),
          delete: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ error: { message: "delete blocked" } }),
            }),
          }),
        };
      }
      if (table === "user_profiles") {
        return profileUpsertOk([], {
          data: null,
          error: { message: "profile failed" },
        });
      }
      return chain({ data: null, error: null });
    });

    const result = await persistAppIdentityEdit({
      ...baseInput,
      importantPeople: [],
      replaceImportantPeople: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("identity_state_may_need_repair");
    }
  });

  it("returns save_failed when profile upsert fails but version rollback succeeds", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "user_identity_version") {
        let selectCall = 0;
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => {
                  selectCall += 1;
                  if (selectCall === 1) {
                    return Promise.resolve({
                      data: { id: OLD_VERSION, version_number: 1 },
                      error: null,
                    });
                  }
                  return Promise.resolve({ data: { version_number: 1 }, error: null });
                },
              }),
              order: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: { version_number: 1 }, error: null }),
                }),
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: NEW_VERSION }, error: null }),
            }),
          }),
          delete: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          }),
        };
      }
      if (table === "user_profiles") {
        return profileUpsertOk([], {
          data: null,
          error: { message: "profile failed" },
        });
      }
      return chain({ data: null, error: null });
    });

    const result = await persistAppIdentityEdit({
      ...baseInput,
      importantPeople: [],
      replaceImportantPeople: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("save_failed");
    }
  });

  it("returns success when coaching memory recompute fails after canonical save", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "user_identity_version") {
        return baseIdentityVersionHandlers([]);
      }
      if (table === "user_profiles") {
        return profileUpsertOk();
      }
      if (table === "important_people") {
        return {
          update: () => {
            const q: Record<string, unknown> = {};
            const ret = () => q;
            for (const m of ["eq", "in", "is"]) q[m] = ret;
            q.then = (resolve: (v: unknown) => void) =>
              Promise.resolve({ error: null }).then(resolve);
            return q;
          },
        };
      }
      return chain({ data: null, error: null });
    });

    recomputeMock.mockRejectedValue(new Error("projection lag"));

    const result = await persistAppIdentityEdit({
      ...baseInput,
      importantPeople: [],
    });

    expect(result.ok).toBe(true);
  });

  it("does not overwrite people_summary when replaceImportantPeople is false", async () => {
    const updates: Record<string, unknown>[] = [];
    const peopleOps: string[] = [];

    fromMock.mockImplementation((table: string) => {
      if (table === "user_identity_version") {
        return baseIdentityVersionHandlers([]);
      }
      if (table === "user_profiles") {
        return profileUpsertOk(updates);
      }
      if (table === "important_people") {
        return {
          insert: () => {
            peopleOps.push("insert");
            return { select: () => Promise.resolve({ data: [], error: null }) };
          },
          update: () => {
            peopleOps.push("deactivate_prior");
            return chain({ error: null });
          },
        };
      }
      return chain({ data: null, error: null });
    });

    const result = await persistAppIdentityEdit({
      ...baseInput,
      importantPeople: [{ display_name: "Sam", relationship_type: "child" }],
      replaceImportantPeople: false,
    });

    expect(result.ok).toBe(true);
    expect(updates[0]).not.toHaveProperty("people_summary");
    expect(peopleOps).toEqual([]);
  });

  it("uses custom coaching memory reason code when provided", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "user_identity_version") {
        return baseIdentityVersionHandlers([]);
      }
      if (table === "user_profiles") {
        return profileUpsertOk();
      }
      if (table === "important_people") {
        return {
          update: () => {
            const q: Record<string, unknown> = {};
            const ret = () => q;
            for (const m of ["eq", "in", "is"]) q[m] = ret;
            q.then = (resolve: (v: unknown) => void) =>
              Promise.resolve({ error: null }).then(resolve);
            return q;
          },
        };
      }
      return chain({ data: null, error: null });
    });

    await persistAppIdentityEdit({
      ...baseInput,
      importantPeople: [],
      replaceImportantPeople: false,
      coachingMemoryReasonCode: "guided_resolution_identity",
    });

    expect(recomputeMock).toHaveBeenCalledWith(COMMITMENT, {
      reasonCode: "guided_resolution_identity",
    });
  });
});

describe("persistGuidedIdentityAnchorEdit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveCommitmentMock.mockResolvedValue({ id: COMMITMENT });
    recomputeMock.mockResolvedValue(undefined);
  });

  it("returns identity_setup_incomplete when no active identity version exists", async () => {
    loadDraftMock.mockResolvedValue({
      activeIdentityVersionId: null,
      preferredName: "Alex",
      identityAnchorText: "Old",
      ingredientIds: [],
      otherText: null,
      intakeOrigin: null,
      useMineAnyway: false,
      clarityScore: null,
      importantPeople: [],
    });

    const result = await persistGuidedIdentityAnchorEdit({
      clerkUserId: USER,
      identityAnchorText: "I am becoming steadier every day.",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("identity_setup_incomplete");
    }
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("preserves ingredients and people via persistAppIdentityEdit with replaceImportantPeople false", async () => {
    loadDraftMock.mockResolvedValue({
      activeIdentityVersionId: OLD_VERSION,
      preferredName: "Alex",
      identityAnchorText: "Old anchor",
      ingredientIds: ["dad"],
      otherText: "Custom",
      intakeOrigin: "generated",
      useMineAnyway: false,
      clarityScore: 72,
      importantPeople: [{ display_name: "Sam", relationship_type: "child" }],
    });

    const updates: Record<string, unknown>[] = [];
    const versionInserts: Record<string, unknown>[] = [];
    const peopleOps: string[] = [];

    fromMock.mockImplementation((table: string) => {
      if (table === "user_identity_version") {
        return baseIdentityVersionHandlers(versionInserts);
      }
      if (table === "user_profiles") {
        return profileUpsertOk(updates);
      }
      if (table === "important_people") {
        return {
          insert: () => {
            peopleOps.push("insert");
            return { select: () => Promise.resolve({ data: [], error: null }) };
          },
          update: () => {
            peopleOps.push("deactivate_prior");
            return chain({ error: null });
          },
        };
      }
      return chain({ data: null, error: null });
    });

    const newAnchor = "I am becoming a steadier parent every day.";
    const result = await persistGuidedIdentityAnchorEdit({
      clerkUserId: USER,
      identityAnchorText: newAnchor,
    });

    expect(result.ok).toBe(true);
    expect(versionInserts.some((row) => row.identity_anchor_text === newAnchor)).toBe(true);
    expect(versionInserts.some((row) => row.ingredient_ids)).toBe(true);
    expect(updates[0]).toMatchObject({
      identity_anchor_text: newAnchor,
      active_identity_version_id: NEW_VERSION,
    });
    expect(updates[0]).not.toHaveProperty("people_summary");
    expect(peopleOps).toEqual([]);
    expect(recomputeMock).toHaveBeenCalledWith(COMMITMENT, {
      reasonCode: "guided_resolution_identity",
    });
  });
});

describe("persistWave11ConfirmedIdentityAnchorEdit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveCommitmentMock.mockResolvedValue({ id: COMMITMENT });
    recomputeMock.mockResolvedValue(undefined);
  });

  it("creates versioned identity update with explicitly_confirmed source and skips coaching recompute", async () => {
    loadDraftMock.mockResolvedValue({
      activeIdentityVersionId: OLD_VERSION,
      preferredName: "Alex",
      identityAnchorText: "Old anchor",
      ingredientIds: ["dad"],
      otherText: null,
      intakeOrigin: "generated",
      useMineAnyway: false,
      clarityScore: 80,
      importantPeople: [{ display_name: "Sam", relationship_type: "child" }],
    });

    const updates: Record<string, unknown>[] = [];
    const versionInserts: Record<string, unknown>[] = [];

    fromMock.mockImplementation((table: string) => {
      if (table === "user_identity_version") {
        return baseIdentityVersionHandlers(versionInserts);
      }
      if (table === "user_profiles") {
        return profileUpsertOk(updates);
      }
      return chain({ data: null, error: null });
    });

    const newAnchor = "I am becoming a steadier parent every day.";
    const result = await persistWave11ConfirmedIdentityAnchorEdit({
      clerkUserId: USER,
      identityAnchorText: newAnchor,
    });

    expect(result.ok).toBe(true);
    expect(versionInserts.some((row) => row.identity_anchor_text === newAnchor)).toBe(true);
    expect(updates[0]).toMatchObject({
      identity_anchor_text: newAnchor,
      active_identity_version_id: NEW_VERSION,
      identity_source: "explicitly_confirmed",
    });
    expect(updates[0]).not.toHaveProperty("people_summary");
    expect(recomputeMock).not.toHaveBeenCalled();
  });

  it("returns identity_setup_incomplete when no active version exists", async () => {
    loadDraftMock.mockResolvedValue({
      activeIdentityVersionId: null,
      preferredName: "Alex",
      identityAnchorText: null,
      ingredientIds: [],
      otherText: null,
      intakeOrigin: null,
      useMineAnyway: false,
      clarityScore: null,
      importantPeople: [],
    });

    const result = await persistWave11ConfirmedIdentityAnchorEdit({
      clerkUserId: USER,
      identityAnchorText: "I am becoming steadier every day.",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("identity_setup_incomplete");
    }
    expect(fromMock).not.toHaveBeenCalled();
  });
});
