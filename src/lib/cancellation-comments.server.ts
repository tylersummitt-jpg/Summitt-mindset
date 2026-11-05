import "server-only";

import { exitSurveyReasonLabel } from "@/lib/exit-survey";
import { supabaseServer } from "@/lib/supabase-server";

export type CancellationComment = {
  createdAt: string;
  reasonLabel: string;
  message: string;
};

export type CancellationCommentView =
  | { status: "ready"; comments: CancellationComment[]; capped: boolean }
  | { status: "empty" }
  | { status: "unavailable" };

const COMMENT_LIMIT = 40;

export async function loadCancellationComments(): Promise<CancellationCommentView> {
  const { data, error } = await supabaseServer
    .from("feedback_events")
    .select("created_at, reason_code, message")
    .eq("type", "churn")
    .eq("moment", "cancel_attempt")
    .not("message", "is", null)
    .order("created_at", { ascending: false })
    .limit(COMMENT_LIMIT + 1);
  if (error) {
    console.warn("[retention] cancellation comments read failed", { code: error.code });
    return { status: "unavailable" };
  }
  const comments: CancellationComment[] = [];
  for (const row of data ?? []) {
    if (typeof row.message !== "string") continue;
    const message = row.message.trim();
    if (!message) continue;
    comments.push({
      createdAt: typeof row.created_at === "string" ? row.created_at.slice(0, 10) : "Date unavailable",
      reasonLabel: exitSurveyReasonLabel(
        typeof row.reason_code === "string" ? row.reason_code : null
      ),
      message: message.slice(0, 2000),
    });
  }
  const capped = comments.length > COMMENT_LIMIT;
  const visible = comments.slice(0, COMMENT_LIMIT);
  if (visible.length === 0) return { status: "empty" };
  return { status: "ready", comments: visible, capped };
}
