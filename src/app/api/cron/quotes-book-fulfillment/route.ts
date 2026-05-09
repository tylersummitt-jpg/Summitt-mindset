/* eslint-disable no-console */
import { NextResponse } from "next/server";
import {
  getClerkUserOrNull,
  listClerkUsers,
  type ClerkUserResponse,
} from "@/lib/clerk-rest";
import { validateCronSecretRequest } from "@/lib/cron-auth";
import { notifyQuotesBookFulfillment } from "@/lib/notify-quotes-book-fulfillment";
import {
  addTwentyDays,
  extractDisplayNameSnapshot,
  extractPrimaryEmail,
  isEntitledForQuotesBookReminder,
  isUserCreatedOnOrAfterCutoff,
  parseAutomationCutover,
  parseClerkCreatedAtMs,
  truncateErrorMessage,
} from "@/lib/quotes-book-fulfillment-reminder";
import { supabaseServer } from "@/lib/supabase-server";

/** Email-only ops reminders via Resend — no Twilio SMS; nothing to pass through finalizeNorthStarCoachSms. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH_DUE = 50;
const LIST_PAGE_SIZE = 200;
const MAX_LIST_PAGES = 50;
const ERROR_MAX_LEN = 500;

type Summary = {
  initialized: number;
  skippedBeforeCutover: number;
  skippedNotEntitled: number;
  skippedNoEmail: number;
  skippedExistingRow: number;
  dueProcessed: number;
  remindersSent: number;
  skippedNoLongerEntitled: number;
  skippedUserMissing: number;
  skippedCutoverSafety: number;
  failed: number;
  errors: string[];
};

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}

async function handleCron(request: Request) {
  const summary: Summary = {
    initialized: 0,
    skippedBeforeCutover: 0,
    skippedNotEntitled: 0,
    skippedNoEmail: 0,
    skippedExistingRow: 0,
    dueProcessed: 0,
    remindersSent: 0,
    skippedNoLongerEntitled: 0,
    skippedUserMissing: 0,
    skippedCutoverSafety: 0,
    failed: 0,
    errors: [],
  };

  if (!validateCronSecretRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoverRaw = process.env.QUOTES_BOOK_FULFILLMENT_AUTOMATION_START_AT;
  const cutover = parseAutomationCutover(cutoverRaw);
  if (!cutover) {
    const msg =
      "QUOTES_BOOK_FULFILLMENT_AUTOMATION_START_AT missing or invalid";
    console.warn("[quotes-book-fulfillment]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const cutoverIso = cutover.toISOString();
  const now = new Date();

  try {
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const offset = page * LIST_PAGE_SIZE;
      const users = await listClerkUsers({
        limit: LIST_PAGE_SIZE,
        offset,
      });

      if (!users.length) break;

      for (const u of users) {
        const createdMs = parseClerkCreatedAtMs(u as ClerkUserResponse);
        if (createdMs == null) {
          summary.skippedBeforeCutover += 1;
          continue;
        }

        if (!isUserCreatedOnOrAfterCutoff(createdMs, cutover)) {
          summary.skippedBeforeCutover += 1;
          continue;
        }

        if (!isEntitledForQuotesBookReminder(u.public_metadata)) {
          summary.skippedNotEntitled += 1;
          continue;
        }

        const email = extractPrimaryEmail(u as ClerkUserResponse);
        if (!email) {
          summary.skippedNoEmail += 1;
          continue;
        }

        const { data: existing } = await supabaseServer
          .from("quotes_book_fulfillment_reminders")
          .select("clerk_user_id")
          .eq("clerk_user_id", u.id)
          .maybeSingle();

        if (existing?.clerk_user_id) {
          summary.skippedExistingRow += 1;
          continue;
        }

        const entitledFirstSeenAt = now;
        const quotesBookDueAt = addTwentyDays(entitledFirstSeenAt);
        const displayName = extractDisplayNameSnapshot(
          u as ClerkUserResponse
        );
        const clerkCreatedAtSnapshot = new Date(createdMs).toISOString();

        const { error: insertErr } = await supabaseServer
          .from("quotes_book_fulfillment_reminders")
          .insert({
            clerk_user_id: u.id,
            email_snapshot: email,
            display_name_snapshot: displayName,
            entitled_first_seen_at: entitledFirstSeenAt.toISOString(),
            quotes_book_due_at: quotesBookDueAt.toISOString(),
            automation_cutover_at: cutoverIso,
            clerk_created_at_snapshot: clerkCreatedAtSnapshot,
            updated_at: entitledFirstSeenAt.toISOString(),
          });

        if (insertErr) {
          const code = (insertErr as { code?: string }).code;
          if (code === "23505") {
            summary.skippedExistingRow += 1;
          } else {
            summary.failed += 1;
            const e = truncateErrorMessage(insertErr, ERROR_MAX_LEN);
            if (summary.errors.length < 20) summary.errors.push(`insert:${u.id}:${e}`);
            console.warn(
              "[quotes-book-fulfillment] insert failed",
              u.id,
              insertErr
            );
          }
          continue;
        }

        summary.initialized += 1;
      }

      if (users.length < LIST_PAGE_SIZE) break;
    }
  } catch (err) {
    summary.failed += 1;
    summary.errors.push(truncateErrorMessage(err, ERROR_MAX_LEN));
    console.error("[quotes-book-fulfillment] list/init phase:", err);
  }

  const { data: dueRows, error: dueErr } = await supabaseServer
    .from("quotes_book_fulfillment_reminders")
    .select("*")
    .is("ops_email_sent_at", null)
    .lte("quotes_book_due_at", now.toISOString())
    .limit(BATCH_DUE);

  if (dueErr) {
    summary.failed += 1;
    summary.errors.push(truncateErrorMessage(dueErr, ERROR_MAX_LEN));
    return NextResponse.json({ ok: false, ...summary }, { status: 500 });
  }

  const rows = dueRows ?? [];

  for (const row of rows) {
    summary.dueProcessed += 1;
    const clerkUserId =
      typeof row.clerk_user_id === "string" ? row.clerk_user_id : null;
    if (!clerkUserId) {
      summary.failed += 1;
      continue;
    }

    let user: ClerkUserResponse | null;
    try {
      user = await getClerkUserOrNull(clerkUserId);
    } catch {
      summary.failed += 1;
      const errMsg = "clerk_user_fetch_failed";
      await bumpFailureOnly(clerkUserId, errMsg);
      if (summary.errors.length < 20) {
        summary.errors.push(`fetch:${clerkUserId}:${errMsg}`);
      }
      continue;
    }

    if (!user) {
      summary.skippedUserMissing += 1;
      continue;
    }

    const createdMs = parseClerkCreatedAtMs(user);
    if (createdMs == null || !isUserCreatedOnOrAfterCutoff(createdMs, cutover)) {
      summary.skippedCutoverSafety += 1;
      continue;
    }

    if (!isEntitledForQuotesBookReminder(user.public_metadata)) {
      summary.skippedNoLongerEntitled += 1;
      continue;
    }

    const emailLive = extractPrimaryEmail(user);
    if (!emailLive) {
      summary.skippedNoEmail += 1;
      const errMsg = "no_primary_email";
      await bumpFailureOnly(clerkUserId, errMsg);
      continue;
    }

    const entitledIso =
      typeof row.entitled_first_seen_at === "string"
        ? row.entitled_first_seen_at
        : new Date(row.entitled_first_seen_at as string).toISOString();
    const dueIso =
      typeof row.quotes_book_due_at === "string"
        ? row.quotes_book_due_at
        : new Date(row.quotes_book_due_at as string).toISOString();

    const displayName = extractDisplayNameSnapshot(user);

    try {
      await notifyQuotesBookFulfillment({
        userEmail: emailLive,
        displayName,
        clerkUserId,
        entitledFirstSeenAtIso: entitledIso,
        quotesBookDueAtIso: dueIso,
      });
    } catch (sendErr) {
      summary.failed += 1;
      const errStr = truncateErrorMessage(sendErr, ERROR_MAX_LEN);
      if (summary.errors.length < 20) {
        summary.errors.push(`send:${clerkUserId}:${errStr}`);
      }
      await bumpFailureOnly(clerkUserId, errStr);
      console.warn(
        "[quotes-book-fulfillment] notify failed",
        clerkUserId,
        sendErr
      );
      continue;
    }

    const attemptWas =
      typeof row.ops_email_attempt_count === "number"
        ? row.ops_email_attempt_count
        : 0;
    const sentAtIso = now.toISOString();

    const { data: updated, error: updErr } = await supabaseServer
      .from("quotes_book_fulfillment_reminders")
      .update({
        ops_email_sent_at: sentAtIso,
        ops_email_attempt_count: attemptWas + 1,
        last_attempt_at: sentAtIso,
        last_error: null,
        updated_at: sentAtIso,
        email_snapshot: emailLive,
        display_name_snapshot: displayName,
      })
      .eq("clerk_user_id", clerkUserId)
      .is("ops_email_sent_at", null)
      .select("clerk_user_id");

    if (updErr) {
      summary.failed += 1;
      if (summary.errors.length < 20) {
        summary.errors.push(`update:${clerkUserId}:${updErr.message}`);
      }
      continue;
    }

    if (updated && updated.length > 0) {
      summary.remindersSent += 1;
    }
  }

  return NextResponse.json({ ok: true, ...summary });
}

async function bumpFailureOnly(
  clerkUserId: string,
  errShort: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data: row } = await supabaseServer
    .from("quotes_book_fulfillment_reminders")
    .select("ops_email_attempt_count")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  const prev =
    typeof row?.ops_email_attempt_count === "number"
      ? row.ops_email_attempt_count
      : 0;

  await supabaseServer
    .from("quotes_book_fulfillment_reminders")
    .update({
      ops_email_attempt_count: prev + 1,
      last_attempt_at: nowIso,
      last_error: errShort.slice(0, ERROR_MAX_LEN),
      updated_at: nowIso,
    })
    .eq("clerk_user_id", clerkUserId)
    .is("ops_email_sent_at", null);
}
