import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export async function GET() {
  const { data } = await supabaseServer
    .from("pat_quotes")
    .select("quote_text, slug")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "No quotes found" },
      { status: 404 }
    );
  }

  const quote = data[Math.floor(Math.random() * data.length)];

  return NextResponse.json({
    quote: quote.quote_text,
    slug: quote.slug,
    url: `/pat-summitt-quotes/${quote.slug}`,
  });
}
