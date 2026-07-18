import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();
const updateClerkMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));
vi.mock("@/lib/clerk-public-metadata", () => ({
  updateClerkPublicMetadata: (...args: unknown[]) => updateClerkMock(...args),
}));
vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: vi.fn(async () => ({})),
}));

import {
  SUPPRESS_SMS_FOR_ACCOUNT_DELETION_RPC,
  createAccountDeletionRequest,
  useInMemoryAccountDeletionStoreForTests,
} from "./repository";
import {
  SMS_BINDING_REMOVED_STEP,
  suppressSmsForDeletion,
} from "./suppress-sms";
import { hasUnresolvedAccountDeletionRequest } from "./deletion-guards";
import { syncSmsAudience } from "../sms-audience-sync";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260718130000_account_deletion_sms_suppress.sql"
);

describe("APP-041B2a migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("defines suppress RPC and CAS sms_result without phone hash or STOP insert", () => {
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.suppress_sms_for_account_deletion"
    );
    expect(sql).toContain("p_set_sms_result BOOLEAN DEFAULT false");
    expect(sql).toContain("DELETE FROM public.sms_identities");
    expect(sql).toContain("DELETE FROM public.sms_audience");
    expect(sql).toContain("AND status NOT IN ('sent', 'cancelled')");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.suppress_sms_for_account_deletion");
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.suppress_sms_for_account_deletion(TEXT, UUID) FROM anon"
    );
    expect(sql).toContain("SET search_path = public");
    expect(sql).not.toMatch(/INSERT\s+INTO\s+sms_inbound_messages/i);
    expect(sql).not.toMatch(/phone_hmac|createHmac|digest\(/i);
    expect(sql).not.toMatch(/CREATE TABLE.*opt_out/i);
    expect(sql).not.toContain("'claimed'");
  });

  it("cancels every nonterminal coach-job status; leaves sent/cancelled alone", () => {
    const cancelBlock = sql.slice(
      sql.indexOf("UPDATE public.sms_inbound_coach_jobs"),
      sql.indexOf("DELETE FROM public.sms_identities")
    );
    expect(cancelBlock).toContain("status = 'cancelled'");
    expect(cancelBlock).toContain("account_deletion_sms_suppress");
    expect(cancelBlock).toContain("AND status NOT IN ('sent', 'cancelled')");
    // Terminal allowlist only — all other proven statuses are cancelled.
    for (const status of [
      "pending",
      "processing",
      "generating_reply",
      "reply_ready",
      "sending",
      "failed",
      "needs_manual_review",
    ]) {
      expect(cancelBlock).not.toContain(`status = '${status}'`);
    }
    expect(sql).toMatch(
      /IF p_set_sms_result THEN[\s\S]*p_sms_result IS NULL[\s\S]*RETURN;/
    );
  });

  it("rejects invalid suppress RPC arguments instead of already_absent", () => {
    expect(sql).toContain("RAISE EXCEPTION 'invalid_clerk_user_id'");
    expect(sql).toContain("RAISE EXCEPTION 'invalid_deletion_request_id'");
    expect(sql).toContain("RAISE EXCEPTION 'account_deletion_request_not_found'");
    expect(sql).toContain("RAISE EXCEPTION 'account_deletion_request_user_mismatch'");
    expect(sql).toContain("RAISE EXCEPTION 'unsupported_orchestration_version'");
    expect(sql).toContain("RAISE EXCEPTION 'account_deletion_request_not_suppressing_sms'");
    expect(sql).toContain("RAISE EXCEPTION 'account_deletion_request_current_step_mismatch'");
    expect(sql).toContain("orchestration_version IS DISTINCT FROM 1");
    expect(sql).toContain("current_step IS DISTINCT FROM 'suppressing_sms'");
    expect(sql).toContain("length(v_clerk) = 0");
  });

  it("atomically merges sms_binding_removed with DB now() and no PII", () => {
    expect(sql).toContain("'sms_binding_removed'");
    expect(sql).toContain("'code', 'identity_removed'");
    expect(sql).toContain("coalesce(r.steps, '{}'::jsonb) || jsonb_build_object");
    expect(sql).toContain("to_char((now() AT TIME ZONE 'utc')");
    expect(sql).toContain("IF v_identity_exists THEN");
    expect(sql).toContain("WHERE r.id = p_deletion_request_id");
    // Marker payload keys only — no phone/email/clerk fields in the JSON object.
    expect(sql).toMatch(
      /'sms_binding_removed',\s*jsonb_build_object\(\s*'ok',\s*true,\s*'code',\s*'identity_removed',\s*'at',/
    );
  });
});

