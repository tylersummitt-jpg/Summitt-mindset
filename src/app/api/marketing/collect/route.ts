import { NextRequest, NextResponse } from "next/server";

import {
  collectFailOpenResponse,
  insertMarketingEventFailOpen,
  readMarketingCookiesFromRequest,
} from "@/lib/marketing-collect";
import {
  allowlistedCtaSurface,
  isMarketingPageViewPath,
  normalizePathname,
} from "@/lib/marketing-attribution-pure";
import { isNativeSummittMindsetAppRequestFromRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4096;

async function readJsonCapped(req: NextRequest): Promise<unknown> {
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    if (isNativeSummittMindsetAppRequestFromRequest(req)) {
      return collectFailOpenResponse();
    }

    const body = await readJsonCapped(req);
    if (!body || typeof body !== "object") return collectFailOpenResponse();
    const rec = body as Record<string, unknown>;
    const eventType = rec.event_type;
    if (eventType !== "page_viewed" && eventType !== "trial_cta_clicked") {
      return collectFailOpenResponse();
    }

    const cookies = await readMarketingCookiesFromRequest(req);
    if (!cookies.visitorId || !cookies.attribution) {
      return collectFailOpenResponse();
    }

    const path =
      typeof rec.path === "string" ? normalizePathname(rec.path) : "";
    if (eventType === "page_viewed") {
      if (!path || !isMarketingPageViewPath(path)) {
        return collectFailOpenResponse();
      }
    }

    const metadata =
      eventType === "trial_cta_clicked"
        ? allowlistedCtaSurface(rec.cta_surface)
          ? { cta_surface: allowlistedCtaSurface(rec.cta_surface)! }
          : null
        : null;

    await insertMarketingEventFailOpen({
      event_type: eventType,
      visitor_id: cookies.visitorId,
      path: path || null,
      attribution: cookies.attribution,
      metadata,
    });
    return collectFailOpenResponse();
  } catch {
    return collectFailOpenResponse();
  }
}

export async function GET() {
  return new NextResponse(null, { status: 204 });
}
