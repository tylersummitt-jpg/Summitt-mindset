import { NextResponse } from "next/server";

import {
  isCurrentSubscribedMember,
  normalizeAdminCustomerNotesPatch,
  resolveQuotesBookSentAtPatch,
} from "@/lib/admin-customers-dashboard";
import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import { getClerkUserOrNull } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeClerkUserId(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ clerkUserId: string }> }
) {
  try {
    const { userId: updatedBy } = await requireTylerAdmin();
    const { clerkUserId: rawId } = await context.params;
    const clerkUserId = normalizeClerkUserId(rawId);

    if (!clerkUserId) {
      return NextResponse.json(
        { ok: false, error: "Missing clerk user id" },
        { status: 400 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON" },
        { status: 400 }
      );
    }

    const parsed = normalizeAdminCustomerNotesPatch(body);
    if (!parsed.ok) {
      return NextResponse.json(
        { ok: false, error: parsed.error },
        { status: 400 }
      );
    }

    const clerkUser = await getClerkUserOrNull(clerkUserId);
    if (!clerkUser) {
      return NextResponse.json(
        { ok: false, error: "User not found" },
        { status: 404 }
      );
    }

    const md = (clerkUser.public_metadata || {}) as Record<string, unknown>;
    if (!isCurrentSubscribedMember(md)) {
      return NextResponse.json(
        { ok: false, error: "User is not a current subscribed member" },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();

    const { data: existing } = await supabaseServer
      .from("admin_customer_relationship_notes")
      .select("sent_quotes_book, sent_quotes_book_at")
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();

    const previousSent = existing?.sent_quotes_book === true;
    const previousSentAt =
      typeof existing?.sent_quotes_book_at === "string"
        ? existing.sent_quotes_book_at
        : null;

    const sentQuotesBookAt = resolveQuotesBookSentAtPatch({
      previousSent,
      nextSent: parsed.value.sentQuotesBook,
      previousSentAt,
      nowIso,
    });

    const row = {
      clerk_user_id: clerkUserId,
      tyler_notes: parsed.value.tylerNotes,
      sent_quotes_book: parsed.value.sentQuotesBook,
      sent_quotes_book_at: sentQuotesBookAt,
      other_items_sent: parsed.value.otherItemsSent,
      updated_at: nowIso,
      updated_by: updatedBy,
    };

    const { error } = await supabaseServer
      .from("admin_customer_relationship_notes")
      .upsert(row, { onConflict: "clerk_user_id" });

    if (error) {
      console.error("[admin/customers/notes] upsert failed", error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      notes: {
        clerkUserId,
        tylerNotes: row.tyler_notes,
        sentQuotesBook: row.sent_quotes_book,
        sentQuotesBookAt: row.sent_quotes_book_at,
        otherItemsSent: row.other_items_sent,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
      },
    });
  } catch (err: unknown) {
    console.error("[admin/customers/notes] PATCH failed", err);

    const status =
      err != null &&
      typeof err === "object" &&
      "status" in err &&
      typeof (err as { status: unknown }).status === "number"
        ? (err as { status: number }).status
        : 500;

    const message =
      err instanceof Error ? err.message : "unknown_error";

    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
