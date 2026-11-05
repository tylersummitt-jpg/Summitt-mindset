import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACCOUNT_DELETION_REASON_ROLLBACK_SQL,
  ACCOUNT_DELETION_REASON_SQL,
  ACCOUNT_DELETION_REASON_VERIFICATION_SQL,
} from "@/lib/account-deletion/account-deletion-reason.contract.sql";
import {
  ACCOUNT_DELETION_REASON_DISCLOSURE,
  ACCOUNT_DELETION_REASON_SETTLE_LIMIT,
  ACCOUNT_DELETION_REASON_SQL_CONTRACT,
  buildAccountDeletionReasonRequestBody,
  DELETION_REASON_CODES,
  RECORD_ACCOUNT_DELETION_REASON_RPC,
  SETTLE_ACCOUNT_DELETION_REASONS_RPC,
  validateAccountDeletionReasonBody,
} from "@/lib/account-deletion/account-deletion-reason-contract";
import {
  formatDeletionReasonLines,
  parseDeletionReasonReportRows,
} from "@/lib/account-deletion/deletion-reason-facts";

const SQL = ACCOUNT_DELETION_REASON_SQL.toLowerCase();

function reportRow(
  code: string,
  count: number | null,
  completed: number,
  recorded: number | null,
  missing: number | null,
  withheld: boolean
) {
  return {
    reason_code: code,
    completed_total: completed,
    recorded_total: withheld ? null : recorded,
    missing_total: withheld ? null : missing,
    reason_count: withheld ? null : count,
    breakdown_withheld: withheld,
  };
}

describe("deletion reason contract", () => {
  it("accepts only the nine reason codes and rejects extra fields", () => {
    expect(buildAccountDeletionReasonRequestBody("skipped")).toEqual({
      reasonCode: "skipped",
    });
    expect(validateAccountDeletionReasonBody({ reasonCode: "not_using" }).ok).toBe(true);
    expect(validateAccountDeletionReasonBody({ reasonCode: "skipped" }).ok).toBe(true);
    expect(
      validateAccountDeletionReasonBody({
        reasonCode: "not_using",
        message: "keep this",
      }).ok
    ).toBe(false);
    expect(
      validateAccountDeletionReasonBody({
        reasonCode: "not_using",
        requestId: "00000000-0000-4000-8000-000000000001",
      }).ok
    ).toBe(false);
    expect(validateAccountDeletionReasonBody({ reasonCode: "cost" }).ok).toBe(false);
    expect(validateAccountDeletionReasonBody({ confirmation: "DELETE" }).ok).toBe(false);
    expect(ACCOUNT_DELETION_REASON_DISCLOSURE).toContain("We do not keep what you write.");
    expect(ACCOUNT_DELETION_REASON_DISCLOSURE).toContain(
      "If the reason does not get recorded, deletion still continues."
    );
  });

  it("hides a small count instead of publishing it beside the completed total", () => {
    const rows = DELETION_REASON_CODES.map((code, index) =>
      reportRow(code, index === 0 ? 3 : index === 1 ? 7 : 0, 10, 10, 0, false)
    );
    const parsed = parseDeletionReasonReportRows(rows);
    expect(parsed.breakdownWithheld).toBe(true);
    expect(parsed.completed).toBe(10);
    expect(parsed.reasons).toEqual([]);
    expect(parsed.recorded).toBeNull();
    expect(JSON.stringify(parsed)).not.toContain("3");
    const lines = formatDeletionReasonLines(parsed).join("\n");
    expect(lines).toContain("Completed account deletions: 10.");
    expect(lines).toContain("withheld");
    expect(lines).not.toContain("I wasn't using it enough.: 3");
    expect(lines).toContain("Written deletion answers are not stored.");
  });

  it("shows zero only when the full breakdown is safe", () => {
    const rows = DELETION_REASON_CODES.map((code) =>
      reportRow(code, code === "skipped" ? 6 : code === "not_using" ? 5 : 0, 11, 11, 0, false)
    );
    const parsed = parseDeletionReasonReportRows(rows);
    expect(parsed.breakdownWithheld).toBe(false);
    expect(parsed.missing).toBe(0);
    expect(parsed.reasons.find((reason) => reason.code === "no_results")?.count).toBe(0);
    expect(parsed.reasons.find((reason) => reason.code === "skipped")?.count).toBe(6);
    const lines = formatDeletionReasonLines(parsed).join("\n");
    expect(lines).toContain("No reason received: 0.");
    expect(lines).toContain("Skipped the reason question: 6.");
    expect(lines).not.toMatch(/clerk|request_id|journal/i);
  });

  it("treats a missing view as unavailable, not zero", () => {
    const parsed = parseDeletionReasonReportRows([]);
    expect(parsed.readable).toBe(false);
    expect(parsed.completed).toBeNull();
    expect(formatDeletionReasonLines(parsed).join("\n")).toContain("not shown as zero");
    expect(formatDeletionReasonLines(undefined).join("\n")).toContain(
      "not in this saved report"
    );
  });
});

