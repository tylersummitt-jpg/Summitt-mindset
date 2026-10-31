import { connection, NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function healthResponse(ok: boolean): NextResponse {
  return NextResponse.json({ ok }, { status: ok ? 200 : 503, headers: NO_STORE });
}

async function runSupabaseHealthCheck(): Promise<NextResponse> {
  try {
    await connection();
    const { data, error } = await supabaseServer
      .from("film_videos")
      .select("id")
      .limit(1)
      .abortSignal(AbortSignal.timeout(4000));
    if (error || !Array.isArray(data)) return healthResponse(false);
    return healthResponse(true);
  } catch {
    return healthResponse(false);
  }
}

export function GET(): Promise<NextResponse> {
  return runSupabaseHealthCheck();
}

export function HEAD(): Promise<NextResponse> {
  return runSupabaseHealthCheck();
}
