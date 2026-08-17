import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(),
    rpc: rpcMock,
  },
}));

import {
  CAS_ACCOUNT_DELETION_REQUEST_RPC,
  PURGE_APP_DATA_FOR_ACCOUNT_DELETION_RPC,
  createAccountDeletionRequest,
  acquireAccountDeletionLease,
  transitionAccountDeletionRequest,
  useInMemoryAccountDeletionStoreForTests,
} from "./repository";
import {
  purgeAppDataForDeletion,
  purgeOutcomeBlocksAppDataPurged,
} from "./purge-app-data";

const CAS_MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260719120000_account_deletion_cas_purge_result.sql"
);
const PURGE_MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260719121000_account_deletion_purge_app_data.sql"
);
const B3A_CAS = join(
  process.cwd(),
  "supabase/migrations/20260718140000_account_deletion_cas_stripe_result.sql"
);
const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");
const CHALLENGE_SIGNUP = join(
  process.cwd(),
  "src/app/api/challenge/signup/route.ts"
);
const CHALLENGE_CRON = join(
  process.cwd(),
  "src/app/api/cron/challenge/route.ts"
);

function orderedMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function tableCreateBlock(sql: string, tableName: string): string {
  const re = new RegExp(
    `CREATE TABLE IF NOT EXISTS public\\.${tableName}\\s*\\(([\\s\\S]*?)\\);`,
    "i"
  );
  const m = sql.match(re);
  expect(m?.[1]).toBeTruthy();
  return m![1];
}

describe("APP-041C2 CAS migration (static) — unchanged contract", () => {
  const sql = readFileSync(CAS_MIGRATION, "utf8");
  const b3a = readFileSync(B3A_CAS, "utf8");

  it("22. keeps 20-arg CAS with purge_result and service_role-only grants", () => {
    expect(sql).toContain("p_purge_result TEXT DEFAULT NULL");
    expect(sql).toContain("p_set_purge_result BOOLEAN DEFAULT false");
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN) TO service_role"
    );
    for (const pred of [
      "r.id = p_request_id",
      "r.status = p_expected_status",
      "r.orchestration_version = p_expected_orchestration_version",
      "r.lock_owner = v_owner",
    ]) {
      expect(sql).toContain(pred);
      expect(b3a).toContain(pred);
    }
  });

  it("orders CAS after B3a", () => {
    const files = orderedMigrationFiles();
    expect(
      files.indexOf("20260719120000_account_deletion_cas_purge_result.sql")
    ).toBeGreaterThan(
      files.indexOf("20260718140000_account_deletion_cas_stripe_result.sql")
    );
  });
});

