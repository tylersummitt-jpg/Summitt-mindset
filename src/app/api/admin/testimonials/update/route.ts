import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";

type Payload = {
  id: string;
  displayName?: string | null;
  tags?: string[] | null;
  quote?: string | null;
};

function normalizeText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().replace(/\s+/g, " ");
  return t.length ? t : null;
}

function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const tags = input
    .map((t) => normalizeText(t))
    .filter(Boolean) as string[];

  // Deduplicate
  return Array.from(new Set(tags)).slice(0, 10);
}

export async function POST(req: Request) {
  await requireTylerAdmin();

  let body: Payload;

  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }

  const id = normalizeText(body.id);

  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Missing testimonial id" },
      { status: 400 }
    );
  }

  const display_name = normalizeText(body.displayName);

  // Tags: allow empty
  const tags = normalizeTags(body.tags);

  // Quote: optional edit, but always safe-trim to 400 chars
  const quote = normalizeText(body.quote);

  const update: Record<string, any> = {
    display_name,
    tags,
  };

  // Only update quote if provided (prevents accidental wipe)
  if (quote !== null) {
    update.quote = quote.slice(0, 400);
  }

  const { error } = await supabaseServer
    .from("testimonials")
    .update(update)
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
