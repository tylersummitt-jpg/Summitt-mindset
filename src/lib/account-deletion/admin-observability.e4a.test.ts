/**
 * APP-041E4a — read-only account-deletion admin observability tests.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import {
  ACCOUNT_DELETION_ADMIN_DEFAULT_LIMIT,
  ACCOUNT_DELETION_ADMIN_MAX_LIMIT,
  clampAccountDeletionAdminLimit,
  evaluateAccountDeletionAdminLease,
  evaluateAccountDeletionStructuralConsistency,
  mapAccountDeletionStepResultToAdminState,
  maskClerkUserIdForAdmin,
  parseAccountDeletionAdminStatusFilter,
  summarizeAccountDeletionAdminRows,
  toAccountDeletionAdminViewRow,
} from "./admin-observability";
import { listAccountDeletionRequestsForAdmin } from "./list-account-deletion-admin";
import {
  seedAccountDeletionRequestForTests,
  useInMemoryAccountDeletionStoreForTests,
  useSupabaseAccountDeletionStoreForTests,
} from "./repository";
import type { AccountDeletionRequestRow } from "./types";
import AccountDeletionsDashboard from "@/app/admin/account-deletions/account-deletions-dashboard";

const FULL_CLERK = "user_2abcDEFGHIJKLMNopqrs";
const PAGE = join(process.cwd(), "src/app/admin/account-deletions/page.tsx");
const DASHBOARD = join(
  process.cwd(),
  "src/app/admin/account-deletions/account-deletions-dashboard.tsx"
);
const ADMIN_OBS = join(
  process.cwd(),
  "src/lib/account-deletion/admin-observability.ts"
);
const LIST_ADMIN = join(
  process.cwd(),
  "src/lib/account-deletion/list-account-deletion-admin.ts"
);
const REPO = join(process.cwd(), "src/lib/account-deletion/repository.ts");
const LAYOUT = join(process.cwd(), "src/app/admin/layout.tsx");
const VERCEL = join(process.cwd(), "vercel.json");

function baseRow(
  overrides: Partial<AccountDeletionRequestRow> &
    Pick<AccountDeletionRequestRow, "id" | "clerk_user_id" | "status" | "current_step">
): AccountDeletionRequestRow {
  const now = "2026-07-19T12:00:00.000Z";
  return {
    orchestration_version: 1,
    steps: {},
    attempt_count: 0,
    locked_at: null,
    lock_owner: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
    last_retry_at: null,
    last_error_code: null,
    last_error_detail: null,
    sms_result: null,
    stripe_result: null,
    purge_result: null,
    clerk_result: null,
    idempotency_key: `key-${overrides.id}`,
    ...overrides,
  };
}

/** Exact production purge marker shape (readAppDataPurgeRpcMarker). */
function purgeMarkerSteps(): AccountDeletionRequestRow["steps"] {
  return {
    app_data_purge_rpc: {
      ok: true,
      at: "2026-07-19T11:00:00.000Z",
      code: "purged",
      detail: "limitations:0;categories:1;deleted_total:1",
    },
  };
}

/** Exact production Clerk marker shape (readClerkDeleteRpcMarker). */
function clerkMarkerSteps(): AccountDeletionRequestRow["steps"] {
  return {
    ...purgeMarkerSteps(),
    clerk_delete_rpc: {
      ok: true,
      at: "2026-07-19T11:30:00.000Z",
      code: "deleted",
      detail: "provider:clerk",
    },
  };
}

/** Superficially successful purge marker that fails canonical parsing. */
function malformedPurgeLooksOk(
  patch: Partial<{
    at: string;
    ok: boolean;
    code: string;
    detail: string;
  }> = {}
): AccountDeletionRequestRow["steps"] {
  return {
    app_data_purge_rpc: {
      ok: true,
      at: "2026-07-19T11:00:00.000Z",
      code: "purged",
      detail: "limitations:0;categories:1;deleted_total:1",
      ...patch,
    },
  };
}