describe("APP-041C2 purge RPC migration (static) — production-schema alignment", () => {
  const sql = readFileSync(PURGE_MIGRATION, "utf8");
  const tombstoneCols = tableCreateBlock(sql, "sms_opt_out_tombstones");

  it("1. tombstone table exact columns", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.sms_opt_out_tombstones");
    expect(tombstoneCols).toContain("message_sid TEXT PRIMARY KEY");
    expect(tombstoneCols).toContain("received_at TIMESTAMPTZ NOT NULL");
    expect(tombstoneCols).toContain("opt_out_command_token TEXT NOT NULL");
    expect(tombstoneCols).toContain("created_at TIMESTAMPTZ NOT NULL DEFAULT now()");
  });

  it("2. no phone/hash/clerk/body columns in tombstone", () => {
    expect(tombstoneCols).not.toMatch(/clerk_user_id/i);
    expect(tombstoneCols).not.toMatch(/phone/i);
    expect(tombstoneCols).not.toMatch(/hash/i);
    expect(tombstoneCols).not.toMatch(/raw_body/i);
    expect(tombstoneCols).not.toMatch(/\bemail\b/i);
    expect(tombstoneCols).not.toMatch(/display_name/i);
    expect(sql).not.toContain("phone_number_hash");
    expect(sql).not.toMatch(/\bdigest\s*\(/i);
    expect(sql).not.toMatch(/\bhmac\s*\(/i);
  });

  it("3. token CHECK constraint", () => {
    expect(sql).toContain("sms_opt_out_tombstones_token_chk");
    expect(sql).toContain("'stop', 'unsubscribe', 'cancel', 'end'");
  });

  it("4–7. STOP insert before source delete; scoped; ON CONFLICT idempotent", () => {
    expect(sql).toContain("INSERT INTO public.sms_opt_out_tombstones");
    expect(sql).toContain("ON CONFLICT (message_sid) DO NOTHING");
    expect(sql).toContain(
      "DELETE FROM public.sms_inbound_messages WHERE clerk_user_id = v_clerk"
    );
    const insertIdx = sql.indexOf("INSERT INTO public.sms_opt_out_tombstones");
    const deleteIdx = sql.indexOf(
      "DELETE FROM public.sms_inbound_messages WHERE clerk_user_id = v_clerk"
    );
    expect(insertIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(insertIdx);
    expect(sql).toMatch(
      /FROM public\.sms_inbound_messages AS m\s+WHERE m\.clerk_user_id = v_clerk/
    );
    expect(sql).toMatch(
      /IN \('stop', 'unsubscribe', 'cancel', 'end'\)\s+ON CONFLICT \(message_sid\) DO NOTHING/
    );
  });

  it("8. no source UPDATE anonymization for inbound messages", () => {
    expect(sql).not.toMatch(/UPDATE\s+public\.sms_inbound_messages/i);
    expect(sql).not.toMatch(/phone_number\s*=/);
    expect(sql).not.toMatch(/raw_body\s*=/);
  });

  it("9–11. testimonials all deleted; approved not retained; admin row deleted", () => {
    expect(sql).toContain(
      "DELETE FROM public.testimonials WHERE clerk_user_id = v_clerk"
    );
    expect(sql).not.toMatch(/UPDATE\s+public\.testimonials/i);
    expect(sql).not.toContain("testimonials_anonymized");
    expect(sql).not.toMatch(/approved\s*=/i);
    expect(sql).toContain(
      "DELETE FROM public.admin_customer_relationship_notes WHERE clerk_user_id = v_clerk"
    );
    expect(sql).not.toMatch(/UPDATE\s+public\.admin_customer_relationship_notes/i);
  });

  it("12–16. challenge delete by clerk only; nullable column + index; no email predicate", () => {
    expect(sql).toContain(
      "ALTER TABLE public.challenge_participants\n  ADD COLUMN IF NOT EXISTS clerk_user_id TEXT NULL"
    );
    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS challenge_participants_clerk_user_id_idx"
    );
    expect(sql).toContain(
      "ON public.challenge_participants (clerk_user_id)\n  WHERE clerk_user_id IS NOT NULL"
    );
    expect(sql).not.toMatch(
      /UNIQUE.*challenge_participants.*clerk_user_id|challenge_participants_clerk_user_id.*UNIQUE/i
    );
    expect(sql).toContain(
      "DELETE FROM public.challenge_participants\n  WHERE clerk_user_id = v_clerk"
    );
    expect(sql).toContain("challenge_rows_deleted");
    expect(sql).not.toContain("p_trusted_email");
    expect(sql).not.toContain("challenge_participant_cleanup_deferred");
    const challengeDelete = sql.match(
      /DELETE\s+FROM\s+public\.challenge_participants\s+WHERE\s+[^\n;]+;/i
    );
    expect(challengeDelete?.[0]).toBeTruthy();
    expect(challengeDelete![0]).toMatch(/clerk_user_id\s*=\s*v_clerk/i);
    expect(challengeDelete![0]).not.toMatch(/\bemail\b/i);
    expect(sql).not.toMatch(
      /WHERE\s+lower\s*\(\s*trim\s*\(\s*email/i
    );
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.purge_app_data_for_account_deletion(\n  p_request_id UUID,\n  p_clerk_user_id TEXT,\n  p_expected_orchestration_version INTEGER,\n  p_lock_owner TEXT,\n  p_lease_ms INTEGER DEFAULT 120000\n)"
    );
  });

  it("17–18. purged/already_absent possible when limitations empty", () => {
    expect(sql).toContain("outcome := 'purged'");
    expect(sql).toContain("outcome := 'already_absent'");
    expect(sql).toMatch(
      /IF jsonb_array_length\(v_limitations\) > 0 THEN\s+outcome := 'incomplete';\s+ELSIF v_total = 0 THEN\s+outcome := 'already_absent';\s+ELSE\s+outcome := 'purged';/
    );
  });

  it("20. wrong Clerk/request/lease/version still causes zero mutation path", () => {
    expect(sql).toContain("v_req.clerk_user_id IS DISTINCT FROM v_clerk");
    expect(sql).toContain("purging_app_data");
    expect(sql).toContain("outcome := 'conflict'");
    const conflictBeforeMutations =
      sql.indexOf("outcome := 'conflict'") <
      sql.indexOf("DELETE FROM public.sms_identities");
    expect(conflictBeforeMutations).toBe(true);
  });

  it("21. shared tables untouched", () => {
    expect(sql).not.toContain("DELETE FROM public.stripe_webhook_events");
    expect(sql).not.toContain("DELETE FROM public.film_videos");
    expect(sql).not.toContain("DELETE FROM public.sms_daily_stats");
    expect(sql).not.toContain("DELETE FROM public.v2_rollout_flag");
    expect(sql).not.toContain("DELETE FROM public.pat_quotes");
    expect(sql).not.toContain("DELETE FROM public.apple_account_bindings");
    expect(sql).not.toContain("DELETE FROM public.apple_subscriptions");
    expect(sql).not.toContain("DELETE FROM public.apple_notification_events");
  });

  it("is service_role-only; no fabricated STOP VALUES", () => {
    expect(sql).toContain("SECURITY INVOKER");
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.purge_app_data_for_account_deletion(UUID, TEXT, INTEGER, TEXT, INTEGER) FROM anon"
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.purge_app_data_for_account_deletion(UUID, TEXT, INTEGER, TEXT, INTEGER) TO service_role"
    );
    expect(sql).not.toMatch(
      /INSERT\s+INTO\s+public\.sms_opt_out_tombstones[\s\S]*VALUES/i
    );
  });
});

describe("APP-041C2 challenge write paths (static)", () => {
  it("anonymous signup/cron leave clerk_user_id unset (no guess)", () => {
    const signup = readFileSync(CHALLENGE_SIGNUP, "utf8");
    const cron = readFileSync(CHALLENGE_CRON, "utf8");
    expect(signup).toContain('.from("challenge_participants")');
    expect(signup).toContain("insert({");
    expect(signup).not.toMatch(/clerk_user_id\s*:/);
    expect(signup).not.toMatch(/auth\(|currentUser|getAuth|clerkClient/i);
    expect(cron).not.toMatch(/clerk_user_id\s*:/);
  });
});

describe("purgeAppDataForDeletion repository helper", () => {
  beforeEach(() => {
    useInMemoryAccountDeletionStoreForTests();
    rpcMock.mockReset();
  });

  it("17. accepts purged with empty limitations", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          outcome: "purged",
          counts: { journal_entries: 2, challenge_rows_deleted: 1 },
          limitations: [],
        },
      ],
      error: null,
    });
    const result = await purgeAppDataForDeletion({
      requestId: "11111111-1111-1111-1111-111111111111",
      clerkUserId: "user_abc",
      expectedOrchestrationVersion: 1,
      lockOwner: "worker-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outcome).toBe("purged");
      expect(result.value.limitations).toEqual([]);
      expect(purgeOutcomeBlocksAppDataPurged(result.value.outcome)).toBe(false);
    }
  });

  it("18. accepts already_absent with empty limitations", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ outcome: "already_absent", counts: {}, limitations: [] }],
      error: null,
    });
    const result = await purgeAppDataForDeletion({
      requestId: "11111111-1111-1111-1111-111111111111",
      clerkUserId: "user_abc",
      expectedOrchestrationVersion: 1,
      lockOwner: "worker-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outcome).toBe("already_absent");
      expect(purgeOutcomeBlocksAppDataPurged(result.value.outcome)).toBe(false);
    }
  });

  it("16/19. incomplete still blocks app_data_purged; success rejects limitations", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          outcome: "incomplete",
          counts: { journal_entries: 1 },
          limitations: ["some_unresolved_user_store"],
        },
      ],
      error: null,
    });
    const incomplete = await purgeAppDataForDeletion({
      requestId: "11111111-1111-1111-1111-111111111111",
      clerkUserId: "user_abc",
      expectedOrchestrationVersion: 1,
      lockOwner: "worker-1",
    });
    expect(incomplete.ok).toBe(true);
    if (incomplete.ok) {
      expect(incomplete.value.outcome).toBe("incomplete");
      expect(purgeOutcomeBlocksAppDataPurged(incomplete.value.outcome)).toBe(
        true
      );
    }

    rpcMock.mockResolvedValueOnce({
      data: [
        {
          outcome: "purged",
          counts: {},
          limitations: ["legacy_rows_present"],
        },
      ],
      error: null,
    });
    const bad = await purgeAppDataForDeletion({
      requestId: "11111111-1111-1111-1111-111111111111",
      clerkUserId: "user_abc",
      expectedOrchestrationVersion: 1,
      lockOwner: "worker-1",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.message).toBe("purge_rpc_invalid_success_with_limitations");
    }
  });

  it("13/24. maps conflict; no trusted email; no external SDK imports in helper", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ outcome: "conflict", counts: {}, limitations: [] }],
      error: null,
    });
    const conflict = await purgeAppDataForDeletion({
      requestId: "11111111-1111-1111-1111-111111111111",
      clerkUserId: "user_abc",
      expectedOrchestrationVersion: 1,
      lockOwner: "worker-1",
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.code).toBe("cas_conflict");

    expect(rpcMock).toHaveBeenCalledWith(
      PURGE_APP_DATA_FOR_ACCOUNT_DELETION_RPC,
      expect.objectContaining({
        p_request_id: "11111111-1111-1111-1111-111111111111",
        p_clerk_user_id: "user_abc",
        p_lock_owner: "worker-1",
      })
    );
    const args = rpcMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args).not.toHaveProperty("p_trusted_email");
    expect(args).not.toHaveProperty("trustedEmail");

    const purgeSrc = readFileSync(
      join(process.cwd(), "src/lib/account-deletion/purge-app-data.ts"),
      "utf8"
    );
    expect(purgeSrc).not.toMatch(/from ["']@clerk\//i);
    expect(purgeSrc).not.toMatch(/from ["']stripe["']|from ["']twilio["']|from ["']resend["']/i);
    expect(purgeSrc).not.toMatch(/trustedEmail|p_trusted_email/);
  });

  it("19. C3 contract: incomplete/conflict block; purged/already_absent do not", () => {
    expect(purgeOutcomeBlocksAppDataPurged("incomplete")).toBe(true);
    expect(purgeOutcomeBlocksAppDataPurged("conflict")).toBe(true);
    expect(purgeOutcomeBlocksAppDataPurged("purged")).toBe(false);
    expect(purgeOutcomeBlocksAppDataPurged("already_absent")).toBe(false);
  });

  it("in-memory CAS still leaves purge_result untouched when unset", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_cas_purge",
      idempotencyKey: "k-purge-cas",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const leased = await acquireAccountDeletionLease({
      requestId: created.value.row.id,
      lockOwner: "w",
    });
    expect(leased.ok).toBe(true);
    const t = await transitionAccountDeletionRequest({
      requestId: created.value.row.id,
      fromStatus: "requested",
      toStatus: "suppressing_sms",
      lockOwner: "w",
      smsResult: "pending",
    });
    expect(t.ok).toBe(true);
    if (t.ok) {
      expect(t.value.purge_result).toBeNull();
      expect(t.value.sms_result).toBe("pending");
    }
  });

  it("23. does not create a public deletion initiation endpoint", () => {
    const purgeSrc = readFileSync(
      join(process.cwd(), "src/lib/account-deletion/purge-app-data.ts"),
      "utf8"
    );
    expect(purgeSrc).toContain('import "server-only"');
    expect(purgeSrc).not.toMatch(/NextResponse|export async function GET|POST/);
    const apiDir = join(process.cwd(), "src/app/api");
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) out.push(...walk(p));
        else if (ent.name === "route.ts") out.push(p);
      }
      return out;
    };
    const routes = walk(apiDir).filter((p) =>
      /account-deletion|delete-account|data-deletion-initiate/i.test(p)
    );
    // E4b may add a private disabled cron route; public initiation remains forbidden.
    expect(routes).toEqual([
      join(apiDir, "cron/account-deletions/route.ts"),
    ]);
    const cronSrc = readFileSync(routes[0], "utf8");
    expect(cronSrc).toContain("validateCronSecretRequest");
    expect(cronSrc).toContain("ACCOUNT_DELETION_SCHEDULER_ENABLED");
    expect(cronSrc).not.toContain('"use server"');
  });
});

