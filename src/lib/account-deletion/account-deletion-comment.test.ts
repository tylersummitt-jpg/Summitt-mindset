import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_DELETION_COMMENT_DISCLOSURE,
  ACCOUNT_DELETION_COMMENT_RETAIN_LABEL,
  ACCOUNT_DELETION_COMMENT_SQL_CONTRACT,
  buildAccountDeletionCommentRequestBody,
  RECORD_ACCOUNT_DELETION_COMMENT_RPC,
  SETTLE_ACCOUNT_DELETION_COMMENTS_RPC,
  sendAccountDeletionComment,
  validateAccountDeletionCommentBody,
} from "@/lib/account-deletion/account-deletion-comment-contract";
import {
  ACCOUNT_DELETION_COMMENT_ROLLBACK_SQL,
  ACCOUNT_DELETION_COMMENT_SQL,
  ACCOUNT_DELETION_COMMENT_VERIFICATION_SQL,
} from "@/lib/account-deletion/account-deletion-comment.contract.sql";

const rpcMock = vi.hoisted(() => vi.fn());
const authMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn(), rpc: (...args: unknown[]) => rpcMock(...args) },
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

const SQL = ACCOUNT_DELETION_COMMENT_SQL.toLowerCase();

describe("deletion comment contract", () => {
  it("keeps a note only when the member explicitly chooses to", () => {
    expect(ACCOUNT_DELETION_COMMENT_DISCLOSURE).toContain("only if you choose Keep this note");
    expect(ACCOUNT_DELETION_COMMENT_DISCLOSURE).toContain("does not make this note anonymous");
    expect(ACCOUNT_DELETION_COMMENT_RETAIN_LABEL).toBe(
      "Keep this note after my account is deleted."
    );
    expect(buildAccountDeletionCommentRequestBody("  A note  ")).toEqual({
      message: "  A note  ",
      retain: true,
    });
    expect(validateAccountDeletionCommentBody({ message: "  A note  ", retain: true })).toEqual({
      ok: true,
      message: "A note",
    });
    expect(validateAccountDeletionCommentBody({ message: "A note", retain: false }).ok).toBe(false);
    expect(validateAccountDeletionCommentBody({ message: "A note" }).ok).toBe(false);
    expect(
      validateAccountDeletionCommentBody({
        message: "A note",
        retain: true,
        reasonCode: "not_using",
      }).ok
    ).toBe(false);
    expect(
      validateAccountDeletionCommentBody({
        message: "A note",
        retain: true,
        requestId: "00000000-0000-4000-8000-000000000001",
      }).ok
    ).toBe(false);
    expect(validateAccountDeletionCommentBody({ message: "   ", retain: true }).ok).toBe(false);
  });

  it("does not send a note unless retention was chosen", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    sendAccountDeletionComment("A private note", false);
    sendAccountDeletionComment("   ", true);
    expect(fetchMock).not.toHaveBeenCalled();
    sendAccountDeletionComment("A private note", true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string; keepalive: boolean }];
    expect(url).toBe("/api/account/delete-comment");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body)).toEqual({ message: "A private note", retain: true });
    vi.unstubAllGlobals();
  });
});

