import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  COACH_ATTRIBUTION_COOKIE_NAME,
  COACH_ATTRIBUTION_COOKIE_VALUE_COACH,
} from "@/lib/coach-attribution";
import {
  isVisitorId,
  marketingCookieOptions,
  parseAcquisitionCookie,
  SM_ACQ_COOKIE,
  SM_VISITOR_COOKIE,
  type AcquisitionCookiePayload,
} from "@/lib/marketing-attribution-pure";
import { supabaseServer } from "@/lib/supabase-server";

const CTA_METADATA_KEYS = new Set(["cta_surface"]);

export type MarketingEventInsert = {
  occurred_at?: string;
  event_type: "page_viewed" | "trial_cta_clicked" | "account_created";
  visitor_id: string;
  clerk_user_id?: string | null;
  path?: string | null;
  attribution: AcquisitionCookiePayload;
  metadata?: { cta_surface?: string } | null;
};

function sanitizeMetadata(
  raw: { cta_surface?: string } | null | undefined
): { cta_surface: string } | null {
  if (!raw || typeof raw.cta_surface !== "string") return null;
  const surface = raw.cta_surface.trim().slice(0, 40);
  if (!surface) return null;
  return { cta_surface: surface };
}

export async function insertMarketingEventFailOpen(
  row: MarketingEventInsert
): Promise<"ok" | "failed"> {
  try {
    const metadata = sanitizeMetadata(row.metadata);
    if (row.metadata && Object.keys(row.metadata).some((k) => !CTA_METADATA_KEYS.has(k))) {
      // extra keys dropped — never persist unknown metadata
    }
    const { error } = await supabaseServer.from("marketing_events").insert({
      occurred_at: row.occurred_at ?? new Date().toISOString(),
      event_type: row.event_type,
      visitor_id: row.visitor_id,
      clerk_user_id: row.clerk_user_id ?? null,
      path: row.path ?? null,
      utm_source: row.attribution.utm_source,
      utm_medium: row.attribution.utm_medium,
      utm_campaign: row.attribution.utm_campaign,
      utm_content: row.attribution.utm_content,
      source_normalized: row.attribution.source_normalized,
      is_paid_acquisition: row.attribution.is_paid_acquisition,
      referrer_host: row.attribution.referrer_host,
      metadata,
    });
    if (error) {
      if ((error as { code?: string }).code === "23505") return "ok";
      console.warn("[marketing-collect] insert failed", error.message);
      return "failed";
    }
    return "ok";
  } catch (err) {
    console.warn("[marketing-collect] insert threw", err);
    return "failed";
  }
}

export function collectFailOpenResponse(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export async function readMarketingCookiesFromRequest(req: Request): Promise<{
  visitorId: string | null;
  attribution: AcquisitionCookiePayload | null;
  coachCookie: string | null;
}> {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const map = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) map.set(key, value);
  }
  const visitorRaw = map.get(SM_VISITOR_COOKIE) ?? null;
  const acqRaw = map.get(SM_ACQ_COOKIE) ?? null;
  const coach = map.get(COACH_ATTRIBUTION_COOKIE_NAME) ?? null;
  return {
    visitorId: isVisitorId(visitorRaw) ? visitorRaw : null,
    attribution: parseAcquisitionCookie(acqRaw),
    coachCookie: coach === COACH_ATTRIBUTION_COOKIE_VALUE_COACH ? coach : null,
  };
}

export async function readMarketingCookiesFromStore(): Promise<{
  visitorId: string | null;
  attribution: AcquisitionCookiePayload | null;
}> {
  try {
    const store = await cookies();
    const visitorRaw = store.get(SM_VISITOR_COOKIE)?.value ?? null;
    const acqRaw = store.get(SM_ACQ_COOKIE)?.value ?? null;
    return {
      visitorId: isVisitorId(visitorRaw) ? visitorRaw : null,
      attribution: parseAcquisitionCookie(acqRaw),
    };
  } catch (err) {
    console.warn("[marketing-collect] cookie store unavailable", err);
    return { visitorId: null, attribution: null };
  }
}

export { marketingCookieOptions };