describe("CAS callers pass purge/clerk args with set=false by default", () => {
  it("documents RPC constant and result-field defaults in repository source", () => {
    const repo = readFileSync(
      join(process.cwd(), "src/lib/account-deletion/repository.ts"),
      "utf8"
    );
    expect(repo).toContain(
      "p_set_purge_result: patch.set_purge_result ?? false"
    );
    expect(repo).toContain(
      "p_set_clerk_result: patch.set_clerk_result ?? false"
    );
    expect(repo).toContain(CAS_ACCOUNT_DELETION_REQUEST_RPC);
    expect(repo).toContain(PURGE_APP_DATA_FOR_ACCOUNT_DELETION_RPC);
  });
});

describe("Umbrella 1 — v2_win purge extension (static)", () => {
  const WIN_MIGRATION = join(
    process.cwd(),
    "supabase/migrations/20260731120000_v2_win.sql"
  );
  const sql = readFileSync(WIN_MIGRATION, "utf8");

  it("creates v2_win with nullable commitment_id SET NULL and unique idempotency", () => {
    expect(sql).toContain("CREATE TABLE public.v2_win");
    expect(sql).toContain("commitment_id UUID NULL REFERENCES public.v2_commitment (id) ON DELETE SET NULL");
    expect(sql).toContain(
      "source_message_id UUID NULL REFERENCES public.sms_inbound_messages (id) ON DELETE SET NULL"
    );
    expect(sql).not.toContain("IF EXISTS");
    expect(sql).toContain("CREATE UNIQUE INDEX uq_v2_win_idempotency_key");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON TABLE public.v2_win FROM anon");
    expect(sql).toContain("REVOKE ALL ON TABLE public.v2_win FROM authenticated");
  });

  it("extends purge RPC to delete v2_win by clerk_user_id", () => {
    expect(sql).toContain("DELETE FROM public.v2_win WHERE clerk_user_id = v_clerk");
    expect(sql).toContain("jsonb_build_object('v2_win', v_n)");
    const patternIdx = sql.indexOf("DELETE FROM public.v2_sms_pattern_correction");
    const winIdx = sql.indexOf("DELETE FROM public.v2_win WHERE clerk_user_id = v_clerk");
    const commitmentIdx = sql.indexOf("DELETE FROM public.v2_commitment WHERE clerk_user_id = v_clerk");
    expect(winIdx).toBeGreaterThan(patternIdx);
    expect(commitmentIdx).toBeGreaterThan(winIdx);
  });
});