describe("deletion reason SQL contract is not executed here", () => {
  it("matches the application names and the approved safety rules", () => {
    expect(ACCOUNT_DELETION_REASON_SQL_CONTRACT).toBe("2026-11-05-deletion-reason-v1");
    expect(ACCOUNT_DELETION_REASON_SQL).toContain(RECORD_ACCOUNT_DELETION_REASON_RPC);
    expect(ACCOUNT_DELETION_REASON_SQL).toContain(SETTLE_ACCOUNT_DELETION_REASONS_RPC);
    expect(ACCOUNT_DELETION_REASON_SQL).toContain("account_deletion_reason_report");
    expect(ACCOUNT_DELETION_REASON_SQL).toContain("p_clerk_user_id");
    expect(ACCOUNT_DELETION_REASON_SQL).toContain("p_reason_code");
    expect(ACCOUNT_DELETION_REASON_SQL).toContain("p_limit integer DEFAULT 25");
    expect(ACCOUNT_DELETION_REASON_SETTLE_LIMIT).toBe(25);
    expect(SQL).not.toContain("create trigger");
    expect(SQL).toContain("no aggregated flag");
    expect(SQL).not.toMatch(/\baggregated boolean\b/);
    expect(SQL).not.toContain("update public.account_deletion_requests");
    expect(SQL).toContain("on conflict (request_id) do nothing");
    expect(SQL).toContain("for update of p skip locked");

    const settle = SQL.slice(
      SQL.indexOf("function public.settle_account_deletion_reasons"),
      SQL.indexOf("comment on function public.settle_account_deletion_reasons")
    );
    const expiry = settle.indexOf("v_row.expires_at <= now()");
    const count = settle.indexOf("insert into public.account_deletion_reason_counts");
    const unlink = settle.indexOf(
      "delete from public.account_deletion_reason_pending",
      count
    );
    expect(expiry).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(expiry);
    expect(unlink).toBeGreaterThan(count);
    expect(settle).toContain("v_status = 'failed_terminal'");
    expect(settle).not.toContain("for update of r");

    const record = SQL.slice(
      SQL.indexOf("function public.record_account_deletion_reason"),
      SQL.indexOf("comment on function public.record_account_deletion_reason")
    );
    expect(record).toContain("for update");
    expect(record).toContain("status <> 'completed'");
    expect(record).toContain("failed_terminal");
    expect(ACCOUNT_DELETION_REASON_VERIFICATION_SQL).toContain("information_schema.columns");
    expect(ACCOUNT_DELETION_REASON_ROLLBACK_SQL).toContain(
      "DROP TABLE IF EXISTS public.account_deletion_reason_pending"
    );
  });

  it("does not add a migration or a second cron", () => {
    const migrations = readFileSync(
      join(process.cwd(), "vercel.json"),
      "utf8"
    );
    expect(migrations).not.toContain("delete-reason");
    const cron = readFileSync(
      join(process.cwd(), "src/app/api/cron/account-deletions/route.ts"),
      "utf8"
    );
    expect(cron).toContain("settleAccountDeletionReasons");
    expect(cron).toContain("return jsonResponse(result.body, result.httpStatus)");
    expect(cron).not.toMatch(/waitUntil|\.after\(|setTimeout\(|setInterval\(/);
    expect(cron).not.toMatch(/\bwhile\s*\(/);
    const route = readFileSync(
      join(process.cwd(), "src/app/api/account/delete-reason/route.ts"),
      "utf8"
    );
    expect(route).not.toContain("initiateAccountDeletionRequestForUser");
    expect(route).not.toContain("account_deletion_requests");
    expect(route).not.toContain(".insert(");
    expect(route).not.toContain("settleAccountDeletionReasons");
  });
});