describe("suppressSmsForDeletion (in-memory + RPC mock)", () => {
  beforeEach(() => {
    useInMemoryAccountDeletionStoreForTests();
    rpcMock.mockReset();
    updateClerkMock.mockReset();
    updateClerkMock.mockResolvedValue(undefined);
  });

  it("removes live binding path: pending → ok, sms_suppressed", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_a",
      idempotencyKey: "k1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    rpcMock.mockResolvedValue({ data: [{ result: "removed" }], error: null });

    const result = await suppressSmsForDeletion({
      requestId: created.value.row.id,
      clerkUserId: "user_a",
      lockOwner: "worker-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.suppressResult).toBe("removed");
    expect(result.value.row.status).toBe("sms_suppressed");
    expect(result.value.row.sms_result).toBe("ok");
    expect(result.value.row.lock_owner).toBeNull();
    // Marker is written inside the SQL RPC; in-memory RPC mock cannot mutate steps.
    // Crash-after-RPC evidence is covered by retry+seeded-marker + migration SQL tests.
    expect(rpcMock).toHaveBeenCalledWith(SUPPRESS_SMS_FOR_ACCOUNT_DELETION_RPC, {
      p_clerk_user_id: "user_a",
      p_deletion_request_id: created.value.row.id,
    });
    expect(updateClerkMock).toHaveBeenCalledWith(
      "user_a",
      { smsEnabled: false },
      ["phoneNumber"]
    );
    expect(JSON.stringify(result.value.row.steps)).not.toMatch(/STOP/);
    expect(JSON.stringify(result.value.row.steps)).not.toMatch(/\+\d{10}/);
  });

  it("already_absent with no prior marker → sms_result already_done", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_b",
      idempotencyKey: "k2",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    rpcMock.mockResolvedValue({
      data: [{ result: "already_absent" }],
      error: null,
    });

    const result = await suppressSmsForDeletion({
      requestId: created.value.row.id,
      clerkUserId: "user_b",
      lockOwner: "worker-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.suppressResult).toBe("already_absent");
    expect(result.value.row.sms_result).toBe("already_done");
    expect(result.value.row.steps[SMS_BINDING_REMOVED_STEP]).toBeUndefined();
  });

  it("removed → durable marker → Clerk timeout → final sms_result remains ok", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_c",
      idempotencyKey: "k3",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    rpcMock.mockResolvedValue({ data: [{ result: "removed" }], error: null });
    updateClerkMock.mockRejectedValue(new Error("clerk timeout"));

    const result = await suppressSmsForDeletion({
      requestId: created.value.row.id,
      clerkUserId: "user_c",
      lockOwner: "worker-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clerkMetadataWarning).toBe(true);
    expect(result.value.row.status).toBe("sms_suppressed");
    expect(result.value.row.sms_result).toBe("ok");
    expect(result.value.row.steps.sms_suppressed?.code).toBe(
      "identity_removed_clerk_metadata_pending"
    );
  });

  it("retry after removed marker: already_absent still yields sms_result ok", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_retry3",
      idempotencyKey: "k_retry3",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const {
      acquireAccountDeletionLease,
      patchAccountDeletionRequestWhileLeased,
      transitionAccountDeletionRequest,
      releaseAccountDeletionLease,
    } = await import("./repository");

    const lease = await acquireAccountDeletionLease({
      requestId: created.value.row.id,
      lockOwner: "worker-r3",
    });
    expect(lease.ok).toBe(true);
    if (!lease.ok) return;

    const toSuppressing = await transitionAccountDeletionRequest({
      requestId: created.value.row.id,
      fromStatus: "requested",
      toStatus: "suppressing_sms",
      lockOwner: "worker-r3",
      smsResult: "pending",
    });
    expect(toSuppressing.ok).toBe(true);
    if (!toSuppressing.ok) return;

    const marked = await patchAccountDeletionRequestWhileLeased({
      requestId: created.value.row.id,
      expectedStatus: "suppressing_sms",
      lockOwner: "worker-r3",
      steps: {
        ...toSuppressing.value.steps,
        [SMS_BINDING_REMOVED_STEP]: {
          at: new Date().toISOString(),
          ok: true,
          code: "identity_removed",
        },
      },
    });
    expect(marked.ok).toBe(true);
    await releaseAccountDeletionLease({
      requestId: created.value.row.id,
      lockOwner: "worker-r3",
    });

    // Simulate resume after crash: RPC now reports already_absent, but
    // durable marker proves B2a already removed the binding.
    rpcMock.mockResolvedValue({
      data: [{ result: "already_absent" }],
      error: null,
    });
    updateClerkMock.mockResolvedValue(undefined);

    const resumed = await suppressSmsForDeletion({
      requestId: created.value.row.id,
      clerkUserId: "user_retry3",
      lockOwner: "worker-r3b",
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value.suppressResult).toBe("already_absent");
    expect(resumed.value.row.sms_result).toBe("ok");
    const blob = JSON.stringify(resumed.value.row.steps);
    expect(blob).not.toMatch(/\+1\d{10}/);
    expect(blob).not.toMatch(/phoneNumber|phone_number/);
  });

  it("idempotent when already sms_suppressed", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_d",
      idempotencyKey: "k4",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    rpcMock.mockResolvedValue({ data: [{ result: "removed" }], error: null });
    const first = await suppressSmsForDeletion({
      requestId: created.value.row.id,
      clerkUserId: "user_d",
      lockOwner: "worker-1",
    });
    expect(first.ok).toBe(true);

    rpcMock.mockClear();
    const second = await suppressSmsForDeletion({
      requestId: created.value.row.id,
      clerkUserId: "user_d",
      lockOwner: "worker-2",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.row.status).toBe("sms_suppressed");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not invent STOP evidence or PII in steps", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_e",
      idempotencyKey: "k5",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    rpcMock.mockResolvedValue({ data: [{ result: "removed" }], error: null });
    const result = await suppressSmsForDeletion({
      requestId: created.value.row.id,
      clerkUserId: "user_e",
      lockOwner: "w",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const codes = Object.values(result.value.row.steps).map((s) => s.code);
    expect(codes.join(",")).not.toMatch(/stop/i);
    const blob = JSON.stringify(result.value.row.steps);
    expect(blob).not.toMatch(/\+1555/);
    expect(blob).not.toMatch(/phoneNumber/);
  });
});

describe("deletion-aware anti-resurrection guards", () => {
  beforeEach(() => {
    useInMemoryAccountDeletionStoreForTests();
    fromMock.mockReset();
  });

  it("hasUnresolvedAccountDeletionRequest reflects in-memory unresolved rows", async () => {
    expect(await hasUnresolvedAccountDeletionRequest("user_g")).toBe(false);
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_g",
      idempotencyKey: "g1",
    });
    expect(created.ok).toBe(true);
    expect(await hasUnresolvedAccountDeletionRequest("user_g")).toBe(true);
  });

  it("syncSmsAudience blocks enable during unresolved deletion", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_sync2",
      idempotencyKey: "s2",
    });
    expect(created.ok).toBe(true);

    const upsert = vi.fn(async () => ({ error: null }));
    fromMock.mockImplementation(() => ({
      upsert,
      update: () => ({ eq: vi.fn(async () => ({ error: null })) }),
    }));

    await syncSmsAudience({
      userId: "user_sync2",
      phoneNumber: "+15550001111",
      smsEnabled: true,
      stoppedAt: null,
      summittSubscribed: true,
    });

    expect(upsert).not.toHaveBeenCalled();
  });
});
