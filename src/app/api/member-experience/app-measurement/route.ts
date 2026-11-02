import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";
import { detectSummittMindsetPlatformFromRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import { memberExperiencePlatform } from "@/lib/member-experience-event";
import {
  MAX_MEASURED_MS,
  isNavigationSurface,
  validMeasurementId,
  type MeasurementRecord,
} from "@/lib/mobile-measurement";
import { recordAppMeasurement } from "@/lib/mobile-measurement.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 2048;

type ParsedMeasurement = {
  record: MeasurementRecord;
  measurementId: string;
  surface: "victory_room" | "ask_pat" | "film_room" | "programs";
  launchKind: "cold" | "warm" | "navigation";
  elapsedMs: number | null;
};

function parsedMeasurement(body: unknown): ParsedMeasurement | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = (body as { record?: unknown }).record;
  const measurementId = (body as { measurementId?: unknown }).measurementId;
  const surface = (body as { surface?: unknown }).surface;
  const launchKind = (body as { launchKind?: unknown }).launchKind;
  const elapsed = (body as { elapsedMs?: unknown }).elapsedMs;
  if (
    record !== "startup" &&
    record !== "navigation" &&
    record !== "startup_failed" &&
    record !== "navigation_failed"
  ) {
    return null;
  }
  if (!validMeasurementId(measurementId) || !isNavigationSurface(surface)) return null;
  if (launchKind !== "cold" && launchKind !== "warm" && launchKind !== "navigation") return null;
  const failed = record === "startup_failed" || record === "navigation_failed";
  if ((record === "startup" || record === "startup_failed") && launchKind === "navigation") return null;
  if ((record === "navigation" || record === "navigation_failed") && launchKind !== "navigation") return null;
  if ((record === "startup" || record === "startup_failed") && surface !== "victory_room") return null;
  if (failed) {
    if (elapsed != null) return null;
    return { record, measurementId, surface, launchKind, elapsedMs: null };
  }
  if (typeof elapsed !== "number" || !Number.isInteger(elapsed) || elapsed < 0 || elapsed > MAX_MEASURED_MS) {
    return null;
  }
  return { record, measurementId, surface, launchKind, elapsedMs: elapsed };
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });
  const user = await currentUser();
  if (!user || user.id !== userId) return NextResponse.json({ ok: false }, { status: 401 });

  let raw = "";
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (raw.length > MAX_BODY_CHARS) return NextResponse.json({ ok: false }, { status: 400 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = parsedMeasurement(body);
  if (!parsed) return NextResponse.json({ ok: false }, { status: 400 });
  if (!isSubscribedFromPublicMetadata(user.publicMetadata)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const recorded = await recordAppMeasurement({
    clerkUserId: user.id,
    metadata: user.publicMetadata,
    platform: memberExperiencePlatform(detectSummittMindsetPlatformFromRequest(req)),
    ...parsed,
  });
  if (recorded.status === "rejected") return NextResponse.json({ ok: false }, { status: 403 });
  if (recorded.status === "failed") return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true });
}