describe("APP-041E4a sanitization", () => {
  it("5–8. masks Clerk ids; short values redacted", () => {
    expect(maskClerkUserIdForAdmin(FULL_CLERK)).toBe("user_…pqrs");
    expect(maskClerkUserIdForAdmin(FULL_CLERK)).not.toContain(FULL_CLERK);
    expect(maskClerkUserIdForAdmin("short")).toBe("[redacted]");
    expect(maskClerkUserIdForAdmin("")).toBe("[redacted]");
  });

  it("9–12. view model excludes detail/key/steps/raw results", () => {
    const row = baseRow({
      id: "00000000-0000-4000-8000-00000000e401",
      clerk_user_id: FULL_CLERK,
      status: "requested",
      current_step: "requested",
      last_error_detail: "secret stack",
      idempotency_key: "secret-key",
      steps: { x: { detail: "raw" } },
      sms_result: "ok",
    });
    const view = toAccountDeletionAdminViewRow(
      row,
      new Date("2026-07-19T12:00:00.000Z")
    );
    const json = JSON.stringify(view);
    expect(json).not.toContain(FULL_CLERK);
    expect(json).not.toContain("secret stack");
    expect(json).not.toContain("secret-key");
    expect(json).not.toContain("last_error_detail");
    expect(json).not.toContain("idempotency");
    expect(view).not.toHaveProperty("steps");
    expect(view).not.toHaveProperty("sms_result");
    expect(view.smsState).toBe("succeeded");
    expect(view.maskedClerkUserId).toBe("user_…pqrs");
  });
});

