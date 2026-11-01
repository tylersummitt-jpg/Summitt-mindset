import { NextResponse } from "next/server";

import { loadRetentionSubscriptionInputs } from "@/lib/admin-subscriber-growth";
import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import {
  canPublishRetentionReport,
  RETENTION_REPORT_TIME_BUDGET_MS,
  retentionReportError,
} from "@/lib/retention-report";
import {
  claimRetentionReport,
  failRetentionReport,
  publishRetentionReport,
} from "@/lib/retention-report.server";
import { loadRetentionIntelligence } from "@/lib/retention-intelligence.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function adminError(err: unknown) {
  const status =
    err != null && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : 500;
  const message = err instanceof Error ? err.message : "unknown_error";
  if (message === "UNAUTHORIZED") return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  return NextResponse.json({ ok: false, error: "Retention report generation failed." }, { status });
}

export async function POST() {
  try {
    const session = await requireTylerAdmin();
    const tylerId = process.env.TYLER_CLERK_USER_ID?.trim();
    if (!tylerId || session.userId !== tylerId) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const token = crypto.randomUUID();
    const claimed = await claimRetentionReport(token);
    if (claimed === "busy") {
      return NextResponse.json(
        { ok: false, error: "A retention report is already generating." },
        { status: 409 }
      );
    }
    if (claimed === "unavailable") {
      return NextResponse.json(
        { ok: false, error: "The retention report could not be started." },
        { status: 503 }
      );
    }

    try {
      const deadlineMs = Date.now() + RETENTION_REPORT_TIME_BUDGET_MS;
      const subscriptions = await loadRetentionSubscriptionInputs(deadlineMs);
      const intel = await loadRetentionIntelligence(new Date(), subscriptions, deadlineMs);
      if (!canPublishRetentionReport(intel)) {
        const reason = intel.withheld ?? intel.definition;
        await failRetentionReport(token, reason);
        return NextResponse.json({ ok: false, error: retentionReportError(reason) }, { status: 422 });
      }
      const published = await publishRetentionReport(token, intel);
      if (published === "refused") {
        await failRetentionReport(token, "The report was not saved.");
        return NextResponse.json(
          { ok: false, error: "The report was not saved. The last saved report was not replaced." },
          { status: 422 }
        );
      }
      if (published !== "published") {
        await failRetentionReport(token, "The generation claim ended before the report could be saved.");
        return NextResponse.json(
          {
            ok: false,
            error: "The generation claim ended before the report could be saved. The last saved report was not replaced.",
          },
          { status: 409 }
        );
      }
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.warn("[retention-report] generation failed", {
        reason: err instanceof Error ? err.name : "retention_report_failed",
      });
      await failRetentionReport(token, "Retention report generation failed.");
      return NextResponse.json(
        { ok: false, error: "Retention report generation failed. The last saved report was not replaced." },
        { status: 500 }
      );
    }
  } catch (err) {
    return adminError(err);
  }
}
