import { NextRequest, NextResponse } from "next/server";

import { parseLandingAssignments, PROUD_TEST_COOKIE } from "@/lib/landing-experiment";
import {
  recordLandingBehavior,
  recordLandingExposures,
} from "@/lib/landing-experiment.server";
import {
  parseEngagedBucket,
  parseScrollMilestone,
  parseSectionList,
} from "@/lib/landing-experiment-telemetry";
import {
  collectFailOpenResponse,
  insertMarketingEventFailOpen,
  isClientCollectEventType,
  readMarketingCookiesFromRequest,
} from "@/lib/marketing-collect";
import { isHomepageVideoEventType, parseVimeoVideoId } from "@/lib/homepage-video";
import {
  allowlistedCtaSurface,
  isMarketingPageViewPath,
  normalizePathname,
} from "@/lib/marketing-attribution-pure";
import { parseContentProduction } from "@/lib/content-production";
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
    if (!isClientCollectEventType(eventType)) {
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
      if (rec.experiment_exposure === true) {
        await recordLandingExposures({
          visitorId: cookies.visitorId,
          path,
          assignmentCookie: req.cookies.get(PROUD_TEST_COOKIE)?.value,
          attribution: cookies.attribution,
        });
        return collectFailOpenResponse();
      }
      if (rec.experiment_behavior === true) {
        const assignment = parseLandingAssignments(req.cookies.get(PROUD_TEST_COOKIE)?.value).find(
          (item) => item.path === path
        );
        if (!assignment) return collectFailOpenResponse();
        await recordLandingBehavior({
          visitorId: cookies.visitorId,
          experimentId: assignment.experimentId,
          viewedPath: path,
          sections: parseSectionList(rec.sections, path),
          scroll: parseScrollMilestone(rec.scroll),
          engaged: parseEngagedBucket(rec.engaged),
          attribution: cookies.attribution,
          userAgent: req.headers.get("user-agent"),
          synthetic: req.headers.get("x-sm-exp-probe") === "1",
        });
        return collectFailOpenResponse();
      }
    }

    if (isHomepageVideoEventType(eventType)) {
      const vimeoVideoId = parseVimeoVideoId(rec.vimeo_video_id);
      if (!vimeoVideoId) return collectFailOpenResponse();
      await insertMarketingEventFailOpen({
        event_type: eventType,
        visitor_id: cookies.visitorId,
        path: path || null,
        attribution: cookies.attribution,
        metadata: { vimeo_video_id: vimeoVideoId },
      });
      return collectFailOpenResponse();
    }

    const production = parseContentProduction(rec.content_production);
    const metadata =
      eventType === "trial_cta_clicked"
        ? allowlistedCtaSurface(rec.cta_surface)
          ? { cta_surface: allowlistedCtaSurface(rec.cta_surface)! }
          : null
        : eventType === "page_viewed" && production
          ? { production }
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