describe("APP-041E4a bounds/filters", () => {
  beforeEach(() => {
    useInMemoryAccountDeletionStoreForTests();
  });
  afterEach(() => {
    useSupabaseAccountDeletionStoreForTests();
  });

  it("13–16. limit default/max/clamp/invalid", () => {
    expect(clampAccountDeletionAdminLimit(undefined)).toBe(
      ACCOUNT_DELETION_ADMIN_DEFAULT_LIMIT
    );
    expect(clampAccountDeletionAdminLimit(100)).toBe(
      ACCOUNT_DELETION_ADMIN_MAX_LIMIT
    );
    expect(clampAccountDeletionAdminLimit(101)).toBe(
      ACCOUNT_DELETION_ADMIN_MAX_LIMIT
    );
    expect(clampAccountDeletionAdminLimit(0)).toBe(
      ACCOUNT_DELETION_ADMIN_DEFAULT_LIMIT
    );
    expect(clampAccountDeletionAdminLimit(-3)).toBe(
      ACCOUNT_DELETION_ADMIN_DEFAULT_LIMIT
    );
  });

  it("17–18. valid status exact; invalid fails closed to all", () => {
    expect(parseAccountDeletionAdminStatusFilter("failed_retryable")).toBe(
      "failed_retryable"
    );
    expect(parseAccountDeletionAdminStatusFilter("not_a_status")).toBe("all");
    expect(parseAccountDeletionAdminStatusFilter(";requested")).toBe("all");
  });

  it("19–20. order updated_at DESC then id DESC; bounded", async () => {
    for (let i = 1; i <= 3; i++) {
      await seedAccountDeletionRequestForTests(
        baseRow({
          id: `00000000-0000-4000-8000-00000000e41${i}`,
          clerk_user_id: `user_order_${i}_${"x".repeat(12)}`,
          status: "requested",
          current_step: "requested",
          updated_at: `2026-07-19T1${i}:00:00.000Z`,
        })
      );
    }
    const result = await listAccountDeletionRequestsForAdmin({
      limit: 50,
      now: new Date("2026-07-19T20:00:00.000Z"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.appliedLimit).toBe(50);
    expect(result.value.rows.map((r) => r.requestId)).toEqual([
      "00000000-0000-4000-8000-00000000e413",
      "00000000-0000-4000-8000-00000000e412",
      "00000000-0000-4000-8000-00000000e411",
    ]);
  });
});

describe("APP-041E4a consistency", () => {
  it("21. valid requested consistent", () => {
    const c = evaluateAccountDeletionStructuralConsistency(
      baseRow({
        id: "00000000-0000-4000-8000-00000000e421",
        clerk_user_id: FULL_CLERK,
        status: "requested",
        current_step: "requested",
      })
    );
    expect(c).toEqual({
      structurallyConsistent: true,
      inconsistencyCode: "none",
    });
  });

  it("22. illegal status/current_step inconsistent", () => {
    const c = evaluateAccountDeletionStructuralConsistency(
      baseRow({
        id: "00000000-0000-4000-8000-00000000e422",
        clerk_user_id: FULL_CLERK,
        status: "requested",
        current_step: "suppressing_sms",
      })
    );
    expect(c.inconsistencyCode).toBe("illegal_status_step");
  });

  it("23. unsupported version inconsistent", () => {
    const c = evaluateAccountDeletionStructuralConsistency(
      baseRow({
        id: "00000000-0000-4000-8000-00000000e423",
        clerk_user_id: FULL_CLERK,
        status: "requested",
        current_step: "requested",
        orchestration_version: 99,
      })
    );
    expect(c.inconsistencyCode).toBe("unsupported_version");
  });

  it("24–25. missing purge marker inconsistent", () => {
    expect(
      evaluateAccountDeletionStructuralConsistency(
        baseRow({
          id: "00000000-0000-4000-8000-00000000e424",
          clerk_user_id: FULL_CLERK,
          status: "app_data_purged",
          current_step: "app_data_purged",
          purge_result: "ok",
        })
      ).inconsistencyCode
    ).toBe("missing_purge_marker");

    expect(
      evaluateAccountDeletionStructuralConsistency(
        baseRow({
          id: "00000000-0000-4000-8000-00000000e425",
          clerk_user_id: FULL_CLERK,
          status: "deleting_clerk",
          current_step: "deleting_clerk",
          purge_result: "ok",
        })
      ).inconsistencyCode
    ).toBe("missing_purge_marker");
  });

  it("24b. superficially-ok purge markers fail canonical validation", () => {
    const cases: Array<{
      label: string;
      steps: AccountDeletionRequestRow["steps"];
    }> = [
      {
        label: "code alone without at/detail",
        steps: {
          app_data_purge_rpc: { ok: true, code: "purged" },
        },
      },
      {
        label: "missing at",
        steps: {
          app_data_purge_rpc: {
            ok: true,
            code: "purged",
            detail: "limitations:0;categories:1;deleted_total:1",
          },
        },
      },
      {
        label: "invalid at",
        steps: malformedPurgeLooksOk({ at: "not-a-timestamp" }),
      },
      {
        label: "wrong detail",
        steps: malformedPurgeLooksOk({ detail: "provider:supabase" }),
      },
      {
        label: "correct code malformed detail",
        steps: malformedPurgeLooksOk({
          detail: "limitations:0;categories:1",
        }),
      },
      {
        label: "wrong code otherwise valid shape",
        steps: malformedPurgeLooksOk({ code: "ok" }),
      },
    ];

    for (const c of cases) {
      expect(
        evaluateAccountDeletionStructuralConsistency(
          baseRow({
            id: "00000000-0000-4000-8000-00000000e42a",
            clerk_user_id: FULL_CLERK,
            status: "app_data_purged",
            current_step: "app_data_purged",
            purge_result: "ok",
            steps: c.steps,
          })
        ).inconsistencyCode,
        c.label
      ).toBe("missing_purge_marker");
    }
  });

  it("26–27. completed missing clerk marker / completed_at", () => {
    expect(
      evaluateAccountDeletionStructuralConsistency(
        baseRow({
          id: "00000000-0000-4000-8000-00000000e426",
          clerk_user_id: FULL_CLERK,
          status: "completed",
          current_step: "completed",
          completed_at: "2026-07-19T11:00:00.000Z",
          clerk_result: "ok",
          purge_result: "ok",
          steps: purgeMarkerSteps(),
        })
      ).inconsistencyCode
    ).toBe("missing_clerk_marker");

    expect(
      evaluateAccountDeletionStructuralConsistency(
        baseRow({
          id: "00000000-0000-4000-8000-00000000e427",
          clerk_user_id: FULL_CLERK,
          status: "completed",
          current_step: "completed",
          completed_at: null,
          clerk_result: "ok",
          purge_result: "ok",
          steps: clerkMarkerSteps(),
        })
      ).inconsistencyCode
    ).toBe("completed_at_mismatch");
  });

  it("26b. superficially-ok clerk markers fail canonical validation", () => {
    expect(
      evaluateAccountDeletionStructuralConsistency(
        baseRow({
          id: "00000000-0000-4000-8000-00000000e42b",
          clerk_user_id: FULL_CLERK,
          status: "completed",
          current_step: "completed",
          completed_at: "2026-07-19T11:40:00.000Z",
          clerk_result: "ok",
          purge_result: "ok",
          steps: {
            ...purgeMarkerSteps(),
            clerk_delete_rpc: { ok: true, code: "deleted" },
          },
        })
      ).inconsistencyCode
    ).toBe("missing_clerk_marker");

    expect(
      evaluateAccountDeletionStructuralConsistency(
        baseRow({
          id: "00000000-0000-4000-8000-00000000e42c",
          clerk_user_id: FULL_CLERK,
          status: "completed",
          current_step: "completed",
          completed_at: "2026-07-19T11:40:00.000Z",
          clerk_result: "ok",
          purge_result: "ok",
          steps: {
            ...purgeMarkerSteps(),
            clerk_delete_rpc: {
              ok: true,
              at: "2026-07-19T11:30:00.000Z",
              code: "deleted",
              detail: "wrong-detail",
            },
          },
        })
      ).inconsistencyCode
    ).toBe("missing_clerk_marker");
  });

  it("28–29. failed_retryable illegal step; malformed lease", () => {
    expect(
      evaluateAccountDeletionStructuralConsistency(
        baseRow({
          id: "00000000-0000-4000-8000-00000000e428",
          clerk_user_id: FULL_CLERK,
          status: "failed_retryable",
          current_step: "sms_suppressed",
        })
      ).inconsistencyCode
    ).toBe("illegal_status_step");

    expect(
      evaluateAccountDeletionStructuralConsistency(
        baseRow({
          id: "00000000-0000-4000-8000-00000000e429",
          clerk_user_id: FULL_CLERK,
          status: "requested",
          current_step: "requested",
          lock_owner: "worker",
          locked_at: null,
        })
      ).inconsistencyCode
    ).toBe("malformed_lease");
  });

  it("30. valid completed consistent", () => {
    const c = evaluateAccountDeletionStructuralConsistency(
      baseRow({
        id: "00000000-0000-4000-8000-00000000e430",
        clerk_user_id: FULL_CLERK,
        status: "completed",
        current_step: "completed",
        completed_at: "2026-07-19T11:40:00.000Z",
        purge_result: "ok",
        clerk_result: "ok",
        steps: clerkMarkerSteps(),
      })
    );
    expect(c).toEqual({
      structurallyConsistent: true,
      inconsistencyCode: "none",
    });
  });

  it("priority. multi-defect deterministic order", () => {
    // 1. unsupported_version beats malformed_lease
    expect(
      evaluateAccountDeletionStructuralConsistency(
        baseRow({
          id: "00000000-0000-4000-8000-00000000e4p1",
          clerk_user_id: FULL_CLERK,
          status: "requested",
          current_step: "requested",
          orchestration_version: 99,
          lock_owner: "worker",
          locked_at: null,
        })
      ).inconsistencyCode
    ).toBe("unsupported_version");

    // 2. completed missing completed_at beats missing clerk marker
    expect(
      evaluateAccountDeletionStructuralConsistency(
        baseRow({
          id: "00000000-0000-4000-8000-00000000e4p2",
          clerk_user_id: FULL_CLERK,
          status: "completed",
          current_step: "completed",
          completed_at: null,
          steps: {},
        })
      ).inconsistencyCode
    ).toBe("completed_at_mismatch");

    // 3. illegal status/step beats missing purge marker
    expect(
      evaluateAccountDeletionStructuralConsistency(
        baseRow({
          id: "00000000-0000-4000-8000-00000000e4p3",
          clerk_user_id: FULL_CLERK,
          status: "app_data_purged",
          current_step: "deleting_clerk",
          steps: {},
        })
      ).inconsistencyCode
    ).toBe("illegal_status_step");
  });
});

describe("APP-041E4a lease/discovery", () => {
  const now = new Date("2026-07-19T12:00:00.000Z");
  const leaseMs = 120_000;

  it("31–34. lease free/active/boundary/expired", () => {
    expect(
      evaluateAccountDeletionAdminLease(
        { lock_owner: null, locked_at: null },
        now,
        leaseMs
      ).leaseState
    ).toBe("free");

    expect(
      evaluateAccountDeletionAdminLease(
        {
          lock_owner: "w",
          locked_at: "2026-07-19T11:59:00.000Z",
        },
        now,
        leaseMs
      ).leaseState
    ).toBe("active");

    expect(
      evaluateAccountDeletionAdminLease(
        {
          lock_owner: "w",
          locked_at: "2026-07-19T11:58:00.000Z",
        },
        now,
        leaseMs
      ).leaseState
    ).toBe("active");

    expect(
      evaluateAccountDeletionAdminLease(
        {
          lock_owner: "w",
          locked_at: "2026-07-19T11:57:59.000Z",
        },
        now,
        leaseMs
      ).leaseState
    ).toBe("expired");
  });

  it("35–39. discoverability mirrors E3b selector", () => {
    const early = toAccountDeletionAdminViewRow(
      baseRow({
        id: "00000000-0000-4000-8000-00000000e435",
        clerk_user_id: FULL_CLERK,
        status: "failed_retryable",
        current_step: "suppressing_sms",
        attempt_count: 1,
        updated_at: "2026-07-19T11:56:00.000Z",
      }),
      now
    );
    expect(early.currentlyDiscoverable).toBe(false);

    const exact = toAccountDeletionAdminViewRow(
      baseRow({
        id: "00000000-0000-4000-8000-00000000e436",
        clerk_user_id: FULL_CLERK,
        status: "failed_retryable",
        current_step: "suppressing_sms",
        attempt_count: 1,
        updated_at: "2026-07-19T11:55:00.000Z",
      }),
      now
    );
    expect(exact.currentlyDiscoverable).toBe(true);

    const normal = toAccountDeletionAdminViewRow(
      baseRow({
        id: "00000000-0000-4000-8000-00000000e437",
        clerk_user_id: FULL_CLERK,
        status: "requested",
        current_step: "requested",
        updated_at: "2026-07-19T11:00:00.000Z",
      }),
      now
    );
    expect(normal.currentlyDiscoverable).toBe(true);

    const done = toAccountDeletionAdminViewRow(
      baseRow({
        id: "00000000-0000-4000-8000-00000000e438",
        clerk_user_id: FULL_CLERK,
        status: "completed",
        current_step: "completed",
        completed_at: "2026-07-19T11:00:00.000Z",
        purge_result: "ok",
        clerk_result: "ok",
        steps: clerkMarkerSteps(),
      }),
      now
    );
    expect(done.currentlyDiscoverable).toBe(false);

    const badVer = toAccountDeletionAdminViewRow(
      baseRow({
        id: "00000000-0000-4000-8000-00000000e439",
        clerk_user_id: FULL_CLERK,
        status: "requested",
        current_step: "requested",
        orchestration_version: 9,
      }),
      now
    );
    expect(badVer.currentlyDiscoverable).toBe(false);
  });

  it("GREATEST last_retry_at / updated_at backoff base", () => {
    // last_retry_at=10:00, updated_at=10:06, attempt<3 → base=10:06 + 5m
    // now=10:10 → not discoverable; now=10:11 → discoverable
    const staleRetry = baseRow({
      id: "00000000-0000-4000-8000-00000000e4g1",
      clerk_user_id: FULL_CLERK,
      status: "failed_retryable",
      current_step: "suppressing_sms",
      attempt_count: 1,
      last_retry_at: "2026-07-19T10:00:00.000Z",
      updated_at: "2026-07-19T10:06:00.000Z",
    });
    expect(
      toAccountDeletionAdminViewRow(
        staleRetry,
        new Date("2026-07-19T10:10:00.000Z")
      ).currentlyDiscoverable
    ).toBe(false);
    expect(
      toAccountDeletionAdminViewRow(
        staleRetry,
        new Date("2026-07-19T10:11:00.000Z")
      ).currentlyDiscoverable
    ).toBe(true);

    // Reverse: newer last_retry_at remains the GREATEST base
    // last_retry_at=10:08, updated_at=10:02 → base=10:08 + 5m = 10:13
    const newerRetry = baseRow({
      id: "00000000-0000-4000-8000-00000000e4g2",
      clerk_user_id: FULL_CLERK,
      status: "failed_retryable",
      current_step: "suppressing_sms",
      attempt_count: 1,
      last_retry_at: "2026-07-19T10:08:00.000Z",
      updated_at: "2026-07-19T10:02:00.000Z",
    });
    expect(
      toAccountDeletionAdminViewRow(
        newerRetry,
        new Date("2026-07-19T10:12:00.000Z")
      ).currentlyDiscoverable
    ).toBe(false);
    expect(
      toAccountDeletionAdminViewRow(
        newerRetry,
        new Date("2026-07-19T10:13:00.000Z")
      ).currentlyDiscoverable
    ).toBe(true);
  });
});

describe("APP-041E4a result-state mapping", () => {
  it("40–44. safe stage mapping; no raw leakage", () => {
    expect(mapAccountDeletionStepResultToAdminState("ok")).toBe("succeeded");
    expect(mapAccountDeletionStepResultToAdminState("failed")).toBe(
      "retryable_failure"
    );
    expect(
      mapAccountDeletionStepResultToAdminState("failed", "failed_terminal")
    ).toBe("terminal_failure");
    expect(
      mapAccountDeletionStepResultToAdminState("not-real" as never)
    ).toBe("malformed");
    expect(mapAccountDeletionStepResultToAdminState(null)).toBe("unavailable");
    expect(mapAccountDeletionStepResultToAdminState("already_done")).toBe(
      "already_absent"
    );
  });
});

describe("APP-041E4a UI", () => {
  it("45–50. warning, empty state, summary, masked id, no mutation controls", () => {
    const emptyHtml = renderToStaticMarkup(
      React.createElement(AccountDeletionsDashboard, {
        rows: [],
        summary: {
          totalVisible: 0,
          inProgress: 0,
          failedRetryable: 0,
          failedTerminal: 0,
          completed: 0,
          structurallyInconsistent: 0,
          currentlyDiscoverable: 0,
        },
        appliedStatus: "all",
        appliedLimit: 50,
      })
    );
    expect(emptyHtml).toContain(
      "Read-only. No request can be created, retried, unlocked, or processed from this page."
    );
    expect(emptyHtml).toContain(
      "No account deletion requests are currently recorded."
    );
    expect(emptyHtml).not.toMatch(/<button|<form|type=\"submit\"/i);

    const view = toAccountDeletionAdminViewRow(
      baseRow({
        id: "00000000-0000-4000-8000-00000000e450",
        clerk_user_id: FULL_CLERK,
        status: "requested",
        current_step: "requested",
      }),
      new Date("2026-07-19T12:00:00.000Z")
    );
    const summary = summarizeAccountDeletionAdminRows([view]);
    expect(summary.totalVisible).toBe(1);
    expect(summary.inProgress).toBe(1);

    const html = renderToStaticMarkup(
      React.createElement(AccountDeletionsDashboard, {
        rows: [view],
        summary,
        appliedStatus: "all",
        appliedLimit: 50,
      })
    );
    expect(html).toContain(view.maskedClerkUserId);
    expect(html).not.toContain(FULL_CLERK);
    expect(html).not.toContain("idempotency_key");
    expect(html).not.toContain("last_error_detail");
    expect(html).not.toMatch(/<button|<form/i);
    expect(html).not.toContain('"steps"');
  });
});

describe("APP-041E4a no-scope proofs", () => {
  it("51–60. no migration/reconciler/provider/mutation wiring (E4d may schedule cron)", () => {
    const migrations = readdirSync(join(process.cwd(), "supabase/migrations"));
    expect(migrations.some((f) => /e4a|admin_account_deletion/i.test(f))).toBe(
      false
    );

    // Admin observability must not configure Vercel; E4d may schedule the
    // disabled /api/cron/account-deletions path separately.
    for (const file of [PAGE, DASHBOARD, ADMIN_OBS, LIST_ADMIN]) {
      expect(readFileSync(file, "utf8")).not.toContain("vercel.json");
    }
    const vercel = JSON.parse(readFileSync(VERCEL, "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const deletionCrons = vercel.crons.filter(
      (c) => c.path === "/api/cron/account-deletions"
    );
    expect(deletionCrons.length).toBeLessThanOrEqual(1);

    for (const file of [PAGE, DASHBOARD, ADMIN_OBS, LIST_ADMIN]) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toContain("reconcileAccountDeletionRequest");
      expect(src).not.toContain("executeTrustedAccountDeletionReconcile");
      expect(src).not.toContain("acquireAccountDeletionLease");
      expect(src).not.toMatch(/from \"stripe\"|from \"twilio\"|openai|resend/i);
      expect(src).not.toContain("\"use server\"");
      expect(src).not.toMatch(/method:\s*[\"'](POST|PATCH|DELETE)[\"']/);
    }

    expect(readFileSync(ADMIN_OBS, "utf8")).toContain(
      "readAppDataPurgeRpcMarker"
    );
    expect(readFileSync(ADMIN_OBS, "utf8")).toContain(
      "readClerkDeleteRpcMarker"
    );

    const repoSrc = readFileSync(REPO, "utf8");
    const adminMarker =
      "steps retained server-side only for production marker readers";
    const markerAt = repoSrc.indexOf(adminMarker);
    expect(markerAt).toBeGreaterThan(-1);
    const selectBlock = repoSrc.slice(markerAt, markerAt + 900);
    expect(selectBlock).toContain('"steps"');
    expect(selectBlock).toMatch(/"clerk_result",\s*\]\.join/);
    expect(selectBlock).not.toMatch(/"idempotency_key"/);
    expect(selectBlock).not.toMatch(/"last_error_detail"/);

    const layout = readFileSync(LAYOUT, "utf8");
    expect(layout).toContain("Account Deletions");
    expect(layout).toContain("/admin/account-deletions");

    const publicCandidates = [
      "src/components/SiteHeader.tsx",
      "src/components/site-header.tsx",
      "src/app/page.tsx",
    ];
    for (const rel of publicCandidates) {
      const p = join(process.cwd(), rel);
      try {
        const src = readFileSync(p, "utf8");
        expect(src).not.toContain("/admin/account-deletions");
      } catch {
        // optional path
      }
    }
  });
});
