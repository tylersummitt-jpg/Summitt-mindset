import { NextResponse } from "next/server";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import {
  decideScheduledPreviewWork,
  eveningPreviewIsReady,
  readCompletedScheduledPreview,
  readScheduledGenerationBatch,
  resolveMemberPreviewDecision,
  runScheduledTtoGeneration,
} from "@/lib/tto-scheduled-generate";
import { SMS_DAILY_EVENING_PREVIEW_SEND_SLOT } from "@/lib/tyler-text-overview-types";
import { PROACTIVE_SCHEDULE_ADMIN_TIMEZONE } from "@/lib/sms-proactive-schedule";
import { getDateKeyInTimezone } from "@/lib/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminErrorResponse(err: unknown) {
  const status =
    err != null &&
    typeof err === "object" &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : 500;

  const message = err instanceof Error ? err.message : "unknown_error";
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  try {
    await requireTylerAdmin();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const clerkUserId =
      body != null &&
      typeof body === "object" &&
      "clerk_user_id" in body &&
      typeof (body as { clerk_user_id: unknown }).clerk_user_id === "string"
        ? (body as { clerk_user_id: string }).clerk_user_id.trim()
        : "";

    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "clerk_user_id required" }, { status: 400 });
    }

    const postedDayKey =
      body != null &&
      typeof body === "object" &&
      "draft_for_day_key" in body &&
      typeof (body as { draft_for_day_key: unknown }).draft_for_day_key === "string"
        ? (body as { draft_for_day_key: string }).draft_for_day_key.trim()
        : "";
    const memberLocalDate =
      body != null &&
      typeof body === "object" &&
      "member_local_date" in body &&
      typeof (body as { member_local_date: unknown }).member_local_date === "string"
        ? (body as { member_local_date: string }).member_local_date.trim()
        : "";
    const batchDate =
      postedDayKey || getDateKeyInTimezone(new Date(), PROACTIVE_SCHEDULE_ADMIN_TIMEZONE);

    const loaded = await readScheduledGenerationBatch({
      batchDate,
      owner: "evening",
    });
    if (!loaded.ok) {
      return NextResponse.json(
        { ok: false, error: loaded.error, reason: "batch_unreadable" },
        { status: 503 }
      );
    }
    const now = new Date();
    const decision = loaded.batch
      ? decideScheduledPreviewWork({
          occurrences: loaded.batch.occurrences,
          clerkUserId,
          postedBatchDate: batchDate,
          memberLocalDate: memberLocalDate || null,
          now,
        })
      : await resolveMemberPreviewDecision({
          now,
          owner: "evening",
          batchDate,
          clerkUserId,
          memberLocalDate: memberLocalDate || null,
        });
    if (decision.action === "unresolved") {
      return NextResponse.json(
        {
          ok: false,
          error: "This member's schedule could not be resolved",
          reason: "unresolved",
        },
        { status: 409 }
      );
    }
    if (decision.action === "none") {
      return NextResponse.json(
        { ok: false, error: "No scheduled Evening occurrence for this batch", reason: "unscheduled" },
        { status: 400 }
      );
    }
    if (decision.action === "ambiguous") {
      return NextResponse.json(
        {
          ok: false,
          error: "This member has more than one Evening occurrence in the batch",
          reason: "ambiguous_occurrences",
          member_local_dates: decision.dates,
        },
        { status: 409 }
      );
    }
    if (decision.action === "not_ready") {
      return NextResponse.json(
        {
          ok: false,
          error: "Evening preview is not ready yet.",
          reason: "preview_not_ready",
        },
        { status: 409 }
      );
    }

    let preview =
      decision.action === "read_existing"
        ? await readCompletedScheduledPreview({
            clerkUserId,
            memberLocalDate: decision.occurrence.memberLocalDate,
            sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
            batchDate,
          })
        : null;
    let scheduled = decision.occurrence;
    let otherDates = decision.otherDates;

    if (decision.action === "generate") {
      const ran = await runScheduledTtoGeneration({
        owner: "evening",
        batchDate,
        trigger: "manual_schedule",
        onlyClerkUserIds: [clerkUserId],
        onlyMemberLocalDate: decision.occurrence.memberLocalDate,
      });
      if (!ran.ok) {
        return NextResponse.json(
          { ok: false, error: ran.error, reason: ran.error },
          { status: ran.status }
        );
      }
      const updated =
        ran.batch.occurrences.find(
          (item) =>
            item.clerkUserId === clerkUserId &&
            item.memberLocalDate === decision.occurrence.memberLocalDate
        ) ?? decision.occurrence;
      scheduled = updated;
      otherDates = decision.otherDates;
      preview =
        ran.previews.find(
          (item) =>
            item.clerkUserId === clerkUserId &&
            item.memberLocalDate === decision.occurrence.memberLocalDate
        ) ?? null;
      if (
        !preview &&
        (updated.state === "generated" ||
          updated.state === "protected" ||
          updated.state === "intentional_space" ||
          updated.state === "sent")
      ) {
        preview = await readCompletedScheduledPreview({
          clerkUserId,
          memberLocalDate: decision.occurrence.memberLocalDate,
          sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
          batchDate,
        });
      }
    }

    if (!eveningPreviewIsReady({ state: scheduled.state, preview })) {
      return NextResponse.json(
        {
          ok: false,
          error: "Evening preview is not ready yet.",
          reason: "preview_not_ready",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      ok: true,
      preview_only: true,
      send_slot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      clerk_user_id: clerkUserId,
      draft_for_day_key: scheduled.memberLocalDate,
      generation_id: preview?.generationId ?? null,
      machine_should_send: preview?.machineShouldSend ?? false,
      machine_draft_body: preview?.body ?? null,
      machine_no_send_reason: preview?.machineNoSendReason ?? null,
      other_member_local_dates: otherDates,
      message_for: null,
      writer_prompt_path: null,
      current_draft_protected: preview?.protected === true,
      morning_anchor_source: null,
      slot_coaching_context: null,
    });
  } catch (err) {
    console.error("[admin/tyler-text-overview/evening-preview] POST failed", err);
    return adminErrorResponse(err);
  }
}