describe("deletion comment SQL contract is not executed here", () => {
  it("keeps the permanent note free of member and request identifiers", () => {
    expect(ACCOUNT_DELETION_COMMENT_SQL_CONTRACT).toBe("2026-11-05-deletion-comment-v1");
    expect(ACCOUNT_DELETION_COMMENT_SQL).toContain(RECORD_ACCOUNT_DELETION_COMMENT_RPC);
    expect(ACCOUNT_DELETION_COMMENT_SQL).toContain(SETTLE_ACCOUNT_DELETION_COMMENTS_RPC);
    expect(SQL).not.toContain("create trigger");
    expect(SQL).not.toContain("update public.account_deletion_requests");
    expect(SQL).toContain("on conflict (request_id) do nothing");
    expect(SQL).toContain("for update of p skip locked");

    const kept = SQL.slice(
      SQL.indexOf("create table public.account_deletion_comments"),
      SQL.indexOf("comment on table public.account_deletion_comments")
    );
    expect(kept).not.toContain("clerk_user_id");
    expect(kept).not.toContain("request_id");
    expect(kept).not.toContain("email");

    const settle = SQL.slice(
      SQL.indexOf("function public.settle_account_deletion_comments"),
      SQL.indexOf("comment on function public.settle_account_deletion_comments")
    );
    const expiry = settle.indexOf("v_row.expires_at <= now()");
    const keep = settle.indexOf("insert into public.account_deletion_comments");
    const unlink = settle.indexOf("delete from public.account_deletion_comment_pending", keep);
    expect(expiry).toBeGreaterThan(-1);
    expect(keep).toBeGreaterThan(expiry);
    expect(unlink).toBeGreaterThan(keep);
    expect(settle).toContain("failed_terminal");
    expect(settle).not.toContain("for update of r");
    const keptInsert = settle.slice(
      settle.indexOf("insert into public.account_deletion_comments"),
      settle.indexOf("values")
    );
    expect(keptInsert).toContain("(message)");
    expect(keptInsert).not.toContain("request_id");
    expect(keptInsert).not.toContain("clerk");
    expect(ACCOUNT_DELETION_COMMENT_VERIFICATION_SQL).toContain("clerk_user_id");
    expect(ACCOUNT_DELETION_COMMENT_ROLLBACK_SQL).toContain(
      "DROP TABLE IF EXISTS public.account_deletion_comments"
    );
  });

  it("does not add a migration, a public route, or the note to the copied report", () => {
    const migrations = readdirSync(join(process.cwd(), "supabase/migrations"));
    expect(migrations.some((file) => file.includes("deletion-comment"))).toBe(false);
    const vercel = readFileSync(join(process.cwd(), "vercel.json"), "utf8");
    expect(vercel).not.toContain("delete-comment");
    const middleware = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");
    expect(middleware).not.toContain("/api/account/delete-comment");
    const screen = readFileSync(join(process.cwd(), "src/app/admin/operating-screen.tsx"), "utf8");
    const factsCall = screen.slice(
      screen.indexOf("formatCompleteRetentionFacts"),
      screen.indexOf("formatCompleteRetentionFacts") + 180
    );
    expect(factsCall).not.toContain("deletionComments");
    expect(screen).toContain("not included in Copy Complete Facts Report");
    const route = readFileSync(
      join(process.cwd(), "src/app/api/account/delete-comment/route.ts"),
      "utf8"
    );
    expect(route).not.toContain("account_deletion_requests");
    expect(route).not.toContain(".insert(");
    expect(route).not.toContain("initiateAccountDeletionRequestForUser");
    const cron = readFileSync(
      join(process.cwd(), "src/app/api/cron/account-deletions/route.ts"),
      "utf8"
    );
    expect(cron).toContain("settleAccountDeletionComments");
    expect(cron).not.toMatch(/waitUntil|\.after\(|setTimeout\(|setInterval\(/);
  });
});

describe("deletion comment route", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    authMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: null });
    authMock.mockResolvedValue({ userId: "user_owner" });
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("records only an opted-in note and ignores a missing database function", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "private note should not be logged" },
    });
    const { POST } = await import("@/app/api/account/delete-comment/route");
    const res = await POST(
      new Request("http://localhost/api/account/delete-comment", {
        method: "POST",
        body: JSON.stringify({ message: "  The evening text was too much  ", retain: true }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("record_account_deletion_comment", {
      p_clerk_user_id: "user_owner",
      p_message: "The evening text was too much",
    });
    expect(JSON.stringify(rpcMock.mock.calls)).not.toContain("request_id");
  });

  it("rejects a note that was not explicitly retained", async () => {
    const { POST } = await import("@/app/api/account/delete-comment/route");
    const declined = await POST(
      new Request("http://localhost/api/account/delete-comment", {
        method: "POST",
        body: JSON.stringify({ message: "private", retain: false }),
      })
    );
    expect(declined.status).toBe(400);
    const extra = await POST(
      new Request("http://localhost/api/account/delete-comment", {
        method: "POST",
        body: JSON.stringify({ message: "private", retain: true, clerkUserId: "user_other" }),
      })
    );
    expect(extra.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not record a note for a signed-out caller", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { POST } = await import("@/app/api/account/delete-comment/route");
    const res = await POST(
      new Request("http://localhost/api/account/delete-comment", {
        method: "POST",
        body: JSON.stringify({ message: "private", retain: true }),
      })
    );
    expect(res.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
